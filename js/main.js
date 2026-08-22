// Mundialito — enrutador principal y estado de la app

import { net, ONLINE, miId } from './net/net.js';
import { $, toast } from './ui/dom.js';
import { pantallaGrupo, pantallaInicio } from './ui/grupo.js';
import { pantallaLobby } from './ui/lobby.js';
import { pantallaDraft } from './ui/draft.js';
import { pantallaTorneo } from './ui/torneo.js';

export const app = {
  root: null,
  code: null,
  playerId: null,      // participación efímera dentro del torneo activo
  grupo: null,         // { group, member, token, dashboard } identidad persistente
  estado: null,        // { room, players } último estado conocido
  unsub: null,
  pantallaActual: null, // para no re-renderizar pantallas completas innecesariamente
  limpiezaPantalla: null, // cada pantalla registra aquí cómo soltar sus listeners
};

const CONTEXTO_GRUPO_KEY = 'mundialito-grupo-contexto';

function idGrupo(group) { return group?.id || group?.group_id || null; }
function extraerIngresoVestuario(respuesta) {
  const dato = Array.isArray(respuesta) ? respuesta[0] : (respuesta?.data ?? respuesta);
  const code = dato?.code ?? dato?.room_code ?? dato?.roomCode;
  const playerId = dato?.playerId ?? dato?.player_id ?? dato?.player?.id;
  if (!code || !playerId) throw new Error('No se pudo abrir el vestuario del grupo.');
  return { code, playerId };
}
function guardarContextoGrupo() {
  if (!app.grupo?.group) {
    localStorage.removeItem(CONTEXTO_GRUPO_KEY);
    return;
  }
  localStorage.setItem(CONTEXTO_GRUPO_KEY, JSON.stringify({
    group: app.grupo.group,
    member: app.grupo.member || null,
    expiresAt: app.grupo.expiresAt || null,
  }));
}

export function miJugadorId() {
  return app.playerId || miId();
}

const HEARTBEAT_MS = 15000;
let heartbeatTimer = null;
let heartbeatCode = null;
let heartbeatEnCurso = false;

function detenerHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  heartbeatCode = null;
  heartbeatEnCurso = false;
}

function iniciarHeartbeat(code) {
  detenerHeartbeat();
  if (!ONLINE) return;
  heartbeatCode = code;
  const pulso = async () => {
    if (heartbeatEnCurso || app.code !== code || heartbeatCode !== code) return;
    heartbeatEnCurso = true;
    try { await net.mantenerPresencia(code, miJugadorId()); }
    catch { /* el polling y el siguiente pulso vuelven a intentarlo */ }
    finally { heartbeatEnCurso = false; }
  };
  pulso();
  heartbeatTimer = setInterval(pulso, HEARTBEAT_MS);
}

function cambiarPantalla(nombre, renderFn) {
  if (app.limpiezaPantalla) { app.limpiezaPantalla(); app.limpiezaPantalla = null; }
  app.pantallaActual = nombre;
  renderFn();
}

export async function refrescarGrupo({ renderizar = true, silencioso = false } = {}) {
  const group = app.grupo?.group;
  const groupId = idGrupo(group);
  if (!groupId) return null;
  try {
    const dashboard = await net.grupoDashboard(groupId);
    if (!dashboard) return null;
    app.grupo = { ...app.grupo, group: dashboard.group || group, dashboard };
    guardarContextoGrupo();
    if (renderizar && !app.code) pantallaGrupo(app.root);
    return dashboard;
  } catch (e) {
    if (!silencioso) toast('No se pudo actualizar el grupo: ' + e.message, true);
    return null;
  }
}

export async function entrarAGrupo(groupOrDashboard, sesion = {}) {
  const dashboard = groupOrDashboard?.group && Array.isArray(groupOrDashboard?.members)
    ? groupOrDashboard
    : (sesion.dashboard || null);
  const group = dashboard?.group || groupOrDashboard?.group || groupOrDashboard;
  if (!idGrupo(group)) throw new Error('El grupo no tiene una identidad válida.');
  const mismoGrupo = idGrupo(app.grupo?.group) === idGrupo(group);
  const member = sesion.member || sesion.miembro || (mismoGrupo ? app.grupo?.member : null) || null;
  const token = sesion.sessionToken || sesion.token || (mismoGrupo ? app.grupo?.token : null) || null;
  const expiresAt = sesion.expiresAt || sesion.expires_at || (mismoGrupo ? app.grupo?.expiresAt : null) || null;
  app.grupo = { group, member, token, expiresAt, dashboard };
  if (member && token) {
    await net.grupoSesionGuardar(idGrupo(group), member, token, expiresAt);
  }
  guardarContextoGrupo();
  if (!dashboard) await refrescarGrupo({ renderizar: false, silencioso: true });
  if (!app.code) await abrirVestuarioGrupo();
  return app.grupo;
}

// El vestuario es una room lobby persistida: el grupo conserva identidad e
// historial; la room conserva presencia, anfitrión, draft y torneo.
export async function abrirVestuarioGrupo() {
  if (app.code) return app.code;
  const group = app.grupo?.group;
  const member = app.grupo?.member;
  const token = app.grupo?.token;
  if (!idGrupo(group) || !member?.id || !token) return null;
  const parametros = {
    groupId: idGrupo(group), memberId: member.id, sessionToken: token,
  };
  let respuesta;
  try {
    // La RPC bloquea el grupo y es la fuente de verdad: intentar crear primero
    // evita depender de un dashboard que pudo quedar desactualizado al terminar
    // el Mundialito anterior. Si ya existe una room activa, abajo se reutiliza.
    respuesta = await net.grupoIniciarTorneo({ ...parametros, modo: 'almanaque|32', enabledSquads: null });
  } catch (error) {
    // Dos DT pueden intentar crear el vestuario a la vez. La RPC bloquea el
    // grupo y crea solo una room; quien pierde la carrera se une a esa misma.
    if (/Mundialito activo/i.test(error?.message || '')) {
      try { respuesta = await net.grupoUnirseTorneo(parametros); }
      catch (joinError) { error = joinError; }
    }
    if (!respuesta) {
      app.grupo = { ...app.grupo, vestuarioError: error?.message || 'No se pudo abrir el vestuario.' };
      pantallaGrupo(app.root);
      return null;
    }
  }
  const { code, playerId } = extraerIngresoVestuario(respuesta);
  app.grupo = { ...app.grupo, vestuarioError: null };
  entrarASala(code, { playerId });
  return code;
}

export async function salirDeGrupo() {
  const groupId = idGrupo(app.grupo?.group);
  if (app.code) salirDeSala({ volverAlGrupo: false });
  if (groupId) await net.grupoSesionBorrar(groupId);
  app.grupo = null;
  guardarContextoGrupo();
  app.pantallaActual = null;
  pantallaGrupo(app.root);
}

export function entrarASala(code, { playerId = null } = {}) {
  app.code = code;
  app.playerId = playerId || app.playerId || miId();
  if (app.unsub) app.unsub();
  app.unsub = net.suscribir(code, alCambiarEstado);
  iniciarHeartbeat(code);
  // recordar la sala para reconectarse si se recarga la página
  sessionStorage.setItem('mundialito-sala', code);
  sessionStorage.setItem('mundialito-player-id', app.playerId);
}

export function salirDeSala({ notificar = true, volverAlGrupo = true } = {}) {
  const code = app.code;
  const jugadorId = miJugadorId();
  const status = app.estado?.room?.status;
  const estabaEnSala = Boolean(code && app.estado?.players?.some(p => p.id === jugadorId));
  detenerHeartbeat();
  if (app.unsub) app.unsub();
  if (app.limpiezaPantalla) { app.limpiezaPantalla(); app.limpiezaPantalla = null; }
  app.unsub = null;
  app.code = null;
  app.playerId = null;
  app.estado = null;
  app.pantallaActual = null;
  sessionStorage.removeItem('mundialito-sala');
  sessionStorage.removeItem('mundialito-player-id');
  if (volverAlGrupo) {
    if (status === 'finished' && app.grupo?.member && app.grupo?.token) {
      refrescarGrupo({ renderizar: false, silencioso: true })
        .finally(() => abrirVestuarioGrupo());
    } else {
      pantallaGrupo(app.root);
      refrescarGrupo({ renderizar: true, silencioso: true });
    }
  }
  // Se hace después de soltar la suscripción para que la baja local/online no
  // vuelva a dibujar la pantalla que acabamos de abandonar.
  if (notificar && estabaEnSala && status !== 'finished') {
    net.salirSala(code, jugadorId)
      .catch(e => toast('Saliste de la sala, pero no se pudo avisar al servidor: ' + e.message, true));
  }
}

function alCambiarEstado(estado) {
  if (!estado.room) { salirDeSala({ notificar: false }); return; }
  const habiaSala = Boolean(app.estado?.room);
  const hostAnterior = app.estado?.room?.host_id;
  app.estado = estado;
  // si el anfitrión me sacó de la sala antes del Mundial (ya no estoy en la lista), me voy
  if ((estado.room.status === 'lobby' || estado.room.status === 'draft') &&
      estado.players.length && !estado.players.some(p => p.id === miJugadorId())) {
    toast('El anfitrión te sacó de la sala.', true);
    salirDeSala({ notificar: false });
    return;
  }
  const status = estado.room.status;
  if (status === 'finished') detenerHeartbeat();
  const pantalla = status === 'lobby' ? 'lobby' : status === 'draft' ? 'draft' : 'torneo';

  // Torneo captura `esHost` al montar la pantalla. Un relevo requiere montar de
  // nuevo para entregar inmediatamente los controles al nuevo anfitrión.
  const cambioHost = habiaSala && hostAnterior !== estado.room.host_id;
  if (app.pantallaActual !== pantalla || cambioHost) {
    if (pantalla === 'lobby') cambiarPantalla('lobby', () => pantallaLobby(app.root));
    else if (pantalla === 'draft') cambiarPantalla('draft', () => pantallaDraft(app.root));
    else cambiarPantalla('torneo', () => pantallaTorneo(app.root));
  } else {
    // actualización en caliente dentro de la misma pantalla
    document.dispatchEvent(new CustomEvent('sala:cambio', { detail: estado }));
  }
}

export function soyHost() {
  return app.estado?.room?.host_id === miJugadorId();
}

export function miJugador() {
  return app.estado?.players?.find(p => p.id === miJugadorId());
}

// arranque
document.addEventListener('DOMContentLoaded', () => {
  app.root = $('#app');
  // La sesión y la sala persistidas se conservan, pero nunca definen la primera
  // pantalla: cada carga empieza deliberadamente en la portada.
  pantallaInicio(app.root);
});

window.addEventListener('error', e => {
  console.error(e.error || e.message);
  toast('Ups, algo falló: ' + (e.error?.message || e.message), true);
});
