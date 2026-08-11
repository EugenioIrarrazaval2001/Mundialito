// El Mundial: simulación determinista que se reproduce con reloj en vivo.
// Empate tras el alargue = tanda de penales. Si la tanda es de TU equipo
// contra la máquina, la juegas tú: eliges lado al patear y al atajar.
// Si tu equipo queda eliminado, se acaba el juego para ti.

import { net, miId } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, salirDeSala } from '../main.js';
import { SQUADS_BY_KEY, JUGADORES_BY_ID, bandera, squadsParaModo } from '../data/squads.js';
import { simularMundial, parseModo } from '../engine/engine.js';
import { Rng } from '../engine/rng.js';

// en players.resultados conviven las tandas (clave del partido) y datos
// internos con prefijo '_' (_paso/_reproduccion del anfitrión y _t_<clave>
// con los lados elegidos en una tanda)
const soloTandas = obj =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));

const SUBFASES_REPRODUCCION = Object.freeze({
  regular: 0,
  resumen90: 1,
  extra: 2,
  resumen120: 3,
  completo: 4,
});

const DURACION_90_MS_POR_FASE = Object.freeze({
  grupos: 10000,
  r32: 12000,
  r16: 14000,
  cuartos: 16000,
  semifinal: 18000,
  final: 20000,
  tercerPuesto: 10000,
});

const FASE_ANIMACION_POR_RONDA = Object.freeze({
  'Dieciseisavos de Final': 'r32',
  'Octavos de Final': 'r16',
  'Cuartos de Final': 'cuartos',
  'Semifinales': 'semifinal',
  'Final': 'final',
});

function intervaloRelojPorFase(fase) {
  const duracion90 = DURACION_90_MS_POR_FASE[fase] ?? DURACION_90_MS_POR_FASE.grupos;
  return duracion90 / 90;
}

let relojTimer = null;
let salaHandler = null;
let resumenRondaOverlay = null;

function cerrarResumenRonda() {
  if (!resumenRondaOverlay) return;
  const { appRoot, appEraInerte, manejarTeclado } = resumenRondaOverlay;
  document.removeEventListener('keydown', manejarTeclado);
  resumenRondaOverlay.remove();
  if (appRoot && !appEraInerte) appRoot.inert = false;
  resumenRondaOverlay = null;
}

// El SQL de relevo conserva la fila del anfitrión anterior, pero no copia este
// campo nuevo. Elegir la subfase monotónica más avanzada del paso permite que
// un anfitrión de reemplazo continúe la pausa sin agregar columnas ni RPCs.
function subfaseCompartida(players, paso) {
  return players
    .map(player => player.resultados?._reproduccion)
    .filter(rep => Number(rep?.paso) === paso &&
      Object.hasOwn(SUBFASES_REPRODUCCION, rep?.subfase))
    .sort((a, b) => SUBFASES_REPRODUCCION[b.subfase] - SUBFASES_REPRODUCCION[a.subfase])[0]
    ?.subfase || null;
}

export function pantallaTorneo(root) {
  clearInterval(relojTimer);
  cerrarResumenRonda();
  if (salaHandler) { document.removeEventListener('sala:cambio', salaHandler); salaHandler = null; }
  const { room, players } = app.estado;

  // equipos humanos en orden determinista (igual en todos los clientes)
  const humanos = players
    .filter(p => p.ready && p.lineup)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(p => ({
      id: 'h-' + p.id, nombre: p.name, esIA: false,
      squadKey: null, formacion: p.formacion, lineup: p.lineup,
    }));

  if (humanos.length === 0) {
    render(root, '<p class="nota centrada esperando">No hay equipos listos…</p>');
    return;
  }

  // tandas de penales ya jugadas por los DTs (cada uno escribe solo su fila)
  const overrides = soloTandas(Object.assign({}, ...players.map(p => p.resultados || {})));
  // jugadores marcados como ausentes por el anfitrión (cerraron la app): la máquina
  // juega sus penales para no trancar el Mundial. Se guardan en la fila del anfitrión.
  const abandonados = (players.find(p => p.id === room.host_id)?.resultados?._abandonados) || [];
  const modo = parseModo(room.modo).modo;
  const soloPenales = modo === 'penales';
  const poolSala = squadsParaModo(modo, room.enabled_squads);
  const mundial = simularMundial(room.seed, humanos, overrides, parseModo(room.modo).total, soloPenales, poolSala);
  marcarPendientes(mundial, abandonados);
  const pasos = construirPasos(mundial);

  const kPaso = `mundialito-paso-${room.code}-${room.seed}`;
  const kVisto = `mundialito-visto-${room.code}-${room.seed}`;
  const kElim = `mundialito-elim-${room.code}-${room.seed}`;

  // el anfitrión maneja el ritmo del mundial; los demás siguen su paso
  const esHost = room.host_id === miId();
  const hostPaso = () => Math.min(
    Number(app.estado.players.find(p => p.id === room.host_id)?.resultados?._paso ?? 0),
    pasos.length - 1);
  const pasoGuardado = sessionStorage.getItem(kPaso);
  const pasoLocal = Number(pasoGuardado);
  let paso = esHost
    ? Math.min(Math.max(
      pasoGuardado !== null && Number.isFinite(pasoLocal) ? pasoLocal : 0,
      hostPaso(),
    ), pasos.length - 1)
    : hostPaso();
  const miEq = 'h-' + miId();
  const pasoElim = calcularEliminacion(mundial, miEq, pasos);
  const pasoEsEliminatorio = indice => !soloPenales && Boolean(pasos[indice]?.eliminatorio);
  const subfaseInicial = () => {
    if (!pasoEsEliminatorio(paso)) return null;
    const compartida = subfaseCompartida(app.estado.players, paso);
    if (compartida) return compartida;
    const visto = Number(sessionStorage.getItem(kVisto) || -1);
    return esHost && paso <= visto ? 'completo' : 'regular';
  };
  let subfase = subfaseInicial();
  let colaPublicacion = Promise.resolve(true);
  let publicandoTransicion = false;

  // Paso y subfase viajan juntos en la fila del anfitrión. Cada escritura parte
  // del JSON más fresco para conservar tandas, ausentes y metadatos existentes.
  const publicarCoordinacion = (
    nuevoPaso,
    nuevaSubfase,
    avisarError = true,
    permitirRetroceso = false,
  ) => {
    if (!esHost) return Promise.resolve(false);
    const tarea = async () => {
      const yo = app.estado.players.find(pl => pl.id === miId());
      if (!yo) return false;
      const actuales = yo.resultados || {};
      const repActual = actuales._reproduccion;
      const pasoActual = Number(actuales._paso ?? -1);
      const rangoActual = Number(repActual?.paso) === nuevoPaso
        ? (SUBFASES_REPRODUCCION[repActual?.subfase] ?? -1)
        : -1;
      const rangoNuevo = SUBFASES_REPRODUCCION[nuevaSubfase] ?? -1;
      // Las publicaciones automáticas son monotónicas. Solo los botones Prev/Next
      // pueden solicitar expresamente un paso anterior.
      if (!permitirRetroceso && (pasoActual > nuevoPaso ||
          (pasoActual === nuevoPaso && rangoActual > rangoNuevo))) return true;
      const repCoincide = nuevaSubfase === null
        || (Number(repActual?.paso) === nuevoPaso && repActual?.subfase === nuevaSubfase);
      if (pasoActual === nuevoPaso && repCoincide) return true;

      const resultados = { ...actuales, _paso: nuevoPaso };
      if (nuevaSubfase !== null) {
        resultados._reproduccion = { paso: nuevoPaso, subfase: nuevaSubfase };
      }
      try {
        await net.actualizarJugador(room.code, miId(), { resultados });
        const actualizado = app.estado.players.find(pl => pl.id === miId());
        if (actualizado) {
          const trasRespuesta = actualizado.resultados || {};
          const pasoTrasRespuesta = Number(trasRespuesta._paso ?? -1);
          const repTrasRespuesta = trasRespuesta._reproduccion;
          const rangoTrasRespuesta = Number(repTrasRespuesta?.paso) === nuevoPaso
            ? (SUBFASES_REPRODUCCION[repTrasRespuesta?.subfase] ?? -1)
            : -1;
          const conservarAvanceRemoto = !permitirRetroceso &&
            (pasoTrasRespuesta > nuevoPaso ||
              (pasoTrasRespuesta === nuevoPaso && rangoTrasRespuesta > rangoNuevo));
          if (!conservarAvanceRemoto) {
            actualizado.resultados = {
              ...trasRespuesta,
              _paso: nuevoPaso,
              ...(nuevaSubfase === null
                ? {}
                : { _reproduccion: { paso: nuevoPaso, subfase: nuevaSubfase } }),
            };
          }
        }
        return true;
      } catch (e) {
        if (avisarError) toast('No se pudo sincronizar la reproducción: ' + e.message, true);
        return false;
      }
    };
    colaPublicacion = colaPublicacion.then(tarea, tarea);
    return colaPublicacion;
  };

  const adoptarAvanceCompartido = () => {
    const nuevoPaso = hostPaso();
    if (nuevoPaso > paso) {
      paso = nuevoPaso;
      subfase = pasoEsEliminatorio(nuevoPaso)
        ? (subfaseCompartida(app.estado.players, nuevoPaso) || 'regular')
        : null;
      return true;
    }
    if (nuevoPaso !== paso || !pasoEsEliminatorio(paso)) return false;
    const compartida = subfaseCompartida(app.estado.players, paso);
    const rangoCompartido = SUBFASES_REPRODUCCION[compartida] ?? -1;
    const rangoLocal = SUBFASES_REPRODUCCION[subfase] ?? -1;
    if (rangoCompartido <= rangoLocal) return false;
    subfase = compartida;
    return true;
  };

  const asegurarCoordinacion = () => {
    if (!esHost) return;
    publicarCoordinacion(paso, pasoEsEliminatorio(paso) ? subfase : null, false)
      .then(ok => {
        if (ok && !publicandoTransicion && adoptarAvanceCompartido()) dibujar();
      });
  };

  // La gestión de ausentes escribe el mismo JSON `resultados`; compartir la
  // cola evita que una marca de ausencia y una frontera 90/120 se pisen.
  const actualizarAusente = (playerId, ausente) => {
    if (!esHost) return Promise.resolve(false);
    const tarea = async () => {
      const host = app.estado.players.find(pl => pl.id === miId());
      if (!host) return false;
      const abandonadosActuales = new Set(host.resultados?._abandonados || []);
      if (ausente) abandonadosActuales.add(playerId);
      else abandonadosActuales.delete(playerId);
      const resultados = {
        ...(host.resultados || {}),
        _abandonados: [...abandonadosActuales],
      };
      try {
        await net.actualizarJugador(room.code, miId(), { resultados });
        const actualizado = app.estado.players.find(pl => pl.id === miId());
        if (actualizado) {
          actualizado.resultados = {
            ...(actualizado.resultados || {}),
            _abandonados: resultados._abandonados,
          };
        }
        if (!publicandoTransicion && adoptarAvanceCompartido()) dibujar();
        return true;
      } catch (e) {
        toast('No se pudo actualizar: ' + e.message, true);
        return false;
      }
    };
    colaPublicacion = colaPublicacion.then(tarea, tarea);
    return colaPublicacion;
  };

  const cambiarSubfase = async nuevaSubfase => {
    if (!esHost || publicandoTransicion || !pasoEsEliminatorio(paso)) return false;
    publicandoTransicion = true;
    const ok = await publicarCoordinacion(paso, nuevaSubfase);
    publicandoTransicion = false;
    if (!ok) return false;
    if (adoptarAvanceCompartido()) {
      dibujar();
      return true;
    }
    subfase = nuevaSubfase;
    if (subfase === 'completo') sessionStorage.setItem(kVisto, paso);
    dibujar();
    return true;
  };

  const cambiarPaso = async nuevoPaso => {
    if (!esHost || publicandoTransicion || nuevoPaso < 0 || nuevoPaso >= pasos.length) return false;
    publicandoTransicion = true;
    const visto = Number(sessionStorage.getItem(kVisto) || -1);
    const compartida = pasoEsEliminatorio(nuevoPaso)
      ? subfaseCompartida(app.estado.players, nuevoPaso)
      : null;
    const nuevaSubfase = pasoEsEliminatorio(nuevoPaso)
      ? (compartida || (nuevoPaso <= visto ? 'completo' : 'regular'))
      : null;
    const ok = await publicarCoordinacion(
      nuevoPaso,
      nuevaSubfase,
      true,
      nuevoPaso < paso,
    );
    publicandoTransicion = false;
    if (!ok) return false;
    if (adoptarAvanceCompartido()) {
      dibujar();
      return true;
    }
    paso = nuevoPaso;
    subfase = nuevaSubfase;
    dibujar();
    return true;
  };

  // cambios que llegan por la sala: tandas nuevas re-simulan; el paso del
  // anfitrión mueve a los espectadores. La tanda abierta escucha sus propios eventos.
  salaHandler = () => {
    if (document.querySelector('.overlay-tanda')) return;
    const nuevas = soloTandas(Object.assign({}, ...app.estado.players.map(p => p.resultados || {})));
    const nuevosAband = (app.estado.players.find(p => p.id === room.host_id)?.resultados?._abandonados) || [];
    if (JSON.stringify(nuevas) !== JSON.stringify(overrides) ||
        JSON.stringify(nuevosAband) !== JSON.stringify(abandonados)) { pantallaTorneo(root); return; }
    const nuevoPaso = hostPaso();
    if (esHost) {
      // Tras un relevo, la actualización de la fila heredada puede llegar un
      // instante después del cambio de room.host_id. Nunca hacemos rollback:
      // solo adoptamos paso o subfase compartida estrictamente más avanzados.
      if (!publicandoTransicion && adoptarAvanceCompartido()) {
        dibujar();
        return;
      }
    } else {
      const pasoCambio = nuevoPaso !== paso;
      const nuevaCompartida = pasoEsEliminatorio(nuevoPaso)
        ? subfaseCompartida(app.estado.players, nuevoPaso)
        : null;
      const nuevaSubfase = pasoEsEliminatorio(nuevoPaso)
        ? (nuevaCompartida || (pasoCambio ? 'regular' : subfase))
        : null;
      if (pasoCambio || nuevaSubfase !== subfase) {
        paso = nuevoPaso;
        subfase = nuevaSubfase;
        dibujar();
        return;
      }
    }
    // marcador de penales en vivo para los espectadores (sin re-simular)
    const liveEl = document.getElementById('live-penales');
    if (liveEl) {
      const pendActual = (pasos[paso].partidos || []).find(p => p.pendiente);
      if (pendActual) liveEl.textContent = textoLivePenales(mundial, pendActual);
    }
  };
  document.addEventListener('sala:cambio', salaHandler);
  app.limpiezaPantalla = () => {
    clearInterval(relojTimer);
    cerrarResumenRonda();
    document.querySelector('.overlay-gestion')?.remove();
    if (salaHandler) { document.removeEventListener('sala:cambio', salaHandler); salaHandler = null; }
  };

  const dibujar = () => {
    clearInterval(relojTimer);
    cerrarResumenRonda();
    document.querySelector('.overlay-gestion')?.remove();
    sessionStorage.setItem(kPaso, paso);
    asegurarCoordinacion();
    const visto = Number(sessionStorage.getItem(kVisto) || -1);
    // Una vez notificada su eliminación, el DT queda como espectador hasta que
    // aparezca el campeón. Antes de la notificación no ocultamos nada para no
    // adelantar visualmente el resultado de un partido que aún está en vivo.
    const espectadorForzado = Boolean(sessionStorage.getItem(kElim)) && paso < pasos.length - 1;
    const esEliminatoria = pasoEsEliminatorio(paso);
    const enPausa = esEliminatoria && (subfase === 'resumen90' || subfase === 'resumen120');
    const enVivoEliminatoria = esEliminatoria && (subfase === 'regular' || subfase === 'extra');
    // Grupos conservan su camino histórico; Solo Penales sigue sin reloj.
    const enVivoComun = !esEliminatoria && !soloPenales && paso > visto && Boolean(pasos[paso].partidos);
    const enVivo = enVivoEliminatoria || enVivoComun;
    const completo = !esEliminatoria || subfase === 'completo';
    // Tandas, eliminación y resultado final permanecen bloqueados durante ambas pausas.
    const pend = completo && !enVivo
      ? (pasos[paso].partidos || []).find(p => p.pendiente)
      : null;
    const mostrarFinal = completo && !enVivo;
    const mostrarReloj = enVivo || enPausa;
    const minutoInicial = subfase === 'resumen120' ? 120
      : esEliminatoria && (subfase === 'extra' || subfase === 'resumen90') ? 90
      : 0;
    const etiquetaReloj = enPausa ? 'PAUSA'
      : esEliminatoria && subfase === 'extra' ? 'ALARGUE'
      : 'EN JUEGO';

    render(root, html`
      <div class="torneo">
        <header class="cabecera-sala">
          ${espectadorForzado ? '' : '<button id="btn-salir" class="btn btn-mini">← Salir</button>'}
          <div class="ticket"><span class="ticket-label">MUNDIALITO</span>
            <span class="ticket-codigo">${esc(room.code)}</span></div>
          <div class="controles-torneo">
            ${esHost && !enVivo && !enPausa
              ? '<button id="btn-jugadores" class="btn btn-mini">👥 Jugadores</button>'
              : ''}
            ${esHost
              ? (enVivo
                ? '<button id="btn-skip" class="btn btn-mini">⏩ Al pitazo final</button>'
                : enPausa ? '' : html`
                  <button id="btn-prev" class="btn btn-mini" ${paso === 0 ? 'disabled' : ''}>◀</button>
                  <button id="btn-sig" class="btn btn-primario" ${paso >= pasos.length - 1 || pend ? 'disabled' : ''}>
                    Siguiente ▶</button>`)
              : '<span class="chip-modo">🎮 EL ANFITRIÓN MANEJA EL RITMO</span>'}
          </div>
        </header>
        <div class="contenido-torneo">
          ${mostrarReloj ? `<div class="reloj-vivo"><span id="reloj">${minutoInicial}'</span><span class="reloj-label">${etiquetaReloj}</span></div>` : ''}
          ${pasos[paso].render(mundial, mostrarFinal)}
          ${pend && !pend.pendiente.includes(miEq) ? html`
            <div class="nota centrada esperando penales-espectador">
              <span>🧤 ${esc(nombresPendientes(mundial, pend))} definiendo en penales…</span>
              <span id="live-penales" class="marcador-vivo-penales">${esc(textoLivePenales(mundial, pend))}</span>
              <span class="penales-pie">El mundial sigue cuando termine la tanda.</span>
            </div>` : ''}
        </div>
        <div class="migas">${pasos.map((p, i) =>
          `<span class="miga ${i === paso ? 'activa' : i < paso ? 'pasada' : ''}">${esc(p.titulo)}</span>`).join('')}
        </div>
      </div>
    `);

    $('#btn-salir', root)?.addEventListener('click', () => { clearInterval(relojTimer); salirDeSala(); });
    $('#btn-jugadores', root)?.addEventListener('click', () =>
      abrirGestionJugadores(room, actualizarAusente));

    if (enVivoEliminatoria) {
      const limite = subfase === 'extra' ? 120 : 90;
      const siguienteSubfase = subfase === 'extra' ? 'resumen120' : 'resumen90';
      let finalizando = false;
      const terminarTramo = async () => {
        if (finalizando) return;
        clearInterval(relojTimer);
        pintarPartidosHasta(root, pasos[paso].partidos, limite);
        if (!esHost) {
          const label = $('.reloj-label', root);
          if (label) label.textContent = 'ESPERANDO AL ANFITRIÓN';
          return;
        }
        finalizando = true;
        const boton = $('#btn-skip', root);
        if (boton) { boton.disabled = true; boton.textContent = 'Sincronizando…'; }
        const ok = await cambiarSubfase(siguienteSubfase);
        if (!ok) {
          finalizando = false;
          if (boton?.isConnected) { boton.disabled = false; boton.textContent = '↻ Reintentar resumen'; }
        }
      };
      $('#btn-skip', root)?.addEventListener('click', terminarTramo);
      animarPartidos(
        root,
        pasos[paso].partidos,
        subfase === 'extra' ? 90 : 0,
        limite,
        terminarTramo,
        pasos[paso].faseAnimacion,
      );
    } else if (enVivoComun) {
      const terminar = () => {
        clearInterval(relojTimer);
        sessionStorage.setItem(kVisto, paso);
        dibujar();
      };
      $('#btn-skip', root)?.addEventListener('click', () => {
        pintarPartidosHasta(root, pasos[paso].partidos, 90);
        terminar();
      });
      animarPartidos(
        root,
        pasos[paso].partidos,
        0,
        90,
        terminar,
        pasos[paso].faseAnimacion,
      );
    } else if (enPausa) {
      const minuto = subfase === 'resumen90' ? 90 : 120;
      pintarPartidosHasta(root, pasos[paso].partidos, minuto);
      abrirResumenRonda({
        mundial,
        partidos: pasos[paso].partidos,
        tituloPaso: pasos[paso].titulo,
        subfase,
        esHost,
        alContinuar: async () => {
          const hayAlargue = pasos[paso].partidos.some(p => p.alargue);
          return cambiarSubfase(subfase === 'resumen90' && hayAlargue ? 'extra' : 'completo');
        },
      });
    } else {
      if (esEliminatoria) sessionStorage.setItem(kVisto, paso);
      else if (paso > visto) sessionStorage.setItem(kVisto, paso);
      $('#btn-sig', root)?.addEventListener('click', () => cambiarPaso(paso + 1));
      $('#btn-prev', root)?.addEventListener('click', () => cambiarPaso(paso - 1));
      if (pend && pend.pendiente.includes(miEq)) {
        // ¡me toca jugar la tanda!
        abrirTanda(root, mundial, pend, room);
      } else if (!pend && pasoElim >= 0 && paso >= pasoElim && paso < pasos.length - 1 &&
          !sessionStorage.getItem(kElim)) {
        // ¿quedé eliminado en este paso? fin del juego
        mostrarEliminado(
          root,
          mundial,
          () => sessionStorage.setItem(kElim, '1'),
          dibujar,
        );
      }
    }
  };
  dibujar();
}

// marca los partidos cuya tanda deben jugar uno o dos DTs (sin override aún).
// abandonados: playerIds que el anfitrión marcó como ausentes (cerraron la app);
// si un partido involucra a un ausente, NO se marca pendiente y queda con el
// resultado automático (la máquina lo juega) para que el Mundial no se tranque.
function marcarPendientes(mundial, abandonados = []) {
  const ausente = id => {
    const e = mundial.equipos.find(e => e.id === id);
    return e && !e.esIA && abandonados.includes(id.slice(2)); // 'h-<pid>' → pid
  };
  const partidos = [
    ...mundial.llaves.flatMap(l => l.partidos),
    ...(mundial.tercerPuesto ? [mundial.tercerPuesto] : []),
  ];
  for (const p of partidos) {
    if (!p.penales?.auto) continue;
    if (ausente(p.idA) || ausente(p.idB)) continue; // hay un ausente: la juega la máquina
    const humanos = [p.idA, p.idB].filter(id => !mundial.equipos.find(e => e.id === id).esIA);
    // con un DT: juega contra la máquina; con dos: duelo en línea entre ambos
    if (humanos.length >= 1) p.pendiente = humanos;
  }
}

// modal del anfitrión: lista todos los jugadores y permite marcar/reactivar ausentes.
// "ausente" = cerró la app; la máquina juega sus penales y el Mundial no se tranca.
// La lista de ausentes vive en la fila del anfitrión (resultados._abandonados).
function abrirGestionJugadores(room, actualizarAusente) {
  if (document.querySelector('.overlay-gestion')) return;
  const div = document.createElement('div');
  div.className = 'overlay-gestion';
  document.body.appendChild(div);
  const cerrar = () => div.remove();

  const toggle = async (pid, ausente) => {
    const ok = await actualizarAusente(pid, ausente);
    if (ok && div.isConnected) pintar();
  };

  function pintar() {
    const host = app.estado.players.find(p => p.id === room.host_id);
    const aband = new Set(host?.resultados?._abandonados || []);
    div.innerHTML = html`
      <div class="cartel-gestion">
        <p class="elim-titulo">JUGADORES DE LA SALA</p>
        <p class="nota">Si alguien cerró la app y deja el Mundial trancado (por ejemplo, unos
          penales que no se juegan), márcalo como ausente: la máquina juega sus penales y el
          torneo sigue. Su equipo se queda en el cuadro.</p>
        <ul class="lista-gestion">
          ${app.estado.players.map(p => html`
            <li class="${aband.has(p.id) ? 'ausente' : ''}">
              <b>${esc(p.name)}</b>
              ${p.id === room.host_id
                ? '<span class="etiqueta-host">ANFITRIÓN</span>'
                : (aband.has(p.id)
                  ? `<span class="tag-ausente">ausente · juega la máquina</span>
                     <button class="btn btn-mini" data-react="${p.id}">↩ Reactivar</button>`
                  : `<button class="btn btn-mini btn-ausente" data-aus="${p.id}">🤖 Marcar ausente</button>`)}
            </li>`).join('')}
        </ul>
        <button id="cerrar-gestion" class="btn btn-primario">Cerrar</button>
      </div>`;
    $('#cerrar-gestion', div).addEventListener('click', cerrar);
    $$('[data-aus]', div).forEach(b => b.addEventListener('click', () => toggle(b.dataset.aus, true)));
    $$('[data-react]', div).forEach(b => b.addEventListener('click', () => toggle(b.dataset.react, false)));
  }

  pintar();
}

function nombresPendientes(mundial, p) {
  return p.pendiente
    .map(id => mundial.equipos.find(e => e.id === id)?.nombre)
    .filter(Boolean).join(' y ');
}

// nombre en texto plano (sin HTML) para el marcador de penales en vivo
function nombrePlano(mundial, id) {
  const e = mundial.equipos.find(e => e.id === id);
  if (!e) return '';
  if (!e.esIA) return e.nombre;
  const s = SQUADS_BY_KEY[e.squadKey];
  return `${s.pais} ${s.anio}`;
}

// marcador en vivo de una tanda en curso: lo publica el/los DT que la juegan
// en su fila (clave '_live_<clave>'), y el resto de la sala lo ve actualizarse
function textoLivePenales(mundial, partido) {
  const todos = Object.assign({}, ...app.estado.players.map(p => p.resultados || {}));
  const live = todos['_live_' + partido.clave];
  if (!live) return '';
  return `${nombrePlano(mundial, partido.idA)} ${live.a} – ${live.b} ${nombrePlano(mundial, partido.idB)}`;
}

// ---------- reloj en vivo ----------

function pintarPartidosHasta(root, partidos, minuto) {
  const reloj = $('#reloj', root);
  if (reloj) reloj.textContent = minuto + "'";
  for (let i = 0; i < partidos.length; i++) {
    const p = partidos[i];
    const cont = $(`[data-partido="${i}"]`, root);
    if (!cont) continue;
    const minutoPartido = Math.min(minuto, duracionPartido(p));
    const golesVisibles = (p.eventos || []).filter(e => e.minuto <= minutoPartido);
    const ga = golesVisibles.filter(e => e.equipoId === p.idA).length;
    const gb = golesVisibles.filter(e => e.equipoId === p.idB).length;
    const marcador = $('.resultado', cont);
    const nuevo = `${ga} – ${gb}`;
    if (marcador && marcador.textContent.trim() !== nuevo.trim()) {
      marcador.textContent = nuevo;
      cont.classList.remove('gol-flash');
      void cont.offsetWidth; // reinicia la animación
      cont.classList.add('gol-flash');
    }
    const timeline = $('.timeline-partido', cont);
    if (timeline) timeline.innerHTML = timelinePartidoHTML(p, minutoPartido);

    const estado = $('.estado-partido', cont);
    if (estado && p.alargue && minutoPartido >= 90) {
      estado.innerHTML = etiquetaAlargueHTML(p, minutoPartido < 120);
    }
  }
}

function animarPartidos(root, partidos, desdeMin, hastaMin, alTerminar, faseAnimacion = 'grupos') {
  // En eliminación directa, cada tramo se detiene en su frontera para que el
  // resumen del host habilite explícitamente 91–120 o las tandas.
  let minuto = desdeMin;
  pintarPartidosHasta(root, partidos, minuto);
  relojTimer = setInterval(() => {
    minuto++;
    pintarPartidosHasta(root, partidos, minuto);
    if (minuto >= hastaMin) {
      clearInterval(relojTimer);
      alTerminar();
    }
  }, intervaloRelojPorFase(faseAnimacion));
}

// ---------- helpers de presentación ----------

function duracionPartido(p) {
  return Number(p?.duracion) === 120 || p?.alargue ? 120 : 90;
}

function nombreJugador(id) {
  return JUGADORES_BY_ID[id]?.nombre || id || 'Jugador';
}

function nombreGoleador(evento) {
  return evento.jugador || nombreJugador(evento.jugadorId);
}

// Los datos siguen separados (eventos = goles; sustituciones = cambios), y
// solo se combinan aquí para presentarlos en el orden en que ocurrieron.
function eventosTimeline(p, hastaMin = Infinity) {
  const goles = (p.eventos || []).map((evento, orden) => ({
    ...evento,
    tipo: 'gol',
    orden,
  }));
  const cambios = (p.sustituciones || []).map((evento, orden) => ({
    ...evento,
    tipo: 'cambio',
    orden,
  }));
  return [...goles, ...cambios]
    .filter(evento => evento.minuto <= hastaMin)
    .sort((a, b) => a.minuto - b.minuto ||
      (a.tipo === b.tipo ? a.orden - b.orden : a.tipo === 'cambio' ? -1 : 1) ||
      String(a.equipoId).localeCompare(String(b.equipoId)));
}

function textoEventoHTML(evento) {
  if (evento.tipo === 'gol') {
    return `<span class="evento-icono" aria-hidden="true">⚽</span><b>${esc(nombreGoleador(evento))}</b>`;
  }
  return `<span class="evento-icono cambio-icono" aria-hidden="true">⇄</span>` +
    `<span><b>Entra ${esc(nombreJugador(evento.entraId))}</b>` +
    `<small>Sale ${esc(nombreJugador(evento.saleId))}${evento.puesto ? ` · ${esc(evento.puesto)}` : ''}</small></span>`;
}

function timelinePartidoHTML(p, hastaMin = Infinity) {
  return eventosTimeline(p, hastaMin).map(evento => {
    const lado = evento.equipoId === p.idB ? 'lado-b' : 'lado-a';
    return `<div class="timeline-evento ${lado} evento-${evento.tipo}">` +
      `<span class="timeline-contenido">${textoEventoHTML(evento)}</span>` +
      `<time>${evento.minuto}'</time></div>`;
  }).join('');
}

function etiquetaAlargueHTML(p, enJuego = false) {
  if (!p.alargue) return '';
  const marcador90 = Number.isFinite(p.goles90A) && Number.isFinite(p.goles90B)
    ? ` · 90': ${p.goles90A}–${p.goles90B}`
    : '';
  return `<span class="etiqueta-aet">${enJuego ? 'ALARGUE' : 'AET'}${marcador90}</span>`;
}

function nombreEquipo(mundial, id) {
  const e = mundial.equipos.find(e => e.id === id);
  if (!e.esIA) return `⭐ <b>${esc(e.nombre)}</b>`;
  const s = SQUADS_BY_KEY[e.squadKey];
  return `${bandera(s)} ${esc(s.pais)} ${s.anio} <span class="dt ia">· máquina</span>`;
}

function esMio(mundial, id) {
  const e = mundial.equipos.find(e => e.id === id);
  return e && e.id === 'h-' + miId();
}

// el partido del usuario siempre se muestra primero
function miPrimero(mundial, partidos) {
  const mio = p => (esMio(mundial, p.idA) || esMio(mundial, p.idB)) ? 1 : 0;
  return [...partidos].sort((a, b) => mio(b) - mio(a));
}

function desenlaceResumenHTML(mundial, p, tituloPaso, golesA, golesB) {
  const ganadorId = golesA > golesB ? p.idA : p.idB;
  const perdedorId = ganadorId === p.idA ? p.idB : p.idA;
  const ganador = esc(nombrePlano(mundial, ganadorId));
  const perdedor = esc(nombrePlano(mundial, perdedorId));
  if (tituloPaso === 'Final') {
    return `<span class="resumen-avanza">🏆 ${ganador} gana la Final</span>` +
      `<span class="resumen-eliminado">✕ ${perdedor} termina subcampeón</span>`;
  }
  if (tituloPaso === 'Tercer Puesto') {
    return `<span class="resumen-avanza">✓ ${ganador} gana el Tercer Puesto</span>` +
      `<span class="resumen-eliminado">✕ ${perdedor} termina cuarto</span>`;
  }
  if (tituloPaso === 'Semifinales') {
    return `<span class="resumen-avanza">✓ ${ganador} avanza a la Final</span>` +
      `<span class="resumen-eliminado">✕ ${perdedor} queda fuera de la Final</span>`;
  }
  return `<span class="resumen-avanza">✓ ${ganador} avanza</span>` +
    `<span class="resumen-eliminado">✕ ${perdedor} queda eliminado</span>`;
}

function marcadorResumenHTML(mundial, p, golesA, golesB) {
  return `<div class="resumen-marcador">` +
    `<span class="resumen-equipo">${nombreEquipo(mundial, p.idA)}</span>` +
    `<strong>${golesA} – ${golesB}</strong>` +
    `<span class="resumen-equipo der">${nombreEquipo(mundial, p.idB)}</span>` +
    `</div>`;
}

function partidoDefinidoResumenHTML(mundial, p, tituloPaso, golesA, golesB, aet = false) {
  const mio = esMio(mundial, p.idA) || esMio(mundial, p.idB) ? 'mi-partido' : '';
  return `<article class="resumen-partido definido ${mio}">` +
    marcadorResumenHTML(mundial, p, golesA, golesB) +
    `<div class="resumen-mensajes">${aet ? '<small class="resumen-aet">AET · tras alargue</small>' : ''}` +
    desenlaceResumenHTML(mundial, p, tituloPaso, golesA, golesB) +
    `</div></article>`;
}

function partidoPendienteResumenHTML(mundial, p, golesA, golesB, penales = false) {
  const mio = esMio(mundial, p.idA) || esMio(mundial, p.idB) ? 'mi-partido' : '';
  return `<article class="resumen-partido pendiente ${mio}">` +
    marcadorResumenHTML(mundial, p, golesA, golesB) +
    `<div class="resumen-mensajes"><span>${penales
      ? '🧤 La clasificación se decidirá desde los doce pasos'
      : '→ Se jugarán 30 minutos adicionales'}</span></div></article>`;
}

function seccionResumenHTML(titulo, clase, partidosHTML) {
  if (!partidosHTML.length) return '';
  return `<section class="resumen-seccion ${clase}"><h3>${titulo}</h3>` +
    `<div class="resumen-partidos">${partidosHTML.join('')}</div></section>`;
}

function contenidoResumen90(mundial, partidos, tituloPaso) {
  // Esta vista solo consulta goles90*: nunca ganador, marcador de alargue ni tanda.
  const finalizados = partidos
    .filter(p => p.goles90A !== p.goles90B)
    .map(p => partidoDefinidoResumenHTML(mundial, p, tituloPaso, p.goles90A, p.goles90B));
  const alargues = partidos
    .filter(p => p.alargue === true)
    .map(p => partidoPendienteResumenHTML(mundial, p, p.goles90A, p.goles90B));
  return {
    titulo: "⏱ FIN DE LOS 90'",
    subtitulo: alargues.length
      ? 'Así queda la ronda después del tiempo reglamentario'
      : 'Todos los partidos de la ronda quedaron definidos',
    cuerpo: seccionResumenHTML('PARTIDOS FINALIZADOS', 'finalizados', finalizados) +
      seccionResumenHTML('VAN A ALARGUE', 'alargues', alargues),
    boton: alargues.length ? '▶ CONTINUAR AL ALARGUE' : 'CONTINUAR ▶',
  };
}

function contenidoResumen120(mundial, partidos, tituloPaso) {
  const alargues = partidos.filter(p => p.alargue === true);
  // En empates solo se consultan golesA/B. penales y ganador quedan fuera del DOM.
  const definidos = alargues
    .filter(p => p.golesA !== p.golesB)
    .map(p => partidoDefinidoResumenHTML(mundial, p, tituloPaso, p.golesA, p.golesB, true));
  const penales = alargues
    .filter(p => p.golesA === p.golesB)
    .map(p => partidoPendienteResumenHTML(mundial, p, p.golesA, p.golesB, true));
  return {
    titulo: "⏱ FIN DE LOS 120'",
    subtitulo: 'Así terminó el tiempo extra',
    cuerpo: seccionResumenHTML('DEFINIDOS EN EL ALARGUE', 'definidos-extra', definidos) +
      seccionResumenHTML('VAN A PENALES', 'van-penales', penales),
    boton: penales.length ? '🧤 IR A PENALES' : 'CONTINUAR ▶',
  };
}

function abrirResumenRonda({ mundial, partidos, tituloPaso, subfase, esHost, alContinuar }) {
  cerrarResumenRonda();
  const contenido = subfase === 'resumen90'
    ? contenidoResumen90(mundial, partidos, tituloPaso)
    : contenidoResumen120(mundial, partidos, tituloPaso);
  const div = document.createElement('div');
  div.className = 'overlay-resumen-ronda';
  div.dataset.subfase = subfase;
  div.innerHTML = html`
    <section class="resumen-ronda" role="dialog" aria-modal="true"
        aria-labelledby="resumen-titulo" aria-describedby="resumen-subtitulo" tabindex="-1">
      <header class="resumen-ronda-cabecera">
        <p class="resumen-sello">${esc(tituloPaso)}</p>
        <h2 id="resumen-titulo">${contenido.titulo}</h2>
        <p id="resumen-subtitulo">${contenido.subtitulo}</p>
      </header>
      <div class="resumen-ronda-cuerpo">${contenido.cuerpo}</div>
      <footer class="resumen-ronda-pie">
        ${esHost
          ? `<button id="resumen-continuar" class="btn btn-primario">${contenido.boton}</button>`
          : '<p class="resumen-espera" role="status" tabindex="0">Esperando al anfitrión…</p>'}
      </footer>
    </section>`;

  const appRoot = document.getElementById('app');
  const appEraInerte = appRoot?.hasAttribute('inert') ?? false;
  const dialogo = $('.resumen-ronda', div);
  const manejarTeclado = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Tab') return;
    const foco = $('#resumen-continuar', div) || $('.resumen-espera', div) || dialogo;
    e.preventDefault();
    foco?.focus();
  };
  div.appRoot = appRoot;
  div.appEraInerte = appEraInerte;
  div.manejarTeclado = manejarTeclado;
  if (appRoot) appRoot.inert = true;
  document.body.appendChild(div);
  document.addEventListener('keydown', manejarTeclado);
  resumenRondaOverlay = div;

  const boton = $('#resumen-continuar', div);
  boton?.addEventListener('click', async () => {
    if (boton.disabled) return;
    const texto = boton.textContent;
    boton.disabled = true;
    dialogo.setAttribute('aria-busy', 'true');
    boton.textContent = 'Sincronizando…';
    const ok = await alContinuar();
    if (!ok && boton.isConnected) {
      boton.disabled = false;
      boton.textContent = texto;
      dialogo.removeAttribute('aria-busy');
    }
  });
  (boton || $('.resumen-espera', div) || dialogo)?.focus();
}

function partidoHTML(mundial, p, idx, final) {
  const mio = esMio(mundial, p.idA) || esMio(mundial, p.idB) ? 'mi-partido' : '';

  if (!final) {
    return html`
      <div class="partido ${mio}" data-partido="${idx}">
        <div class="marcador">
          <span class="equipo">${nombreEquipo(mundial, p.idA)}</span>
          <span class="resultado">0 – 0</span>
          <span class="equipo der">${nombreEquipo(mundial, p.idB)}</span>
        </div>
        <div class="estado-partido" aria-live="polite"></div>
        <div class="timeline-partido" aria-live="polite"></div>
      </div>`;
  }

  const pendiente = Boolean(p.pendiente);
  // si el marcador del partido ya es el de la tanda (modo solo penales), no repito los números
  const definidoEnPenales = p.penales && p.golesA === p.penales.golesA && p.golesB === p.penales.golesB;
  const notas = [];
  if (pendiente) notas.push('🧤 ¡a penales!');
  else if (definidoEnPenales) notas.push('🧤 definido en penales');
  else if (p.penales) notas.push(`penales ${p.penales.golesA}–${p.penales.golesB}`);
  if (p.alargue) notas.unshift(etiquetaAlargueHTML(p));

  return html`
    <div class="partido ${mio}">
      <div class="marcador">
        <span class="equipo ${!pendiente && p.ganador === p.idA ? 'ganador' : ''}">${nombreEquipo(mundial, p.idA)}</span>
        <span class="resultado">${p.golesA} – ${p.golesB}</span>
        <span class="equipo der ${!pendiente && p.ganador === p.idB ? 'ganador' : ''}">${nombreEquipo(mundial, p.idB)}</span>
      </div>
      ${notas.length ? `<div class="estado-partido notas">${notas.join(' <span aria-hidden="true">·</span> ')}</div>` : ''}
      ${eventosTimeline(p).length ? `<div class="timeline-partido">${timelinePartidoHTML(p)}</div>` : ''}
    </div>`;
}

function tablaGrupoHTML(mundial, tabla) {
  return html`
    <div class="tabla-grupo">
      <h4 class="titulo-grupo">GRUPO ${tabla.grupo}</h4>
      <table>
        <thead><tr><th></th><th>PJ</th><th>GF</th><th>GC</th><th>PTS</th></tr></thead>
        <tbody>
          ${tabla.filas.map((f, i) => html`
            <tr class="${i < 2 ? 'clasificado' : ''} ${esMio(mundial, f.id) ? 'mi-fila' : ''}">
              <td class="celda-equipo">${nombreEquipo(mundial, f.id)}</td>
              <td>${f.pj}</td><td>${f.gf}</td><td>${f.gc}</td><td class="pts">${f.pts}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ---------- tanda de penales interactiva ----------

function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }

// probabilidad de gol: pesa el nivel del pateador y del arquero,
// y si el arquero adivinó el lado (quedarse al medio y que te la tiren ahí, ataja casi todo)
function pGol(nivelPateador, nivelArquero, mismoLado, alMedio = false) {
  if (!mismoLado) return clamp(0.85 + (nivelPateador - 80) * 0.004, 0.72, 0.97);
  const base = alMedio ? 0.28 : 0.45;
  return clamp(base + (nivelPateador - nivelArquero) * 0.01, 0.10, 0.72);
}

// Dos modos:
//  - contra la máquina: los lados de la IA salen al azar en el momento
//  - duelo entre dos DTs: cada uno elige su lado en su pantalla; las elecciones
//    viajan por la sala (resultados._t_<clave>) y el desenlace de cada penal es
//    determinista (semilla de sala + clave + número de penal), así ambos ven lo mismo
function abrirTanda(root, mundial, partido, room) {
  if (document.querySelector('.overlay-tanda')) return; // ya está abierta
  const almanaque = parseModo(room.modo).modo === 'almanaque';
  const miEq = 'h-' + miId();
  const soyA = partido.idA === miEq;
  const eqA = mundial.equipos.find(e => e.id === partido.idA);
  const eqB = mundial.equipos.find(e => e.id === partido.idB);
  const mio = soyA ? eqA : eqB;
  const rival = soyA ? eqB : eqA;
  const duelo = !rival.esIA;
  const rivalPid = duelo ? rival.id.slice(2) : null;
  const kT = '_t_' + partido.clave; // mis lados elegidos, guardados en mi fila

  const nivelLineup = (eq, id) => eq.lineup.slots?.find(s => s.id === id)?.nivel ?? JUGADORES_BY_ID[id]?.nivel ?? 70;
  const conNivelLineup = eq => id => ({ ...JUGADORES_BY_ID[id], nivel: nivelLineup(eq, id) });
  const ordenarPateadores = jugadores => jugadores
    .sort((a, b) => b.nivel - a.nivel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pateadoresDesdeSlots = slots => ordenarPateadores(slots
    .filter(slot => slot?.puesto !== 'POR' && slot?.linea !== 'POR')
    .flatMap(slot => {
      const jugador = JUGADORES_BY_ID[slot.id];
      return jugador && Number.isFinite(slot.nivel)
        ? [{ ...jugador, nivel: slot.nivel }]
        : [];
    }));
  const pateadoresOriginales = eq => {
    if (Array.isArray(eq.lineup?.slots)) return pateadoresDesdeSlots(eq.lineup.slots);
    return ordenarPateadores([
      ...(eq.lineup?.DEF || []),
      ...(eq.lineup?.MED || []),
      ...(eq.lineup?.DEL || []),
    ].map(conNivelLineup(eq)).filter(jugador => jugador.id));
  };
  const pateadoresPartido = (eq, slotsFinales) => {
    const finales = Array.isArray(slotsFinales) ? pateadoresDesdeSlots(slotsFinales) : [];
    return finales.length ? finales : pateadoresOriginales(eq);
  };
  const patA = pateadoresPartido(eqA, partido.slotsFinalesA);
  const patB = pateadoresPartido(eqB, partido.slotsFinalesB);
  const gkA = conNivelLineup(eqA)(eqA.lineup.POR[0]);
  const gkB = conNivelLineup(eqB)(eqB.lineup.POR[0]);

  // marcador por equipo real; el equipo A patea primero
  const t = { A: [], B: [] }; // true = gol
  const goles = arr => arr.filter(Boolean).length;
  const nv = j => almanaque ? '' : ` (${j.nivel})`;
  // etiqueta de un equipo: ⭐ con nombre si es un DT humano, bandera + país si es la máquina
  const etiquetaEquipo = eq => {
    if (!eq.esIA) return `⭐ ${esc(eq.nombre)}`;
    const s = SQUADS_BY_KEY[eq.squadKey];
    return `${bandera(s)} ${esc(s.pais)} ${s.anio}`;
  };
  const etiquetaRival = etiquetaEquipo(rival);

  const div = document.createElement('div');
  div.className = 'overlay-tanda';
  document.body.appendChild(div);

  // en duelo: mis lados ya elegidos (sobreviven a un refresco) y los del rival
  let misLados = [...((app.estado.players.find(pl => pl.id === miId())?.resultados || {})[kT] || [])];
  const susLados = () => duelo
    ? ((app.estado.players.find(pl => pl.id === rivalPid)?.resultados || {})[kT] || [])
    : [];
  const resultadoGuardado = () => Object.assign({}, ...app.estado.players.map(p => p.resultados || {}))[partido.clave];

  let accion = null;     // callback al elegir lado
  let animando = false;  // no procesar doble durante una animación
  let cerrado = false;
  let guardando = false;

  // si el anfitrión marcó ausente a alguno de los dos, la máquina toma la tanda:
  // cierro este duelo y dejo que el Mundial siga con el resultado automático
  const hayAusenteEnDuelo = () => {
    const aband = (app.estado.players.find(p => p.id === room.host_id)?.resultados?._abandonados) || [];
    return [partido.idA, partido.idB].some(id => aband.includes(id.slice(2)));
  };
  const tandaHandler = () => {
    if (cerrado) return;
    if (resultadoGuardado() || hayAusenteEnDuelo()) {
      cerrar();
      pantallaTorneo(root);
      return;
    }
    if (!animando) procesar();
  };
  if (duelo) document.addEventListener('sala:cambio', tandaHandler);
  const cerrar = () => {
    cerrado = true;
    if (duelo) document.removeEventListener('sala:cambio', tandaHandler);
    div.remove();
  };

  // publica el marcador parcial para que toda la sala lo vea en vivo
  const publicarLive = () => {
    const yo = app.estado.players.find(pl => pl.id === miId());
    if (!yo) return;
    yo.resultados = { ...(yo.resultados || {}), ['_live_' + partido.clave]: { a: goles(t.A), b: goles(t.B) } };
    net.actualizarJugador(room.code, miId(), { resultados: yo.resultados }).catch(() => {});
  };

  const marcas = arr => {
    const total = Math.max(5, arr.length);
    return Array.from({ length: total }, (_, i) =>
      i < arr.length ? (arr[i] ? '⚽' : '❌') : '·').join(' ');
  };

  function dibujarTanda(msg, opts = {}) {
    const mias = soyA ? t.A : t.B;
    const suyas = soyA ? t.B : t.A;
    div.innerHTML = html`
      <div class="tanda">
        <p class="tanda-titulo">🧤 TANDA DE PENALES</p>
        ${opts.turno ? `<div class="tanda-turno ${opts.turno.mio ? 'turno-mio' : 'turno-rival'}">
          <span class="turno-rol">${opts.turno.mio ? '⚽ TU PENAL' : '🧤 ¡ATAJÁS TÚ!'}</span>
          <span class="turno-quien">${opts.turno.label}</span>
        </div>` : ''}
        <div class="tanda-marcas">
          <div class="tanda-fila"><span class="tanda-eq">⭐ ${esc(mio.nombre)}</span>
            <b>${goles(mias)}</b> <span class="marcas">${marcas(mias)}</span></div>
          <div class="tanda-fila"><span class="tanda-eq">${etiquetaRival}</span>
            <b>${goles(suyas)}</b> <span class="marcas">${marcas(suyas)}</span></div>
        </div>
        <div class="arco-zona">
          <div class="arco">
            <span class="golero ${opts.golero || ''}">🧤</span>
          </div>
          <span class="balon ${opts.balon || ''}">⚽</span>
          ${opts.verdict ? `<div class="verdict">${opts.verdict}</div>` : ''}
        </div>
        <p class="tanda-msg">${msg}</p>
        <div class="tanda-botones">
          ${opts.botones ? html`
            <button class="btn btn-primario btn-lado" data-lado="izq">⬅ IZQUIERDA</button>
            <button class="btn btn-primario btn-lado" data-lado="centro">🎯 AL MEDIO</button>
            <button class="btn btn-primario btn-lado" data-lado="der">DERECHA ➡</button>` : ''}
          ${opts.continuar ? '<button id="tanda-continuar" class="btn btn-primario btn-grande">Continuar ▶</button>' : ''}
        </div>
      </div>`;

    $$('.btn-lado', div).forEach(b => b.addEventListener('click', () => {
      const cb = accion;
      accion = null;
      $$('.btn-lado', div).forEach(btn => { btn.disabled = true; });
      if (cb) cb(b.dataset.lado);
    }));
    $('#tanda-continuar', div)?.addEventListener('click', guardar);
  }

  function resolver(pateaA, ladoTiro, ladoAtajada, gol) {
    const lista = pateaA ? t.A : t.B;
    const pateador = (pateaA ? patA : patB)[lista.length % (pateaA ? patA : patB).length];
    const arquero = pateaA ? gkB : gkA;
    lista.push(gol);
    publicarLive();
    const pateoYo = pateaA === soyA;
    const arqueroToco = ladoTiro === ladoAtajada && !gol;
    animando = true;
    dibujarTanda(
      gol
        ? (pateoYo ? `⚽ ¡GOOOOL de ${esc(pateador.nombre)}!` : `❌ Gol de ${esc(pateador.nombre)}…`)
        : (pateoYo ? `🧤 ¡${esc(arquero.nombre)} se la atajó!` : `🧤 ¡ATAJADÓN de ${esc(arquero.nombre)}!`),
      {
        balon: ladoTiro + (gol ? ' gol' : ' atajado'),
        golero: ladoAtajada + (arqueroToco || !gol ? '' : ' errado'),
        verdict: gol ? (pateoYo ? '¡GOL!' : 'GOL RIVAL') : (pateoYo ? '¡ATAJADO!' : '¡LA SACASTE!'),
        turno: { mio: pateoYo, label: etiquetaEquipo(pateaA ? eqA : eqB) },
      });
    setTimeout(() => { animando = false; if (!cerrado) procesar(); }, 1500);
  }

  function procesar() {
    if (cerrado || animando) return;
    const completas = t.A.length === t.B.length;
    const ga = goles(t.A), gb = goles(t.B);
    // al mejor de 5: durante los primeros 5, termina apenas la ventaja sea
    // inalcanzable. en muerte súbita (ambos con 5+), solo cuando patearon
    // parejo y hay diferencia — nunca antes de que el segundo responda su penal.
    if (t.A.length < 5 || t.B.length < 5) {
      const remA = Math.max(0, 5 - t.A.length), remB = Math.max(0, 5 - t.B.length);
      if (ga > gb + remB || gb > ga + remA) return terminar();
    } else if (completas && ga !== gb) {
      return terminar();
    }

    const pateaA = completas; // A patea cuando van parejos en penales ejecutados
    const k = t.A.length + t.B.length; // número de penal (global)
    const lista = pateaA ? t.A : t.B;
    const pateador = (pateaA ? patA : patB)[lista.length % (pateaA ? patA : patB).length];
    const arquero = pateaA ? gkB : gkA;
    const pateoYo = pateaA === soyA;

    const pedirLado = () => dibujarTanda(pateoYo
      ? `Patea ${esc(pateador.nombre)}${nv(pateador)} contra ${esc(arquero.nombre)}${nv(arquero)}. ¿A qué lado le pega?`
      : `Patea ${esc(pateador.nombre)}${nv(pateador)}. ¡${esc(arquero.nombre)} puede ser héroe! ¿Hacia dónde se lanza?`,
      { botones: true, turno: { mio: pateoYo, label: etiquetaEquipo(pateaA ? eqA : eqB) } });

    if (!duelo) {
      // contra la máquina: su lado sale al azar al momento de resolver
      accion = lado => {
        const rng = new Rng(`tanda-ia-${room.seed}-${partido.clave}-${k}-${lado}`);
        const ladoIA = ['izq', 'centro', 'der'][rng.int(3)];
        const ladoTiro = pateoYo ? lado : ladoIA;
        const ladoAtajada = pateoYo ? ladoIA : lado;
        resolver(pateaA, ladoTiro, ladoAtajada,
          rng.next() < pGol(pateador.nivel, arquero.nivel, ladoTiro === ladoAtajada, ladoTiro === 'centro'));
      };
      pedirLado();
      return;
    }

    // duelo entre DTs: este penal necesita el lado de ambos
    const sus = susLados();
    if (misLados.length > k && sus.length > k) {
      // ambos eligieron: desenlace determinista, idéntico en las dos pantallas
      const ladoTiro = pateoYo ? misLados[k] : sus[k];
      const ladoAtajada = pateoYo ? sus[k] : misLados[k];
      const rng = new Rng(`tanda-${room.seed}-${partido.clave}-${k}`);
      resolver(pateaA, ladoTiro, ladoAtajada,
        rng.next() < pGol(pateador.nivel, arquero.nivel, ladoTiro === ladoAtajada, ladoTiro === 'centro'));
      return;
    }
    if (misLados.length > k) {
      dibujarTanda(`⏳ Esperando la elección de ${esc(rival.nombre)}…`, {});
      return;
    }
    accion = async lado => {
      misLados.push(lado);
      const yo = app.estado.players.find(pl => pl.id === miId());
      yo.resultados = { ...(yo.resultados || {}), [kT]: misLados };
      try { await net.actualizarJugador(room.code, miId(), { resultados: yo.resultados }); }
      catch (e) { toast('No se pudo enviar tu elección: ' + e.message, true); }
      procesar();
    };
    pedirLado();
  }

  function terminar() {
    const gm = goles(soyA ? t.A : t.B);
    const gr = goles(soyA ? t.B : t.A);
    dibujarTanda(gm > gr ? '🏆 ¡GANASTE LA TANDA, DT!' : '😔 Perdiste la tanda…',
      { continuar: true, verdict: `${gm} – ${gr}` });
  }

  async function guardar() {
    if (guardando) return;
    guardando = true;
    // ambos DTs escriben el mismo resultado: da igual quién llegue primero
    const yo = app.estado.players.find(pl => pl.id === miId());
    const { ['_live_' + partido.clave]: _liveFin, ...resto } = (yo.resultados || {});
    const resultados = {
      ...resto,
      [partido.clave]: { penales: { golesA: goles(t.A), golesB: goles(t.B) } },
    };
    yo.resultados = resultados; // actualización optimista para recalcular al tiro
    try {
      await net.actualizarJugador(room.code, miId(), { resultados });
      cerrar();
      pantallaTorneo(root);
    } catch (e) {
      guardando = false;
      toast('No se pudo guardar la tanda: ' + e.message, true);
    }
  }

  procesar();
}

// ---------- eliminación ----------

// devuelve el índice del paso donde mi equipo queda eliminado (-1 si no juego o salgo campeón)
function calcularEliminacion(mundial, miEq, pasos) {
  if (!mundial.equipos.some(e => e.id === miEq)) return -1;
  if (mundial.campeonId === miEq) return -1;
  const idx = titulo => pasos.findIndex(p => p.titulo === titulo);
  const enLlave = r => r.partidos.some(p => p.idA === miEq || p.idB === miEq);
  if (!mundial.llaves.some(enLlave)) return idx('Tablas'); // no pasé la fase de grupos
  for (let r = 0; r < mundial.llaves.length; r++) {
    const p = mundial.llaves[r].partidos.find(p => p.idA === miEq || p.idB === miEq);
    if (p && p.ganador !== miEq) return idx(mundial.llaves[r].nombre);
  }
  return -1;
}

function mostrarEliminado(root, mundial, marcar, alSeguir) {
  if (document.querySelector('.overlay-elim')) return;
  marcar();
  const div = document.createElement('div');
  div.className = 'overlay-elim';
  div.innerHTML = html`
    <div class="cartel-elim" role="dialog" aria-modal="true" aria-labelledby="titulo-eliminado">
      <p class="elim-titulo" id="titulo-eliminado">ELIMINADO</p>
      <p class="elim-texto">Tu combinado quedó fuera del Mundialito.<br>Se acabó el juego para ti, DT. 😔</p>
      <div class="elim-botones">
        <button id="elim-mirar" class="btn">📺 Verlo por TV</button>
      </div>
    </div>`;
  const appRoot = document.getElementById('app');
  const appEraInerte = appRoot?.hasAttribute('inert') ?? false;
  const cerrar = () => {
    document.removeEventListener('keydown', manejarTeclado);
    div.remove();
    if (appRoot && !appEraInerte) appRoot.inert = false;
    alSeguir?.();
  };
  const manejarTeclado = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      $('#elim-mirar', div)?.focus();
    }
  };
  if (appRoot) appRoot.inert = true;
  document.body.appendChild(div);
  document.addEventListener('keydown', manejarTeclado);
  $('#elim-mirar', div).addEventListener('click', cerrar);
  $('#elim-mirar', div).focus();
}

// ---------- pasos de la reproducción ----------

function construirPasos(mundial) {
  const pasos = [];

  // en modo solo penales no hay fase de grupos: se omiten el sorteo y las tablas
  if (mundial.grupos.length) pasos.push({
    titulo: 'Sorteo',
    render: m => html`
      <h2 class="titulo-fase">El sorteo de grupos</h2>
      <div class="grilla-grupos">
        ${m.grupos.map(g => html`
          <div class="tabla-grupo">
            <h4 class="titulo-grupo">GRUPO ${g.nombre}</h4>
            <ul class="lista-grupo">
              ${g.ids.map(id => `<li class="${esMio(m, id) ? 'mi-fila' : ''}">${nombreEquipo(m, id)}</li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>`,
  });

  mundial.faseGrupos.forEach(fecha => {
    const ordenados = miPrimero(mundial, fecha.partidos);
    pasos.push({
      titulo: fecha.nombre,
      faseAnimacion: 'grupos',
      partidos: ordenados,
      render: (m, final) => html`
        <h2 class="titulo-fase">Fase de grupos · ${esc(fecha.nombre)}</h2>
        <div class="lista-partidos">
          ${ordenados.map((p, i) => partidoHTML(m, p, i, final)).join('')}
        </div>`,
    });
  });

  if (mundial.grupos.length) pasos.push({
    titulo: 'Tablas',
    render: m => html`
      <h2 class="titulo-fase">Así quedaron los grupos</h2>
      <p class="nota centrada">Los dos primeros de cada grupo avanzan a la fase final.</p>
      <div class="grilla-grupos">${m.tablas.map(t => tablaGrupoHTML(m, t)).join('')}</div>`,
  });

  mundial.llaves.forEach(ronda => {
    const ordenados = miPrimero(mundial, ronda.partidos);
    const esFinal = ronda.nombre === 'Final';
    pasos.push({
      titulo: ronda.nombre,
      eliminatorio: true,
      faseAnimacion: FASE_ANIMACION_POR_RONDA[ronda.nombre] || 'grupos',
      partidos: ordenados,
      render: (m, final) => esFinal
        ? html`
          <div class="escenario-final">
            <div class="banderines">${'<i></i>'.repeat(16)}</div>
            <div class="tribuna"><span class="publico"></span></div>
            <h2 class="titulo-gran-final">⭐ LA GRAN FINAL ⭐</h2>
            <p class="final-sub">EL ESTADIO ESTÁ QUE ARDE · ${m.grupos.length ? 'LA GLORIA NO ADMITE EMPATES' : 'TODO SE DECIDE DESDE LOS DOCE PASOS'}</p>
            <div class="lista-partidos final-grande">
              ${partidoHTML(m, ordenados[0], 0, final)}
            </div>
            <div class="banderines invertidos">${'<i></i>'.repeat(16)}</div>
          </div>`
        : html`
          <h2 class="titulo-fase">${esc(ronda.nombre)}</h2>
          <div class="lista-partidos">
            ${ordenados.map((p, i) => partidoHTML(m, p, i, final)).join('')}
          </div>`,
    });
    // el tercer puesto va en su propia página, después de las semis
    // (mostrarlo junto a ellas adelantaba quiénes las perdían)
    if (ronda.nombre === 'Semifinales' && mundial.tercerPuesto) {
      pasos.push({
        titulo: 'Tercer Puesto',
        eliminatorio: true,
        faseAnimacion: 'tercerPuesto',
        partidos: [mundial.tercerPuesto],
        render: (m, final) => html`
          <h2 class="titulo-fase">Partido por el Tercer Puesto</h2>
          <div class="lista-partidos">${partidoHTML(m, m.tercerPuesto, 0, final)}</div>`,
      });
    }
  });

  pasos.push({
    titulo: '🏆 Campeón',
    render: m => {
      const campeon = m.equipos.find(e => e.id === m.campeonId);
      const s = SQUADS_BY_KEY[campeon.squadKey];
      const esMioCampeon = campeon.id === 'h-' + miId();
      return html`
        <div class="celebracion">
          <div class="confeti">🎉🎊⚽🏆</div>
          <p class="campeon-label">CAMPEÓN DEL MUNDIALITO</p>
          <h2 class="campeon-nombre">${campeon.esIA
            ? `${bandera(s, 21)} ${esc(s.pais)} ${s.anio}`
            : `⭐ ${esc(campeon.nombre)}`}</h2>
          ${campeon.esIA
            ? `<p class="campeon-apodo">"${esc(s.apodo)}"</p>
               <p class="campeon-dt">…ganó la máquina. Papelón de la oficina. 😅</p>`
            : `<p class="campeon-dt">${esMioCampeon ? '¡ERES EL CAMPEÓN, DT! 👑' : `DT campeón: <b>${esc(campeon.nombre)}</b> 👑`}</p>`}
          <p class="subcampeon">Subcampeón: ${nombreEquipo(m, m.subcampeonId)}</p>
        </div>
        ${m.goleadores.length ? html`
        <h3 class="titulo-fase chico">Goleadores del torneo</h3>
        <table class="tabla-goleadores">
          <tbody>
            ${m.goleadores.slice(0, 8).map((g, i) => html`
              <tr class="${esMio(m, g.equipoId) ? 'mi-fila' : ''}">
                <td>${i + 1}</td>
                <td>${esc(g.jugador)}</td>
                <td class="celda-equipo">${nombreEquipo(m, g.equipoId)}</td>
                <td class="pts">${g.goles} ⚽</td>
              </tr>`).join('')}
          </tbody>
        </table>` : ''}`;
    },
  });

  return pasos;
}
