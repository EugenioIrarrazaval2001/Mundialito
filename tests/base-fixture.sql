-- SOLO PARA TESTS: contrato mínimo inferido del código legacy. NO es un dump
-- del servidor real ni una migración para reemplazar su esquema desconocido.
create role anon;
create role authenticated;
create role service_role;
create table public.rooms(code text primary key,status text not null default 'lobby',seed bigint not null,host_id text,modo text not null);
create table public.players(id text primary key,room_code text not null references public.rooms(code) on delete cascade,
name text not null,squad_key text,formacion text,lineup jsonb,ready boolean not null default false,
resultados jsonb not null default '{}',joined_at timestamptz not null default clock_timestamp());
-- Las políticas permisivas de una instalación antigua también deben quedar sin efecto.
grant all on public.rooms,public.players to anon,authenticated;
