-- Solo lectura. Ejecutar como propietario en el SQL Editor, antes de actualizar.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public'
and table_name in ('rooms','players','groups','group_members','group_member_sessions','tournament_participants','tournament_results')
order by table_name,ordinal_position;
select c.conrelid::regclass as tabla,c.conname,pg_get_constraintdef(c.oid) as definicion
from pg_constraint c where c.conrelid in (to_regclass('public.rooms'),to_regclass('public.players'));
select p.oid::regprocedure as firma,p.prosecdef as security_definer,
has_function_privilege('anon',p.oid,'execute') as anon_execute,pg_get_functiondef(p.oid) as definicion
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('start_persistent_group_tournament','join_persistent_group_tournament','finalize_persistent_group_tournament','touch_and_claim_room_host','leave_room_and_handoff','mundialito_api');
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('rooms','players','group_members','group_member_sessions');
select e.extname,e.extversion,n.nspname as extension_schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname in ('pgcrypto','unaccent','pg_cron');
