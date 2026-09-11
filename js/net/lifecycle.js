import { crearBackendLocal } from './local-lifecycle.js';
export const CICLO_VIDA = { heartbeatMs: 15000, absenceMs: 90000, abandonmentMs: 600000, retentionMs: 86400000 };
let desfase = 0;
export const ahoraServidor = () => Date.now() + desfase;
export function validarNombreJugador(value) {
  const nombre = String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
  if ([...nombre].length < 2 || [...nombre].length > 30 || !/^[\p{L}\p{N} .'-]+$/u.test(nombre))
    throw new Error('El nombre debe tener entre 2 y 30 caracteres: letras, números, espacios, puntos, guiones o apóstrofes.');
  return nombre;
}
const secreto = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2,'0')).join('');
const leer = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
export class ErrorPartida extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; Object.assign(this, details); }
}
export function crearRedSegura({ legacyNet, online, url, key, transport = null }) {
  let contexto = null, generacion = 0;
  const local = crearBackendLocal(legacyNet, CICLO_VIDA);
  async function rpc(action, payload = {}) {
    payload = structuredClone(payload);
    let data;
    if (transport) data = await transport(action, structuredClone(payload));
    else if (!online) data = await local(action,payload);
    else {
      const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch(`${url}/rest/v1/rpc/mundialito_api`, {
          method:'POST', headers:{ apikey:key, 'Content-Type':'application/json' },
          body:JSON.stringify({p_action:action,p_payload:payload}), signal:abort.signal,
        });
        data = await response.json();
        if (!response.ok) throw new ErrorPartida(response.status===404?'MIGRATION_REQUIRED':'SERVER',
          response.status===404?'El servidor necesita la actualización de Partida rápida. Consulta supabase/README.md.':
          response.status===401?'Supabase rechazó la configuración pública. Revisa la URL y la clave del proyecto.':(data.message || 'El servidor no pudo completar la operación.'));
      } catch (e) {
        if (e instanceof ErrorPartida) throw e;
        throw new ErrorPartida(e.name==='AbortError'?'TIMEOUT':'NETWORK',e.name==='AbortError'?'La conexión tardó demasiado. Puedes reintentar sin duplicar la operación.':'No se pudo conectar. Tu identidad y progreso siguen guardados.');
      } finally { clearTimeout(timeout); }
    }
    if (data?.ok === false) throw new ErrorPartida(data.code || 'SERVER',data.message,data);
    for (const [setting, value] of Object.entries(data?.settings || {})) {
      if (Object.hasOwn(CICLO_VIDA,setting) && Number.isFinite(value) && value > 0) CICLO_VIDA[setting] = value;
    }
    if (Number.isFinite(Date.parse(data?.serverNow))) desfase = Date.parse(data.serverNow)-Date.now();
    return data;
  }
  function capturar(code) {
    if (!contexto || contexto.code !== code) throw new ErrorPartida('STALE_CONTEXT','La pantalla ya no corresponde a esta partida.');
    return { ...contexto };
  }
  function accion(code, action, payload = {}) {
    let ctx; try { ctx = capturar(code); } catch (e) { return Promise.reject(e); }
    // Capture immediately: leaving the screen must not switch a queued write to
    // another identity, and callers cannot replace the authorization envelope.
    return rpc(action,{ ...payload, ...ctx });
  }
  function identidadGuardar(data, token) {
    const ctx = { ...data, token };
    if (ctx.accessMode==='quick') {
      if (!ctx.roomId || !ctx.playerId || !/^[A-Z]{5}$/.test(ctx.code) || !token)
        throw new ErrorPartida('INVALID_RESPONSE','No se pudo confirmar la identidad de la partida. Puedes reintentar.');
      localStorage.setItem('mundialito-quick:'+ctx.roomId,JSON.stringify(ctx));
      localStorage.setItem('mundialito-quick-code:'+ctx.code,JSON.stringify(ctx.roomId));
    }
    return ctx;
  }
  function rapidaSesionLeer(key) {
    return leer('mundialito-quick:'+key) || leer('mundialito-quick:'+leer('mundialito-quick-code:'+String(key).trim().toUpperCase()));
  }
  async function intento(action, values, explicitId) {
    // Un intento pendiente se comparte entre pestañas y sobrevive respuestas perdidas.
    // La huella no contiene PIN ni token. El secreto no se manda a tablas públicas.
    const storageKey = 'mundialito-intento:'+action+':'+JSON.stringify({nombre:values.nombre,clave:values.clave,code:values.code,groupId:values.groupId,memberId:values.memberId,previousRoomId:values.previousRoomId});
    const run = async () => {
      let pending = leer(storageKey);
      if (!pending || (explicitId && pending.operationId!==explicitId)) {
        pending={operationId:explicitId || crypto.randomUUID(),token:secreto()}; localStorage.setItem(storageKey,JSON.stringify(pending));
      }
      try {
        const data=await rpc(action,{...values,...pending});
        const result=identidadGuardar(data,pending.token);
        // A confirmed login is not cached indefinitely: a later PIN login must
        // obtain a fresh session. A lost response retains the pending attempt.
        if (action==='group_claim') localStorage.removeItem(storageKey);
        return result;
      } catch (error) {
        if (action==='group_claim' && !['NETWORK','TIMEOUT'].includes(error.code)) localStorage.removeItem(storageKey);
        throw error;
      }
    };
    // Cross-tab double clicks use one opaque attempt rather than racing two
    // localStorage reads. This lock contains no PIN or credential in its name.
    return globalThis.navigator?.locks ? navigator.locks.request(storageKey,run) : run();
  }
  const api = {
    ...legacyNet,
    activarContexto(ctx) {
      if (!ctx?.roomId || !ctx?.playerId || !ctx?.code || !ctx?.token) throw new ErrorPartida('INVALID_SESSION','Falta la identidad de la partida.');
      contexto={code:ctx.code,roomId:ctx.roomId,playerId:ctx.playerId,token:ctx.token,
        accessMode:ctx.accessMode,groupId:ctx.groupId,memberId:ctx.memberId}; generacion++;
    },
    limpiarContexto() { contexto=null; generacion++; },
    rapidaSesionLeer,
    rapidaCrear: ({nombre,operationId}={}) => intento('quick_create',{nombre:validarNombreJugador(nombre)},operationId),
    rapidaUnirse: async ({nombre,code}) => {
      nombre=validarNombreJugador(nombre); code=String(code).trim().toUpperCase();
      if (!/^[A-Z]{5}$/.test(code)) throw new ErrorPartida('INVALID_CODE','El código debe tener cinco letras.');
      const saved=rapidaSesionLeer(code);
      if (saved) {
        try { return await api.rapidaReanudar(saved); }
        catch (error) {
          // A five-letter code can be reused after retention. Let the server
          // resolve the current room, but never replace an active credential
          // just because its network request failed or the player was kicked.
          if (!['NOT_FOUND','FINISHED','CANCELLED','EXPIRED'].includes(error.code)) throw error;
          if (!online) throw error;
          // La sustitución tiene un intento propio, estable entre reintentos y
          // pestañas. Si se pierde su respuesta tras commit, no crea otro jugador.
          return intento('quick_join',{nombre,code,previousRoomId:saved.roomId});
        }
      }
      if (!online) throw new ErrorPartida('LOCAL_ONLY','Modo local: un jugador contra bots. Configura Supabase para unirte a amigos.');
      return intento('quick_join',{nombre,code});
    },
    rapidaReanudar: async ctx => identidadGuardar(await rpc('reconnect',ctx),ctx.token),
    grupoBuscar: async clave => online ? (await rpc('group_find',{clave})).group : legacyNet.grupoBuscar(clave),
    grupoDashboard: async groupId => online ? (await rpc('group_dashboard',{groupId})).dashboard : legacyNet.grupoDashboard(groupId),
    grupoCrearCompleto: p => intento('group_create',{...p,nombre:validarNombreJugador(p.nombre)},p.operationId),
    grupoCrearMiembro: p => intento('group_member_create',{...p,nombre:validarNombreJugador(p.nombre)},p.operationId),
    grupoReclamarMiembro: p => intento('group_claim',p,p.operationId),
    grupoAcceder: async p => ({...await rpc('group_access',{...p,token:p.sessionToken || p.token}),token:p.sessionToken || p.token}),
    estado: code => accion(code,'state'),
    mantenerPresencia: code => accion(code,'heartbeat',{visible:document.visibilityState!=='hidden'}),
    salirSala: code => accion(code,'leave'),
    configurarSala: (code,p) => accion(code,'configure',p),
    eliminarJugador: (code,targetId) => accion(code,'kick',{targetId}),
    iniciarDraft: code => accion(code,'start_draft'),
    iniciarTorneo: code => accion(code,'start_tournament'),
    cancelarSala: code => accion(code,'cancel'),
    finalizarSala: (code,podium) => accion(code,'finalize',{podium}),
    guardarDraft: (code,p) => accion(code,'save_draft',p),
    actualizarJugador: (code,targetId,changes) => accion(code,'update_player',{targetId,changes}),
    actualizarSala: (code,changes) => changes.status==='draft'?api.iniciarDraft(code):changes.status==='running'?api.iniciarTorneo(code):Promise.reject(new ErrorPartida('FORBIDDEN','Usa la operación autorizada para modificar la sala.')),
    suscribir(code,callback,{onError=()=>{}}={}) {
      const ctx=capturar(code), generation=generacion;
      let active=true,busy=false,previous=null;
      const valid=()=>active && generacion===generation && contexto?.roomId===ctx.roomId && contexto?.playerId===ctx.playerId;
      const refresh=async()=>{
        if (!valid()||busy||document.visibilityState==='hidden') return;
        busy=true;
        try {
          const state=await rpc('state',ctx);
          if (!valid()||state.room?.id!==ctx.roomId) return;
          const signature=JSON.stringify([state.room,state.players]);
          if (signature!==previous) { previous=signature; callback(state); }
        } catch(e) { if(valid()) onError(e); } finally { busy=false; }
      };
      const timer=setInterval(refresh,3000); refresh();
      document.addEventListener('visibilitychange',refresh);
      return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
    },
  };
  api.grupoIniciarTorneo=api.grupoAcceder; api.grupoUnirseTorneo=api.grupoAcceder;
  api.crearSala=async nombre=>api.rapidaCrear({nombre,operationId:crypto.randomUUID()});
  api.unirse=(code,nombre)=>api.rapidaUnirse({code,nombre});
  api.grupoFinalizarTorneo=p=>api.finalizarSala(p.roomCode,p.podium||p.podio);
  api.grupoConfigurarVestuario=p=>api.configurarSala(contexto?.code,p);
  api.grupoCrear=()=>Promise.reject(new ErrorPartida('ATOMIC_REQUIRED','Crea el grupo junto con tu identidad en el formulario de inicio.'));
  return api;
}
