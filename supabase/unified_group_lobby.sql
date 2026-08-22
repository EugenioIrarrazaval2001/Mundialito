-- Mundialito: configuración segura del vestuario unificado.
-- Ejecutar UNA VEZ en el SQL Editor después de add_persistent_groups.sql.
-- No modifica historial, resultados ni tablas: solo permite al anfitrión del
-- lobby guardar room.enabled_squads mediante la misma identidad/PIN vigente.

create or replace function public.configure_persistent_group_lobby(
  p_group_id uuid,
  p_member_id uuid,
  p_session_token text,
  p_enabled_squads text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_host_member_id uuid;
begin
  perform 1 from public.groups g where g.id = p_group_id for update;
  if not found then raise exception 'El grupo no existe.'; end if;
  if not public.valid_persistent_member_session(p_group_id, p_member_id, p_session_token) then
    raise exception 'La sesion vencio. Vuelve a entrar con tu PIN.';
  end if;
  if p_enabled_squads is null or cardinality(p_enabled_squads) = 0 then
    raise exception 'Activa al menos un plantel para el draft.';
  end if;

  select * into v_room
  from public.rooms r
  where r.group_id = p_group_id and r.finalized_at is null and r.status = 'lobby'
  order by r.created_at desc
  limit 1
  for update;
  if not found then raise exception 'El vestuario ya no está disponible.'; end if;

  select p.member_id into v_host_member_id
  from public.players p
  where p.room_code::text = v_room.code::text and p.id::text = v_room.host_id::text;
  if v_host_member_id is distinct from p_member_id then
    raise exception 'Solo el DT anfitrión puede configurar planteles.';
  end if;

  perform set_config('mundialito.persistent_group_rpc', 'on', true);
  update public.rooms r set enabled_squads = p_enabled_squads
  where r.code::text = v_room.code::text;

  return jsonb_build_object('code', v_room.code::text, 'enabled_squads', p_enabled_squads);
end;
$$;

revoke all on function public.configure_persistent_group_lobby(uuid, uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.configure_persistent_group_lobby(uuid, uuid, text, text[])
  to anon, authenticated;
