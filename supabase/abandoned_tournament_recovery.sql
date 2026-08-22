-- Mundialito: recuperación oportunista de rooms abandonadas.
-- Ejecutar UNA VEZ en Supabase SQL Editor, después de add_persistent_groups.sql
-- y unified_group_lobby.sql. No modifica resultados, historial ni gameplay.

alter table public.rooms
add column if not exists cancelled_at timestamptz;

-- Amplía solamente el CHECK de status para conservar los estados existentes y
-- distinguir una cancelación administrativa de una finalización deportiva.
do $$
declare
  v_constraint record;
  v_status_attnum smallint;
begin
  select a.attnum into v_status_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.rooms'::regclass
    and a.attname = 'status'
    and not a.attisdropped;

  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.rooms'::regclass
      and c.contype = 'c'
      and v_status_attnum = any(c.conkey)
  loop
    execute format('alter table public.rooms drop constraint %I', v_constraint.conname);
  end loop;

  alter table public.rooms add constraint rooms_status_check
    check (status in ('lobby', 'draft', 'running', 'finished', 'cancelled'));
end;
$$;

-- El trigger existente ya protege los campos de ciclo de vida. Incluimos la
-- cancelación para que el cliente nunca pueda cancelar una room por UPDATE.
create or replace function public.protect_persistent_group_room_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(
    current_setting('mundialito.persistent_group_rpc', true), ''
  ) = 'on';
begin
  if tg_op = 'INSERT' then
    if new.group_id is not null and not v_internal then
      raise exception 'Los torneos de grupo solo se crean mediante la RPC autorizada.';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.group_id is not null and not v_internal then
      raise exception 'Un torneo historico de grupo no se puede eliminar directamente.';
    end if;
    return old;
  end if;

  if not v_internal
     and (old.group_id is not null or new.group_id is not null)
     and (
       new.group_id is distinct from old.group_id
       or new.host_id is distinct from old.host_id
       or new.seed is distinct from old.seed
       or new.modo is distinct from old.modo
       or new.enabled_squads is distinct from old.enabled_squads
       or new.finalized_at is distinct from old.finalized_at
       or new.cancelled_at is distinct from old.cancelled_at
       or new.final_podium is distinct from old.final_podium
       or (new.status in ('finished', 'cancelled') and old.status is distinct from new.status)
       or (old.status in ('finished', 'cancelled') and new.status is distinct from old.status)
     ) then
    raise exception 'Los campos historicos del torneo solo cambian mediante la RPC autorizada.';
  end if;
  return new;
end;
$$;

-- El Vestuario unificado invoca esta RPC primero. Bajo el lock del grupo, una
-- room draft/running se cancela solo si NADIE tiene last_seen en 30 minutos.
-- Una cancelada sale del índice parcial de rooms activas y se crea otra lobby.
create or replace function public.start_persistent_group_tournament(
  p_group_id uuid,
  p_member_id uuid,
  p_session_token text,
  p_modo text,
  p_enabled_squads text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_active public.rooms%rowtype;
  v_code public.rooms.code%type;
  v_player_id public.players.id%type;
  v_seed integer;
  v_inserted boolean := false;
  v_attempt integer;
  v_now timestamptz := clock_timestamp();
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then raise exception 'El grupo no existe.'; end if;
  if not public.valid_persistent_member_session(p_group_id, p_member_id, p_session_token) then
    raise exception 'La sesion vencio. Vuelve a entrar con tu PIN.';
  end if;
  select * into v_member from public.group_members gm
  where gm.group_id = p_group_id and gm.id = p_member_id;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);

  select * into v_active
  from public.rooms r
  where r.group_id = p_group_id and r.finalized_at is null
    and r.status in ('lobby', 'draft', 'running')
  order by r.created_at desc
  limit 1
  for update;

  if found then
    if v_active.status in ('draft', 'running') and not exists (
      select 1 from public.players p
      where p.room_code::text = v_active.code::text
        and p.last_seen >= v_now - interval '30 minutes'
    ) then
      update public.rooms r
      set status = 'cancelled', cancelled_at = v_now
      where r.code::text = v_active.code::text;
    else
      raise exception 'El grupo ya tiene un Mundialito activo.';
    end if;
  end if;

  if coalesce(p_modo, '') !~ '^(almanaque|penales)([|](16|32))?$' then
    raise exception 'El modo del Mundialito no es valido.';
  end if;
  if p_enabled_squads is not null and cardinality(p_enabled_squads) = 0 then
    raise exception 'Activa al menos un plantel para el draft.';
  end if;

  v_seed := floor(random() * 2147483647)::integer;
  v_player_id := extensions.gen_random_uuid();
  for v_attempt in 1..20 loop
    v_code := public.new_internal_room_code();
    begin
      insert into public.rooms(
        code, status, seed, host_id, modo, enabled_squads, group_id
      ) values (
        v_code, 'lobby', v_seed, v_player_id, p_modo, p_enabled_squads, p_group_id
      );
      v_inserted := true;
      exit;
    exception when unique_violation then
      if exists (
        select 1 from public.rooms r
        where r.group_id = p_group_id and r.finalized_at is null
          and r.status in ('lobby', 'draft', 'running')
      ) then
        raise exception 'El grupo ya tiene un Mundialito activo.';
      end if;
    end;
  end loop;
  if not v_inserted then raise exception 'No se pudo reservar un codigo interno para el torneo.'; end if;

  insert into public.players(
    id, room_code, member_id, name, ready, last_seen
  ) values (
    v_player_id, v_code, p_member_id, v_member.display_name, false, v_now
  );

  update public.group_members set last_seen_at = v_now where id = p_member_id;
  update public.groups set updated_at = v_now where id = p_group_id;
  return jsonb_build_object(
    'code', v_code::text, 'playerId', v_player_id::text, 'status', 'lobby',
    'recovered_abandoned_room', v_active.code is not null
  );
end;
$$;

-- Un cliente tardío nunca revive una room cancelada con un heartbeat.
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
  select r.status, r.host_id::text into v_status, v_old_host
  from public.rooms r where r.code::text = p_room_code for update;
  if not found then return null; end if;
  if v_status in ('finished', 'cancelled') then return v_old_host; end if;

  update public.players p set last_seen = clock_timestamp()
  where p.room_code::text = p_room_code and p.id::text = p_player_id;
  if not found then return null; end if;
  perform set_config('mundialito.persistent_group_rpc', 'on', true);

  if v_old_host is not null then
    select p.last_seen into v_host_seen from public.players p
    where p.room_code::text = p_room_code and p.id::text = v_old_host;
  end if;
  if v_old_host is not null and v_host_seen is not null
     and v_host_seen >= clock_timestamp() - interval '90 seconds' then return v_old_host; end if;

  select p.id into v_candidate from public.players p
  where p.room_code::text = p_room_code
    and (v_old_host is null or p.id::text <> v_old_host)
    and p.last_seen >= clock_timestamp() - interval '90 seconds'
  order by p.joined_at nulls last, p.id::text limit 1;
  if v_candidate is null then return v_old_host; end if;
  update public.rooms r set host_id = v_candidate where r.code::text = p_room_code;

  if v_status = 'running' then
    select coalesce(p.resultados, '{}'::jsonb) into v_old_results from public.players p
    where p.room_code::text = p_room_code and p.id::text = v_old_host;
    v_old_results := coalesce(v_old_results, '{}'::jsonb);
    select coalesce(p.resultados, '{}'::jsonb) into v_new_results from public.players p
    where p.room_code::text = p_room_code and p.id = v_candidate;
    v_new_results := coalesce(v_new_results, '{}'::jsonb);
    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados from (
      select value as valor from jsonb_array_elements_text(case when jsonb_typeof(v_old_results -> '_abandonados') = 'array' then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select value as valor from jsonb_array_elements_text(case when jsonb_typeof(v_new_results -> '_abandonados') = 'array' then v_new_results -> '_abandonados' else '[]'::jsonb end)
      union all select v_old_host
    ) x where x.valor <> v_candidate::text;
    v_new_results := jsonb_set(v_new_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    if v_old_results ? '_paso' then
      v_new_results := jsonb_set(v_new_results, '{_paso}', v_old_results -> '_paso', true);
    end if;
    update public.players p set resultados = v_new_results
    where p.room_code::text = p_room_code and p.id = v_candidate;
  end if;
  return v_candidate::text;
end;
$$;

-- Solo lobby permite una salida explícita que elimine la fila. Draft y running
-- preservan al participante y su estado completo para la reconexión.
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
begin
  select r.status, r.host_id::text into v_status, v_old_host
  from public.rooms r where r.code::text = p_room_code for update;
  if not found or v_status in ('finished', 'cancelled') then return v_old_host; end if;
  if not exists (select 1 from public.players p where p.room_code::text = p_room_code and p.id::text = p_player_id) then
    return v_old_host;
  end if;
  if v_status in ('draft', 'running') then return v_old_host; end if;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);
  if v_old_host = p_player_id then
    select p.id into v_candidate from public.players p
    where p.room_code::text = p_room_code and p.id::text <> p_player_id
      and p.last_seen >= clock_timestamp() - interval '90 seconds'
    order by p.joined_at nulls last, p.id::text limit 1;
    update public.rooms r set host_id = v_candidate where r.code::text = p_room_code;
  end if;
  delete from public.players p where p.room_code::text = p_room_code and p.id::text = p_player_id;
  return case when v_old_host = p_player_id then v_candidate::text else v_old_host end;
end;
$$;

revoke all on function public.start_persistent_group_tournament(uuid, uuid, text, text, text[])
  from public, anon, authenticated;
revoke all on function public.touch_and_claim_room_host(text, text)
  from public, anon, authenticated;
revoke all on function public.leave_room_and_handoff(text, text)
  from public, anon, authenticated;
grant execute on function public.start_persistent_group_tournament(uuid, uuid, text, text, text[])
  to anon, authenticated;
grant execute on function public.touch_and_claim_room_host(text, text)
  to anon, authenticated;
grant execute on function public.leave_room_and_handoff(text, text)
  to anon, authenticated;
