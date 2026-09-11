import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database, identity, rpc } from './database.mjs';
let db;
before(async()=>{db=await database();}); after(async()=>{await db?.close();});
async function quick(nombre='Juan-Pedro') {const p={nombre,...identity()};const r=await rpc(db,'quick_create',p);assert.equal(r.ok,true,JSON.stringify(r));return {...r,token:p.token,request:p};}
async function join(ctx,nombre='Amigo'){const p={nombre,code:ctx.code,...identity()};const r=await rpc(db,'quick_join',p);return {...r,token:p.token};}
async function age(ctx,seconds){await db.query("update public.players set last_seen=clock_timestamp()-$1*interval '1 second' where room_code=$2",[seconds,ctx.code]);await db.query("update public.rooms set last_activity_at=clock_timestamp()-$1*interval '1 second' where id=$2",[seconds,ctx.roomId]);}
test('quick create is atomic, isolated, idempotent and code is five letters',async()=>{
 const a=await quick();assert.match(a.code,/^[A-Z]{5}$/);const retry=await rpc(db,'quick_create',a.request);assert.equal(retry.roomId,a.roomId);
 const b=await join(a);assert.equal(b.roomId,a.roomId);assert.notEqual(b.playerId,a.playerId);
 const state=await rpc(db,'state',a);assert.equal(state.players.length,2);assert.equal(state.room.group_id,null);
 assert.equal(JSON.stringify(state).includes(a.token),false);assert.equal(JSON.stringify(state).includes('token_hash'),false);
 assert.equal((await db.query('select count(*)::int n from public.group_members')).rows[0].n,0);
});
test('new player rejected after draft, credential reconnect preserves identity; room scoped authorization',async()=>{
 const a=await quick(),b=await join(a);assert.equal((await rpc(db,'start_draft',a)).ok,true);
 assert.equal((await join(a,'Tarde')).code,'STARTED');assert.equal((await rpc(db,'reconnect',b)).playerId,b.playerId);
 const other=await quick('Otra');assert.equal((await rpc(db,'state',{...other,playerId:a.playerId,token:a.token})).code,'INVALID_SESSION');
 assert.equal((await rpc(db,'cancel',b)).code,'HOST_REQUIRED');assert.equal((await rpc(db,'configure',{...b,enabledSquads:['x']})).code,'HOST_REQUIRED');
 assert.equal((await rpc(db,'heartbeat',{...a,token:'invalid',visible:true})).code,'INVALID_SESSION');
});
test('capacity is checked inside serialized transaction and never exceeds 32',async()=>{
 const a=await quick();for(let i=0;i<30;i++)assert.equal((await join(a,'Jugador '+i)).ok,true);
 const results=await Promise.all([join(a,'Último A'),join(a,'Último B')]);assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).code,'FULL');
 assert.equal((await rpc(db,'state',a)).players.length,32);
});
test('lobby, draft and running expire before late heartbeat/reconnect; no revival on rejection',async()=>{
 for(const status of ['lobby','draft','running']){
   const a=await quick();await db.query('update public.rooms set status=$1 where id=$2',[status,a.roomId]);await age(a,601);
   assert.equal((await rpc(db,'heartbeat',{...a,visible:true})).code,'CANCELLED');
   assert.equal((await db.query('select status from public.rooms where id=$1',[a.roomId])).rows[0].status,'cancelled');
   assert.equal((await rpc(db,'reconnect',a)).code,'CANCELLED');
   assert.equal((await rpc(db,'start_draft',a)).code,'CANCELLED');
 }
});
test('90 second handoff preserves old host/team; active participant keeps long tournament alive',async()=>{
 const a=await quick(),b=await join(a);await db.query("update public.players set last_seen=clock_timestamp()-interval '91 seconds' where id=$1",[a.playerId]);
 const state=await rpc(db,'state',b);assert.equal(state.room.host_id,b.playerId);assert.equal(state.players.length,2);
 assert.equal((await rpc(db,'reconnect',a)).playerId,a.playerId);
 await db.query("update public.rooms set created_at=clock_timestamp()-interval '3 days' where id=$1",[a.roomId]);
 assert.equal((await rpc(db,'heartbeat',{...b,visible:true})).ok,true);
});
test('draft CAS rejects stale tabs; confirmed picks cannot be removed',async()=>{
 const a=await quick();await rpc(db,'start_draft',a);
 const state={picks:[{id:'one'}],bench:[],formacion:'4-3-3'};
 assert.equal((await rpc(db,'save_draft',{...a,expectedRevision:0,state})).revision,1);
 assert.equal((await rpc(db,'save_draft',{...a,expectedRevision:0,state:{picks:[],bench:[]}})).code,'DRAFT_CONFLICT');
 assert.equal((await rpc(db,'save_draft',{...a,expectedRevision:1,state:{picks:[],bench:[]}})).code,'DRAFT_CONFLICT');
 assert.deepEqual((await rpc(db,'state',a)).players[0].draft_state,state);
});
test('group/member/session creation commits once; PIN zeros preserved and attempts persist',async()=>{
 const request={clave:'Grupo Pruebas',nombre:'Juan-Pedro',pin:'0012',...identity()};
 const g=await rpc(db,'group_create',request);assert.equal(g.ok,true,JSON.stringify(g));
 assert.equal((await rpc(db,'group_create',request)).member.id,g.member.id);
 assert.equal((await rpc(db,'group_create',{...request,...identity()})).code,'GROUP_EXISTS');
 const claim={groupId:g.group.id,memberId:g.member.id,pin:'bad'};
 for(let i=0;i<5;i++)assert.equal((await rpc(db,'group_claim',claim)).code,'INVALID_PIN');
 assert.equal((await rpc(db,'group_claim',{...claim,pin:'0012'})).code,'PIN_RATE_LIMIT');
 await db.query("update mundialito_private.pin_attempts set window_at=clock_timestamp()-interval '6 minutes',blocked_until=clock_timestamp()-interval '1 second' where member_id=$1",[g.member.id]);
 assert.equal((await rpc(db,'group_claim',{...claim,pin:'0012'})).ok,true);
 const access={groupId:g.group.id,memberId:g.member.id,token:request.token};const a=await rpc(db,'group_access',access);
 await age(a,601);const [b,c]=await Promise.all([rpc(db,'group_access',access),rpc(db,'group_access',access)]);
 assert.notEqual(a.roomId,b.roomId);assert.equal(b.roomId,c.roomId);
});
test('finalization idempotent, quick writes no group awards, terminal writes denied and cleanup scoped',async()=>{
 const a=await quick();await rpc(db,'start_draft',a);
 await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{lineup:{test:true},formacion:'4-3-3',ready:true}});
 await rpc(db,'start_tournament',a);
 const podium=[{place:1,teamId:'h-'+a.playerId,displayName:'Human'},{place:2,teamId:'ai-1',displayName:'AI1'},{place:3,teamId:'ai-2',displayName:'AI2'}];
 assert.equal((await rpc(db,'finalize',{...a,podium})).finalized,true);assert.equal((await rpc(db,'finalize',{...a,podium})).finalized,true);
 assert.equal((await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{resultados:{fake:{}}}})).code,'FINISHED');
 assert.equal((await db.query('select count(*)::int n from public.tournament_results')).rows[0].n,0);
 await db.query("update public.rooms set finalized_at=clock_timestamp()-interval '25 hours' where id=$1",[a.roomId]);
 await db.query('select public.mundialito_maintenance()');assert.equal((await rpc(db,'state',a)).code,'NOT_FOUND');
 assert.equal((await rpc(db,'quick_create',a.request)).code,'EXPIRED');
});
test('anon cannot bypass API through table writes, legacy RPCs, hashes or maintenance',async()=>{
 for(const sql of ["update public.rooms set status='running'",'select * from mundialito_private.credentials','select public.touch_and_claim_room_host(\'ABCDE\',\'fake\')','select public.mundialito_maintenance()']){
   await db.exec('set role anon');try{await assert.rejects(db.exec(sql),/permission denied/);}finally{await db.exec('reset role');}
 }
});
test('group history survives new room; successor can finalize and retry without duplicate awards',async()=>{
 const p={clave:'Grupo Historial',nombre:'Primero',pin:'0000',...identity()},g=await rpc(db,'group_create',p);
 const mReq={groupId:g.group.id,nombre:'Segundo',pin:'0022',...identity()},m=await rpc(db,'group_member_create',mReq);
 const a={...await rpc(db,'group_access',{groupId:g.group.id,memberId:g.member.id,token:p.token}),token:p.token};
 const b={...await rpc(db,'group_access',{groupId:g.group.id,memberId:m.member.id,token:mReq.token}),token:mReq.token};
 await rpc(db,'start_draft',a);
 for(const c of [a,b])await rpc(db,'update_player',{...c,targetId:c.playerId,changes:{lineup:{test:true},formacion:'4-3-3',ready:true}});
 await rpc(db,'start_tournament',a);
 await db.query("update public.players set last_seen=clock_timestamp()-interval '91 seconds' where id=$1",[a.playerId]);
 const state=await rpc(db,'state',b);assert.equal(state.room.host_id,b.playerId);assert.equal(state.room.roster.length,2);
 const podium=[{place:1,teamId:'h-'+a.playerId},{place:2,teamId:'h-'+b.playerId},{place:3,teamId:'ai-test',displayName:'Bot'}];
 assert.equal((await rpc(db,'finalize',{...b,podium})).finalized,true);
 assert.equal((await rpc(db,'finalize',{...b,podium})).finalized,true);
 const dash=(await rpc(db,'group_dashboard',{groupId:g.group.id})).dashboard;
 assert.equal(dash.ranking.find(x=>x.id===g.member.id).cups,1);assert.equal(dash.ranking.find(x=>x.id===m.member.id).silvers,1);
 assert.equal((await db.query('select count(*)::int n from public.tournament_participants where room_code=$1',[a.code])).rows[0].n,2);
 const fresh=await rpc(db,'group_access',{groupId:g.group.id,memberId:g.member.id,token:p.token});assert.notEqual(fresh.roomId,a.roomId);
 assert.equal((await rpc(db,'group_dashboard',{groupId:g.group.id})).dashboard.ranking.find(x=>x.id===g.member.id).cups,1);
});
test('code collision retries atomically and stale immutable room identity cannot hit reused code',async()=>{
 const a=await quick();
 const original=(await db.query("select pg_get_functiondef('mundialito_private.new_quick_code()'::regprocedure) def")).rows[0].def;
 await db.exec('create temporary table test_codes(code text, n serial)');await db.query('insert into test_codes(code) values($1),($2)',[a.code,'ZZZZZ']);
 await db.exec("create or replace function mundialito_private.new_quick_code() returns text language plpgsql set search_path='' as $$ declare c text; begin delete from pg_temp.test_codes where n=(select min(n) from pg_temp.test_codes) returning code into c; return c; end $$");
 let b;try{b=await quick('Colisión');assert.equal(b.code,'ZZZZZ');assert.notEqual(b.roomId,a.roomId);}finally{await db.exec(original);}
 await rpc(db,'cancel',a);await db.query("update public.rooms set cancelled_at=clock_timestamp()-interval '25 hours' where id=$1",[a.roomId]);await db.query('select public.mundialito_maintenance()');
 await db.exec(`create or replace function mundialito_private.new_quick_code() returns text language sql set search_path='' as $$ select '${a.code}'::text $$`);
 try { const reused=await quick('Código reutilizado');assert.equal(reused.code,a.code);assert.notEqual(reused.roomId,a.roomId); } finally { await db.exec(original); }
 assert.equal((await rpc(db,'state',a)).code,'NOT_FOUND');
});
test('hidden heartbeat does not extend expiry; empty lobby uses server activity and kicked roster excludes only explicitly',async()=>{
 const a=await quick();await age(a,500);await rpc(db,'heartbeat',{...a,visible:false});
 const last=(await db.query('select extract(epoch from clock_timestamp()-last_activity_at)::int age from public.rooms where id=$1',[a.roomId])).rows[0].age;assert.ok(last>=500);
 await db.query('delete from public.players where room_code=$1',[a.code]);await age(a,601);await db.query('select public.mundialito_maintenance()');
 assert.equal((await db.query('select status from public.rooms where id=$1',[a.roomId])).rows[0].status,'cancelled');
 const host=await quick(),away=await join(host);await rpc(db,'start_draft',host);
 assert.equal((await rpc(db,'kick',{...host,targetId:away.playerId})).code,'STILL_PRESENT');
 await db.query("update public.players set last_seen=clock_timestamp()-interval '91 seconds' where id=$1",[away.playerId]);
 assert.equal((await rpc(db,'kick',{...host,targetId:away.playerId})).ok,true);assert.equal((await rpc(db,'reconnect',away)).code,'KICKED');
 assert.equal((await rpc(db,'state',host)).players.length,1);
});
test('migration also supports existing UUID player/host columns, not only text fixture',async()=>{
 const uuidDb=await database({uuidIds:true});try{
 const p={nombre:'UUID anfitrión',...identity()},r=await rpc(uuidDb,'quick_create',p);assert.equal(r.ok,true);
 const q={nombre:'UUID amigo',code:r.code,...identity()},s=await rpc(uuidDb,'quick_join',q);assert.equal(s.ok,true);
 await uuidDb.query("update public.players set last_seen=clock_timestamp()-interval '91 seconds' where id=$1",[r.playerId]);
 assert.equal((await rpc(uuidDb,'state',{...s,token:q.token})).room.host_id,s.playerId);
 }finally{await uuidDb.close();}
});
test('successful PIN retry returns the same session and never stores its plaintext in request snapshots',async()=>{
 const create={clave:'Grupo Sesion Perdida',nombre:'Socio Uno',pin:'0001',...identity()};
 const g=await rpc(db,'group_create',create);
 const claim={groupId:g.group.id,memberId:g.member.id,pin:'0001',...identity()};
 const first=await rpc(db,'group_claim',claim),retry=await rpc(db,'group_claim',claim);
 assert.equal(first.ok,true);assert.equal(first.token,claim.token);assert.deepEqual(retry,first);
 assert.equal((await db.query('select count(*)::int n from public.group_member_sessions where member_id=$1',[g.member.id])).rows[0].n,2);
 const request=(await db.query('select response from mundialito_private.requests where id=$1',[claim.operationId])).rows[0].response;
 assert.equal(JSON.stringify(request).includes(claim.token),false);
 assert.equal((await rpc(db,'group_claim',{...claim,pin:'0002'})).code,'RETRY_CONFLICT');
 await db.query("update public.group_member_sessions set expires_at=clock_timestamp()-interval '1 second' where member_id=$1",[g.member.id]);
 assert.equal((await rpc(db,'group_claim',claim)).code,'EXPIRED_SESSION');
});
test('malformed JSON and absent fields are controlled errors and cannot partially confirm a team or podium',async()=>{
 assert.equal((await rpc(db,'settings',null)).code,'INVALID_INPUT');
 assert.equal((await rpc(db,'state',{roomId:'not-a-uuid'})).code,'INVALID_INPUT');
 assert.equal((await rpc(db,'group_find',{clave:''})).code,'INVALID_GROUP');
 const a=await quick();
 for(const enabledSquads of [undefined,null,[],[null],['']])assert.equal((await rpc(db,'configure',{...a,enabledSquads})).code,'INVALID_SQUADS');
 assert.equal((await rpc(db,'heartbeat',{...a,visible:'yes'})).code,'INVALID_INPUT');
 await rpc(db,'start_draft',a);
 assert.equal((await rpc(db,'save_draft',{...a,expectedRevision:0,state:{}})).code,'INVALID_DRAFT');
 assert.equal((await rpc(db,'save_draft',{...a,expectedRevision:'invalid',state:{}})).code,'INVALID_INPUT');
 assert.equal((await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{ready:true,lineup:{test:true},resultados:{}}})).code,'INVALID_INPUT');
 assert.equal((await rpc(db,'state',a)).players[0].ready,false);
 assert.equal((await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{ready:true,lineup:null}})).code,'INVALID_DRAFT');
 assert.equal((await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{ready:true,lineup:{test:true},formacion:'4-3-3'}})).ok,true);
 await rpc(db,'start_tournament',a);
 for(const podium of [undefined,null,[],[{teamId:'a'},{teamId:'b'},{teamId:'c'}],[{place:1,teamId:''},{place:2,teamId:'b'},{place:3,teamId:'c'}]])assert.equal((await rpc(db,'finalize',{...a,podium})).code,'INVALID_PODIUM');
 assert.equal((await rpc(db,'state',a)).room.status,'running');
});
test('penalty decisions keep exact prefix order; goalkeeper and resolved result do not change on old-tab writes',async()=>{
 const a=await quick();await rpc(db,'start_draft',a);
 await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{ready:true,lineup:{test:true},formacion:'4-3-3'}});await rpc(db,'start_tournament',a);
 const update=resultados=>rpc(db,'update_player',{...a,targetId:a.playerId,changes:{resultados}});
 await update({_t_match:['izquierda','derecha'],_gk_tanda_match:{goalkeeperId:'first'},match:{penales:{golesA:5,golesB:3}}});
 await update({_t_match:['derecha','izquierda','centro'],_gk_tanda_match:{goalkeeperId:'second'},match:{penales:{golesA:0,golesB:7}}});
 let results=(await rpc(db,'state',a)).players[0].resultados;
 assert.deepEqual(results._t_match,['izquierda','derecha']);assert.equal(results._gk_tanda_match.goalkeeperId,'first');assert.equal(results.match.penales.golesA,5);
 await update({_t_match:['izquierda','derecha','centro']});results=(await rpc(db,'state',a)).players[0].resultados;assert.deepEqual(results._t_match,['izquierda','derecha','centro']);
});
test('successor write immediately after failover retains the transferred coordinator snapshot',async()=>{
 const a=await quick(),b=await join(a);await rpc(db,'start_draft',a);
 for(const ctx of [a,b])await rpc(db,'update_player',{...ctx,targetId:ctx.playerId,changes:{ready:true,lineup:{test:true},formacion:'4-3-3'}});
 await rpc(db,'start_tournament',a);
 await rpc(db,'update_player',{...a,targetId:a.playerId,changes:{resultados:{_paso:7,_reproduccion:{paso:7,subfase:'regular'}}}});
 await db.query("update public.players set last_seen=clock_timestamp()-interval '91 seconds' where id=$1",[a.playerId]);
 assert.equal((await rpc(db,'update_player',{...b,targetId:b.playerId,changes:{resultados:{_live_test:{a:1,b:0}}}})).ok,true);
 const state=await rpc(db,'state',b);assert.equal(state.room.host_id,b.playerId);
 const result=state.players.find(p=>p.id===b.playerId).resultados;assert.equal(result._paso,7);assert.equal(result._reproduccion.paso,7);assert.equal(result._live_test.a,1);
});
test('exhausted code collisions return a bounded retryable error without inserting rooms',async()=>{
 const a=await quick(),original=(await db.query("select pg_get_functiondef('mundialito_private.new_quick_code()'::regprocedure) def")).rows[0].def;
 const before=(await db.query('select count(*)::int n from public.rooms')).rows[0].n;
 await db.exec(`create or replace function mundialito_private.new_quick_code() returns text language sql set search_path='' as $$ select '${a.code}'::text $$`);
 try {assert.equal((await rpc(db,'quick_create',{nombre:'Reintento',...identity()})).code,'CODE_UNAVAILABLE');} finally {await db.exec(original);}
 assert.equal((await db.query('select count(*)::int n from public.rooms')).rows[0].n,before);
});
test('quick creation and group/member/session creation roll back together on a downstream database failure',async()=>{
 const beforeRooms=(await db.query('select count(*)::int n from public.rooms')).rows[0].n;
 await db.exec("create function public.test_reject_insert() returns trigger language plpgsql as $$ begin raise exception 'injected database failure'; end $$; create trigger test_reject before insert on public.players for each row execute function public.test_reject_insert()");
 try {await assert.rejects(rpc(db,'quick_create',{nombre:'Sin Fila Parcial',...identity()}),/injected database failure/);} finally {await db.exec('drop trigger test_reject on public.players');}
 assert.equal((await db.query('select count(*)::int n from public.rooms')).rows[0].n,beforeRooms);
 const beforeGroups=(await db.query('select count(*)::int n from public.groups')).rows[0].n;
 const beforeMembers=(await db.query('select count(*)::int n from public.group_members')).rows[0].n;
 await db.exec('create trigger test_reject before insert on public.group_member_sessions for each row execute function public.test_reject_insert()');
 try {await assert.rejects(rpc(db,'group_create',{clave:'Grupo Sin Parciales',nombre:'Primer Socio',pin:'0011',...identity()}),/injected database failure/);} finally {await db.exec('drop trigger test_reject on public.group_member_sessions; drop function public.test_reject_insert()');}
 assert.equal((await db.query('select count(*)::int n from public.groups')).rows[0].n,beforeGroups);assert.equal((await db.query('select count(*)::int n from public.group_members')).rows[0].n,beforeMembers);
});
test('upgrade after both legacy migrations is repeatable and revokes independent column privileges',async()=>{
 const legacyDb=await database({legacyMigrations:true});try{
   const req={nombre:'Sala Conservada',...identity()},a=await rpc(legacyDb,'quick_create',req);
   await legacyDb.exec('grant update(status) on public.rooms to anon; grant select(pin_hash) on public.group_members to anon');
   const sql=await readFile(new URL('../supabase/quick_rooms_lifecycle.sql',import.meta.url),'utf8');await legacyDb.exec(sql);
   const state=await rpc(legacyDb,'state',{...a,token:req.token});assert.equal(state.room.id,a.roomId);assert.equal(state.players.length,1);
   await legacyDb.exec('set role anon');
   try {
     await assert.rejects(legacyDb.exec("update public.rooms set status='running'"),/permission denied/);
     await assert.rejects(legacyDb.exec('select pin_hash from public.group_members'),/permission denied/);
     await assert.rejects(legacyDb.exec("select public.touch_and_claim_room_host('ABCDE','fake')"),/permission denied/);
   }finally{await legacyDb.exec('reset role');}
 }finally{await legacyDb.close();}
});
