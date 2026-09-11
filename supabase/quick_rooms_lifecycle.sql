-- ACTUALIZACIÓN FINAL. Ejecutar después de add_persistent_groups.sql.
-- No ejecutar migraciones antiguas después de este archivo. Ver README.md.
begin;
do $$ declare missing text; begin
  if to_regclass('public.rooms') is null or to_regclass('public.players') is null
     or to_regclass('public.group_members') is null then
    raise exception 'Falta esquema base o add_persistent_groups.sql; revisar README antes de continuar.';
  end if;
  select string_agg(signature,', ') into missing
  from unnest(array[
    'public.clean_persistent_name(text)', 'public.normalize_persistent_key(text)',
    'public.find_persistent_group(text)', 'public.get_persistent_group_dashboard(uuid)',
    'public.valid_persistent_member_session(uuid,uuid,text)', 'public.issue_persistent_member_session(uuid)',
    'public.new_internal_room_code()', 'extensions.digest(text,text)',
    'extensions.gen_random_bytes(integer)', 'extensions.crypt(text,text)',
    'extensions.gen_salt(text,integer)', 'extensions.unaccent(text)'
  ]) as required(signature) where to_regprocedure(signature) is null;
  if missing is not null then
    raise exception 'Faltan funciones requeridas: %. No se aplicaron cambios; revisar preflight y esquema de extensiones, sin reinstalar scripts antiguos a ciegas.',missing;
  end if;
end $$;
alter table public.rooms add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists rooms_instance_uidx on public.rooms(id);
alter table public.rooms add column if not exists access_kind text;
update public.rooms set access_kind = case when group_id is null then 'quick' else 'group' end where access_kind is null;
alter table public.rooms alter column access_kind set not null;
alter table public.rooms add column if not exists last_activity_at timestamptz not null default clock_timestamp();
alter table public.rooms add column if not exists cancelled_at timestamptz;
alter table public.rooms add column if not exists roster jsonb;
alter table public.players add column if not exists draft_state jsonb;
alter table public.players add column if not exists draft_revision integer not null default 0;
alter table public.players add column if not exists expelled_at timestamptz;
alter table public.players add column if not exists disconnected_at timestamptz;
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check check (status in ('lobby','draft','running','finished','cancelled'));
alter table public.rooms drop constraint if exists rooms_access_kind_check;
alter table public.rooms add constraint rooms_access_kind_check check ((access_kind='group' and group_id is not null) or (access_kind='quick' and group_id is null));

create schema if not exists mundialito_private;
revoke all on schema mundialito_private from public, anon, authenticated;
create table if not exists mundialito_private.settings (
  singleton boolean primary key default true check(singleton),
  heartbeat_ms integer not null default 15000 check(heartbeat_ms > 0),
  absence_ms integer not null default 90000 check(absence_ms > heartbeat_ms),
  abandonment_ms integer not null default 600000 check(abandonment_ms > absence_ms),
  retention_ms integer not null default 86400000 check(retention_ms > 0)
);
insert into mundialito_private.settings(singleton) values(true) on conflict do nothing;
create table if not exists mundialito_private.credentials (
  player_id text primary key, room_id uuid not null references public.rooms(id) on delete cascade,
  token_hash text not null
);
create table if not exists mundialito_private.requests (
  id uuid primary key, action text not null, token_hash text not null,
  fingerprint text not null, response jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table if not exists mundialito_private.pin_attempts (
  member_id uuid primary key, failures integer not null default 0,
  window_at timestamptz not null default clock_timestamp(), blocked_until timestamptz
);
revoke all on all tables in schema mundialito_private from public, anon, authenticated;

create or replace function mundialito_private.failure(p_code text, p_message text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('ok',false,'code',p_code,'message',p_message);
$$;
create or replace function mundialito_private.hash(p_value text)
returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(coalesce(p_value,''),'sha256'),'hex');
$$;
create or replace function mundialito_private.new_quick_code()
returns text language plpgsql set search_path='' as $$
declare result text:=''; value integer;
begin
 while length(result)<5 loop
   value:=get_byte(extensions.gen_random_bytes(1),0);
   if value<234 then result:=result||chr(65+(value%26)); end if;
 end loop;
 return result;
end $$;
-- Siempre grupo -> sala -> participantes. El lookup inicial no adquiere locks.
create or replace function mundialito_private.lock_room(p_id uuid)
returns public.rooms language plpgsql set search_path='' as $$
declare r public.rooms; gid uuid;
begin
 select group_id into gid from public.rooms where id=p_id;
 if gid is not null then perform 1 from public.groups where id=gid for update; end if;
 select * into r from public.rooms where id=p_id for update;
 return r;
end $$;
create or replace function mundialito_private.recover(p_id uuid)
returns public.rooms language plpgsql set search_path='' as $$
declare r public.rooms; s mundialito_private.settings; last_valid timestamptz; successor public.rooms.host_id%type; old_result jsonb;
begin
 r := mundialito_private.lock_room(p_id);
 if r.id is null or r.status not in ('lobby','draft','running') then return r; end if;
 select * into s from mundialito_private.settings;
 select greatest(r.last_activity_at, max(last_seen)) into last_valid from public.players where room_code=r.code and expelled_at is null;
 if clock_timestamp() - coalesce(last_valid,r.created_at) >= s.abandonment_ms * interval '1 millisecond' then
   perform set_config('mundialito.persistent_group_rpc','on',true);
   update public.rooms set status='cancelled',cancelled_at=clock_timestamp() where id=r.id returning * into r;
   return r;
 end if;
 if not exists(select 1 from public.players where room_code=r.code and id::text=r.host_id::text and expelled_at is null and disconnected_at is null and last_seen > clock_timestamp()-s.absence_ms*interval '1 millisecond') then
   select id::text into successor from public.players where room_code=r.code and expelled_at is null and disconnected_at is null
      and last_seen > clock_timestamp()-s.absence_ms*interval '1 millisecond' order by joined_at,id limit 1;
   if successor is not null and successor::text is distinct from r.host_id::text then
     perform set_config('mundialito.persistent_group_rpc','on',true);
     select coalesce(resultados,'{}') into old_result from public.players where id::text=r.host_id::text and room_code=r.code;
     update public.players set resultados=coalesce(resultados,'{}') || jsonb_strip_nulls(jsonb_build_object('_paso',old_result->'_paso','_reproduccion',old_result->'_reproduccion','_abandonados',old_result->'_abandonados')) where id::text=successor::text and room_code=r.code;
     update public.rooms set host_id=successor where id=r.id returning * into r;
   end if;
 end if;
 return r;
end $$;

create or replace function public.mundialito_api(p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 r public.rooms; pl public.players; g public.groups; m public.group_members;
 req mundialito_private.requests; attempt mundialito_private.pin_attempts;
 rid uuid; gid uuid; mid uuid; pid public.players.id%type; host_pid public.rooms.host_id%type; token text := p_payload->>'token';
 op uuid; name text := public.clean_persistent_name(p_payload->>'nombre');
 code text := upper(btrim(coalesce(p_payload->>'code',''))); result jsonb;
 settings jsonb; change jsonb; incoming jsonb; merged jsonb; entry record; item jsonb;
 fingerprint text; n integer; is_host boolean; terminal boolean; final jsonb := '[]';
 has_claim_request boolean; field text; code_attempt integer;
 place integer; team text; seen_teams text[] := '{}'; seen_places integer[] := '{}';
 member_for_award uuid; display text; now_at timestamptz := clock_timestamp();
begin
 perform set_config('mundialito.persistent_group_rpc','on',true);
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>524288 then return mundialito_private.failure('INVALID_INPUT','Solicitud inválida.'); end if;
 if p_action is null or p_action not in ('settings','group_find','group_dashboard','group_claim','group_create','group_member_create','group_access','quick_create','quick_join','reconnect','state','heartbeat','leave','configure','kick','start_draft','start_tournament','cancel','finalize','save_draft','update_player') then return mundialito_private.failure('UNKNOWN_ACTION','Operación no disponible.'); end if;
 -- Validar identificadores antes de adquirir locks o hacer escrituras evita
 -- excepciones de cast que deshagan una reparación dentro de la transacción.
 foreach field in array array['roomId','groupId','memberId','operationId'] loop
   if p_payload->>field is not null and p_payload->>field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return mundialito_private.failure('INVALID_INPUT','Identificador inválido.'); end if;
 end loop;
 if p_action='heartbeat' and p_payload ? 'visible' and jsonb_typeof(p_payload->'visible') is distinct from 'boolean' then return mundialito_private.failure('INVALID_INPUT','La visibilidad debe ser un booleano.'); end if;
 if p_action='save_draft' and p_payload ? 'expectedRevision' and coalesce(p_payload->>'expectedRevision','') !~ '^[0-9]{1,9}$' then return mundialito_private.failure('INVALID_INPUT','Revisión inválida.'); end if;
 select jsonb_build_object('heartbeatMs',heartbeat_ms,'absenceMs',absence_ms,'abandonmentMs',abandonment_ms,'retentionMs',retention_ms) into settings from mundialito_private.settings;
 if p_action='settings' then return jsonb_build_object('ok',true,'settings',settings,'serverNow',now_at); end if;
 if p_action='group_find' then
   display:=public.clean_persistent_name(p_payload->>'clave');
   if char_length(replace(display,' ',''))<5 or char_length(display)>50 then return mundialito_private.failure('INVALID_GROUP','La clave del grupo debe tener entre 5 y 50 caracteres.'); end if;
   return jsonb_build_object('ok',true,'group',public.find_persistent_group(display));
 end if;
 if p_action='group_dashboard' then
   if not exists(select 1 from public.groups where id=(p_payload->>'groupId')::uuid) then return mundialito_private.failure('NOT_FOUND','El grupo no existe.'); end if;
   return jsonb_build_object('ok',true,'dashboard',public.get_persistent_group_dashboard((p_payload->>'groupId')::uuid));
 end if;

 -- El cliente nuevo prepara el secreto antes del PIN: una respuesta perdida
 -- recupera la misma sesión. Clientes antiguos conservan el flujo sin operationId.
 has_claim_request:=p_action='group_claim' and (p_payload ? 'operationId' or p_payload ? 'token');
 if has_claim_request then
   if coalesce(token,'') !~ '^[a-f0-9]{64}$' or p_payload->>'operationId' is null then return mundialito_private.failure('INVALID_SESSION','Credencial de intento inválida.'); end if;
   op:=(p_payload->>'operationId')::uuid;
   perform pg_advisory_xact_lock(hashtextextended(op::text,0));
   fingerprint:=mundialito_private.hash((p_payload-'token')::text);
   select * into req from mundialito_private.requests where id=op;
   if req.id is not null then
     if req.action<>p_action or req.token_hash<>mundialito_private.hash(token) or req.fingerprint<>fingerprint then return mundialito_private.failure('RETRY_CONFLICT','El intento pertenece a otra operación.'); end if;
     if not public.valid_persistent_member_session((p_payload->>'groupId')::uuid,(p_payload->>'memberId')::uuid,token) then return mundialito_private.failure('EXPIRED_SESSION','La sesión de este intento venció. Inicia un intento nuevo con el PIN.'); end if;
     return req.response || jsonb_build_object('token',token);
   end if;
 end if;

 -- Rate limit antes de crypt, bajo el lock del grupo. Fallos devueltos, no excepciones.
 if p_action='group_claim' then
   gid := (p_payload->>'groupId')::uuid; mid := (p_payload->>'memberId')::uuid;
   perform 1 from public.groups where id=gid for update;
   now_at:=clock_timestamp();
   select * into m from public.group_members where id=mid and group_id=gid;
   if m.id is null then return mundialito_private.failure('INVALID_PIN','Miembro o PIN incorrecto.'); end if;
   insert into mundialito_private.pin_attempts(member_id) values(mid) on conflict do nothing;
   select * into attempt from mundialito_private.pin_attempts where member_id=mid for update;
   if attempt.blocked_until > now_at then return mundialito_private.failure('PIN_RATE_LIMIT','Demasiados intentos. Espera 5 minutos y vuelve a probar.'); end if;
   if attempt.window_at < now_at-interval '5 minutes' then update mundialito_private.pin_attempts set failures=0,window_at=now_at,blocked_until=null where member_id=mid; attempt.failures:=0; end if;
   if coalesce(p_payload->>'pin','') !~ '^[0-9]{4,6}$' or extensions.crypt(p_payload->>'pin',m.pin_hash) is distinct from m.pin_hash then
     update mundialito_private.pin_attempts set failures=failures+1,blocked_until=case when failures+1>=5 then now_at+interval '5 minutes' end where member_id=mid;
     return mundialito_private.failure('INVALID_PIN','Miembro o PIN incorrecto.');
   end if;
   delete from mundialito_private.pin_attempts where member_id=mid;
   if has_claim_request then
     insert into public.group_member_sessions(member_id,token_hash,expires_at) values(mid,mundialito_private.hash(token),now_at+interval '30 days');
     update public.group_members set last_seen_at=now_at,updated_at=now_at where id=mid returning * into m;
     result:=jsonb_build_object('ok',true,'member',to_jsonb(m)-'pin_hash','expires_at',now_at+interval '30 days');
     insert into mundialito_private.requests(id,action,token_hash,fingerprint,response) values(op,p_action,mundialito_private.hash(token),fingerprint,result);
     return result || jsonb_build_object('token',token);
   end if;
   return public.issue_persistent_member_session(mid) || jsonb_build_object('ok',true);
 end if;

 if p_action in ('quick_create','quick_join','group_create','group_member_create') then
   if char_length(name) not between 2 and 30 or name !~ '^[[:alnum:] .''-]+$' then return mundialito_private.failure('INVALID_NAME','El nombre debe tener entre 2 y 30 caracteres: letras, números, espacios, puntos, guiones o apóstrofes.'); end if;
   if coalesce(token,'') !~ '^[a-f0-9]{64}$' then return mundialito_private.failure('INVALID_SESSION','Credencial temporal inválida.'); end if;
   op := (p_payload->>'operationId')::uuid;
   if op is null then return mundialito_private.failure('INVALID_INPUT','Falta la identidad del intento.'); end if;
   perform pg_advisory_xact_lock(hashtextextended(op::text,0));
   fingerprint := mundialito_private.hash((p_payload-'token')::text);
   select * into req from mundialito_private.requests where id=op;
   if req.id is not null then
     if req.action<>p_action or req.token_hash<>mundialito_private.hash(token) or req.fingerprint<>fingerprint then return mundialito_private.failure('RETRY_CONFLICT','El intento pertenece a otra operación.'); end if;
     if req.response ? 'roomId' then
       r:=mundialito_private.recover((req.response->>'roomId')::uuid);
       if r.id is null or r.status in ('finished','cancelled') then return mundialito_private.failure('EXPIRED','Esta partida ya terminó o caducó. Crea otra partida.'); end if;
       if exists(select 1 from public.players where room_code=r.code and id::text=req.response->>'playerId' and expelled_at is not null) then return mundialito_private.failure('KICKED','El anfitrión te excluyó de esta partida.'); end if;
       return req.response || jsonb_build_object('status',r.status,'serverNow',clock_timestamp());
     end if;
     return req.response;
   end if;
 end if;
 if p_action in ('group_create','group_member_create') then
   if coalesce(p_payload->>'pin','') !~ '^[0-9]{4,6}$' then return mundialito_private.failure('INVALID_PIN','El PIN debe tener entre 4 y 6 dígitos.'); end if;
   if p_action='group_create' then
     display := public.clean_persistent_name(p_payload->>'clave');
     if char_length(replace(display,' ',''))<5 or char_length(display)>50 or display !~ '^[[:alnum:] ]+$' then return mundialito_private.failure('INVALID_GROUP','El grupo debe tener entre 5 y 50 caracteres, solo letras, números y espacios.'); end if;
     perform pg_advisory_xact_lock(hashtextextended(public.normalize_persistent_key(display),1));
     if exists(select 1 from public.groups where normalized_key=public.normalize_persistent_key(display)) then return mundialito_private.failure('GROUP_EXISTS','Ya existe ese grupo. Usa Unirse a grupo existente.'); end if;
     insert into public.groups(display_name,normalized_key) values(display,public.normalize_persistent_key(display)) returning * into g;
     gid:=g.id;
   else
     gid := (p_payload->>'groupId')::uuid;
     select * into g from public.groups where id=gid for update;
     if g.id is null then return mundialito_private.failure('NOT_FOUND','El grupo no existe.'); end if;
   end if;
   if exists(select 1 from public.group_members where group_id=gid and normalized_name=public.normalize_persistent_key(name)) then return mundialito_private.failure('MEMBER_EXISTS','Ese nombre ya existe. Recupera tu identidad con el PIN.'); end if;
   insert into public.group_members(group_id,display_name,normalized_name,pin_hash)
     values(gid,name,public.normalize_persistent_key(name),extensions.crypt(p_payload->>'pin',extensions.gen_salt('bf',10))) returning * into m;
   insert into public.group_member_sessions(member_id,token_hash,expires_at) values(m.id,mundialito_private.hash(token),now_at+interval '30 days');
   result:=jsonb_build_object('ok',true,'group',to_jsonb(g),'member',to_jsonb(m)-'pin_hash','expires_at',now_at+interval '30 days');
   insert into mundialito_private.requests(id,action,token_hash,fingerprint,response) values(op,p_action,mundialito_private.hash(token),fingerprint,result);
   return result;
 end if;

 if p_action='group_access' then
   gid := (p_payload->>'groupId')::uuid; mid := (p_payload->>'memberId')::uuid;
   perform 1 from public.groups where id=gid for update;
   if not public.valid_persistent_member_session(gid,mid,token) then return mundialito_private.failure('INVALID_SESSION','La sesión venció. Vuelve a entrar con tu PIN.'); end if;
   select * into r from public.rooms where group_id=gid and status in ('lobby','draft','running') and finalized_at is null order by created_at desc limit 1;
   if r.id is not null then r:=mundialito_private.recover(r.id); end if;
   if r.id is null or r.status='cancelled' then
     pid:=gen_random_uuid()::text;
     host_pid:=pid;
     for code_attempt in 1..64 loop
       code:=public.new_internal_room_code();
       begin
         insert into public.rooms(code,status,seed,host_id,modo,group_id,access_kind,last_activity_at)
         values(code,'lobby',floor(random()*2147483647)::integer,host_pid,'almanaque|32',gid,'group',now_at) returning * into r;
         exit;
       exception when unique_violation then
         if not exists(select 1 from public.rooms where rooms.code=code) then raise; end if;
         if code_attempt=64 then return mundialito_private.failure('CODE_UNAVAILABLE','No se pudo reservar un código. Reintenta la creación.'); end if;
       end;
     end loop;
   end if;
   select * into m from public.group_members where id=mid;
   name:=m.display_name;
   select * into pl from public.players where room_code=r.code and member_id=mid;
 elsif p_action='quick_create' then
   pid:=gen_random_uuid()::text;
   host_pid:=pid;
   for code_attempt in 1..64 loop
     code:=mundialito_private.new_quick_code();
     begin
       insert into public.rooms(code,status,seed,host_id,modo,access_kind,last_activity_at)
       values(code,'lobby',floor(random()*2147483647)::integer,host_pid,'almanaque|32','quick',now_at) returning * into r;
       exit;
     exception when unique_violation then
       if not exists(select 1 from public.rooms where rooms.code=code) then raise; end if;
       if code_attempt=64 then return mundialito_private.failure('CODE_UNAVAILABLE','No se pudo reservar un código. Reintenta la creación.'); end if;
     end;
   end loop;
 elsif p_action='quick_join' then
   if code !~ '^[A-Z]{5}$' then return mundialito_private.failure('INVALID_CODE','El código debe tener cinco letras.'); end if;
   select id into rid from public.rooms where rooms.code=code and access_kind='quick';
   r:=mundialito_private.recover(rid);
   -- Este intento puede reenviarse desde otra pestaña con la misma credencial.
   select p.* into pl from public.players p join mundialito_private.credentials c on c.player_id=p.id::text and c.room_id=r.id
     where c.token_hash=mundialito_private.hash(token) and p.room_code=r.code;
 else
   rid := (p_payload->>'roomId')::uuid;
   r:=mundialito_private.lock_room(rid);
   select * into pl from public.players where room_code=r.code and id::text=p_payload->>'playerId';
   if r.id is null then return mundialito_private.failure('NOT_FOUND','La partida no existe o sus datos temporales caducaron.'); end if;
   if pl.id is null or (r.access_kind='group' and not public.valid_persistent_member_session(r.group_id,pl.member_id,token))
     or (r.access_kind='quick' and not exists(select 1 from mundialito_private.credentials where player_id=pl.id::text and room_id=r.id and token_hash=mundialito_private.hash(token))) then
     return mundialito_private.failure('INVALID_SESSION','No se pudo acreditar esta participación. Vuelve a entrar con tu identidad.');
   end if;
   if pl.expelled_at is not null then return mundialito_private.failure('KICKED','El anfitrión te excluyó de esta partida.'); end if;
   r:=mundialito_private.recover(r.id);
 end if;
 if r.id is null then return mundialito_private.failure('NOT_FOUND','No existe una partida con ese código.'); end if;
 if r.status='cancelled' then return mundialito_private.failure('CANCELLED','La partida fue cancelada o caducó por abandono. Crea otra partida.'); end if;
 -- La recuperación puede haber transferido resultados al sucesor. No usar su
 -- snapshot anterior al relevo para fusionar una escritura nueva.
 if pl.id is not null then select * into pl from public.players where id=pl.id and room_code=r.code; end if;
 -- Un request que estuvo esperando el lock no puede hacer retroceder presencia
 -- usando la fecha anterior a la espera.
 now_at:=clock_timestamp();
 if p_action in ('quick_create','quick_join','group_access','reconnect') then
   if r.status='finished' then return mundialito_private.failure('FINISHED','La partida ya terminó. Crea otra partida.'); end if;
   if pl.expelled_at is not null then return mundialito_private.failure('KICKED','El anfitrión te excluyó de esta partida.'); end if;
   if pl.id is null then
     if r.status<>'lobby' then return mundialito_private.failure('STARTED','La partida ya empezó. Solo pueden volver quienes ya participaban.'); end if;
     if (select count(*) from public.players where room_code=r.code and expelled_at is null)>=32 then return mundialito_private.failure('FULL','La sala está llena: máximo 32 humanos.'); end if;
     if pid is null then pid:=gen_random_uuid(); end if;
     insert into public.players(id,room_code,member_id,name,ready,last_seen,resultados)
     values(pid,r.code,mid,name,false,now_at,'{}') returning * into pl;
     if r.access_kind='quick' then insert into mundialito_private.credentials(player_id,room_id,token_hash) values(pid::text,r.id,mundialito_private.hash(token)); end if;
   end if;
   update public.players set last_seen=now_at,disconnected_at=null where id=pl.id and room_code=r.code;
   update public.rooms set last_activity_at=now_at where id=r.id;
   r:=mundialito_private.recover(r.id);
   result:=jsonb_build_object('ok',true,'code',r.code,'roomId',r.id,'playerId',pl.id,'accessMode',r.access_kind,'status',r.status,'groupId',r.group_id,'memberId',pl.member_id,'settings',settings,'serverNow',now_at);
   if op is not null then insert into mundialito_private.requests(id,action,token_hash,fingerprint,response) values(op,p_action,mundialito_private.hash(token),fingerprint,result); end if;
   return result;
 end if;
 is_host := r.host_id::text=pl.id::text;
 if p_action='state' then
   select coalesce(jsonb_agg(to_jsonb(p) order by p.joined_at,p.id),'[]') into result from public.players p where room_code=r.code and (expelled_at is null or id=pl.id);
   return jsonb_build_object('ok',true,'room',to_jsonb(r),'players',result,'settings',settings,'serverNow',now_at);
 end if;
 if p_action='finalize' and r.status='finished' then return jsonb_build_object('ok',true,'finalized',true,'podium',r.final_podium); end if;
 if r.status='finished' then return mundialito_private.failure('FINISHED','La partida ya terminó.'); end if;
 if p_action='heartbeat' then
   if coalesce((p_payload->>'visible')::boolean,false) then
     update public.players set last_seen=now_at,disconnected_at=null where id=pl.id and room_code=r.code;
     update public.rooms set last_activity_at=now_at where id=r.id;
     r:=mundialito_private.recover(r.id);
   end if;
 elsif p_action='leave' then
   update public.players set disconnected_at=now_at where id=pl.id and room_code=r.code;
   r:=mundialito_private.recover(r.id);
 elsif p_action in ('configure','kick','start_draft','start_tournament','cancel','finalize') then
   if not is_host then return mundialito_private.failure('HOST_REQUIRED','Solo el anfitrión actual puede hacer esto.'); end if;
   if p_action='cancel' then update public.rooms set status='cancelled',cancelled_at=now_at where id=r.id;
   elsif p_action='configure' then
     if r.status<>'lobby' then return mundialito_private.failure('STARTED','La configuración ya está cerrada.'); end if;
     if jsonb_typeof(p_payload->'enabledSquads') is distinct from 'array' then return mundialito_private.failure('INVALID_SQUADS','Activa al menos un plantel.'); end if;
     if jsonb_array_length(p_payload->'enabledSquads')=0 or exists(select 1 from jsonb_array_elements(p_payload->'enabledSquads') v where jsonb_typeof(v.value)<>'string' or btrim(v.value#>>'{}')='') then return mundialito_private.failure('INVALID_SQUADS','Activa al menos un plantel.'); end if;
     update public.rooms set enabled_squads=array(select jsonb_array_elements_text(p_payload->'enabledSquads')) where id=r.id;
   elsif p_action='kick' then
     if r.status not in ('lobby','draft') or p_payload->>'targetId'=pl.id::text then return mundialito_private.failure('INVALID_STATE','No se puede excluir esa participación.'); end if;
     if r.status='draft' and exists(select 1 from public.players where id::text=p_payload->>'targetId' and room_code=r.code and disconnected_at is null and last_seen>now_at-((settings->>'absenceMs')::integer*interval '1 millisecond')) then return mundialito_private.failure('STILL_PRESENT','El jugador todavía está presente.'); end if;
     update public.players set expelled_at=now_at where room_code=r.code and id::text=p_payload->>'targetId';
   elsif p_action='start_draft' then
     if r.status='draft' then return jsonb_build_object('ok',true); end if;
     if r.status<>'lobby' then return mundialito_private.failure('INVALID_STATE','El vestuario ya está cerrado.'); end if;
     select count(*) into n from public.players where room_code=r.code and expelled_at is null;
     if n not between 1 and 32 then return mundialito_private.failure('FULL','El plantel humano debe tener entre 1 y 32 participantes.'); end if;
     update public.rooms set status='draft' where id=r.id;
   elsif p_action='start_tournament' then
     if r.status='running' then return jsonb_build_object('ok',true); end if;
     if r.status<>'draft' or exists(select 1 from public.players where room_code=r.code and expelled_at is null and (not ready or lineup is null)) then return mundialito_private.failure('NOT_READY','Todos deben confirmar su equipo. Puedes excluir a un ausente.'); end if;
     select jsonb_agg(to_jsonb(p) order by p.id) into result from public.players p where room_code=r.code and expelled_at is null;
     if result is null then return mundialito_private.failure('NOT_READY','No hay equipos listos.'); end if;
     update public.rooms set status='running',roster=result where id=r.id;
   elsif p_action='finalize' then
     if r.status<>'running' then return mundialito_private.failure('INVALID_STATE','El torneo todavía no comenzó.'); end if;
     incoming:=p_payload->'podium';
     if jsonb_typeof(incoming) is distinct from 'array' then return mundialito_private.failure('INVALID_PODIUM','El podio debe tener tres equipos distintos.'); end if;
     if jsonb_array_length(incoming)<>3 then return mundialito_private.failure('INVALID_PODIUM','El podio debe tener tres equipos distintos.'); end if;
     for item in select value from jsonb_array_elements(incoming) loop
       if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'place','') !~ '^[123]$' then return mundialito_private.failure('INVALID_PODIUM','Cada puesto debe ser 1, 2 o 3.'); end if;
       place:=(item->>'place')::integer; team:=coalesce(item->>'teamId',item->>'team_id');
       if place=any(seen_places) or team is null or char_length(btrim(team)) not between 1 and 100 or team=any(seen_teams) then return mundialito_private.failure('INVALID_PODIUM','Podio inválido.'); end if;
       seen_places:=array_append(seen_places,place); seen_teams:=array_append(seen_teams,team);
       member_for_award:=null; display:=coalesce(item->>'displayName',item->>'display_name',team);
       if left(team,2)='h-' then
         select players.member_id,players.name into member_for_award,display from public.players where room_code=r.code and id::text=substr(team,3) and ready and expelled_at is null;
         if not found then return mundialito_private.failure('INVALID_PODIUM','El humano del podio no participó.'); end if;
       end if;
       final:=final||jsonb_build_array(jsonb_build_object('place',place,'team_id',team,'display_name',display,'human',left(team,2)='h-','member_id',member_for_award,'squad_key',item->>'squadKey'));
     end loop;
     if r.group_id is not null then
       insert into public.tournament_participants(room_code,group_id,member_id) select r.code,r.group_id,member_id from public.players where room_code=r.code and member_id is not null and expelled_at is null on conflict do nothing;
       for item in select value from jsonb_array_elements(final) loop
         if item->>'member_id' is not null then
           place:=(item->>'place')::integer;
           insert into public.tournament_results(group_id,room_code,member_id,place,award_type) values(r.group_id,r.code,(item->>'member_id')::uuid,place,case place when 1 then 'cup' when 2 then 'silver' else 'bronze' end) on conflict do nothing;
         end if;
       end loop;
     end if;
     update public.rooms set status='finished',finalized_at=now_at,final_podium=final where id=r.id;
     return jsonb_build_object('ok',true,'finalized',true,'podium',final);
   end if;
 elsif p_action='save_draft' then
   if r.status<>'draft' or pl.ready then return mundialito_private.failure('INVALID_STATE','El draft ya se cerró.'); end if;
   if (p_payload->>'expectedRevision')::integer is distinct from pl.draft_revision then return mundialito_private.failure('DRAFT_CONFLICT','Hay progreso más reciente en otra pestaña.')||jsonb_build_object('state',pl.draft_state,'revision',pl.draft_revision); end if;
   incoming:=p_payload->'state';
   if jsonb_typeof(incoming) is distinct from 'object' or jsonb_typeof(incoming->'picks') is distinct from 'array' or jsonb_typeof(incoming->'bench') is distinct from 'array' then return mundialito_private.failure('INVALID_DRAFT','Progreso inválido.'); end if;
   if exists(select 1 from jsonb_array_elements(coalesce(pl.draft_state->'picks','[]')) v where not (incoming->'picks' @> jsonb_build_array(v.value)))
      or exists(select 1 from jsonb_array_elements(coalesce(pl.draft_state->'bench','[]')) v where not (incoming->'bench' @> jsonb_build_array(v.value))) then return mundialito_private.failure('DRAFT_CONFLICT','Las elecciones confirmadas no se pueden deshacer.'); end if;
   update public.players set draft_state=incoming,draft_revision=draft_revision+1 where id=pl.id and room_code=r.code returning * into pl;
   return jsonb_build_object('ok',true,'revision',pl.draft_revision,'state',pl.draft_state);
 elsif p_action='update_player' then
   change:=p_payload->'changes';
   if jsonb_typeof(change) is distinct from 'object' then return mundialito_private.failure('INVALID_INPUT','Cambios inválidos.'); end if;
   if change ? 'resultados' and change ?| array['ready','lineup','formacion','squad_key'] then return mundialito_private.failure('INVALID_INPUT','El equipo y los resultados se guardan en operaciones distintas.'); end if;
   if change ? 'draft_revision' and coalesce(change->>'draft_revision','') !~ '^[0-9]{1,9}$' then return mundialito_private.failure('INVALID_INPUT','Revisión inválida.'); end if;
   if p_payload->>'targetId' is distinct from pl.id::text then return mundialito_private.failure('FORBIDDEN','Solo puedes actualizar tu participación.'); end if;
   if exists(select 1 from jsonb_object_keys(change) k where k not in ('ready','lineup','formacion','squad_key','resultados','draft_revision')) then return mundialito_private.failure('FORBIDDEN','Campo protegido.'); end if;
   if change ?| array['ready','lineup','formacion','squad_key'] then
     if pl.ready and pl.lineup=change->'lineup' and pl.formacion=change->>'formacion' then return jsonb_build_object('ok',true); end if;
     if r.status<>'draft' or pl.ready then return mundialito_private.failure('INVALID_STATE','El equipo ya está confirmado.'); end if;
     if pl.draft_state is not null and ((change->>'draft_revision')::integer is distinct from pl.draft_revision or change->'lineup'->'slots' is distinct from pl.draft_state->'picks' or change->'lineup'->'bench' is distinct from pl.draft_state->'bench' or change->>'formacion' is distinct from pl.draft_state->>'formacion') then return mundialito_private.failure('DRAFT_CONFLICT','El equipo debe corresponder al último draft confirmado.'); end if;
     if change->'ready' is distinct from 'true'::jsonb or jsonb_typeof(change->'lineup') is distinct from 'object' then return mundialito_private.failure('INVALID_DRAFT','Confirma un equipo completo.'); end if;
     update public.players set ready=true,lineup=change->'lineup',formacion=change->>'formacion',squad_key=change->>'squad_key' where id=pl.id and room_code=r.code;
   end if;
   if change ? 'resultados' then
     if r.status<>'running' then return mundialito_private.failure('INVALID_STATE','El torneo no está en juego.'); end if;
     incoming:=change->'resultados'; merged:=coalesce(pl.resultados,'{}');
     if jsonb_typeof(incoming) is distinct from 'object' then return mundialito_private.failure('INVALID_INPUT','Resultados inválidos.'); end if;
     for entry in select * from jsonb_each(incoming) loop
       if entry.key in ('_paso','_reproduccion','_abandonados') and not is_host and entry.value is distinct from merged->entry.key then return mundialito_private.failure('HOST_REQUIRED','Solo el anfitrión coordina el torneo.'); end if;
       -- Primer resultado resuelto gana; los prefijos de decisiones son append-only.
       if left(entry.key,1)<>'_' and exists(select 1 from public.players where room_code=r.code and resultados ? entry.key) then continue; end if;
       if left(entry.key,10)='_gk_tanda_' and merged ? entry.key then continue; end if;
       if left(entry.key,3)='_t_' then
         if jsonb_typeof(entry.value) is distinct from 'array' then return mundialito_private.failure('INVALID_INPUT','Las decisiones de penales deben ser una secuencia.'); end if;
         -- Contención JSON (@>) ignora el orden y los duplicados. Una tanda
         -- requiere conservar exactamente el prefijo de decisiones confirmado.
         if jsonb_typeof(merged->entry.key)='array' and (jsonb_array_length(entry.value)<jsonb_array_length(merged->entry.key) or exists(select 1 from jsonb_array_elements(merged->entry.key) with ordinality v(value,ord) where entry.value->(v.ord::integer-1) is distinct from v.value)) then continue; end if;
       end if;
       merged:=merged||jsonb_build_object(entry.key,entry.value);
     end loop;
     update public.players set resultados=merged where id=pl.id and room_code=r.code;
   end if;
 else return mundialito_private.failure('UNKNOWN_ACTION','Operación no disponible.');
 end if;
 return jsonb_build_object('ok',true,'settings',settings,'serverNow',now_at);
end $$;

-- Cierre de todos los accesos legacy que omitían autorización o renovaban antes
-- de recuperar. Sus cuerpos se conservan para auditoría, no son ejecutables por clientes.
create or replace function public.touch_and_claim_room_host(p_room_code text,p_player_id text)
returns text language plpgsql set search_path='' as $$ begin
 raise exception 'Endpoint legacy deshabilitado. Usar mundialito_api con credencial.';
end $$;
create or replace function public.leave_room_and_handoff(p_room_code text,p_player_id text)
returns text language plpgsql set search_path='' as $$ begin
 raise exception 'Endpoint legacy deshabilitado. Usar mundialito_api con credencial.';
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like '%persistent%' or p.proname in ('touch_and_claim_room_host','leave_room_and_handoff','new_internal_room_code')) loop
   execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 end loop;
end $$;
revoke all on public.rooms,public.players,public.groups,public.group_members,public.group_member_sessions,public.tournament_participants,public.tournament_results from public,anon,authenticated;
-- PostgreSQL mantiene grants de columna independientes de los grants de tabla.
-- Cerrarlos también evita que una instalación legacy con UPDATE(status), etc.
-- pueda eludir la API aunque REVOKE ALL ON TABLE ya se haya ejecutado.
do $$ declare t text; cols text; begin
 foreach t in array array['rooms','players','groups','group_members','group_member_sessions','tournament_participants','tournament_results'] loop
   select string_agg(quote_ident(a.attname),',') into cols from pg_attribute a
   where a.attrelid=format('public.%I',t)::regclass and a.attnum>0 and not a.attisdropped;
   execute format('revoke all privileges (%s) on table public.%I from public, anon, authenticated',cols,t);
 end loop;
end $$;
revoke all on all functions in schema mundialito_private from public,anon,authenticated;
revoke all on function public.mundialito_api(text,jsonb) from public;
grant execute on function public.mundialito_api(text,jsonb) to anon,authenticated;

create or replace function public.mundialito_maintenance()
returns jsonb language plpgsql security definer set search_path='' as $$
declare row record; r public.rooms; cancelled integer:=0; deleted integer; retention integer;
begin
 perform set_config('mundialito.persistent_group_rpc','on',true);
 -- Mismo orden que el acceso; las llamadas de Cron no cuentan como presencia.
 for row in select id from public.rooms where status in ('lobby','draft','running') order by group_id nulls last,id loop
   r:=mundialito_private.recover(row.id); if r.status='cancelled' then cancelled:=cancelled+1; end if;
 end loop;
 select retention_ms into retention from mundialito_private.settings;
 delete from public.players where room_code in (select code from public.rooms where access_kind='quick' and status in ('finished','cancelled') and coalesce(finalized_at,cancelled_at)<clock_timestamp()-retention*interval '1 millisecond');
 delete from public.rooms where access_kind='quick' and status in ('finished','cancelled') and coalesce(finalized_at,cancelled_at)<clock_timestamp()-retention*interval '1 millisecond';
 get diagnostics deleted=row_count;
 -- Tombstones de idempotencia se conservan para que un reintento nunca recree sala.
 return jsonb_build_object('cancelled',cancelled,'deletedQuickRooms',deleted);
end $$;
revoke all on function public.mundialito_maintenance() from public,anon,authenticated;
grant execute on function public.mundialito_maintenance() to service_role;
notify pgrst,'reload schema';
commit;
