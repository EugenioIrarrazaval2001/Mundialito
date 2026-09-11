import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {crearRedSegura,CICLO_VIDA} from '../js/net/lifecycle.js';
import {crearBackendLocal} from '../js/net/local-lifecycle.js';

const KEY='mundialito-grupos-local-v1';
const realNow=Date.now;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const wait=()=>new Promise(r=>setImmediate(r));
const identity=()=>({operationId:crypto.randomUUID(),token:[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('')});
beforeEach(()=>{
  const values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
});
afterEach(()=>{Date.now=realNow;});
function client(transport){return crearRedSegura({legacyNet:{},online:true,transport});}
const ctx=(code='ABCDE')=>({roomId:crypto.randomUUID(),playerId:crypto.randomUUID(),token:identity().token,code,accessMode:'quick'});

test('unsubscribe and context switch discard state replies after await',async()=>{
  const held=deferred(),a=ctx(),b=ctx('BCDEF'),received=[];
  const net=client(()=>held.promise);net.activarContexto(a);
  const stop=net.suscribir(a.code,state=>received.push(state));
  stop();net.activarContexto(b);
  held.resolve({ok:true,room:{id:a.roomId,code:a.code},players:[]});await wait();
  assert.deepEqual(received,[]);
});

test('writes retain their original room credentials after local exit and input mutation',async()=>{
  const held=deferred(),requests=[],a=ctx(),b=ctx('BCDEF');
  const net=client(async(action,p)=>{requests.push({action,p});await held.promise;return {ok:true};});
  net.activarContexto(a);
  const changes={state:{picks:[{id:1}],bench:[]},expectedRevision:0,token:'forged',roomId:b.roomId};
  const pending=net.guardarDraft(a.code,changes);changes.state.picks.length=0;
  net.limpiarContexto();net.activarContexto(b);held.resolve();await pending;
  assert.equal(requests[0].p.roomId,a.roomId);assert.equal(requests[0].p.token,a.token);
  assert.equal(requests[0].p.state.picks.length,1);
});

test('lost PIN login response retries same opaque operation and then obtains a fresh session',async()=>{
  const requests=[];let lose=true;
  const net=client(async(action,p)=>{
    requests.push(p);assert.equal(action,'group_claim');
    if(lose){lose=false;return {ok:false,code:'NETWORK',message:'lost reply'};}
    return {ok:true,member:{id:p.memberId,group_id:p.groupId},token:p.token};
  });
  const p={groupId:crypto.randomUUID(),memberId:crypto.randomUUID(),pin:'0012'};
  await assert.rejects(net.grupoReclamarMiembro(p),{code:'NETWORK'});
  const response=await net.grupoReclamarMiembro(p);
  assert.equal(requests[0].operationId,requests[1].operationId);assert.equal(response.token,requests[0].token);
  await net.grupoReclamarMiembro(p);assert.notEqual(requests[2].operationId,requests[1].operationId);
});

test('reused quick code resolves a new immutable room; network error never creates a replacement identity',async()=>{
  const a=ctx(),b=ctx(a.code);let resumeError='NOT_FOUND';const calls=[];
  localStorage.setItem('mundialito-quick:'+a.roomId,JSON.stringify(a));localStorage.setItem('mundialito-quick-code:'+a.code,JSON.stringify(a.roomId));
  const net=client(async(action,p)=>{
    calls.push(action);
    if(action==='reconnect')return {ok:false,code:resumeError,message:'unavailable'};
    return {...b,ok:true};
  });
  const joined=await net.rapidaUnirse({nombre:'Jugador',code:' abcde '});
  assert.equal(joined.roomId,b.roomId);assert.deepEqual(calls,['reconnect','quick_join']);
  resumeError='NETWORK';await assert.rejects(net.rapidaUnirse({nombre:'Jugador',code:a.code}),{code:'NETWORK'});
  assert.equal(calls.filter(x=>x==='quick_join').length,1);
});

test('server clock and lifecycle ignore malformed response metadata',async()=>{
  const defaults={...CICLO_VIDA},a=ctx();
  const net=client(async()=>({ok:true,settings:{absenceMs:-1,retentionMs:'bad',unknown:1},serverNow:'not a date'}));
  net.activarContexto(a);await net.estado(a.code);assert.deepEqual(CICLO_VIDA,defaults);
});

test('lost reply while joining a reused code retries the same new participation',async()=>{
  const old=ctx(),replacement=ctx(old.code),joins=[];
  localStorage.setItem('mundialito-quick:'+old.roomId,JSON.stringify(old));
  localStorage.setItem('mundialito-quick-code:'+old.code,JSON.stringify(old.roomId));
  const net=client(async(action,p)=>{
    if(action==='reconnect')return {ok:false,code:'NOT_FOUND',message:'expired old room'};
    joins.push(p);
    if(joins.length===1)return {ok:false,code:'NETWORK',message:'reply lost after commit'};
    return {...replacement,ok:true};
  });
  await assert.rejects(net.rapidaUnirse({nombre:'Reintento',code:old.code}),{code:'NETWORK'});
  const result=await net.rapidaUnirse({nombre:'Reintento',code:old.code});
  assert.equal(result.roomId,replacement.roomId);
  assert.equal(joins[0].operationId,joins[1].operationId);
  assert.equal(joins[0].token,joins[1].token);
});

test('local quick draft, freeze, server finish, idempotency and cleanup preserve group records',async()=>{
  let now=realNow();Date.now=()=>now;
  const net=crearRedSegura({legacyNet:{},online:false});
  const a=await net.rapidaCrear({nombre:'Juan-Pedro',operationId:crypto.randomUUID()});net.activarContexto(a);
  await net.iniciarDraft(a.code);
  await assert.rejects(net.guardarDraft(a.code,{expectedRevision:0,state:{picks:[]}}),{code:'INVALID_DRAFT'});
  const draft={picks:[{id:'one'}],bench:[],formacion:'4-3-3'};
  await net.guardarDraft(a.code,{expectedRevision:0,state:draft});
  await assert.rejects(net.guardarDraft(a.code,{expectedRevision:0,state:draft}),{code:'DRAFT_CONFLICT'});
  await assert.rejects(net.actualizarJugador(a.code,a.playerId,{lineup:{slots:draft.picks,bench:[]},formacion:'5-3-2',ready:true,draft_revision:1}),{code:'DRAFT_CONFLICT'});
  await net.actualizarJugador(a.code,a.playerId,{lineup:{slots:draft.picks,bench:[]},formacion:draft.formacion,ready:true,draft_revision:1});
  await net.iniciarTorneo(a.code);const original=(await net.estado(a.code)).room.roster;
  await net.actualizarJugador(a.code,a.playerId,{resultados:{_paso:2,_t_one:[{decision:1}],match:{winner:'old'}}});
  await net.actualizarJugador(a.code,a.playerId,{resultados:{_t_one:[{decision:2}],match:{winner:'new'}}});
  await net.iniciarTorneo(a.code);const state=await net.estado(a.code);
  assert.deepEqual(state.room.roster,original);assert.equal(state.players[0].resultados.match.winner,'old');
  assert.deepEqual(state.players[0].resultados._t_one,[{decision:1}]);
  const podium=[{place:1,teamId:'h-'+a.playerId},{place:2,teamId:'ai-one'},{place:3,teamId:'ai-two'}];
  await assert.rejects(net.finalizarSala(a.code,podium.map(x=>({...x,place:1}))),{code:'INVALID_PODIUM'});
  await net.finalizarSala(a.code,podium);await net.finalizarSala(a.code,podium);
  let db=JSON.parse(localStorage.getItem(KEY));assert.equal(db.members.length,0);assert.equal(db.results.length,0);
  await assert.rejects(net.mantenerPresencia(a.code),{code:'FINISHED'});
  now+=CICLO_VIDA.retentionMs+1;await assert.rejects(net.estado(a.code),{code:'NOT_FOUND'});
  db=JSON.parse(localStorage.getItem(KEY));assert.equal(db.rooms.length,0);assert.equal(db.credentials[a.playerId],undefined);
});

test('local expiry precedes heartbeat and group recovery rejects kicked members',async()=>{
  let now=realNow();Date.now=()=>now;
  const backend=crearBackendLocal({},CICLO_VIDA),request={nombre:'Primero',...identity()};
  const created=await backend('quick_create',request),a={...created,token:request.token};
  now+=CICLO_VIDA.abandonmentMs+1;
  assert.equal((await backend('heartbeat',{...a,visible:true})).code,'CANCELLED');
  assert.equal((await backend('reconnect',a)).code,'CANCELLED');
  const p={clave:'Grupo Viejo',nombre:'Miembro',pin:'0012',...identity()};
  const group=await backend('group_create',p),auth={groupId:group.group.id,memberId:group.member.id,token:p.token};
  const room=await backend('group_access',auth),db=JSON.parse(localStorage.getItem(KEY));
  db.rooms.find(x=>x.id===room.roomId).players[0].expelled_at=new Date(now).toISOString();localStorage.setItem(KEY,JSON.stringify(db));
  assert.equal((await backend('group_access',auth)).code,'KICKED');
});

test('local PIN retries redact request snapshots and cannot reuse an expired session',async()=>{
  let now=realNow();Date.now=()=>now;
  const backend=crearBackendLocal({},CICLO_VIDA),p={clave:'Grupo Sesiones',nombre:'Socio',pin:'0012',...identity()};
  const g=await backend('group_create',p),claim={groupId:g.group.id,memberId:g.member.id,pin:'0012',...identity()};
  assert.equal((await backend('group_claim',claim)).ok,true);
  assert.equal((await backend('group_claim',claim)).token,claim.token);
  const db=JSON.parse(localStorage.getItem(KEY));
  assert.ok(Object.values(db.requests).every(request=>!Object.hasOwn(request.response,'token')));
  now+=31*86400000;
  assert.equal((await backend('group_claim',claim)).code,'EXPIRED_SESSION');
});
