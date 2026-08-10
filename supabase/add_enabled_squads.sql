-- Ejecutar una sola vez en el SQL Editor del proyecto Supabase de Mundialito.
alter table public.rooms
add column if not exists enabled_squads text[];
