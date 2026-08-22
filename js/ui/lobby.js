// Lobby: jugadores esperando, el host reparte los planteles

import { net, ONLINE, MAX_JUGADORES } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, soyHost, salirDeGrupo, miJugadorId } from '../main.js';
import {
  abrirUniversoDraft, configuracionDraftValida, establecerPlantelesDraftActivos,
  keysDraftActivas, resumenUniversoDraft,
} from './home.js';
import { abrirRankingHistorico } from './grupo.js';

// Vive fuera de `dibujar`: Realtime repinta el Lobby durante los updates del
// bucle, pero no debe recrear un botón habilitado ni iniciar un segundo bucle.
const iniciosDraftEnCurso = new Set();
const guardadosPlantelesEnCurso = new Map();

function guardarPlantelesVestuario(room, grupo) {
  const code = room.code;
  const anterior = guardadosPlantelesEnCurso.get(code) || Promise.resolve();
  // El selector puede emitir varios cambios seguidos. Serializarlos conserva el
  // último gesto del anfitrión incluso si la red responde fuera de orden.
  const siguiente = anterior.catch(() => {}).then(() => net.grupoConfigurarVestuario({
    groupId: grupo?.id ?? grupo?.group_id,
    memberId: app.grupo?.member?.id,
    sessionToken: app.grupo?.token,
    enabledSquads: keysDraftActivas(),
  }));
  guardadosPlantelesEnCurso.set(code, siguiente);
  siguiente.catch(error => {
    toast(error?.message || 'No se pudo guardar la configuración de planteles.', true);
  }).finally(() => {
    if (guardadosPlantelesEnCurso.get(code) === siguiente) guardadosPlantelesEnCurso.delete(code);
  });
}

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
  establecerPlantelesDraftActivos(room.enabled_squads);
  const host = soyHost();
  const jugadorId = miJugadorId();
  const grupo = app.grupo?.group;
  const identidadPrincipal = grupo?.displayName || grupo?.display_name || room.group_name || room.code;
  const esTorneoDeGrupo = Boolean(grupo || room.group_id);
  const esLocal = !ONLINE || room.code === 'LOCAL' || room.code.startsWith('LOCAL-');
  const iniciandoDraft = iniciosDraftEnCurso.has(room.code);
  const ahora = Date.now();
  const jugadoresConectados = players.filter(player => {
    const visto = Date.parse(player.last_seen || '');
    return !Number.isFinite(visto) || ahora - visto < 45000;
  });
  const salaLlena = players.length >= MAX_JUGADORES;
  const salaSobrepasada = players.length > MAX_JUGADORES;
  const { activos, total } = resumenUniversoDraft('almanaque');

  render(root, html`
    <div class="lobby">
      <header class="cabecera-sala">
        <button id="btn-salir" class="btn btn-mini" ${iniciandoDraft ? 'disabled' : ''}>Salir del grupo</button>
        <div class="ticket">
          <span class="ticket-label">${esTorneoDeGrupo ? 'GRUPO' : 'CÓDIGO DE SALA'}</span>
          <span class="ticket-codigo ${esTorneoDeGrupo ? 'ticket-grupo' : ''}">${esc(identidadPrincipal)}</span>
        </div>
        <span class="chip-modo">MUNDIALITO · 32 EQUIPOS</span>
      </header>

      <h2 class="titulo-seccion">VESTUARIO <span class="contador">— ${jugadoresConectados.length}/${MAX_JUGADORES}</span></h2>
      ${esLocal ? '' : html`<p class="nota centrada">DT conectados ahora en <b>${esc(identidadPrincipal)}</b>.</p>`}
      ${salaLlena && !salaSobrepasada ? '<p class="nota centrada">Sala llena: este es el máximo para un mundial de 32 equipos.</p>' : ''}
      ${salaSobrepasada ? html`<p class="nota centrada error-lobby">Hay ${players.length} jugadores, pero el máximo es ${MAX_JUGADORES}. Deben salir ${players.length - MAX_JUGADORES} antes de empezar.</p>` : ''}

      <ul class="lista-jugadores">
        ${jugadoresConectados.map((p, i) => html`
          <li class="jugador-item ${p.id === jugadorId ? 'soy-yo' : ''}">
            <span class="dorsal">${i + 1}</span>
            <span class="nombre-jugador">${esc(p.name)}</span>
            ${p.id === room.host_id ? '<span class="etiqueta-host">DT ANFITRIÓN</span>' : ''}
            ${host && p.id !== room.host_id
              ? `<button class="btn-kick" data-kick="${p.id}" title="Sacar de la sala">✕</button>`
              : ''}
          </li>`).join('')}
      </ul>

      <section class="vestuario-planteles" aria-labelledby="titulo-planteles-vestuario">
        <div>
          <p class="grupo-sobretitulo">UNIVERSO DEL DRAFT</p>
          <h3 id="titulo-planteles-vestuario">PLANTELES HABILITADOS</h3>
          <p class="nota vestuario-resumen-planteles">${activos} / ${total}</p>
        </div>
        ${host
          ? '<button id="btn-configurar-planteles" class="btn btn-mini">CONFIGURAR PLANTELES</button>'
          : '<p class="nota">La configuración la define el DT anfitrión.</p>'}
      </section>

      ${host ? html`
        <div class="acciones-centro">
          <button id="btn-repartir" class="btn btn-primario btn-grande" ${iniciandoDraft ? 'disabled' : ''}>
            COMENZAR MUNDIALITO
          </button>
          <p class="nota">${esLocal
            ? 'Armarás tu equipo de 11 titulares y 7 suplentes a punta de sorteos, y jugarás contra selecciones controladas por Bots.'
            : 'Cada DT armará 11 titulares y 7 suplentes: en cada turno se sortea una selección histórica y elige un jugador.'}</p>
        </div>` : html`
        <p class="nota centrada esperando">Esperando que el DT anfitrión comience el Mundialito…</p>`}

      <div class="vestuario-historial-accion">
        <button id="btn-ranking-historico" class="btn btn-mini">RANKING HISTÓRICO</button>
      </div>
    </div>
  `);

  $('#btn-salir', root).addEventListener('click', salirDeGrupo);
  $('#btn-ranking-historico', root)?.addEventListener('click', evento => abrirRankingHistorico(evento.currentTarget));

  $('#btn-configurar-planteles', root)?.addEventListener('click', evento => {
    abrirUniversoDraft(evento.currentTarget, {
      modo: 'almanaque',
      alCambiar: () => {
        if (!configuracionDraftValida('almanaque')) return;
        guardarPlantelesVestuario(room, grupo);
      },
    });
  });

  // el anfitrión puede sacar a un jugador antes de empezar (si alguien se desconecta)
  $$('.btn-kick', root).forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.kick;
    const pl = players.find(p => p.id === pid);
    const formaReingreso = esTorneoDeGrupo ? 'la clave del grupo' : 'el código';
    if (!confirm(`¿Sacar a ${pl?.name ?? 'este jugador'} de la sala? Podrá volver a entrar con ${formaReingreso} mientras no haya empezado.`)) return;
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
      if (!configuracionDraftValida('almanaque')) {
        toast('Activa al menos un plantel para el draft.', true);
        return;
      }
      iniciosDraftEnCurso.add(room.code);
      btn.disabled = true;
      $('#btn-salir', root).disabled = true;
      const puedeContinuar = () =>
        app.code === room.code && app.estado?.room?.status === 'lobby' && soyHost();
      try {
        // No iniciar con un snapshot viejo si el anfitrión acaba de tocar el
        // selector: el draft debe recibir exactamente enabled_squads compartido.
        await (guardadosPlantelesEnCurso.get(room.code) || Promise.resolve());
        if (!puedeContinuar()) { iniciosDraftEnCurso.delete(room.code); return; }
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
