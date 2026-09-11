-- OPCIONAL. Ejecutar como propietario después de quick_rooms_lifecycle.sql.
-- Habilitar primero Cron/pg_cron en Supabase Dashboard -> Integrations -> Cron.
-- Este archivo no asume que el servicio esté habilitado ni pretende instalarlo.
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then
   raise exception 'Cron no está habilitado. Actívalo en Supabase y vuelve a ejecutar este archivo. La recuperación al acceder funciona sin Cron.';
 end if;
end $$;
select cron.schedule('mundialito-maintenance','* * * * *','select public.mundialito_maintenance();');
select jobid,jobname,schedule,active from cron.job where jobname='mundialito-maintenance';
select status,start_time,end_time,return_message from cron.job_run_details
where jobid in (select jobid from cron.job where jobname='mundialito-maintenance') order by start_time desc limit 10;
