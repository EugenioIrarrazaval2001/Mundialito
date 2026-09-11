import { net, CICLO_VIDA } from './net/net.js';
import { $, toast, esc } from './ui/dom.js';
import { pantallaGrupo, pantallaInicio } from './ui/grupo.js';
import { pantallaLobby } from './ui/lobby.js';
import { pantallaDraft } from './ui/draft.js';
import { pantallaTorneo } from './ui/torneo.js';

export const app = { root: null, code: null, roomId: null, playerId: null,
  accessMode: null, credencial: null, grupo: null, estado: null, unsub: null,
  pantallaActual: null, limpiezaPantalla: null, generacion: 0, accesoInterrumpido: false };
const RESUME_KEY = 'mundialito-resume-v2';
let timer, cargaTimer, pulsoPendiente = false, accesoPendiente = null;
const idGrupo = g => g?.id || g?.group_id;
export const miJugadorId = () => app.playerId;
export const miJugador = () => app.estado?.players?.find(p => p.id === app.playerId);
export const soyHost = () => Boolean(app.playerId && app.estado?.room?.host_id === app.playerId);
export function capturarNavegacion() {
  const { generacion, roomId, playerId } = app;
  return () => app.generacion === generacion && app.roomId === roomId && app.playerId === playerId;
}
function resumeLeer() { try { return JSON.parse(localStorage.getItem(RESUME_KEY)); } catch { return null; } }
function guardarResume(auto = true) {
  if (!app.code || !app.roomId || !app.playerId) return;
  auto = auto && !app.accesoInterrumpido && !['finished','cancelled'].includes(app.estado?.room?.status);
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ code: app.code, roomId: app.roomId,
      playerId: app.playerId, accessMode: app.accessMode, groupId: idGrupo(app.grupo?.group),
      memberId: app.grupo?.member?.id, lastActiveAt: Date.now(), auto }));
  } catch { /* La navegación nunca depende de la cuota del respaldo local. */ }
}
function detener() {
  clearInterval(timer); clearTimeout(cargaTimer); pulsoPendiente = false;
  app.unsub?.(); app.unsub = null;
  app.limpiezaPantalla?.(); app.limpiezaPantalla = null;
  document.dispatchEvent(new Event('mundialito:salir'));
  document.querySelectorAll('[class*="overlay-"]').forEach(e => e.remove());
  if (app.root) app.root.inert = false;
  document.body.style.overflow = '';
}
function barraSalida() {
  let barra = $('#navegacion-partida');
  if (!barra) { barra = document.createElement('nav'); barra.id = 'navegacion-partida'; document.body.appendChild(barra); }
  barra.hidden = !app.code && !app.grupo;
  barra.innerHTML = '<button class="btn btn-mini" id="salida-global">Salir al menú</button>' +
    (soyHost() && ['lobby', 'draft', 'running'].includes(app.estado?.room?.status)
      ? '<button class="btn btn-mini" id="cancelar-global">Cancelar partida</button>' : '');
  $('#salida-global', barra).onclick = () => salirAlMenu();
  $('#cancelar-global', barra)?.addEventListener('click', async () => {
    if (!confirm('Cancelar termina esta partida para todos. No se podrá continuar. El historial de otros torneos se conserva. ¿Cancelar partida?')) return;
    const vigente = capturarNavegacion();
    try { await net.cancelarSala(app.code); if (vigente()) salirAlMenu(); }
    catch (e) { if (vigente()) toast(e.message, true); }
  });
}
function pantallaError(mensaje, reintentar) {
  app.limpiezaPantalla?.(); app.limpiezaPantalla = null; app.pantallaActual = 'error';
  app.root.innerHTML = `<main class="inicio inicio-formulario"><section class="inicio-panel"><h1>No pudimos continuar</h1><p role="alert">${esc(mensaje)}</p><button class="btn" id="reintentar-acceso">Reintentar</button><button class="btn" id="volver-menu">Volver al menú</button></section></main>`;
  $('#reintentar-acceso').onclick = reintentar;
  $('#volver-menu').onclick = () => salirAlMenu(); barraSalida();
}
function carga(mensaje, reintentar) {
  app.pantallaActual = 'carga';
  app.root.innerHTML = `<main class="inicio inicio-formulario"><section class="inicio-panel"><p role="status">${esc(mensaje)}</p><button class="btn" id="volver-menu">Volver al menú</button></section></main>`;
  $('#volver-menu').onclick = () => salirAlMenu(); clearTimeout(cargaTimer);
  const vigente = capturarNavegacion();
  cargaTimer = setTimeout(() => { if (vigente() && !app.estado) pantallaError('La conexión tardó demasiado. Tu identidad sigue guardada.', reintentar); }, 16000);
  barraSalida();
}
export function salirAlMenu({ paso = 'opciones', notificar = true } = {}) {
  guardarResume(false);
  // Capturar credencial antes de soltar contexto; nunca esperar la red para salir.
  if (notificar && app.code) net.salirSala(app.code, app.playerId).catch(() => {});
  app.generacion++; detener(); accesoPendiente = null; net.limpiarContexto();
  Object.assign(app, { code: null, roomId: null, playerId: null, accessMode: null,
    credencial: null, grupo: null, estado: null, pantallaActual: null, accesoInterrumpido: false });
  pantallaInicio(app.root, paso); barraSalida();
}
export const salirDeGrupo = () => salirAlMenu();
export const salirDeSala = (opciones = {}) => salirAlMenu(opciones);
export const nuevaPartidaRapida = () => salirAlMenu({ paso: 'rapida-crear' });
export async function refrescarGrupo({ renderizar = false, silencioso = false } = {}) {
  const contexto = app.grupo, vigente = capturarNavegacion();
  if (!contexto?.group) return null;
  try {
    const dashboard = await net.grupoDashboard(idGrupo(contexto.group));
    if (!vigente() || app.grupo !== contexto) return null;
    app.grupo = { ...contexto, dashboard, group: dashboard.group || contexto.group };
    if (renderizar && !app.code) pantallaGrupo(app.root);
    return dashboard;
  } catch (e) { if (vigente() && !silencioso) toast(e.message, true); return null; }
}
export async function entrarAGrupo(groupOrDashboard, sesion = {}) {
  const group = groupOrDashboard.group || groupOrDashboard;
  if (!idGrupo(group)) throw new Error('Grupo inválido.');
  app.generacion++; detener(); accesoPendiente = null; net.limpiarContexto();
  Object.assign(app, { code: null, roomId: null, playerId: null, estado: null, credencial: null, accesoInterrumpido: false, accessMode: 'group',
    grupo: { group, member: sesion.member, token: sesion.token || sesion.sessionToken,
      expiresAt: sesion.expires_at || sesion.expiresAt, dashboard: groupOrDashboard.members ? groupOrDashboard : sesion.dashboard } });
  if (app.grupo.member && app.grupo.token) {
    net.grupoSesionGuardar(idGrupo(group), app.grupo.member, app.grupo.token, app.grupo.expiresAt);
    return abrirVestuarioGrupo();
  }
  const vigente = capturarNavegacion();
  await refrescarGrupo({ silencioso: true }); if (vigente()) { pantallaGrupo(app.root); barraSalida(); }
  return false;
}
export async function abrirVestuarioGrupo() {
  if (app.code) return app.code;
  if (accesoPendiente) return accesoPendiente;
  const contexto = app.grupo;
  if (!contexto?.member || !contexto.token) return null;
  const vigente = capturarNavegacion(); carga('Abriendo vestuario…', abrirVestuarioGrupo);
  const tarea = (async () => {
    try {
      const ingreso = await net.grupoAcceder({ groupId: idGrupo(contexto.group), memberId: contexto.member.id, sessionToken: contexto.token });
      if (!vigente()) return null;
      app.grupo = { ...app.grupo, vestuarioError: null };
      entrarASala(ingreso.code, { ...ingreso, token: contexto.token, accessMode: 'group' });
      refrescarGrupo({ silencioso: true }); return ingreso.code;
    } catch (e) {
      if (vigente()) { clearTimeout(cargaTimer); app.grupo = { ...app.grupo, vestuarioError: e.message }; pantallaError(e.message, abrirVestuarioGrupo); }
      return null;
    }
  })();
  accesoPendiente = tarea;
  try { return await tarea; } finally { if (accesoPendiente === tarea) accesoPendiente = null; }
}
export function entrarASala(code, contexto = {}) {
  if (!contexto.roomId || !contexto.playerId || !contexto.token) throw new Error('Falta la identidad autorizada de esta partida.');
  app.generacion++; detener();
  const accessMode = contexto.accessMode || (contexto.groupId ? 'group' : 'quick');
  if (accessMode === 'quick') app.grupo = null;
  Object.assign(app, { code, roomId: contexto.roomId, playerId: contexto.playerId, accessMode, credencial: contexto.token, estado: null, pantallaActual: null, accesoInterrumpido: false });
  net.activarContexto({ ...contexto, code, accessMode });
  guardarResume(); carga('Entrando al vestuario…', refrescarSala);
  const vigente = capturarNavegacion();
  app.unsub = net.suscribir(code, estado => { if (vigente()) alCambiarEstado(estado); }, { onError: error => { if (vigente()) errorSala(error); } });
  timer = setInterval(pulso, CICLO_VIDA.heartbeatMs); pulso();
}
function errorSala(error) {
  if (['CANCELLED', 'EXPIRED', 'NOT_FOUND', 'INVALID_SESSION', 'KICKED'].includes(error.code)) {
    // A heartbeat and a state read can finish out of order. Invalidate both
    // generations before showing a terminal/identity error, otherwise an older
    // lobby response could reopen a room after cancellation was confirmed.
    app.generacion++; app.accesoInterrumpido = true; guardarResume(false);
    detener(); net.limpiarContexto(); app.estado = null;
    pantallaError(error.message, () => app.accessMode==='quick' && ['CANCELLED','EXPIRED','NOT_FOUND','KICKED'].includes(error.code)
      ? salirAlMenu({paso:'rapida',notificar:false}) : reanudarGuardada());
  }
  else if (!app.estado) pantallaError(error.message, refrescarSala);
}
async function pulso() {
  if (!app.code || app.accesoInterrumpido || pulsoPendiente || document.visibilityState === 'hidden') return;
  const vigente = capturarNavegacion(); pulsoPendiente = true;
  try { await net.mantenerPresencia(app.code, app.playerId); if (vigente()) guardarResume(); }
  catch (e) { if (vigente() && e.code !== 'NETWORK' && e.code !== 'TIMEOUT') errorSala(e); }
  finally { if (vigente()) pulsoPendiente = false; }
}
async function refrescarSala() {
  if (!app.code || app.accesoInterrumpido) return;
  const vigente = capturarNavegacion();
  try { const estado = await net.estado(app.code); if (vigente()) alCambiarEstado(estado); }
  catch (e) { if (vigente()) errorSala(e); }
}
function alCambiarEstado(estado) {
  if (!estado?.room || !Array.isArray(estado.players)) return;
  if (estado.room.id !== app.roomId || estado.room.code !== app.code) return;
  // Polling y recuperación visible pueden solaparse en la misma sala. La hora
  // del snapshot, tomada bajo lock SQL, impide que una lectura antigua vuelva
  // del torneo al draft o reemplace progreso recién confirmado.
  const anterior = Date.parse(app.estado?.serverNow), recibido = Date.parse(estado.serverNow);
  if (Number.isFinite(anterior) && Number.isFinite(recibido) && recibido < anterior) return;
  if (estado.room.status === 'cancelled') { errorSala({code:'CANCELLED',message:'Esta partida fue cancelada o caducó por abandono. Puedes crear una nueva.'}); return; }
  const yo = estado.players.find(p => p.id === app.playerId);
  if (!yo) { pantallaError('No se pudo confirmar tu participación. Reintenta el acceso.', () => reanudarGuardada()); return; }
  if (yo.expelled_at) { errorSala({code:'KICKED',message:'El anfitrión te excluyó de esta partida.'}); return; }
  if (!['lobby','draft','running','finished'].includes(estado.room.status)) { pantallaError('El servidor devolvió un estado incompleto. Reintenta el acceso.', refrescarSala); return; }
  clearTimeout(cargaTimer);
  const cambioHost = app.estado && app.estado.room.host_id !== estado.room.host_id;
  app.estado = estado;
  if (estado.room.status === 'finished') { clearInterval(timer); guardarResume(false); }
  const pantalla = estado.room.status === 'lobby' ? 'lobby' : estado.room.status === 'draft' ? 'draft' : 'torneo';
  if (app.pantallaActual !== pantalla || cambioHost) {
    app.limpiezaPantalla?.(); app.limpiezaPantalla = null; app.pantallaActual = pantalla;
    ({ lobby: pantallaLobby, draft: pantallaDraft, torneo: pantallaTorneo })[pantalla](app.root);
  } else document.dispatchEvent(new CustomEvent('sala:cambio', { detail: estado }));
  barraSalida();
}
export async function reanudarGuardada({ automatica = false } = {}) {
  const resume = resumeLeer();
  if (!resume || (automatica && (!resume.auto || Date.now() - resume.lastActiveAt > CICLO_VIDA.abandonmentMs))) return false;
  app.generacion++; detener(); accesoPendiente = null; net.limpiarContexto(); app.estado = null;
  const vigente = capturarNavegacion(); carga('Recuperando tu participación…', () => reanudarGuardada());
  try {
    if (resume.accessMode === 'quick') {
      const sesion = net.rapidaSesionLeer(resume.roomId);
      if (!sesion) throw new Error('No hay credencial de esta partida en este navegador.');
      const ingreso = await net.rapidaReanudar(sesion);
      if (!vigente()) return false; entrarASala(ingreso.code, ingreso);
    } else {
      const sesion = net.grupoSesionLeer(resume.groupId);
      if (!sesion) throw new Error('Vuelve a entrar al grupo con tu PIN.');
      const dashboard = await net.grupoDashboard(resume.groupId);
      if (!vigente()) return false; await entrarAGrupo(dashboard, sesion);
    }
    return true;
  } catch (e) { if (vigente()) { clearTimeout(cargaTimer); pantallaError(e.message, () => reanudarGuardada()); } return true; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guardarResume(); else if (app.code) { pulso(); refrescarSala(); } });
window.addEventListener('pagehide', () => guardarResume());
window.addEventListener('online', () => { if (app.code) { pulso(); refrescarSala(); } });
document.addEventListener('DOMContentLoaded', async () => {
  app.root = $('#app');
  const generacionInicial = app.generacion;
  const atendida = await reanudarGuardada({ automatica: true });
  if (!atendida && app.generacion === generacionInicial) pantallaInicio(app.root, 'portada');
});
