// Mundialito — enrutador principal y estado de la app

import { net, ONLINE, miId } from './net/net.js';
import { $, toast } from './ui/dom.js';
import { pantallaHome } from './ui/home.js';
import { pantallaLobby } from './ui/lobby.js';
import { pantallaDraft } from './ui/draft.js';
import { pantallaTorneo } from './ui/torneo.js';

export const app = {
  root: null,
  code: null,
  estado: null,        // { room, players } último estado conocido
  unsub: null,
  pantallaActual: null, // para no re-renderizar pantallas completas innecesariamente
  limpiezaPantalla: null, // cada pantalla registra aquí cómo soltar sus listeners
};

function cambiarPantalla(nombre, renderFn) {
  if (app.limpiezaPantalla) { app.limpiezaPantalla(); app.limpiezaPantalla = null; }
  app.pantallaActual = nombre;
  renderFn();
}

export function entrarASala(code) {
  app.code = code;
  if (app.unsub) app.unsub();
  app.unsub = net.suscribir(code, alCambiarEstado);
  // recordar la sala para reconectarse si se recarga la página
  sessionStorage.setItem('mundialito-sala', code);
}

export function salirDeSala() {
  if (app.unsub) app.unsub();
  if (app.limpiezaPantalla) { app.limpiezaPantalla(); app.limpiezaPantalla = null; }
  app.unsub = null;
  app.code = null;
  app.estado = null;
  app.pantallaActual = null;
  sessionStorage.removeItem('mundialito-sala');
  pantallaHome(app.root);
}

function alCambiarEstado(estado) {
  if (!estado.room) { salirDeSala(); return; }
  app.estado = estado;
  // si el anfitrión me sacó de la sala antes del Mundial (ya no estoy en la lista), me voy
  if ((estado.room.status === 'lobby' || estado.room.status === 'draft') &&
      estado.players.length && !estado.players.some(p => p.id === miId())) {
    toast('El anfitrión te sacó de la sala.', true);
    salirDeSala();
    return;
  }
  const status = estado.room.status;
  const pantalla = status === 'lobby' ? 'lobby' : status === 'draft' ? 'draft' : 'torneo';

  if (app.pantallaActual !== pantalla) {
    if (pantalla === 'lobby') cambiarPantalla('lobby', () => pantallaLobby(app.root));
    else if (pantalla === 'draft') cambiarPantalla('draft', () => pantallaDraft(app.root));
    else cambiarPantalla('torneo', () => pantallaTorneo(app.root));
  } else {
    // actualización en caliente dentro de la misma pantalla
    document.dispatchEvent(new CustomEvent('sala:cambio', { detail: estado }));
  }
}

export function soyHost() {
  return app.estado?.room?.host_id === miId();
}

export function miJugador() {
  return app.estado?.players?.find(p => p.id === miId());
}

// arranque
document.addEventListener('DOMContentLoaded', async () => {
  app.root = $('#app');
  const salaGuardada = sessionStorage.getItem('mundialito-sala');
  if (salaGuardada && ONLINE) {
    try {
      const { room } = await net.estado(salaGuardada);
      if (room) { entrarASala(salaGuardada); return; }
    } catch { /* sin conexión: vamos al home */ }
    sessionStorage.removeItem('mundialito-sala');
  }
  pantallaHome(app.root);
});

window.addEventListener('error', e => {
  console.error(e.error || e.message);
  toast('Ups, algo falló: ' + (e.error?.message || e.message), true);
});
