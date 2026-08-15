-- Mundialito: grupos permanentes, miembros recuperables e historial trazable.
-- Ejecutar una vez en el SQL Editor de Supabase DESPUES de crear las tablas
-- base rooms y players. Esta migracion ya incorpora enabled_squads, last_seen
-- y las RPC de failover: no exige ejecutar antes las otras dos migraciones.
-- La migracion es repetible: todos los objetos usan IF NOT EXISTS o
-- CREATE OR REPLACE.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_display_name_length check (char_length(display_name) between 5 and 50),
  constraint groups_normalized_key_length check (char_length(normalized_key) between 5 and 50)
);

create unique index if not exists groups_normalized_key_uidx
on public.groups (normalized_key);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint group_members_display_name_length check (char_length(display_name) between 1 and 40),
  constraint group_members_normalized_name_length check (char_length(normalized_name) between 1 and 40),
  constraint group_members_group_name_unique unique (group_id, normalized_name),
  constraint group_members_group_id_id_unique unique (group_id, id)
);

create table if not exists public.group_member_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.group_members(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists group_member_sessions_member_expiry_idx
on public.group_member_sessions (member_id, expires_at);

alter table public.rooms
add column if not exists group_id uuid references public.groups(id) on delete restrict;

alter table public.rooms
add column if not exists created_at timestamptz not null default now();

alter table public.rooms
add column if not exists enabled_squads text[];

alter table public.rooms
add column if not exists finalized_at timestamptz;

alter table public.rooms
add column if not exists final_podium jsonb;

alter table public.players
add column if not exists member_id uuid references public.group_members(id) on delete restrict;

alter table public.players
add column if not exists last_seen timestamptz;

alter table public.players
alter column last_seen set default now();

update public.players set last_seen = now() where last_seen is null;

alter table public.players
alter column last_seen set not null;

create index if not exists players_room_last_seen_idx
on public.players (room_code, last_seen);

alter table public.rooms
alter column host_id drop not null;

-- Una identidad persistente solo puede ocupar una fila por torneo. Los players
-- legacy conservan member_id NULL y no chocan entre si.
create unique index if not exists players_room_member_uidx
on public.players (room_code, member_id)
where member_id is not null;

create index if not exists rooms_group_history_idx
on public.rooms (group_id, finalized_at desc)
where group_id is not null;

create index if not exists players_member_idx
on public.players (member_id)
where member_id is not null;

-- Reemplaza solo el CHECK que involucra la columna status, si la instalacion
-- antigua lo limitaba a lobby/draft/running, y agrega finished.
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

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rooms'::regclass and conname = 'rooms_status_check'
  ) then
    alter table public.rooms add constraint rooms_status_check
      check (status in ('lobby', 'draft', 'running', 'finished'));
  end if;
end;
$$;

-- La garantia 0/1 torneo activo vive en la base, no en una consulta previa del
-- frontend. finalized_at se incluye para tolerar objetos legacy reparados.
create unique index if not exists rooms_one_active_per_group_uidx
on public.rooms (group_id)
where group_id is not null
  and finalized_at is null
  and status in ('lobby', 'draft', 'running');

create table if not exists public.tournament_participants (
  room_code text not null references public.rooms(code) on delete cascade,
  group_id uuid not null references public.groups(id) on delete restrict,
  member_id uuid not null references public.group_members(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (room_code, member_id),
  constraint tournament_participants_group_member_fk
    foreign key (group_id, member_id)
    references public.group_members(group_id, id) on delete restrict
);

create index if not exists tournament_participants_group_member_idx
on public.tournament_participants (group_id, member_id, room_code);

create table if not exists public.tournament_results (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  room_code text not null references public.rooms(code) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete restrict,
  place integer not null check (place in (1, 2, 3)),
  award_type text not null check (award_type in ('cup', 'silver', 'bronze')),
  created_at timestamptz not null default now(),
  constraint tournament_results_award_matches_place check (
    (place = 1 and award_type = 'cup') or
    (place = 2 and award_type = 'silver') or
    (place = 3 and award_type = 'bronze')
  ),
  constraint tournament_results_group_member_fk
    foreign key (group_id, member_id)
    references public.group_members(group_id, id) on delete restrict,
  constraint tournament_results_room_place_unique unique (room_code, place),
  constraint tournament_results_room_member_unique unique (room_code, member_id)
);

create index if not exists tournament_results_group_member_idx
on public.tournament_results (group_id, member_id, place);

-- Los hashes nunca se consultan desde el cliente. Toda lectura/escritura de las
-- tablas nuevas pasa por RPCs SECURITY DEFINER de superficie reducida.
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_member_sessions enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.tournament_results enable row level security;

revoke all on table public.groups from anon, authenticated;
revoke all on table public.group_members from anon, authenticated;
revoke all on table public.group_member_sessions from anon, authenticated;
revoke all on table public.tournament_participants from anon, authenticated;
revoke all on table public.tournament_results from anon, authenticated;

-- rooms/players ya existian y pueden conservar politicas RLS permisivas. Estos
-- triggers impiden que el cliente legacy falsifique la relacion historica o
-- marque una finalizacion por UPDATE directo. Las RPCs autorizadas levantan un
-- guard transaccional antes de tocar los campos protegidos.
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
    or new.final_podium is distinct from old.final_podium
    or (new.status = 'finished' and old.status is distinct from new.status)
    or (old.status = 'finished' and new.status is distinct from old.status)
  ) then
    raise exception 'Los campos historicos del torneo solo cambian mediante la RPC autorizada.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_persistent_player_member()
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
    if new.member_id is not null and not v_internal then
      raise exception 'La identidad persistente solo se asigna mediante la RPC autorizada.';
    end if;
  elsif new.member_id is distinct from old.member_id and not v_internal then
    raise exception 'La identidad persistente de una participacion es inmutable.';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.rooms'::regclass
      and tgname = 'protect_persistent_group_room_fields_trigger'
      and not tgisinternal
  ) then
    create trigger protect_persistent_group_room_fields_trigger
    before insert or update or delete on public.rooms
    for each row execute function public.protect_persistent_group_room_fields();
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.players'::regclass
      and tgname = 'protect_persistent_player_member_trigger'
      and not tgisinternal
  ) then
    create trigger protect_persistent_player_member_trigger
    before insert or update of member_id on public.players
    for each row execute function public.protect_persistent_player_member();
  end if;
end;
$$;

create or replace function public.clean_persistent_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g');
$$;

create or replace function public.normalize_persistent_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(extensions.unaccent(public.clean_persistent_name(p_value)));
$$;

create or replace function public.issue_persistent_member_session(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz := clock_timestamp() + interval '30 days';
begin
  select * into v_member
  from public.group_members gm
  where gm.id = p_member_id;
  if not found then raise exception 'El miembro no existe.'; end if;

  delete from public.group_member_sessions s
  where s.expires_at <= clock_timestamp();

  insert into public.group_member_sessions(member_id, token_hash, expires_at)
  values (
    v_member.id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expires
  );

  update public.group_members
  set last_seen_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = v_member.id;

  return jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_member.id,
      'group_id', v_member.group_id,
      'display_name', v_member.display_name,
      'normalized_name', v_member.normalized_name,
      'created_at', v_member.created_at,
      'last_seen_at', clock_timestamp()
    ),
    'token', v_token,
    'expires_at', v_expires
  );
end;
$$;

create or replace function public.valid_persistent_member_session(
  p_group_id uuid,
  p_member_id uuid,
  p_session_token text
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    join public.group_member_sessions s on s.member_id = gm.id
    where gm.group_id = p_group_id
      and gm.id = p_member_id
      and s.token_hash = encode(extensions.digest(coalesce(p_session_token, ''), 'sha256'), 'hex')
      and s.expires_at > clock_timestamp()
  );
$$;

create or replace function public.find_persistent_group(p_group_key text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_key text := public.normalize_persistent_key(p_group_key);
  v_group public.groups%rowtype;
begin
  if char_length(replace(v_key, ' ', '')) < 5 or char_length(v_key) > 50 then
    raise exception 'La clave debe tener entre 5 caracteres significativos y 50 caracteres.';
  end if;
  select * into v_group from public.groups g where g.normalized_key = v_key;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_group.id, 'display_name', v_group.display_name,
    'normalized_key', v_group.normalized_key, 'created_at', v_group.created_at,
    'updated_at', v_group.updated_at
  );
end;
$$;

create or replace function public.create_persistent_group(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display text := public.clean_persistent_name(p_display_name);
  v_key text := public.normalize_persistent_key(p_display_name);
  v_group public.groups%rowtype;
begin
  if char_length(replace(v_key, ' ', '')) < 5 or char_length(v_display) > 50 then
    raise exception 'La clave debe tener entre 5 caracteres significativos y 50 caracteres.';
  end if;
  if v_display !~ '^[[:alnum:] ]+$' then
    raise exception 'La clave solo puede contener letras, numeros y espacios.';
  end if;

  begin
    insert into public.groups(display_name, normalized_key)
    values (v_display, v_key)
    returning * into v_group;
  exception when unique_violation then
    select * into v_group from public.groups g where g.normalized_key = v_key;
  end;

  return jsonb_build_object(
    'id', v_group.id, 'display_name', v_group.display_name,
    'normalized_key', v_group.normalized_key, 'created_at', v_group.created_at,
    'updated_at', v_group.updated_at
  );
end;
$$;

create or replace function public.create_persistent_group_member(
  p_group_id uuid,
  p_display_name text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display text := public.clean_persistent_name(p_display_name);
  v_name text := public.normalize_persistent_key(p_display_name);
  v_member_id uuid;
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id) then
    raise exception 'El grupo no existe.';
  end if;
  if char_length(v_display) < 1 or char_length(v_display) > 40
     or v_display !~ '^[[:alnum:] ]+$' then
    raise exception 'El nombre debe usar letras, numeros y espacios (maximo 40 caracteres).';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'El PIN debe tener entre 4 y 6 digitos.';
  end if;

  begin
    insert into public.group_members(
      group_id, display_name, normalized_name, pin_hash, last_seen_at
    ) values (
      p_group_id, v_display, v_name,
      extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), clock_timestamp()
    ) returning id into v_member_id;
  exception when unique_violation then
    raise exception 'Ese nombre ya existe en el grupo. Entra como miembro existente.';
  end;

  return public.issue_persistent_member_session(v_member_id);
end;
$$;

create or replace function public.claim_persistent_group_member(
  p_group_id uuid,
  p_member_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then
    raise exception 'El PIN debe tener entre 4 y 6 digitos.';
  end if;
  select gm.pin_hash into v_hash
  from public.group_members gm
  where gm.group_id = p_group_id and gm.id = p_member_id;

  -- El mismo mensaje para nombre inexistente y PIN incorrecto evita confirmar
  -- identidades a quien solo esta tanteando el endpoint.
  if v_hash is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    raise exception 'Miembro o PIN incorrecto.';
  end if;
  return public.issue_persistent_member_session(p_member_id);
end;
$$;

create or replace function public.get_persistent_group_dashboard(p_group_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_group jsonb;
  v_members jsonb;
  v_active jsonb;
  v_recent jsonb;
  v_last_champion jsonb;
begin
  select jsonb_build_object(
    'id', g.id, 'display_name', g.display_name, 'normalized_key', g.normalized_key,
    'created_at', g.created_at, 'updated_at', g.updated_at
  ) into v_group
  from public.groups g where g.id = p_group_id;
  if v_group is null then raise exception 'El grupo no existe.'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', x.id, 'group_id', x.group_id, 'display_name', x.display_name,
      'normalized_name', x.normalized_name, 'created_at', x.created_at,
      'last_seen_at', x.last_seen_at, 'cups', x.cups,
      'silvers', x.silvers, 'bronzes', x.bronzes,
      'played', x.played, 'podiums', x.podiums
    ) order by x.cups desc, x.silvers desc, x.bronzes desc,
      x.display_name asc, x.id asc
  ), '[]'::jsonb) into v_members
  from (
    select gm.id, gm.group_id, gm.display_name, gm.normalized_name,
      gm.created_at, gm.last_seen_at,
      coalesce(r.cups, 0)::int as cups,
      coalesce(r.silvers, 0)::int as silvers,
      coalesce(r.bronzes, 0)::int as bronzes,
      coalesce(p.played, 0)::int as played,
      coalesce(r.podiums, 0)::int as podiums
    from public.group_members gm
    left join (
      select tr.member_id,
        count(*) filter (where tr.place = 1) as cups,
        count(*) filter (where tr.place = 2) as silvers,
        count(*) filter (where tr.place = 3) as bronzes,
        count(*) as podiums
      from public.tournament_results tr
      where tr.group_id = p_group_id
      group by tr.member_id
    ) r on r.member_id = gm.id
    left join (
      select tp.member_id, count(distinct tp.room_code) as played
      from public.tournament_participants tp
      where tp.group_id = p_group_id
      group by tp.member_id
    ) p on p.member_id = gm.id
    where gm.group_id = p_group_id
  ) x;

  select jsonb_build_object(
    'code', r.code, 'status', r.status, 'modo', r.modo,
    'enabled_squads', r.enabled_squads, 'created_at', r.created_at
  ) into v_active
  from public.rooms r
  where r.group_id = p_group_id and r.finalized_at is null
    and r.status in ('lobby', 'draft', 'running')
  order by r.created_at desc
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code', h.code, 'status', h.status, 'modo', h.modo,
      'enabled_squads', h.enabled_squads, 'finished_at', h.finalized_at,
      'podium', h.final_podium, 'tournament_number', h.tournament_number
    ) order by h.finalized_at desc, h.code desc
  ), '[]'::jsonb) into v_recent
  from (
    select numbered.code, numbered.status, numbered.modo,
      numbered.enabled_squads, numbered.finalized_at,
      numbered.final_podium, numbered.tournament_number
    from (
      select r.code, r.status, r.modo, r.enabled_squads,
        r.finalized_at, r.final_podium,
        row_number() over (order by r.finalized_at asc, r.code asc) as tournament_number
      from public.rooms r
      where r.group_id = p_group_id and r.finalized_at is not null
    ) numbered
    order by numbered.finalized_at desc, numbered.code desc
    limit 10
  ) h;

  v_last_champion := case
    when jsonb_array_length(v_recent) > 0
      then (v_recent -> 0 -> 'podium' -> 0)
    else null
  end;

  return jsonb_build_object(
    'group', v_group, 'members', v_members, 'ranking', v_members,
    'active_room', v_active, 'recent_tournaments', v_recent,
    'last_champion', v_last_champion
  );
end;
$$;

create or replace function public.new_internal_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_i integer;
begin
  for v_i in 1..5 loop
    v_code := v_code || substr(
      v_alphabet,
      1 + mod(get_byte(extensions.gen_random_bytes(1), 0), char_length(v_alphabet)),
      1
    );
  end loop;
  return v_code;
end;
$$;

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
  v_code public.rooms.code%type;
  v_player_id public.players.id%type;
  v_seed integer;
  v_inserted boolean := false;
  v_attempt integer;
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then raise exception 'El grupo no existe.'; end if;
  if not public.valid_persistent_member_session(p_group_id, p_member_id, p_session_token) then
    raise exception 'La sesion vencio. Vuelve a entrar con tu PIN.';
  end if;
  select * into v_member from public.group_members gm
  where gm.group_id = p_group_id and gm.id = p_member_id;

  if exists (
    select 1 from public.rooms r
    where r.group_id = p_group_id and r.finalized_at is null
      and r.status in ('lobby', 'draft', 'running')
  ) then
    raise exception 'El grupo ya tiene un Mundialito activo.';
  end if;
  if coalesce(p_modo, '') !~ '^(almanaque|penales)([|](16|32))?$' then
    raise exception 'El modo del Mundialito no es valido.';
  end if;
  if p_enabled_squads is not null and cardinality(p_enabled_squads) = 0 then
    raise exception 'Activa al menos un plantel para el draft.';
  end if;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);

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
      -- Una colision de codigo es inocua; el bloqueo de groups impide que esta
      -- rama oculte una carrera de dos torneos activos para el mismo grupo.
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
    v_player_id, v_code, p_member_id, v_member.display_name, false, clock_timestamp()
  );

  update public.group_members set last_seen_at = clock_timestamp()
  where id = p_member_id;
  update public.groups set updated_at = clock_timestamp() where id = p_group_id;

  return jsonb_build_object(
    'code', v_code::text, 'playerId', v_player_id::text, 'status', 'lobby'
  );
end;
$$;

create or replace function public.join_persistent_group_tournament(
  p_group_id uuid,
  p_member_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.group_members%rowtype;
  v_room public.rooms%rowtype;
  v_player_id public.players.id%type;
  v_count integer;
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then raise exception 'El grupo no existe.'; end if;
  if not public.valid_persistent_member_session(p_group_id, p_member_id, p_session_token) then
    raise exception 'La sesion vencio. Vuelve a entrar con tu PIN.';
  end if;
  select * into v_member from public.group_members gm
  where gm.group_id = p_group_id and gm.id = p_member_id;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);

  select * into v_room
  from public.rooms r
  where r.group_id = p_group_id and r.finalized_at is null
    and r.status in ('lobby', 'draft', 'running')
  order by r.created_at desc
  limit 1
  for update;
  if not found then raise exception 'No hay un Mundialito activo en este grupo.'; end if;

  select p.id into v_player_id
  from public.players p
  where p.room_code::text = v_room.code::text and p.member_id = p_member_id
  limit 1;

  if v_player_id is null then
    if v_room.status <> 'lobby' then
      raise exception 'Este Mundialito ya empezo; solo pueden volver quienes ya participaban.';
    end if;
    select count(*)::integer into v_count
    from public.players p where p.room_code::text = v_room.code::text;
    if v_count >= 32 then raise exception 'El Mundialito ya tiene 32 jugadores.'; end if;

    v_player_id := extensions.gen_random_uuid();
    begin
      insert into public.players(
        id, room_code, member_id, name, ready, last_seen
      ) values (
        v_player_id, v_room.code, p_member_id, v_member.display_name,
        false, clock_timestamp()
      );
    exception when unique_violation then
      select p.id into v_player_id
      from public.players p
      where p.room_code::text = v_room.code::text and p.member_id = p_member_id;
    end;
  else
    update public.players p set last_seen = clock_timestamp()
    where p.room_code::text = v_room.code::text and p.id = v_player_id;
  end if;

  if v_room.host_id is null or not exists (
    select 1 from public.players p
    where p.room_code::text = v_room.code::text
      and p.id::text = v_room.host_id::text
  ) then
    update public.rooms r set host_id = v_player_id
    where r.code::text = v_room.code::text;
  end if;

  update public.group_members set last_seen_at = clock_timestamp()
  where id = p_member_id;
  return jsonb_build_object(
    'code', v_room.code::text, 'playerId', v_player_id::text, 'status', v_room.status
  );
end;
$$;

create or replace function public.finalize_persistent_group_tournament(
  p_room_code text,
  p_member_id uuid,
  p_session_token text,
  p_podium jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_entry jsonb;
  v_ordinal bigint;
  v_place integer;
  v_player_text text;
  v_team_id text;
  v_display text;
  v_squad_key text;
  v_is_ai boolean;
  v_podium_member uuid;
  v_member_name text;
  v_final jsonb := '[]'::jsonb;
  v_places integer[] := array[]::integer[];
  v_team_ids text[] := array[]::text[];
  v_now timestamptz := clock_timestamp();
begin
  select * into v_room
  from public.rooms r
  where r.code::text = p_room_code
  for update;
  if not found or v_room.group_id is null then
    raise exception 'El torneo de grupo no existe.';
  end if;
  if not public.valid_persistent_member_session(v_room.group_id, p_member_id, p_session_token) then
    raise exception 'La sesion vencio. Vuelve a entrar con tu PIN.';
  end if;

  -- El lock de rooms serializa clientes concurrentes. El segundo encuentra la
  -- marca y devuelve el mismo snapshot sin insertar una sola fila adicional.
  if v_room.finalized_at is not null then
    return jsonb_build_object(
      'finalized', true, 'already_finalized', true,
      'podium', v_room.final_podium, 'finished_at', v_room.finalized_at
    );
  end if;

  if not exists (
    select 1 from public.players p
    where p.room_code::text = v_room.code::text
      and p.id::text = v_room.host_id::text
      and p.member_id = p_member_id
  ) then
    raise exception 'Solo el anfitrion actual puede finalizar el torneo.';
  end if;
  if v_room.status <> 'running' then
    raise exception 'El torneo aun no esta en estado de juego.';
  end if;
  if jsonb_typeof(p_podium) <> 'array' or jsonb_array_length(p_podium) <> 3 then
    raise exception 'El podio debe tener exactamente tres puestos.';
  end if;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);

  for v_entry, v_ordinal in
    select e.value, e.ordinality
    from jsonb_array_elements(p_podium) with ordinality as e(value, ordinality)
  loop
    begin
      v_place := coalesce(nullif(v_entry ->> 'place', '')::integer, v_ordinal::integer);
    exception when others then
      raise exception 'Cada puesto del podio debe ser 1, 2 o 3.';
    end;
    if v_place not in (1, 2, 3) or v_place = any(v_places) then
      raise exception 'El podio debe contener 1, 2 y 3 una sola vez.';
    end if;

    v_player_text := coalesce(
      nullif(v_entry ->> 'playerId', ''), nullif(v_entry ->> 'player_id', '')
    );
    v_squad_key := coalesce(
      nullif(v_entry ->> 'squadKey', ''), nullif(v_entry ->> 'squad_key', '')
    );
    v_team_id := coalesce(
      nullif(v_entry ->> 'team_id', ''), nullif(v_entry ->> 'teamId', ''),
      nullif(v_entry ->> 'id', ''),
      case when v_player_text is not null then 'h-' || v_player_text end,
      v_squad_key
    );
    if left(v_team_id, 2) = 'h-' and v_player_text is null then
      v_player_text := substr(v_team_id, 3);
    end if;

    begin
      if v_entry ? 'isAI' then
        v_is_ai := (v_entry ->> 'isAI')::boolean;
      elsif v_entry ? 'is_ai' then
        v_is_ai := (v_entry ->> 'is_ai')::boolean;
      elsif v_entry ? 'human' then
        v_is_ai := not (v_entry ->> 'human')::boolean;
      else
        v_is_ai := v_player_text is null and left(coalesce(v_team_id, ''), 2) <> 'h-';
      end if;
    exception when others then
      raise exception 'El tipo humano/maquina del podio no es valido.';
    end;

    if (v_is_ai and v_player_text is not null)
       or (not v_is_ai and v_player_text is null)
       or (not v_is_ai and v_team_id <> ('h-' || v_player_text)) then
      raise exception 'La identidad del equipo del podio no es coherente.';
    end if;

    v_podium_member := null;
    v_member_name := null;
    if not v_is_ai then
      select p.member_id, gm.display_name
      into v_podium_member, v_member_name
      from public.players p
      join public.group_members gm on gm.id = p.member_id and gm.group_id = v_room.group_id
      where p.room_code::text = v_room.code::text
        and p.id::text = v_player_text
      limit 1;
      if v_podium_member is null then
        raise exception 'El humano del podio no participo en este torneo.';
      end if;
    end if;

    v_display := public.clean_persistent_name(coalesce(
      v_member_name,
      nullif(v_entry ->> 'displayName', ''), nullif(v_entry ->> 'display_name', ''),
      nullif(v_entry ->> 'nombre', ''), nullif(v_entry ->> 'name', ''),
      v_team_id
    ));
    if v_team_id is null or char_length(v_team_id) > 100
       or v_display = '' or char_length(v_display) > 100
       or v_team_id = any(v_team_ids) then
      raise exception 'El podio contiene un equipo invalido o repetido.';
    end if;

    v_places := array_append(v_places, v_place);
    v_team_ids := array_append(v_team_ids, v_team_id);
    v_final := v_final || jsonb_build_array(jsonb_build_object(
      'place', v_place,
      'team_id', v_team_id,
      'display_name', v_display,
      'human', v_podium_member is not null,
      'member_id', v_podium_member,
      'squad_key', v_squad_key
    ));
  end loop;

  select coalesce(jsonb_agg(e.value order by (e.value ->> 'place')::integer), '[]'::jsonb)
  into v_final
  from jsonb_array_elements(v_final) e(value);

  -- PJ se obtiene de este snapshot durable; nunca de contadores manuales ni de
  -- players que pueden cambiar con el relevo/salida de clientes.
  insert into public.tournament_participants(room_code, group_id, member_id, created_at)
  select v_room.code::text, v_room.group_id, p.member_id, v_now
  from public.players p
  where p.room_code::text = v_room.code::text and p.member_id is not null
  group by p.member_id
  on conflict (room_code, member_id) do nothing;

  for v_entry in select value from jsonb_array_elements(v_final)
  loop
    if (v_entry ->> 'member_id') is not null then
      v_place := (v_entry ->> 'place')::integer;
      insert into public.tournament_results(
        group_id, room_code, member_id, place, award_type, created_at
      ) values (
        v_room.group_id, v_room.code::text, (v_entry ->> 'member_id')::uuid,
        v_place,
        case v_place when 1 then 'cup' when 2 then 'silver' else 'bronze' end,
        v_now
      ) on conflict do nothing;
    end if;
  end loop;

  update public.rooms r
  set status = 'finished', finalized_at = v_now, final_podium = v_final
  where r.code::text = v_room.code::text;
  update public.groups g set updated_at = v_now where g.id = v_room.group_id;

  return jsonb_build_object(
    'finalized', true, 'already_finalized', false,
    'podium', v_final, 'finished_at', v_now
  );
end;
$$;

-- Reinstalacion autosuficiente de presencia/relevo. A diferencia de la
-- version legacy, una room finished es inmutable: ni heartbeat ni salida
-- cambian last_seen, host_id, resultados o roster historico.
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
  select r.status, r.host_id::text
  into v_status, v_old_host
  from public.rooms r
  where r.code::text = p_room_code
  for update;
  if not found then return null; end if;
  if v_status = 'finished' then return v_old_host; end if;

  update public.players p
  set last_seen = clock_timestamp()
  where p.room_code::text = p_room_code and p.id::text = p_player_id;
  if not found then return null; end if;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);

  if v_old_host is not null then
    select p.last_seen into v_host_seen
    from public.players p
    where p.room_code::text = p_room_code and p.id::text = v_old_host;
  end if;
  if v_old_host is not null and v_host_seen is not null
     and v_host_seen >= clock_timestamp() - interval '90 seconds' then
    return v_old_host;
  end if;

  select p.id into v_candidate
  from public.players p
  where p.room_code::text = p_room_code
    and (v_old_host is null or p.id::text <> v_old_host)
    and p.last_seen >= clock_timestamp() - interval '90 seconds'
  order by p.joined_at nulls last, p.id::text
  limit 1;
  if v_candidate is null then return v_old_host; end if;

  update public.rooms r set host_id = v_candidate
  where r.code::text = p_room_code;

  if v_status = 'running' then
    select coalesce(p.resultados, '{}'::jsonb) into v_old_results
    from public.players p
    where p.room_code::text = p_room_code and p.id::text = v_old_host;
    v_old_results := coalesce(v_old_results, '{}'::jsonb);
    select coalesce(p.resultados, '{}'::jsonb) into v_new_results
    from public.players p
    where p.room_code::text = p_room_code and p.id = v_candidate;
    v_new_results := coalesce(v_new_results, '{}'::jsonb);

    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados
    from (
      select value as valor from jsonb_array_elements_text(
        case when jsonb_typeof(v_old_results -> '_abandonados') = 'array'
          then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select value as valor from jsonb_array_elements_text(
        case when jsonb_typeof(v_new_results -> '_abandonados') = 'array'
          then v_new_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select v_old_host where v_old_host is not null
    ) x
    where x.valor <> v_candidate::text;

    v_new_results := jsonb_set(v_new_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    if v_old_results ? '_paso' then
      v_new_results := jsonb_set(v_new_results, '{_paso}', v_old_results -> '_paso', true);
    end if;
    update public.players p set resultados = v_new_results
    where p.room_code::text = p_room_code and p.id = v_candidate;
  else
    delete from public.players p
    where p.room_code::text = p_room_code and p.id::text = v_old_host;
  end if;
  return v_candidate::text;
end;
$$;

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
  if not found then return null; end if;
  if v_status = 'finished' then return v_old_host; end if;
  if not exists (
    select 1 from public.players p
    where p.room_code::text = p_room_code and p.id::text = p_player_id
  ) then return v_old_host; end if;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);

  if v_status <> 'running' then
    if v_old_host = p_player_id then
      select p.id into v_candidate
      from public.players p
      where p.room_code::text = p_room_code
        and p.id::text <> p_player_id
        and p.last_seen >= clock_timestamp() - interval '90 seconds'
      order by p.joined_at nulls last, p.id::text
      limit 1;
      update public.rooms r set host_id = v_candidate
      where r.code::text = p_room_code;
    end if;
    delete from public.players p
    where p.room_code::text = p_room_code and p.id::text = p_player_id;
    return case when v_old_host = p_player_id then v_candidate::text else v_old_host end;
  end if;

  if v_old_host = p_player_id then
    select p.id into v_candidate
    from public.players p
    where p.room_code::text = p_room_code
      and p.id::text <> p_player_id
      and p.last_seen >= clock_timestamp() - interval '90 seconds'
    order by p.joined_at nulls last, p.id::text
    limit 1;
    if v_candidate is not null then
      update public.rooms r set host_id = v_candidate
      where r.code::text = p_room_code;
    end if;
  else
    select p.id into v_candidate
    from public.players p
    where p.room_code::text = p_room_code and p.id::text = v_old_host;
  end if;

  select coalesce(p.resultados, '{}'::jsonb) into v_old_results
  from public.players p
  where p.room_code::text = p_room_code and p.id::text = v_old_host;
  v_old_results := coalesce(v_old_results, '{}'::jsonb);

  if v_candidate is not null then
    select coalesce(p.resultados, '{}'::jsonb) into v_new_results
    from public.players p
    where p.room_code::text = p_room_code and p.id = v_candidate;
    v_new_results := coalesce(v_new_results, '{}'::jsonb);
    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados
    from (
      select value as valor from jsonb_array_elements_text(
        case when jsonb_typeof(v_old_results -> '_abandonados') = 'array'
          then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all
      select value as valor from jsonb_array_elements_text(
        case when jsonb_typeof(v_new_results -> '_abandonados') = 'array'
          then v_new_results -> '_abandonados' else '[]'::jsonb end)
      union all select p_player_id
    ) x where x.valor <> v_candidate::text;
    v_new_results := jsonb_set(v_new_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    if v_old_host = p_player_id and v_old_results ? '_paso' then
      v_new_results := jsonb_set(v_new_results, '{_paso}', v_old_results -> '_paso', true);
    end if;
    update public.players p set resultados = v_new_results
    where p.room_code::text = p_room_code and p.id = v_candidate;
  else
    select coalesce(array_agg(distinct x.valor order by x.valor), array[]::text[])
    into v_abandonados
    from (
      select value as valor from jsonb_array_elements_text(
        case when jsonb_typeof(v_old_results -> '_abandonados') = 'array'
          then v_old_results -> '_abandonados' else '[]'::jsonb end)
      union all select p_player_id
    ) x;
    v_old_results := jsonb_set(v_old_results, '{_abandonados}', to_jsonb(v_abandonados), true);
    update public.players p set resultados = v_old_results
    where p.room_code::text = p_room_code and p.id::text = p_player_id;
  end if;
  return coalesce(v_candidate::text, v_old_host);
end;
$$;

-- PostgreSQL concede EXECUTE a PUBLIC por defecto. Se revoca expresamente en
-- los helpers internos; en particular nadie puede emitir un token saltandose
-- la comprobacion del PIN.
revoke all on function public.clean_persistent_name(text) from public, anon, authenticated;
revoke all on function public.normalize_persistent_key(text) from public, anon, authenticated;
revoke all on function public.issue_persistent_member_session(uuid) from public, anon, authenticated;
revoke all on function public.valid_persistent_member_session(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.new_internal_room_code() from public, anon, authenticated;
revoke all on function public.protect_persistent_group_room_fields() from public, anon, authenticated;
revoke all on function public.protect_persistent_player_member() from public, anon, authenticated;

revoke all on function public.find_persistent_group(text) from public;
revoke all on function public.create_persistent_group(text) from public;
revoke all on function public.create_persistent_group_member(uuid, text, text) from public;
revoke all on function public.claim_persistent_group_member(uuid, uuid, text) from public;
revoke all on function public.get_persistent_group_dashboard(uuid) from public;
revoke all on function public.start_persistent_group_tournament(uuid, uuid, text, text, text[]) from public;
revoke all on function public.join_persistent_group_tournament(uuid, uuid, text) from public;
revoke all on function public.finalize_persistent_group_tournament(text, uuid, text, jsonb) from public;
revoke all on function public.touch_and_claim_room_host(text, text) from public;
revoke all on function public.leave_room_and_handoff(text, text) from public;

grant execute on function public.find_persistent_group(text) to anon, authenticated;
grant execute on function public.create_persistent_group(text) to anon, authenticated;
grant execute on function public.create_persistent_group_member(uuid, text, text) to anon, authenticated;
grant execute on function public.claim_persistent_group_member(uuid, uuid, text) to anon, authenticated;
grant execute on function public.get_persistent_group_dashboard(uuid) to anon, authenticated;
grant execute on function public.start_persistent_group_tournament(uuid, uuid, text, text, text[]) to anon, authenticated;
grant execute on function public.join_persistent_group_tournament(uuid, uuid, text) to anon, authenticated;
grant execute on function public.finalize_persistent_group_tournament(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.touch_and_claim_room_host(text, text) to anon, authenticated;
grant execute on function public.leave_room_and_handoff(text, text) to anon, authenticated;

comment on table public.groups is
'Liga privada permanente identificada por una clave humana normalizada.';
comment on table public.group_members is
'Identidades persistentes del grupo; pin_hash nunca se expone al frontend.';
comment on table public.tournament_participants is
'Snapshot durable de humanos que participaron en cada Mundialito, fuente de PJ.';
comment on table public.tournament_results is
'Premios humanos trazables por torneo; la IA solo figura en rooms.final_podium.';
comment on function public.finalize_persistent_group_tournament(text, uuid, text, jsonb) is
'Finaliza con lock e idempotencia, snapshot de participantes y podio humano real.';
