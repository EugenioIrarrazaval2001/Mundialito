// Capa de red: salas multijugador vía Supabase, o modo local si no hay config.
//
// Modelo de datos:
//   rooms:   code (pk), status: lobby|draft|running, seed, host_id, modo,
//            enabled_squads (text[], filtro compartido solo del draft;
//            null en salas antiguas = universo base completo del draft)
//   players: id (pk), room_code, name, squad_key, formacion, lineup (json), ready,
//            last_seen (heartbeat para relevar al anfitrión si cierra la pestaña)

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MAX_JUGADORES = 32;

const GRUPO_SESION_PREFIX = 'mundialito-grupo-sesion:';
const LOCAL_GRUPOS_KEY = 'mundialito-grupos-local-v1';
const ABANDONO_TOTAL_MS = 30 * 60 * 1000;

// Estas tres funciones son deliberadamente compartidas por Home y la capa de
// red. La migracion SQL aplica las mismas reglas antes de escribir, de modo que
// la validacion visual nunca es la unica barrera de consistencia.
export function limpiarNombreGrupo(valor) {
  return String(valor ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ');
}

export function normalizarClaveGrupo(valor) {
  return limpiarNombreGrupo(valor)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('es');
}

export function validarClaveGrupo(valor) {
  const display = limpiarNombreGrupo(valor);
  const normalized = normalizarClaveGrupo(display);
  const utiles = normalized.replace(/ /g, '');
  if (!display) return { valida: false, error: 'Escribe una clave para el grupo.' };
  if ([...display].length > 50) return { valida: false, error: 'La clave puede tener como maximo 50 caracteres.' };
  if ([...utiles].length < 5) return { valida: false, error: 'La clave debe tener al menos 5 caracteres significativos.' };
  if (!/^[\p{L}\p{N} ]+$/u.test(display)) {
    return { valida: false, error: 'Usa solamente letras, numeros y espacios.' };
  }
  return { valida: true, display, normalized, error: null };
}

function sesionGrupoNormalizada(groupId, memberOrSession, token, expiresAt) {
  if (groupId && typeof groupId === 'object') {
    const respuesta = groupId;
    const gid = respuesta.groupId ?? respuesta.group_id
      ?? respuesta.member?.group_id ?? respuesta.miembro?.group_id;
    const member = respuesta.member ?? respuesta.miembro
      ?? ((respuesta.memberId ?? respuesta.member_id) ? {
        id: respuesta.memberId ?? respuesta.member_id,
        group_id: gid,
        display_name: respuesta.displayName ?? respuesta.display_name ?? respuesta.name ?? '',
      } : null);
    const rawToken = respuesta.token ?? respuesta.sessionToken ?? respuesta.session_token;
    return gid && member && rawToken ? {
      groupId: String(gid), member, token: String(rawToken),
      expiresAt: respuesta.expiresAt ?? respuesta.expires_at ?? null,
    } : null;
  }
  const member = memberOrSession?.member ?? memberOrSession?.miembro ?? memberOrSession;
  const rawToken = token ?? memberOrSession?.token;
  if (!groupId || !member || !rawToken) return null;
  return {
    groupId: String(groupId), member, token: String(rawToken),
    expiresAt: expiresAt ?? memberOrSession?.expiresAt ?? memberOrSession?.expires_at ?? null,
  };
}

export function grupoSesionGuardar(groupId, memberOrSession, token, expiresAt) {
  const sesion = sesionGrupoNormalizada(groupId, memberOrSession, token, expiresAt);
  if (!sesion) throw new Error('No se pudo guardar la identidad del miembro.');
  const compatible = {
    ...sesion,
    memberId: sesion.member.id,
    displayName: sesion.member.display_name ?? sesion.member.displayName ?? sesion.member.name ?? '',
    sessionToken: sesion.token,
  };
  localStorage.setItem(GRUPO_SESION_PREFIX + sesion.groupId, JSON.stringify(compatible));
  return compatible;
}

export function grupoSesionLeer(groupId) {
  if (!groupId) return null;
  try {
    const guardada = JSON.parse(localStorage.getItem(GRUPO_SESION_PREFIX + groupId));
    const sesion = sesionGrupoNormalizada(guardada);
    if (!sesion?.member?.id || !sesion?.token || sesion.groupId !== String(groupId)) return null;
    if (sesion.expiresAt && Date.parse(sesion.expiresAt) <= Date.now()) {
      grupoSesionBorrar(groupId);
      return null;
    }
    return {
      ...sesion, memberId: sesion.member.id,
      displayName: sesion.member.display_name ?? sesion.member.displayName ?? sesion.member.name ?? '',
      sessionToken: sesion.token,
    };
  } catch {
    return null;
  }
}

export function grupoSesionBorrar(groupId) {
  if (groupId) localStorage.removeItem(GRUPO_SESION_PREFIX + groupId);
}

let supabase = null;
async function client() {
  if (!supabase) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// Identidad local persistente (sin login: cada navegador tiene un id)
export function miId() {
  let id = localStorage.getItem('mundialito-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('mundialito-id', id);
  }
  return id;
}

function codigoSala() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += letras[Math.floor(Math.random() * letras.length)];
  return c;
}

// ---------- MODO ONLINE ----------

async function onlineCrearSala(nombre, modo, enabledSquads = null) {
  const sb = await client();
  const code = codigoSala();
  const seed = Math.floor(Math.random() * 2 ** 31);
  const enabled_squads = Array.isArray(enabledSquads) ? [...enabledSquads] : null;
  const { error: e1 } = await sb.from('rooms')
    .insert({ code, status: 'lobby', seed, host_id: miId(), modo, enabled_squads });
  if (e1) throw e1;
  const { error: e2 } = await sb.from('players')
    .insert({ id: miId(), room_code: code, name: nombre, ready: false });
  if (e2) throw e2;
  return code;
}

async function onlineUnirse(code, nombre) {
  const sb = await client();
  code = code.toUpperCase().trim();
  const { data: room, error } = await sb.from('rooms').select().eq('code', code).maybeSingle();
  if (error) throw error;
  if (!room) throw new Error('No existe una sala con ese código.');
  if (room.status !== 'lobby') throw new Error('Esa sala ya empezó a jugar.');
  const { data: players, error: ePlayers } = await sb.from('players').select('id').eq('room_code', code);
  if (ePlayers) throw ePlayers;
  const yaEstoy = (players ?? []).some(p => p.id === miId());
  if (!yaEstoy && (players ?? []).length >= MAX_JUGADORES) {
    throw new Error(`La sala ya tiene ${MAX_JUGADORES} jugadores, el máximo para un mundial.`);
  }
  const { error: e2 } = await sb.from('players')
    .upsert({ id: miId(), room_code: code, name: nombre, ready: false });
  if (e2) throw e2;
  return code;
}

async function onlineEstado(code) {
  const sb = await client();
  const [{ data: room, error: errorRoom }, { data: players, error: errorPlayers }] = await Promise.all([
    sb.from('rooms').select().eq('code', code).maybeSingle(),
    sb.from('players').select().eq('room_code', code).order('joined_at'),
  ]);
  if (errorRoom) throw errorRoom;
  if (errorPlayers) throw errorPlayers;
  return { room, players: players ?? [] };
}

async function onlineActualizarSala(code, cambios) {
  const sb = await client();
  const { error } = await sb.from('rooms').update(cambios).eq('code', code);
  if (error) throw error;
}

async function onlineActualizarJugador(code, playerId, cambios) {
  const sb = await client();
  const { error } = await sb.from('players')
    .update(cambios).eq('id', playerId).eq('room_code', code);
  if (error) throw error;
}

async function onlineEliminarJugador(code, playerId) {
  const sb = await client();
  const { error } = await sb.from('players')
    .delete().eq('id', playerId).eq('room_code', code);
  if (error) throw error;
}

// El heartbeat y el relevo se resuelven dentro de PostgreSQL para que dos
// clientes no puedan proclamarse anfitriones a la vez. La función también
// actualiza last_seen del jugador que hace el pulso.
async function onlineMantenerPresencia(code, playerId) {
  const sb = await client();
  const { error } = await sb.rpc('touch_and_claim_room_host', {
    p_room_code: code,
    p_player_id: playerId,
  });
  if (error) throw error;
}

// Salida explícita: la RPC hace el relevo y la baja en una sola transacción.
// Durante el Mundial conserva la fila/equipo y lo marca como ausente; antes de
// empezar sí elimina la fila del jugador.
async function onlineSalirSala(code, playerId) {
  const sb = await client();
  const { error } = await sb.rpc('leave_room_and_handoff', {
    p_room_code: code,
    p_player_id: playerId,
  });
  if (error) throw error;
}

function datosRpc(data) {
  if (Array.isArray(data) && data.length === 1) return data[0];
  return data;
}

async function llamarRpc(nombre, parametros) {
  const sb = await client();
  const { data, error } = await sb.rpc(nombre, parametros);
  if (error) throw error;
  return datosRpc(data);
}

async function onlineGrupoBuscar(clave) {
  const validacion = validarClaveGrupo(clave);
  if (!validacion.valida) throw new Error(validacion.error);
  return llamarRpc('find_persistent_group', { p_group_key: validacion.display });
}

async function onlineGrupoCrear(clave) {
  const validacion = validarClaveGrupo(clave);
  if (!validacion.valida) throw new Error(validacion.error);
  return llamarRpc('create_persistent_group', { p_display_name: validacion.display });
}

async function onlineGrupoDashboard(groupId) {
  if (!groupId) throw new Error('Grupo invalido.');
  return llamarRpc('get_persistent_group_dashboard', { p_group_id: groupId });
}

function parametrosMiembro(argumento, nombre, pin) {
  if (argumento && typeof argumento === 'object') return {
    groupId: argumento.groupId ?? argumento.group_id,
    memberId: argumento.memberId ?? argumento.member_id,
    nombre: argumento.nombre ?? argumento.name ?? argumento.displayName ?? argumento.display_name,
    pin: argumento.pin,
  };
  return { groupId: argumento, nombre, pin };
}

async function onlineGrupoCrearMiembro(argumento, nombre, pin) {
  const p = parametrosMiembro(argumento, nombre, pin);
  const data = await llamarRpc('create_persistent_group_member', {
    p_group_id: p.groupId, p_display_name: limpiarNombreGrupo(p.nombre), p_pin: String(p.pin ?? ''),
  });
  return data;
}

async function onlineGrupoReclamarMiembro(argumento, memberId, pin) {
  const p = argumento && typeof argumento === 'object'
    ? parametrosMiembro(argumento)
    : { groupId: argumento, memberId, pin };
  return llamarRpc('claim_persistent_group_member', {
    p_group_id: p.groupId, p_member_id: p.memberId, p_pin: String(p.pin ?? ''),
  });
}

async function onlineGrupoIniciarTorneo(argumento) {
  const p = argumento ?? {};
  return llamarRpc('start_persistent_group_tournament', {
    p_group_id: p.groupId ?? p.group_id,
    p_member_id: p.memberId ?? p.member_id,
    p_session_token: p.sessionToken ?? p.session_token,
    p_modo: p.modo,
    p_enabled_squads: Array.isArray(p.enabledSquads ?? p.enabled_squads)
      ? [...(p.enabledSquads ?? p.enabled_squads)] : null,
  });
}

async function onlineGrupoUnirseTorneo(argumento) {
  const p = argumento ?? {};
  return llamarRpc('join_persistent_group_tournament', {
    p_group_id: p.groupId ?? p.group_id,
    p_member_id: p.memberId ?? p.member_id,
    p_session_token: p.sessionToken ?? p.session_token,
  });
}

async function onlineGrupoConfigurarVestuario(argumento) {
  const p = argumento ?? {};
  return llamarRpc('configure_persistent_group_lobby', {
    p_group_id: p.groupId ?? p.group_id,
    p_member_id: p.memberId ?? p.member_id,
    p_session_token: p.sessionToken ?? p.session_token,
    p_enabled_squads: Array.isArray(p.enabledSquads ?? p.enabled_squads)
      ? [...(p.enabledSquads ?? p.enabled_squads)] : null,
  });
}

async function onlineGrupoFinalizarTorneo(argumento, memberId, sessionToken, podium) {
  const p = argumento && typeof argumento === 'object'
    ? argumento
    : { roomCode: argumento, memberId, sessionToken, podium };
  return llamarRpc('finalize_persistent_group_tournament', {
    p_room_code: p.roomCode ?? p.room_code ?? p.code,
    p_member_id: p.memberId ?? p.member_id,
    p_session_token: p.sessionToken ?? p.session_token,
    p_podium: p.podium ?? p.podio,
  });
}

// Suscripción: callback con el estado completo ante cualquier cambio.
// Usa realtime si está disponible y además sondea cada 3 s como respaldo.
function onlineSuscribir(code, callback) {
  let activo = true;
  let jugadoresConocidos = new Map();
  let refrescando = false;
  let refrescoPendiente = false;
  const firmaJugador = p => JSON.stringify({
    id: p.id, room_code: p.room_code, name: p.name, squad_key: p.squad_key,
    formacion: p.formacion, lineup: p.lineup, ready: p.ready,
    resultados: p.resultados,
  });
  const refrescar = async () => {
    if (!activo) return;
    if (refrescando) { refrescoPendiente = true; return; }
    refrescando = true;
    try {
      const estado = await onlineEstado(code);
      jugadoresConocidos = new Map((estado.players || []).map(p => [String(p.id), firmaJugador(p)]));
      callback(estado);
    } catch { /* reintenta en el próximo tick */ }
    finally {
      refrescando = false;
      if (refrescoPendiente && activo) {
        refrescoPendiente = false;
        queueMicrotask(refrescar);
      }
    }
  };
  // Los heartbeats actualizan players.last_seen. Se ignoran esos UPDATE si el
  // resto de los datos visibles del jugador no cambió, para no convertir cada
  // pulso de cada jugador en dos consultas completas por cada cliente.
  const cambioJugador = payload => {
    if (payload.eventType === 'UPDATE' && payload.new?.id != null) {
      const id = String(payload.new.id);
      const firma = firmaJugador(payload.new);
      if (jugadoresConocidos.get(id) === firma) return;
    }
    refrescar();
  };
  let canal = null;
  client().then(sb => {
    canal = sb.channel('sala-' + code)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_code=eq.${code}` }, cambioJugador)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, refrescar)
      .subscribe();
  });
  const timer = setInterval(refrescar, 3000);
  refrescar();
  return () => {
    activo = false;
    clearInterval(timer);
    if (canal) client().then(sb => sb.removeChannel(canal));
  };
}

// ---------- MODO LOCAL (sin Supabase: 1 jugador vs la máquina) ----------

function nuevaBaseGruposLocal() {
  return { groups: [], members: [], rooms: [], sessions: [], participants: [], results: [] };
}

function cargarBaseGruposLocal() {
  try {
    const db = JSON.parse(localStorage.getItem(LOCAL_GRUPOS_KEY));
    if (db && Array.isArray(db.groups) && Array.isArray(db.members) && Array.isArray(db.rooms)) {
      return { ...nuevaBaseGruposLocal(), ...db };
    }
  } catch { /* se recupera con una base vacía */ }
  return nuevaBaseGruposLocal();
}

function guardarBaseGruposLocal(db) {
  localStorage.setItem(LOCAL_GRUPOS_KEY, JSON.stringify(db));
}

function bytesHex(bytes) {
  return [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
}

function secretoAleatorio(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesHex(buffer);
}

async function hashLocal(valor) {
  const data = new TextEncoder().encode(String(valor));
  return bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

async function hashPinLocal(pin, salt = secretoAleatorio(16)) {
  return `${salt}:${await hashLocal(`${salt}:${pin}`)}`;
}

async function verificarPinLocal(pin, pinHash) {
  const [salt, hash] = String(pinHash ?? '').split(':');
  return Boolean(salt && hash) && await hashLocal(`${salt}:${pin}`) === hash;
}

function validarNombreMiembro(nombre) {
  const display = limpiarNombreGrupo(nombre);
  if (!display || [...display].length > 40 || !/^[\p{L}\p{N} ]+$/u.test(display)) {
    throw new Error('El nombre debe usar letras, números y espacios (máximo 40 caracteres).');
  }
  return { display, normalized: normalizarClaveGrupo(display) };
}

function validarPin(pin) {
  const limpio = String(pin ?? '');
  if (!/^\d{4,6}$/.test(limpio)) throw new Error('El PIN debe tener entre 4 y 6 dígitos.');
  return limpio;
}

function grupoPublicoLocal(group) {
  if (!group) return null;
  const { id, display_name, normalized_key, created_at, updated_at } = group;
  return { id, display_name, normalized_key, created_at, updated_at };
}

function miembroPublicoLocal(member) {
  if (!member) return null;
  const { id, group_id, display_name, normalized_name, created_at, updated_at, last_seen_at } = member;
  return { id, group_id, display_name, normalized_name, created_at, updated_at, last_seen_at };
}

async function crearSesionMiembroLocal(db, member) {
  const token = secretoAleatorio();
  const expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
  db.sessions = db.sessions.filter(s => new Date(s.expires_at).getTime() > Date.now());
  db.sessions.push({
    id: crypto.randomUUID(), member_id: member.id,
    token_hash: await hashLocal(token), created_at: new Date().toISOString(), expires_at: expiresAt,
  });
  member.last_seen_at = new Date().toISOString();
  guardarBaseGruposLocal(db);
  return { member: miembroPublicoLocal(member), token, expires_at: expiresAt };
}

async function autenticarSesionLocal(db, groupId, memberId, token) {
  const member = db.members.find(m => m.id === memberId && m.group_id === groupId);
  if (!member) throw new Error('El miembro no pertenece a este grupo.');
  const tokenHash = await hashLocal(String(token ?? ''));
  const session = db.sessions.find(s => s.member_id === memberId
    && s.token_hash === tokenHash && new Date(s.expires_at).getTime() > Date.now());
  if (!session) throw new Error('La sesión venció. Vuelve a entrar con tu PIN.');
  member.last_seen_at = new Date().toISOString();
  return member;
}

function salaActivaLocal(db, groupId) {
  return db.rooms.find(r => r.group_id === groupId && !r.finalized_at
    && ['lobby', 'draft', 'running'].includes(r.status)) ?? null;
}

function salaAbandonadaLocal(room, ahora = Date.now()) {
  if (!room || !['draft', 'running'].includes(room.status)) return false;
  return !(room.players ?? []).some(player => {
    const visto = Date.parse(player.last_seen || '');
    return Number.isFinite(visto) && ahora - visto <= ABANDONO_TOTAL_MS;
  });
}

const local = { room: null, players: [], listeners: new Set() };

function guardarSalaJuegoLocal() {
  if (!local.room?.group_id) return;
  const db = cargarBaseGruposLocal();
  const index = db.rooms.findIndex(r => r.code === local.room.code);
  const snapshot = {
    ...(index >= 0 ? db.rooms[index] : {}), ...structuredClone(local.room),
    players: structuredClone(local.players), updated_at: new Date().toISOString(),
  };
  if (index >= 0) db.rooms[index] = snapshot;
  else db.rooms.push(snapshot);
  guardarBaseGruposLocal(db);
}

async function localGrupoBuscar(clave) {
  const validacion = validarClaveGrupo(clave);
  if (!validacion.valida) throw new Error(validacion.error);
  return grupoPublicoLocal(cargarBaseGruposLocal().groups
    .find(g => g.normalized_key === validacion.normalized));
}

async function localGrupoCrear(clave) {
  const validacion = validarClaveGrupo(clave);
  if (!validacion.valida) throw new Error(validacion.error);
  const db = cargarBaseGruposLocal();
  const existente = db.groups.find(g => g.normalized_key === validacion.normalized);
  if (existente) return grupoPublicoLocal(existente);
  const ahora = new Date().toISOString();
  const group = {
    id: crypto.randomUUID(), display_name: validacion.display,
    normalized_key: validacion.normalized, created_at: ahora, updated_at: ahora,
  };
  db.groups.push(group);
  guardarBaseGruposLocal(db);
  return grupoPublicoLocal(group);
}

async function localGrupoCrearMiembro(argumento, nombre, pin) {
  const p = parametrosMiembro(argumento, nombre, pin);
  const datosNombre = validarNombreMiembro(p.nombre);
  const pinLimpio = validarPin(p.pin);
  const db = cargarBaseGruposLocal();
  if (!db.groups.some(g => g.id === p.groupId)) throw new Error('El grupo no existe.');
  if (db.members.some(m => m.group_id === p.groupId && m.normalized_name === datosNombre.normalized)) {
    throw new Error('Ese nombre ya existe en el grupo. Entra como miembro existente.');
  }
  const ahora = new Date().toISOString();
  const member = {
    id: crypto.randomUUID(), group_id: p.groupId, display_name: datosNombre.display,
    normalized_name: datosNombre.normalized, pin_hash: await hashPinLocal(pinLimpio),
    created_at: ahora, updated_at: ahora, last_seen_at: ahora,
  };
  db.members.push(member);
  return crearSesionMiembroLocal(db, member);
}

async function localGrupoReclamarMiembro(argumento, memberId, pin) {
  const p = argumento && typeof argumento === 'object'
    ? parametrosMiembro(argumento)
    : { groupId: argumento, memberId, pin };
  const pinLimpio = validarPin(p.pin);
  const db = cargarBaseGruposLocal();
  const member = db.members.find(m => m.id === p.memberId && m.group_id === p.groupId);
  if (!member || !await verificarPinLocal(pinLimpio, member.pin_hash)) {
    throw new Error('Miembro o PIN incorrecto.');
  }
  return crearSesionMiembroLocal(db, member);
}

async function localGrupoDashboard(groupId) {
  const db = cargarBaseGruposLocal();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) throw new Error('El grupo no existe.');
  const members = db.members.filter(m => m.group_id === groupId).map(member => {
    const premios = db.results.filter(r => r.group_id === groupId && r.member_id === member.id);
    const played = new Set(db.participants
      .filter(p => p.group_id === groupId && p.member_id === member.id).map(p => p.room_code)).size;
    return {
      ...miembroPublicoLocal(member), cups: premios.filter(r => r.place === 1).length,
      silvers: premios.filter(r => r.place === 2).length,
      bronzes: premios.filter(r => r.place === 3).length,
      played, podiums: premios.length,
    };
  }).sort((a, b) => b.cups - a.cups || b.silvers - a.silvers
    || b.bronzes - a.bronzes || a.display_name.localeCompare(b.display_name, 'es'));
  const finalizados = db.rooms.filter(r => r.group_id === groupId && r.finalized_at)
    .sort((a, b) => Date.parse(a.finalized_at) - Date.parse(b.finalized_at)
      || a.code.localeCompare(b.code))
    .map((room, index) => ({ room, tournamentNumber: index + 1 }));
  const recientes = finalizados.slice(-10).reverse()
    .map(({ room: r, tournamentNumber }) => ({
      code: r.code, status: 'finished', modo: r.modo,
      enabled_squads: r.enabled_squads ?? null, finished_at: r.finalized_at,
      podium: structuredClone(r.final_podium ?? []), tournament_number: tournamentNumber,
    }));
  const active = salaActivaLocal(db, groupId);
  return {
    group: grupoPublicoLocal(group), members, ranking: members,
    active_room: active ? {
      code: active.code, status: active.status, modo: active.modo,
      enabled_squads: active.enabled_squads ?? null, created_at: active.created_at,
    } : null,
    recent_tournaments: recientes,
    last_champion: recientes[0]?.podium?.find(p => Number(p.place) === 1) ?? null,
  };
}

async function localGrupoIniciarTorneo(argumento) {
  const p = argumento ?? {};
  const groupId = p.groupId ?? p.group_id;
  const memberId = p.memberId ?? p.member_id;
  const token = p.sessionToken ?? p.session_token;
  const db = cargarBaseGruposLocal();
  const member = await autenticarSesionLocal(db, groupId, memberId, token);
  const activa = salaActivaLocal(db, groupId);
  if (activa) {
    if (!salaAbandonadaLocal(activa)) throw new Error('El grupo ya tiene un Mundialito activo.');
    activa.status = 'cancelled';
    activa.cancelled_at = new Date().toISOString();
  }
  if (!/^(almanaque|penales)(\|(16|32))?$/.test(String(p.modo ?? ''))) {
    throw new Error('El modo del Mundialito no es válido.');
  }
  if (Array.isArray(p.enabledSquads ?? p.enabled_squads)
      && (p.enabledSquads ?? p.enabled_squads).length === 0) {
    throw new Error('Activa al menos un plantel para el draft.');
  }
  const code = `LOCAL-${secretoAleatorio(5).toUpperCase()}`;
  const playerId = crypto.randomUUID();
  const ahora = new Date().toISOString();
  const room = {
    code, group_id: groupId, status: 'lobby', seed: Math.floor(Math.random() * 2 ** 31),
    host_id: playerId, modo: p.modo, enabled_squads: Array.isArray(p.enabledSquads ?? p.enabled_squads)
      ? [...(p.enabledSquads ?? p.enabled_squads)] : null,
    created_at: ahora, updated_at: ahora, finalized_at: null, final_podium: null,
  };
  const player = {
    id: playerId, room_code: code, member_id: memberId, name: member.display_name,
    ready: false, squad_key: null, formacion: null, lineup: null, resultados: {}, last_seen: ahora,
  };
  db.rooms.push({ ...room, players: [player] });
  guardarBaseGruposLocal(db);
  local.room = room;
  local.players = [player];
  return { code, playerId, status: 'lobby' };
}

async function localGrupoUnirseTorneo(argumento) {
  const p = argumento ?? {};
  const groupId = p.groupId ?? p.group_id;
  const memberId = p.memberId ?? p.member_id;
  const db = cargarBaseGruposLocal();
  const member = await autenticarSesionLocal(db, groupId, memberId, p.sessionToken ?? p.session_token);
  const room = salaActivaLocal(db, groupId);
  if (!room) throw new Error('No hay un Mundialito activo en este grupo.');
  room.players ??= [];
  let player = room.players.find(pl => pl.member_id === memberId);
  if (!player) {
    if (room.status !== 'lobby') throw new Error('Este Mundialito ya empezó; solo pueden volver quienes ya participaban.');
    if (room.players.length >= MAX_JUGADORES) throw new Error(`El Mundialito ya tiene ${MAX_JUGADORES} jugadores.`);
    player = {
      id: crypto.randomUUID(), room_code: room.code, member_id: memberId,
      name: member.display_name, ready: false, squad_key: null, formacion: null,
      lineup: null, resultados: {}, last_seen: new Date().toISOString(),
    };
    room.players.push(player);
  } else {
    player.last_seen = new Date().toISOString();
  }
  if (!room.host_id || !room.players.some(pl => pl.id === room.host_id)) {
    room.host_id = player.id;
  }
  guardarBaseGruposLocal(db);
  const { players, ...roomPublica } = room;
  local.room = structuredClone(roomPublica);
  local.players = structuredClone(players);
  return { code: room.code, playerId: player.id, status: room.status };
}

async function localGrupoConfigurarVestuario(argumento) {
  const p = argumento ?? {};
  const groupId = p.groupId ?? p.group_id;
  const memberId = p.memberId ?? p.member_id;
  const enabledSquads = p.enabledSquads ?? p.enabled_squads;
  if (!Array.isArray(enabledSquads) || !enabledSquads.length) {
    throw new Error('Activa al menos un plantel para el draft.');
  }
  const db = cargarBaseGruposLocal();
  await autenticarSesionLocal(db, groupId, memberId, p.sessionToken ?? p.session_token);
  const room = salaActivaLocal(db, groupId);
  if (!room || room.status !== 'lobby') throw new Error('El vestuario ya no está disponible.');
  const host = (room.players ?? []).find(player => player.id === room.host_id);
  if (!host || host.member_id !== memberId) throw new Error('Solo el DT anfitrión puede configurar planteles.');
  room.enabled_squads = [...enabledSquads];
  room.updated_at = new Date().toISOString();
  guardarBaseGruposLocal(db);
  if (local.room?.code === room.code) local.room.enabled_squads = [...enabledSquads];
  localEmitir();
  return { code: room.code, enabled_squads: [...enabledSquads] };
}

function entradaPodioLocal(entrada, indice, players) {
  const place = Number(entrada?.place ?? entrada?.lugar ?? indice + 1);
  const indicado = entrada?.playerId ?? entrada?.player_id;
  const squadKey = entrada?.squadKey ?? entrada?.squad_key ?? null;
  const teamId = String(entrada?.team_id ?? entrada?.teamId ?? entrada?.id
    ?? (indicado ? `h-${indicado}` : squadKey ?? ''));
  const playerId = teamId.startsWith('h-') ? teamId.slice(2) : teamId;
  const isAI = entrada?.isAI ?? entrada?.is_ai
    ?? (entrada?.human == null ? !teamId.startsWith('h-') : !entrada.human);
  if ((isAI && indicado) || (!isAI && teamId !== `h-${playerId}`)) {
    throw new Error('La identidad del equipo del podio no es coherente.');
  }
  const player = isAI ? null : players.find(p => String(p.id) === playerId && p.member_id);
  if (!isAI && !player) throw new Error('El humano del podio no participó en este torneo.');
  const displayName = limpiarNombreGrupo(player?.name ?? entrada?.display_name ?? entrada?.displayName
    ?? entrada?.nombre ?? entrada?.name ?? teamId);
  return {
    place, team_id: teamId, display_name: displayName,
    human: Boolean(player), member_id: player?.member_id ?? null, squad_key: squadKey,
  };
}

async function localGrupoFinalizarTorneo(argumento, memberId, sessionToken, podium) {
  const p = argumento && typeof argumento === 'object'
    ? argumento : { roomCode: argumento, memberId, sessionToken, podium };
  const roomCode = p.roomCode ?? p.room_code ?? p.code;
  const db = cargarBaseGruposLocal();
  const room = db.rooms.find(r => r.code === roomCode && r.group_id);
  if (!room) throw new Error('El torneo no existe.');
  const callerMemberId = p.memberId ?? p.member_id;
  await autenticarSesionLocal(db, room.group_id, callerMemberId, p.sessionToken ?? p.session_token);
  if (room.finalized_at) {
    return { finalized: true, already_finalized: true, podium: structuredClone(room.final_podium) };
  }
  const host = (room.players ?? []).find(pl => pl.id === room.host_id);
  if (!host || host.member_id !== callerMemberId) {
    throw new Error('Solo el anfitrión actual puede finalizar el torneo.');
  }
  if (room.status !== 'running') throw new Error('El torneo aún no está en estado de juego.');
  const entradas = p.podium ?? p.podio;
  if (!Array.isArray(entradas) || entradas.length !== 3) {
    throw new Error('El podio debe tener exactamente tres puestos.');
  }
  const finalPodium = entradas.map((entry, i) => entradaPodioLocal(entry, i, room.players ?? []));
  if (finalPodium.some(entry => !entry.team_id || !entry.display_name)
      || new Set(finalPodium.map(entry => entry.team_id)).size !== 3
      || new Set(finalPodium.map(entry => entry.place)).size !== 3
      || ![1, 2, 3].every(place => finalPodium.some(entry => entry.place === place))) {
    throw new Error('El podio debe contener tres equipos distintos en los puestos 1, 2 y 3.');
  }
  const ahora = new Date().toISOString();
  for (const player of room.players ?? []) {
    if (player.member_id && !db.participants.some(x => x.room_code === room.code && x.member_id === player.member_id)) {
      db.participants.push({
        room_code: room.code, group_id: room.group_id,
        member_id: player.member_id, created_at: ahora,
      });
    }
  }
  for (const entry of finalPodium) {
    if (entry.member_id && !db.results.some(x => x.room_code === room.code && x.place === entry.place)) {
      db.results.push({
        id: crypto.randomUUID(), group_id: room.group_id, room_code: room.code,
        member_id: entry.member_id, place: entry.place,
        award_type: ['cup', 'silver', 'bronze'][entry.place - 1], created_at: ahora,
      });
    }
  }
  room.status = 'finished';
  room.finalized_at = ahora;
  room.final_podium = finalPodium.sort((a, b) => a.place - b.place);
  guardarBaseGruposLocal(db);
  if (local.room?.code === room.code) Object.assign(local.room, {
    status: 'finished', finalized_at: ahora, final_podium: structuredClone(room.final_podium),
  });
  return { finalized: true, already_finalized: false, podium: structuredClone(room.final_podium) };
}

function localEmitir() {
  guardarSalaJuegoLocal();
  const estado = { room: { ...local.room }, players: local.players.map(p => ({ ...p })) };
  for (const cb of local.listeners) cb(estado);
}

async function localCrearSala(nombre, modo, enabledSquads = null) {
  local.room = {
    code: 'LOCAL', status: 'lobby',
    seed: Math.floor(Math.random() * 2 ** 31), host_id: miId(), modo,
    enabled_squads: Array.isArray(enabledSquads) ? [...enabledSquads] : null,
  };
  local.players = [{ id: miId(), room_code: 'LOCAL', name: nombre, ready: false, squad_key: null, formacion: null, lineup: null, resultados: {} }];
  return 'LOCAL';
}

async function localEstado() {
  return { room: local.room, players: local.players };
}

async function localActualizarSala(_code, cambios) {
  Object.assign(local.room, cambios);
  localEmitir();
}

async function localActualizarJugador(_code, playerId, cambios) {
  const p = local.players.find(p => p.id === playerId);
  if (p) Object.assign(p, cambios);
  localEmitir();
}

async function localEliminarJugador(_code, playerId) {
  local.players = local.players.filter(p => p.id !== playerId);
  localEmitir();
}

async function localMantenerPresencia() {
  // El modo local tiene un solo jugador y no necesita heartbeat ni relevo.
}

async function localSalirSala(_code, playerId) {
  if (!local.room) return;
  if (['finished', 'cancelled'].includes(local.room.status)) return;
  if (local.room.status === 'lobby') {
    local.players = local.players.filter(p => p.id !== playerId);
    if (local.room.host_id === playerId) local.room.host_id = local.players[0]?.id ?? null;
  }
  // Draft/running mantienen la fila completa: cerrar o soltar el cliente es
  // desconexión, no abandono ni eliminación de progreso.
  localEmitir();
}

function localSuscribir(_code, callback) {
  local.listeners.add(callback);
  localEstado().then(callback);
  return () => local.listeners.delete(callback);
}

// ---------- API unificada ----------

export const net = ONLINE
  ? {
      crearSala: onlineCrearSala, unirse: onlineUnirse, estado: onlineEstado,
      actualizarSala: onlineActualizarSala, actualizarJugador: onlineActualizarJugador,
      eliminarJugador: onlineEliminarJugador,
      mantenerPresencia: onlineMantenerPresencia, salirSala: onlineSalirSala,
      suscribir: onlineSuscribir,
      grupoBuscar: onlineGrupoBuscar, grupoCrear: onlineGrupoCrear,
      grupoDashboard: onlineGrupoDashboard,
      grupoCrearMiembro: onlineGrupoCrearMiembro,
      grupoReclamarMiembro: onlineGrupoReclamarMiembro,
      grupoSesionGuardar, grupoSesionLeer, grupoSesionBorrar,
      grupoIniciarTorneo: onlineGrupoIniciarTorneo,
      grupoUnirseTorneo: onlineGrupoUnirseTorneo,
      grupoConfigurarVestuario: onlineGrupoConfigurarVestuario,
      grupoFinalizarTorneo: onlineGrupoFinalizarTorneo,
    }
  : {
      crearSala: localCrearSala,
      unirse: async () => { throw new Error('Modo local: solo se puede crear sala (configura Supabase para jugar online).'); },
      estado: localEstado,
      actualizarSala: localActualizarSala, actualizarJugador: localActualizarJugador,
      eliminarJugador: localEliminarJugador,
      mantenerPresencia: localMantenerPresencia, salirSala: localSalirSala,
      suscribir: localSuscribir,
      grupoBuscar: localGrupoBuscar, grupoCrear: localGrupoCrear,
      grupoDashboard: localGrupoDashboard,
      grupoCrearMiembro: localGrupoCrearMiembro,
      grupoReclamarMiembro: localGrupoReclamarMiembro,
      grupoSesionGuardar, grupoSesionLeer, grupoSesionBorrar,
      grupoIniciarTorneo: localGrupoIniciarTorneo,
      grupoUnirseTorneo: localGrupoUnirseTorneo,
      grupoConfigurarVestuario: localGrupoConfigurarVestuario,
      grupoFinalizarTorneo: localGrupoFinalizarTorneo,
    };
