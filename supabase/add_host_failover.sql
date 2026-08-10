-- Ejecutar una sola vez en el SQL Editor del proyecto Supabase de Mundialito.
--
-- Requisitos asumidos por el frontend existente:
--   public.rooms(code, status, host_id)
--   public.players(id, room_code, joined_at, resultados jsonb)
--
-- Las funciones son SECURITY INVOKER: siguen respetando los grants y las
-- políticas RLS actuales de rooms/players; no agregan ni cambian policies.

alter table public.players
add column if not exists last_seen timestamptz;

alter table public.players
alter column last_seen set default now();

-- Las filas antiguas reciben un pulso inicial. Así una migración/reinicio no
-- provoca que otra pestaña robe el host inmediatamente.
update public.players
set last_seen = now()
where last_seen is null;

alter table public.players
alter column last_seen set not null;

create index if not exists players_room_last_seen_idx
on public.players (room_code, last_seen);

-- Una sala puede quedar momentáneamente vacía cuando sale su último jugador.
-- El próximo jugador que entre reclamará el host con el heartbeat.
alter table public.rooms
alter column host_id drop not null;


-- Pulso de presencia + claim atómico. El timeout de 90 segundos es
-- deliberadamente mayor que el heartbeat del navegador (15 s): tolera latencia,
-- suspensiones breves y el throttling habitual de pestañas en segundo plano.
create or replace function public.touch_and_claim_room_host(
  p_room_code text,
  p_player_id text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_old_host text;
  v_host_seen timestamptz;
  v_candidate public.players.id%type;
  v_old_results jsonb := '{}'::jsonb;
  v_new_results jsonb := '{}'::jsonb;
  v_abandonados text[] := array[]::text[];
begin
  update public.players p
  set last_seen = clock_timestamp()
  where p.room_code::text = p_room_code
    and p.id::text = p_player_id;

  -- Solo un jugador que realmente pertenece a la sala puede reclamarla.
  if not found then
    return null;
  end if;

  -- Serializa todos los claims de esta sala y elimina carreras entre clientes.
  select r.status, r.host_id::text
  into v_status, v_old_host
  from public.rooms r
  where r.code::text = p_room_code
  for update;

  if not found then
    return null;
  end if;

  if v_old_host is not null then
    select p.last_seen
    into v_host_seen
    from public.players p
    where p.room_code::text = p_room_code
      and p.id::text = v_old_host;
  end if;

  -- Host presente: no se toca nada. Las filas de una migración reciente también
  -- caen aquí gracias al backfill de last_seen.
  if v_old_host is not null
     and v_host_seen is not null
     and v_host_seen >= clock_timestamp() - interval '90 seconds' then
    return v_old_host;
  end if;

  -- Elección determinista entre clientes vivos: primero quien entró antes y,
  -- ante empate, el id. Se excluye al host vencido.
  select p.id
  into v_candidate
  from public.players p
  where p.room_code::text = p_room_code
    and (v_old_host is null or p.id::text <> v_old_host)
    and p.last_seen >= clock_timestamp() - interval '90 seconds'
  order by p.joined_at nulls last, p.id::text
  limit 1;

  if v_candidate is null then
    return v_old_host;
  end if;

  update public.rooms r
  set host_id = v_candidate
  where r.code::text = p_room_code;

  if v_status = 'running' then
    -- El cuadro depende de que todas las filas/equipos humanos permanezcan. Se
    -- conserva el host viejo, se lo marca ausente y se heredan los dos campos de
    -- coordinación que torneo.js guarda en resultados del anfitrión.
    select coalesce(p.resultados, '{}'::jsonb)
    into v_old_results
    from public.players p
    where p.room_code::text = p_room_code
      and p.id::text = v_old_host;
    v_old_results := coalesce(v_old_results, '{}'::jsonb);

    select coalesce(p.resultados, '{}'::jsonb)
    into v_new_results
    from public.players p
    where p.room_code::text = p_room_code
      and p.id = v_candidate;
    v_new_results := coalesce(v_new_results, '{}'::jsonb);

    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados
    from (
      select value as valor
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_old_results -> '_abandonados') = 'array'
          then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select value as valor
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_new_results -> '_abandonados') = 'array'
          then v_new_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select v_old_host where v_old_host is not null
    ) x
    where x.valor <> v_candidate::text;

    v_new_results := jsonb_set(
      v_new_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    if v_old_results ? '_paso' then
      v_new_results := jsonb_set(
        v_new_results, '{_paso}', v_old_results -> '_paso', true);
    end if;

    update public.players p
    set resultados = v_new_results
    where p.room_code::text = p_room_code
      and p.id = v_candidate;
  else
    -- En lobby/draft no existe aún un bracket que preservar: la fila vencida
    -- se elimina para no dejar un jugador fantasma ocupando cupo.
    delete from public.players p
    where p.room_code::text = p_room_code
      and p.id::text = v_old_host;
  end if;

  return v_candidate::text;
end;
$$;


-- Salida voluntaria. Usa el mismo bloqueo de rooms para transferir el mando y
-- retirar/marcar al jugador como una sola operación observable por Realtime.
create or replace function public.leave_room_and_handoff(
  p_room_code text,
  p_player_id text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_old_host text;
  v_candidate public.players.id%type;
  v_old_results jsonb := '{}'::jsonb;
  v_new_results jsonb := '{}'::jsonb;
  v_abandonados text[] := array[]::text[];
begin
  select r.status, r.host_id::text
  into v_status, v_old_host
  from public.rooms r
  where r.code::text = p_room_code
  for update;

  if not found or not exists (
    select 1 from public.players p
    where p.room_code::text = p_room_code and p.id::text = p_player_id
  ) then
    return v_old_host;
  end if;

  if v_status <> 'running' then
    if v_old_host = p_player_id then
      select p.id
      into v_candidate
      from public.players p
      where p.room_code::text = p_room_code
        and p.id::text <> p_player_id
        and p.last_seen >= clock_timestamp() - interval '90 seconds'
      order by p.joined_at nulls last, p.id::text
      limit 1;

      update public.rooms r
      set host_id = v_candidate
      where r.code::text = p_room_code;
    end if;

    delete from public.players p
    where p.room_code::text = p_room_code
      and p.id::text = p_player_id;

    return case when v_old_host = p_player_id
      then v_candidate::text else v_old_host end;
  end if;

  -- En running nunca se elimina la fila: forma parte de los equipos del cuadro.
  if v_old_host = p_player_id then
    select p.id
    into v_candidate
    from public.players p
    where p.room_code::text = p_room_code
      and p.id::text <> p_player_id
      and p.last_seen >= clock_timestamp() - interval '90 seconds'
    order by p.joined_at nulls last, p.id::text
    limit 1;

    -- Si no queda nadie conectado, se conserva el host viejo; no existe un
    -- cliente al que entregar controles. Su equipo igualmente queda marcado.
    if v_candidate is not null then
      update public.rooms r
      set host_id = v_candidate
      where r.code::text = p_room_code;
    end if;
  else
    select p.id
    into v_candidate
    from public.players p
    where p.room_code::text = p_room_code
      and p.id::text = v_old_host;
  end if;

  select coalesce(p.resultados, '{}'::jsonb)
  into v_old_results
  from public.players p
  where p.room_code::text = p_room_code
    and p.id::text = v_old_host;
  v_old_results := coalesce(v_old_results, '{}'::jsonb);

  if v_candidate is not null then
    select coalesce(p.resultados, '{}'::jsonb)
    into v_new_results
    from public.players p
    where p.room_code::text = p_room_code
      and p.id = v_candidate;
    v_new_results := coalesce(v_new_results, '{}'::jsonb);

    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados
    from (
      select value as valor
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_old_results -> '_abandonados') = 'array'
          then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select value as valor
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_new_results -> '_abandonados') = 'array'
          then v_new_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select p_player_id
    ) x
    where x.valor <> v_candidate::text;

    v_new_results := jsonb_set(
      v_new_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    if v_old_host = p_player_id and v_old_results ? '_paso' then
      v_new_results := jsonb_set(
        v_new_results, '{_paso}', v_old_results -> '_paso', true);
    end if;

    update public.players p
    set resultados = v_new_results
    where p.room_code::text = p_room_code
      and p.id = v_candidate;
  else
    -- Sala running de un solo jugador: conserva su fila y deja constancia de la
    -- ausencia, aunque no haya otro navegador que vaya a continuarla.
    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados
    from (
      select value as valor
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_old_results -> '_abandonados') = 'array'
          then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select p_player_id
    ) x;
    v_old_results := jsonb_set(
      v_old_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    update public.players p
    set resultados = v_old_results
    where p.room_code::text = p_room_code
      and p.id::text = p_player_id;
  end if;

  return coalesce(v_candidate::text, v_old_host);
end;
$$;

revoke all on function public.touch_and_claim_room_host(text, text) from public;
revoke all on function public.leave_room_and_handoff(text, text) from public;
grant execute on function public.touch_and_claim_room_host(text, text) to anon, authenticated;
grant execute on function public.leave_room_and_handoff(text, text) to anon, authenticated;

comment on function public.touch_and_claim_room_host(text, text) is
'Actualiza presencia y releva atómicamente un host ausente tras 90 segundos.';
comment on function public.leave_room_and_handoff(text, text) is
'Procesa salida voluntaria, transfiere host y preserva equipos durante running.';
