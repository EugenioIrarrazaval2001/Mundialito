-- Ejecutar después de la migración como propietario. No devuelve secretos.
select column_name,data_type from information_schema.columns where table_schema='public'
and table_name='rooms' and column_name in ('id','access_kind','last_activity_at','roster');
select * from mundialito_private.settings;
select has_function_privilege('anon','public.mundialito_api(text,jsonb)','execute') as api_habilitada,
has_function_privilege('anon','public.touch_and_claim_room_host(text,text)','execute') as legacy_debe_ser_false,
has_function_privilege('anon','public.mundialito_maintenance()','execute') as mantenimiento_debe_ser_false,
has_table_privilege('anon','public.rooms','update') as rooms_update_debe_ser_false,
has_table_privilege('anon','public.players','update') as players_update_debe_ser_false,
has_table_privilege('anon','public.players','select') as players_public_select_debe_ser_false,
has_schema_privilege('anon','mundialito_private','usage') as privado_debe_ser_false;
select group_id,count(*) from public.rooms where group_id is not null and finalized_at is null
and status in ('lobby','draft','running') group by group_id having count(*)>1; -- cero filas
select access_kind,status,count(*) from public.rooms group by access_kind,status;
select r.code,r.id,r.status,r.last_activity_at,max(p.last_seen) as ultima_presencia,
count(p.id) filter(where p.expelled_at is null) as cupos_ocupados
from public.rooms r left join public.players p on p.room_code=r.code
where r.status in ('lobby','draft','running') group by r.id,r.code,r.status,r.last_activity_at;
select room_code,member_id,count(*) from public.tournament_participants group by room_code,member_id having count(*)>1;
select room_code,place,count(*) from public.tournament_results group by room_code,place having count(*)>1;
select pg_get_functiondef('public.touch_and_claim_room_host(text,text)'::regprocedure);
-- Cero filas: tampoco deben sobrevivir grants independientes por columna.
select grantee,table_name,column_name,privilege_type
from information_schema.column_privileges
where table_schema='public' and grantee in ('PUBLIC','anon','authenticated')
and table_name in ('rooms','players','groups','group_members','group_member_sessions','tournament_participants','tournament_results');
-- Cero filas: endpoints legacy que podrían eludir la API autorizada.
select p.oid::regprocedure as endpoint,r.rolname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join pg_roles r
where n.nspname='public' and r.rolname in ('anon','authenticated')
and (p.proname like '%persistent%' or p.proname in ('touch_and_claim_room_host','leave_room_and_handoff','new_internal_room_code','mundialito_maintenance'))
and has_function_privilege(r.rolname,p.oid,'execute');
-- Debe ser 0. No devuelve contenidos ni secretos de solicitudes.
select count(*) as comprobantes_con_token_debe_ser_cero
from mundialito_private.requests where response ? 'token' or response ? 'pin' or response ? 'token_hash';
-- No ejecutar el mantenimiento sin querer aplicar caducidades/limpieza:
-- select public.mundialito_maintenance();
