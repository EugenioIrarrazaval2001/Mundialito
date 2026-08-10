// Lobby: jugadores esperando, el host reparte los planteles

import { net, miId, MAX_JUGADORES } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, soyHost, salirDeSala } from '../main.js';
import { parseModo } from '../engine/engine.js';

// Vive fuera de `dibujar`: Realtime repinta el Lobby durante los updates del
// bucle, pero no debe recrear un botón habilitado ni iniciar un segundo bucle.
const iniciosDraftEnCurso = new Set();

export function pantallaLobby(root) {
  const code = app.estado.room.code;
  dibujar(root);
  const handler = () => dibujar(root);
  document.addEventListener('sala:cambio', handler);
  // main.js llama esta limpieza al cambiar de pantalla
  app.limpiezaPantalla = () => {
    document.removeEventListener('sala:cambio', handler);
    iniciosDraftEnCurso.delete(code);
  };
}

function dibujar(root) {
  const { room, players } = app.estado;
  const host = soyHost();
  const esLocal = room.code === 'LOCAL';
  const iniciandoDraft = iniciosDraftEnCurso.has(room.code);
  const salaLlena = players.length >= MAX_JUGADORES;
  const salaSobrepasada = players.length > MAX_JUGADORES;

  render(root, html`
    <div class="lobby">
      <header class="cabecera-sala">
        <button id="btn-salir" class="btn btn-mini" ${iniciandoDraft ? 'disabled' : ''}>← Salir</button>
        <div class="ticket">
          <span class="ticket-label">CÓDIGO DE SALA</span>
          <span class="ticket-codigo">${esc(room.code)}</span>
        </div>
        <span class="chip-modo">${parseModo(room.modo).modo === 'penales'
          ? '🧤 SOLO PENALES' : '📖 SELECCIONES HISTÓRICAS'}
          · ${parseModo(room.modo).total} EQUIPOS</span>
      </header>

      <h2 class="titulo-seccion">Vestuario <span class="contador">(${players.length}/${MAX_JUGADORES} ${players.length === 1 ? 'jugador' : 'jugadores'})</span></h2>
      ${esLocal ? '' : html`<p class="nota centrada">Comparte el código <b>${esc(room.code)}</b> con tu oficina para que se unan.</p>`}
      ${salaLlena && !salaSobrepasada ? '<p class="nota centrada">Sala llena: este es el máximo para un mundial de 32 equipos.</p>' : ''}
      ${salaSobrepasada ? html`<p class="nota centrada error-lobby">Hay ${players.length} jugadores, pero el máximo es ${MAX_JUGADORES}. Deben salir ${players.length - MAX_JUGADORES} antes de empezar.</p>` : ''}

      <ul class="lista-jugadores">
        ${players.map((p, i) => html`
          <li class="jugador-item ${p.id === miId() ? 'soy-yo' : ''}">
            <span class="dorsal">${i + 1}</span>
            <span class="nombre-jugador">${esc(p.name)}</span>
            ${p.id === room.host_id ? '<span class="etiqueta-host">DT ANFITRIÓN</span>' : ''}
            ${host && p.id !== room.host_id
              ? `<button class="btn-kick" data-kick="${p.id}" title="Sacar de la sala">✕</button>`
              : ''}
          </li>`).join('')}
      </ul>

      ${host ? html`
        <div class="acciones-centro">
          <button id="btn-repartir" class="btn btn-primario btn-grande" ${iniciandoDraft ? 'disabled' : ''}>
            🎲 Empezar el draft
          </button>
          <p class="nota">${esLocal
            ? 'Armarás tu equipo de 11 titulares y 7 suplentes a punta de sorteos, y jugarás contra selecciones de la máquina.'
            : 'Cada DT armará 11 titulares y 7 suplentes: en cada turno se sortea una selección histórica y elige un jugador.'}</p>
        </div>` : html`
        <p class="nota centrada esperando">Esperando que ${esc(players.find(p => p.id === room.host_id)?.name ?? 'el anfitrión')} sortee los planteles…</p>`}
    </div>
  `);

  $('#btn-salir', root).addEventListener('click', salirDeSala);

  // el anfitrión puede sacar a un jugador antes de empezar (si alguien se desconecta)
  $$('.btn-kick', root).forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.kick;
    const pl = players.find(p => p.id === pid);
    if (!confirm(`¿Sacar a ${pl?.name ?? 'este jugador'} de la sala? Podrá volver a entrar con el código mientras no haya empezado.`)) return;
    b.disabled = true;
    try { await net.eliminarJugador(room.code, pid); }
    catch (e) { b.disabled = false; toast('No se pudo sacar al jugador: ' + e.message, true); }
  }));

  if (host) {
    $('#btn-repartir', root).addEventListener('click', async () => {
      if (iniciosDraftEnCurso.has(room.code)) return;
      const btn = $('#btn-repartir', root);
      if (players.length > MAX_JUGADORES) {
        toast(`Máximo ${MAX_JUGADORES} jugadores. Hay ${players.length}.`, true);
        return;
      }
      iniciosDraftEnCurso.add(room.code);
      btn.disabled = true;
      $('#btn-salir', root).disabled = true;
      const puedeContinuar = () =>
        app.code === room.code && app.estado?.room?.status === 'lobby' && soyHost();
      try {
        for (const p of players) {
          if (!puedeContinuar()) { iniciosDraftEnCurso.delete(room.code); return; }
          await net.actualizarJugador(room.code, p.id, {
            squad_key: null, ready: false, lineup: null, formacion: null,
          });
        }
        if (!puedeContinuar()) { iniciosDraftEnCurso.delete(room.code); return; }
        await net.actualizarSala(room.code, { status: 'draft' });
      } catch (e) {
        iniciosDraftEnCurso.delete(room.code);
        if (app.estado?.room?.code === room.code && app.estado.room.status === 'lobby') dibujar(root);
        toast('No se pudo iniciar el draft: ' + e.message, true);
      }
    });
  }
}
