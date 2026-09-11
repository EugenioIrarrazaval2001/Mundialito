// Transporte autorizado y compatibilidad con las identidades/historial locales.
// El código de invitación no es una credencial y no se usa un playerId global.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { crearRedSegura } from './lifecycle.js';
export { CICLO_VIDA, ahoraServidor, validarNombreJugador } from './lifecycle.js';
export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MAX_JUGADORES = 32;
const GRUPO_SESION_PREFIX = 'mundialito-grupo-sesion:';
const LOCAL_GRUPOS_KEY = 'mundialito-grupos-local-v1';

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


function cargarBaseGruposLocal() {
  try { return {groups:[],members:[],rooms:[],sessions:[],participants:[],results:[],...JSON.parse(localStorage.getItem(LOCAL_GRUPOS_KEY))}; }
  catch { return {groups:[],members:[],rooms:[],sessions:[],participants:[],results:[]}; }
}
function grupoPublicoLocal(group) {
  if (!group) return null;
  const {id,display_name,normalized_key,created_at,updated_at}=group;
  return {id,display_name,normalized_key,created_at,updated_at};
}
function miembroPublicoLocal(member) {
  const {pin_hash,...result}=member;
  return result;
}
function salaActivaLocal(db,groupId) {
  return db.rooms.find(r=>r.group_id===groupId&&!r.finalized_at&&['lobby','draft','running'].includes(r.status)) || null;
}
async function localGrupoBuscar(clave) {
  const validacion=validarClaveGrupo(clave);
  if (!validacion.valida) throw new Error(validacion.error);
  return grupoPublicoLocal(cargarBaseGruposLocal().groups.find(g=>g.normalized_key===validacion.normalized));
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


const legacyNet = {grupoBuscar:localGrupoBuscar,grupoDashboard:localGrupoDashboard,
  grupoSesionGuardar,grupoSesionLeer,grupoSesionBorrar};
export const net = crearRedSegura({legacyNet,online:ONLINE,url:SUPABASE_URL,key:SUPABASE_ANON_KEY});
