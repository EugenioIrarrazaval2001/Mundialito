// Backend exclusivamente local de un humano contra bots. No anuncia multijugador.
// Usa la base local anterior para conservar miembros y premios existentes.
const KEY='mundialito-grupos-local-v1';
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)) || {};}catch{return {};}};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const clean=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const failure=(code,message,extra={})=>({ok:false,code,message,...extra});
export function crearBackendLocal(legacy,settings) {
  async function execute(action,p) {
    const db={groups:[],members:[],rooms:[],sessions:[],participants:[],results:[],requests:{},credentials:{},attempts:{},...read()};
    const now=Date.now(), stamp=new Date(now).toISOString(), tokenHash=await hash(p.token || '');
    db.rooms=db.rooms.filter(r=>{
      const expired=r.access_kind==='quick'&&['finished','cancelled'].includes(r.status)&&now-Date.parse(r.finalized_at||r.cancelled_at)>=settings.retentionMs;
      if(expired)for(const player of r.players||[])delete db.credentials[player.id];
      return !expired;
    });
    const save=()=>localStorage.setItem(KEY,JSON.stringify(db));
    const done=data=>{save();return {ok:true,settings:{...settings},serverNow:stamp,...data};};
    const fail=(code,message,extra)=>{save();return failure(code,message,extra);};
    const auth=(gid,mid)=>db.members.some(m=>m.id===mid&&m.group_id===gid)&&db.sessions.some(s=>s.member_id===mid&&s.token_hash===tokenHash&&Date.parse(s.expires_at)>now);
    const recover=r=>{
      if(!r || !['lobby','draft','running'].includes(r.status))return r;
      r.players ||= [];
      const latest=Math.max(Date.parse(r.last_activity_at||r.created_at)||0,...r.players.filter(x=>!x.expelled_at).map(x=>Date.parse(x.last_seen)||0));
      if(now-latest>=settings.abandonmentMs){r.status='cancelled';r.cancelled_at=stamp;}
      else {
        const active=r.players.filter(x=>!x.expelled_at&&!x.disconnected_at&&now-Date.parse(x.last_seen)<settings.absenceMs);
        if(!active.some(x=>x.id===r.host_id)&&active.length){
          const previous=r.players.find(x=>x.id===r.host_id)?.resultados||{};
          const next=active[0];next.resultados ||= {};
          for(const key of ['_paso','_reproduccion','_abandonados'])if(previous[key]!=null)next.resultados[key]=structuredClone(previous[key]);
          r.host_id=next.id;
        }
      }
      return r;
    };
    const publicMember=m=>{const {pin_hash,...publicData}=m;return publicData;};
    const requestResponse=result=>{const {token,...snapshot}=result;return snapshot;};
    const session=async(m,token=p.token)=>{
      db.sessions.push({id:crypto.randomUUID(),member_id:m.id,token_hash:await hash(token),expires_at:new Date(now+30*864e5).toISOString()});
      return {member:publicMember(m),token,expires_at:new Date(now+30*864e5).toISOString()};
    };
    const idempotent=['group_create','group_member_create','quick_create','quick_join'].includes(action)||(action==='group_claim'&&p.operationId);
    const fingerprint=await hash(canonical({...p,token:undefined}));
    if(idempotent) {
      if(!/^[a-f0-9]{64}$/.test(p.token||''))return fail('INVALID_SESSION','Credencial temporal inválida.');
      if(!/^[a-f0-9-]{36}$/i.test(p.operationId||''))return fail('INVALID_INPUT','Falta la identidad del intento.');
      if(action!=='group_claim'&&([...String(p.nombre||'')].length<2||[...String(p.nombre||'')].length>30||!/^[\p{L}\p{N} .'-]+$/u.test(p.nombre)))return fail('INVALID_NAME','El nombre debe tener entre 2 y 30 caracteres.');
      const req=db.requests[p.operationId];
      if(req){
        if(req.hash!==tokenHash||req.action!==action||(req.fingerprint&&req.fingerprint!==fingerprint))return fail('RETRY_CONFLICT','Este intento pertenece a otra operación.');
        if(action==='group_claim'&&!auth(p.groupId,p.memberId))return fail('EXPIRED_SESSION','La sesión de este intento venció. Vuelve a entrar con tu PIN.');
        if(req.response.roomId){const r=recover(db.rooms.find(x=>x.id===req.response.roomId));if(!r||['cancelled','finished'].includes(r.status))return fail('EXPIRED','Esta partida ya terminó. Crea otra partida.');}
        return done(action==='group_claim'?{...req.response,token:p.token}:req.response);
      }
    }
    if(action==='group_claim') {
      const m=db.members.find(x=>x.group_id===p.groupId&&x.id===p.memberId);
      if(!m)return fail('INVALID_PIN','Miembro o PIN incorrecto.');
      let a=db.attempts[m.id]||{count:0,window:now};
      if(a.blocked>now)return fail('PIN_RATE_LIMIT','Demasiados intentos. Espera 5 minutos.');
      if(now-a.window>=300000)a={count:0,window:now};
      const [salt,digest]=m.pin_hash.split(':');
      if(!/^\d{4,6}$/.test(p.pin)||await hash(salt+':'+p.pin)!==digest){a.count++;if(a.count>=5)a.blocked=now+300000;db.attempts[m.id]=a;return fail('INVALID_PIN','Miembro o PIN incorrecto.');}
      delete db.attempts[m.id];
      const token=p.token||[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const result=await session(m,token);
      if(p.operationId)db.requests[p.operationId]={hash:tokenHash,action,fingerprint,response:requestResponse(result)};
      return done(result);
    }
    if(action==='group_create'||action==='group_member_create') {
      if(!/^\d{4,6}$/.test(p.pin))return fail('INVALID_PIN','El PIN debe tener entre 4 y 6 dígitos.');
      let g=db.groups.find(x=>x.id===p.groupId);
      if(action==='group_create') {
        const valid=legacy? clean(p.clave):'';
        if(valid.replace(/ /g,'').length<5||valid.length>50||!/^[\p{L}\p{N} ]+$/u.test(p.clave))return fail('INVALID_GROUP','Nombre de grupo inválido.');
        if(db.groups.some(x=>x.normalized_key===valid))return fail('GROUP_EXISTS','Ya existe ese grupo. Usa Unirse a grupo existente.');
        g={id:crypto.randomUUID(),display_name:p.clave.trim(),normalized_key:valid,created_at:stamp,updated_at:stamp};
      }
      if(!g)return fail('NOT_FOUND','El grupo no existe.');
      if(db.members.some(x=>x.group_id===g.id&&x.normalized_name===clean(p.nombre)))return fail('MEMBER_EXISTS','Ese nombre ya existe. Usa tu PIN.');
      const salt=crypto.randomUUID();
      const m={id:crypto.randomUUID(),group_id:g.id,display_name:p.nombre,normalized_name:clean(p.nombre),pin_hash:salt+':'+await hash(salt+':'+p.pin),created_at:stamp};
      if(action==='group_create')db.groups.push(g);db.members.push(m);
      const result={group:g,...await session(m)};
      db.requests[p.operationId]={hash:tokenHash,action,fingerprint,response:requestResponse(result)};return done(result);
    }
    let r,pl;
    const newRoom=(accessKind,groupId=null)=>{
      let code; do {code=Array.from(crypto.getRandomValues(new Uint8Array(5)),n=>String.fromCharCode(65+n%26)).join('');}while(db.rooms.some(x=>x.code===code));
      r={id:crypto.randomUUID(),code,access_kind:accessKind,group_id:groupId,status:'lobby',seed:Math.floor(Math.random()*2**31),modo:'almanaque|32',players:[],created_at:stamp,last_activity_at:stamp,host_id:null,enabled_squads:null};db.rooms.push(r);
    };
    if(action==='quick_join')return fail('LOCAL_ONLY','Modo local: un humano contra bots. Configura Supabase para unirte a amigos.');
    if(action==='quick_create')newRoom('quick');
    else if(action==='group_access') {
      if(!auth(p.groupId,p.memberId))return fail('INVALID_SESSION','La sesión venció. Vuelve a entrar con tu PIN.');
      r=recover(db.rooms.find(x=>x.group_id===p.groupId&&['lobby','draft','running'].includes(x.status)));
      if(!r||r.status==='cancelled')newRoom('group',p.groupId);
      // Migrar una sala local antigua sin identidad inmutable.
      r.id ||= crypto.randomUUID(); r.access_kind='group';
      pl=r.players.find(x=>x.member_id===p.memberId);
    } else {
      r=db.rooms.find(x=>x.id===p.roomId);pl=r?.players.find(x=>x.id===p.playerId);
      if(!r)return fail('NOT_FOUND','La partida no existe.');
      if(!pl||(r.group_id?!auth(r.group_id,pl.member_id):db.credentials[pl.id]!==tokenHash))return fail('INVALID_SESSION','No se pudo acreditar tu participación.');
      if(pl.expelled_at)return fail('KICKED','El anfitrión te excluyó.');
      recover(r);
    }
    if(r.status==='cancelled')return fail('CANCELLED','La partida fue cancelada o caducó por abandono. Crea otra partida.');
    if(['quick_create','group_access','reconnect'].includes(action)) {
      if(r.status==='finished')return fail('FINISHED','La partida ya terminó.');
      if(pl?.expelled_at)return fail('KICKED','El anfitrión te excluyó de esta partida.');
      if(!pl){
        if(r.status!=='lobby')return fail('STARTED','La partida ya empezó; solo pueden volver participantes existentes.');
        // El backend local no es un servidor multijugador.
        if(r.players.some(x=>!x.expelled_at))return fail('LOCAL_ONLY','Modo local: un humano contra bots.');
        const member=db.members.find(x=>x.id===p.memberId);
        pl={id:crypto.randomUUID(),room_code:r.code,member_id:p.memberId||null,name:member?.display_name||p.nombre,ready:false,lineup:null,formacion:null,squad_key:null,resultados:{},draft_state:null,draft_revision:0,last_seen:stamp,joined_at:stamp};
        r.players.push(pl);db.credentials[pl.id]=tokenHash;
      }
      r.host_id ||= pl.id;pl.last_seen=stamp;pl.disconnected_at=null;r.last_activity_at=stamp;
      recover(r);
      const result={code:r.code,roomId:r.id,playerId:pl.id,accessMode:r.access_kind,groupId:r.group_id,memberId:pl.member_id,status:r.status};
      if(p.operationId)db.requests[p.operationId]={hash:tokenHash,action,fingerprint,response:result};return done(result);
    }
    if(action==='state'){const {players,...room}=r;return done({room:structuredClone(room),players:structuredClone(players.filter(x=>!x.expelled_at||x.id===pl.id))});}
    if(action==='finalize'&&r.status==='finished')return done({finalized:true,podium:r.final_podium});
    if(r.status==='finished')return fail('FINISHED','La partida ya terminó.');
    if(['configure','kick','start_draft','start_tournament','cancel','finalize'].includes(action)&&r.host_id!==pl.id)return fail('HOST_REQUIRED','Solo el anfitrión actual puede hacer esto.');
    if(action==='heartbeat'){if(p.visible===true){pl.last_seen=stamp;pl.disconnected_at=null;r.last_activity_at=stamp;recover(r);}}
    else if(action==='leave'){pl.disconnected_at=stamp;recover(r);}
    else if(action==='cancel'){r.status='cancelled';r.cancelled_at=stamp;}
    else if(action==='configure'){if(r.status!=='lobby')return fail('STARTED','El draft ya empezó.');if(!Array.isArray(p.enabledSquads)||!p.enabledSquads.length)return fail('INVALID_SQUADS','Activa al menos un plantel.');r.enabled_squads=[...p.enabledSquads];}
    else if(action==='start_draft'){if(!['lobby','draft'].includes(r.status))return fail('INVALID_STATE','No se puede iniciar el draft.');const roster=r.players.filter(x=>!x.expelled_at);if(roster.length<1||roster.length>32)return fail('FULL','El plantel debe tener entre 1 y 32 humanos.');r.status='draft';}
    else if(action==='kick'){if(!['lobby','draft'].includes(r.status)||p.targetId===pl.id)return fail('INVALID_STATE','No se puede excluir esa participación.');const target=r.players.find(x=>x.id===p.targetId);if(r.status==='draft'&&target&&!target.disconnected_at&&now-Date.parse(target.last_seen)<settings.absenceMs)return fail('STILL_PRESENT','El jugador todavía está presente.');if(target)target.expelled_at=stamp;}
    else if(action==='start_tournament'){if(r.status==='running')return done({});if(r.status!=='draft')return fail('INVALID_STATE','No se puede iniciar el torneo.');const roster=r.players.filter(x=>!x.expelled_at);if(!roster.length||roster.some(x=>!x.ready||!x.lineup))return fail('NOT_READY','Faltan equipos por confirmar.');r.roster=structuredClone(roster);r.status='running';}
    else if(action==='save_draft'){
      if(r.status!=='draft'||pl.ready)return fail('INVALID_STATE','El draft ya está cerrado.');
      if(p.expectedRevision!==pl.draft_revision)return fail('DRAFT_CONFLICT','Hay progreso más reciente en otra pestaña.',{revision:pl.draft_revision,state:pl.draft_state});
      if(!p.state||!Array.isArray(p.state.picks)||!Array.isArray(p.state.bench))return fail('INVALID_DRAFT','Progreso inválido.');
      for(const key of ['picks','bench'])if((pl.draft_state?.[key]||[]).some(x=>!p.state[key].some(y=>canonical(x)===canonical(y))))return fail('DRAFT_CONFLICT','No puedes deshacer elecciones confirmadas.');
      pl.draft_state=structuredClone(p.state);pl.draft_revision++;return done({revision:pl.draft_revision,state:pl.draft_state});
    } else if(action==='update_player'){
      if(p.targetId!==pl.id)return fail('FORBIDDEN','Solo puedes actualizar tu participación.');
      const c=p.changes;
      if(!c||typeof c!=='object'||Array.isArray(c))return fail('INVALID_INPUT','Cambios inválidos.');
      if(Object.keys(c).some(k=>!['lineup','formacion','squad_key','ready','resultados','draft_revision'].includes(k)))return fail('FORBIDDEN','Campo protegido.');
      if(['lineup','ready','formacion','squad_key'].some(key=>Object.hasOwn(c,key))){
        if(pl.ready&&canonical(pl.lineup)===canonical(c.lineup)&&pl.formacion===c.formacion)return done({});
        if(r.status!=='draft'||pl.ready)return fail('INVALID_STATE','El equipo ya está confirmado.');
        if(pl.draft_state&&(c.draft_revision!==pl.draft_revision||canonical(c.lineup?.slots)!==canonical(pl.draft_state.picks)||canonical(c.lineup?.bench)!==canonical(pl.draft_state.bench)||c.formacion!==pl.draft_state.formacion))return fail('DRAFT_CONFLICT','El equipo no corresponde al último draft confirmado.');
        if(c.ready!==true||!c.lineup)return fail('INVALID_DRAFT','Confirma un equipo completo.');
        Object.assign(pl,{ready:true,lineup:structuredClone(c.lineup),formacion:c.formacion,squad_key:c.squad_key??null});
      }
      if(c.resultados){
        if(r.status!=='running')return fail('INVALID_STATE','La partida no está en juego.');
        const merged=structuredClone(pl.resultados||{});
        for(const [k,v] of Object.entries(c.resultados)){
          if(['_paso','_reproduccion','_abandonados'].includes(k)&&r.host_id!==pl.id&&canonical(v)!==canonical(merged[k]))return fail('HOST_REQUIRED','Solo el anfitrión coordina el torneo.');
          if(!k.startsWith('_')&&r.players.some(x=>Object.hasOwn(x.resultados||{},k)))continue;
          if(k.startsWith('_t_')&&Array.isArray(merged[k])&&(!Array.isArray(v)||merged[k].some((value,i)=>canonical(value)!==canonical(v[i]))))continue;
          merged[k]=structuredClone(v);
        }
        pl.resultados=merged;
      }
    } else if(action==='finalize'){
      if(r.status!=='running'||!Array.isArray(p.podium)||p.podium.length!==3||new Set(p.podium.map(x=>x?.teamId||x?.team_id)).size!==3||new Set(p.podium.map(x=>x?.place)).size!==3||p.podium.some(x=>![1,2,3].includes(x?.place)||typeof(x.teamId||x.team_id)!=='string'||!(x.teamId||x.team_id).length))return fail('INVALID_PODIUM','El podio debe tener tres equipos distintos en los puestos 1, 2 y 3.');
      if(p.podium.some(x=>{const team=x.teamId||x.team_id;return team.startsWith('h-')&&!r.players.some(y=>'h-'+y.id===team&&y.ready&&!y.expelled_at);}))return fail('INVALID_PODIUM','El humano del podio no participó.');
      const final=p.podium.map(x=>{const team=x.teamId||x.team_id;const player=r.players.find(y=>'h-'+y.id===team);return {place:x.place,team_id:team,display_name:player?.name||x.displayName,human:Boolean(player),member_id:player?.member_id||null,squad_key:x.squadKey};});
      if(r.group_id){for(const player of r.players.filter(x=>x.member_id&&!x.expelled_at))if(!db.participants.some(x=>x.room_code===r.code&&x.member_id===player.member_id))db.participants.push({room_code:r.code,group_id:r.group_id,member_id:player.member_id});for(const x of final)if(x.member_id&&!db.results.some(y=>y.room_code===r.code&&y.place===x.place))db.results.push({room_code:r.code,group_id:r.group_id,member_id:x.member_id,place:x.place});}
      r.status='finished';r.finalized_at=stamp;r.final_podium=final;return done({finalized:true,podium:final});
    } else return fail('UNKNOWN_ACTION','Operación desconocida.');
    return done({});
  }
  let queue=Promise.resolve();
  return (action,p)=>{
    const run=()=>navigator.locks?navigator.locks.request('mundialito-local-db',()=>execute(action,p)):execute(action,p);
    const result=queue.then(run,run);queue=result.catch(()=>{});return result;
  };
}
