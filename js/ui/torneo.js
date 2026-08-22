// El Mundial: simulación determinista que se reproduce con reloj en vivo.
// Empate tras el alargue = tanda de penales. Si la tanda es de TU equipo
// contra la máquina, la juegas tú: eliges lado al patear y al atajar.
// Si tu equipo queda eliminado, se acaba el juego para ti.

import { net } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, salirDeSala, miJugadorId, refrescarGrupo } from '../main.js';
import { SQUADS_BY_KEY, JUGADORES_BY_ID, bandera, nivelEnPuesto, squadsParaModo } from '../data/squads.js';
import {
  simularMundial,
  parseModo,
  ZONAS_TIRO_PENAL,
  ZONAS_ARQUERO_PENAL,
  resolverPenalConRng,
} from '../engine/engine.js';
import { Rng } from '../engine/rng.js';
import { medallaMundialitoSvg } from './icons.js';

// en players.resultados conviven las tandas (clave del partido) y datos
// internos con prefijo '_' (_paso/_reproduccion del anfitrión, _t_<clave>
// para lados elegidos y _gk_tanda_<clave> para el arquero de la tanda)
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
  // enabled_squads limita únicamente el draft. Los rivales IA siempre salen
  // del universo base completo del modo, aunque un plantel esté apagado allí.
  const poolTorneo = squadsParaModo(modo);
  const mundial = simularMundial(
    room.seed, humanos, overrides, parseModo(room.modo).total, soloPenales, poolTorneo,
  );
  marcarPendientes(mundial, abandonados);
  const pasos = construirPasos(mundial);

  const kPaso = `mundialito-paso-${room.code}-${room.seed}`;
  const kVisto = `mundialito-visto-${room.code}-${room.seed}`;
  const kElim = `mundialito-elim-${room.code}-${room.seed}`;
  const kPodio = `mundialito-podio-${room.code}-${room.seed}`;

  // el anfitrión maneja el ritmo del mundial; los demás siguen su paso
  const esHost = room.host_id === miJugadorId();
  const hostPaso = () => Math.min(
    Number(app.estado.players.find(p => p.id === room.host_id)?.resultados?._paso ?? 0),
    pasos.length - 1);
  const pasoGuardado = sessionStorage.getItem(kPaso);
  const pasoLocal = Number(pasoGuardado);
  let podioLocal = sessionStorage.getItem(kPodio) === '1';
  let paso = esHost
    ? Math.min(Math.max(
      pasoGuardado !== null && Number.isFinite(pasoLocal) ? pasoLocal : 0,
      hostPaso(),
    ), pasos.length - 1)
    : hostPaso();
  if (podioLocal) paso = pasos.length - 1;
  const miEq = 'h-' + miJugadorId();
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
  let finalizacionGrupoEnCurso = false;
  let finalizacionGrupoCompleta = Boolean(room.finalized_at || room.finalizedAt || room.status === 'finished');

  const reflejarFinalizacionGrupo = () => {
    const estado = $('#estado-finalizacion-grupo', root);
    const reintentar = $('#btn-reintentar-finalizacion', root);
    const volver = $('#btn-volver-grupo', root);
    if (estado) estado.textContent = 'Podio guardado. El historial del grupo ya está actualizado.';
    if (reintentar) reintentar.hidden = true;
    if (volver) volver.disabled = false;
  };

  const finalizarTorneoDeGrupo = async () => {
    const contexto = app.grupo;
    if (!contexto?.group || !contexto?.member || !contexto?.token) return false;
    if (!esHost) return finalizacionGrupoCompleta;
    if (finalizacionGrupoCompleta || finalizacionGrupoEnCurso) return finalizacionGrupoCompleta;
    finalizacionGrupoEnCurso = true;
    const estado = $('#estado-finalizacion-grupo', root);
    const reintentar = $('#btn-reintentar-finalizacion', root);
    const volver = $('#btn-volver-grupo', root);
    if (estado) estado.textContent = 'Guardando el podio en el historial del grupo…';
    if (reintentar) reintentar.disabled = true;
    if (volver) volver.disabled = true;
    const podio = podioDelMundial(mundial).map(({ place, isAI, teamId, playerId, displayName, squadKey }) => ({
      place, isAI, teamId, playerId, displayName, squadKey,
    }));
    try {
      await net.grupoFinalizarTorneo({
        roomCode: room.code,
        memberId: contexto.member.id,
        sessionToken: contexto.token,
        playerId: miJugadorId(),
        podio,
      });
      finalizacionGrupoCompleta = true;
      if (app.estado?.room) {
        app.estado.room.status = 'finished';
        app.estado.room.finalized_at ||= new Date().toISOString();
      }
      reflejarFinalizacionGrupo();
      await refrescarGrupo({ silencioso: true });
      return true;
    } catch (e) {
      if (estado) estado.textContent = 'No se pudo guardar el podio. Reintenta antes de volver al grupo.';
      if (reintentar) { reintentar.hidden = false; reintentar.disabled = false; }
      toast('No se pudo finalizar el Mundialito: ' + e.message, true);
      return false;
    } finally {
      finalizacionGrupoEnCurso = false;
    }
  };

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
      const yo = app.estado.players.find(pl => pl.id === miJugadorId());
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
        await net.actualizarJugador(room.code, miJugadorId(), { resultados });
        const actualizado = app.estado.players.find(pl => pl.id === miJugadorId());
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
      const host = app.estado.players.find(pl => pl.id === miJugadorId());
      if (!host) return false;
      const abandonadosActuales = new Set(host.resultados?._abandonados || []);
      if (ausente) abandonadosActuales.add(playerId);
      else abandonadosActuales.delete(playerId);
      const resultados = {
        ...(host.resultados || {}),
        _abandonados: [...abandonadosActuales],
      };
      try {
        await net.actualizarJugador(room.code, miJugadorId(), { resultados });
        const actualizado = app.estado.players.find(pl => pl.id === miJugadorId());
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
    if (app.estado?.room?.status === 'finished' || app.estado?.room?.finalized_at || app.estado?.room?.finalizedAt) {
      finalizacionGrupoCompleta = true;
      reflejarFinalizacionGrupo();
    }
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
      if (podioLocal && nuevoPaso < pasos.length - 1) return;
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
          <div class="ticket"><span class="ticket-label">${app.grupo?.group ? 'GRUPO' : 'MUNDIALITO'}</span>
            <span class="ticket-codigo ${app.grupo?.group ? 'ticket-grupo' : ''}">${esc(app.grupo?.group?.displayName || app.grupo?.group?.display_name || room.group_name || room.code)}</span></div>
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

    $('#btn-jugadores', root)?.addEventListener('click', () =>
      abrirGestionJugadores(room, actualizarAusente));
    if (paso === pasos.length - 1 && app.grupo?.group) {
      const volver = $('#btn-volver-grupo', root);
      if (volver) {
        volver.disabled = !finalizacionGrupoCompleta;
        volver.addEventListener('click', () => salirDeSala({ notificar: false }));
      }
      $('#btn-reintentar-finalizacion', root)?.addEventListener('click', finalizarTorneoDeGrupo);
      if (finalizacionGrupoCompleta) reflejarFinalizacionGrupo();
      else if (esHost) finalizarTorneoDeGrupo();
      else {
        const estado = $('#estado-finalizacion-grupo', root);
        if (estado) estado.textContent = 'Esperando que el anfitrión guarde el podio…';
      }
    }

    if (enVivoEliminatoria) {
      const limite = subfase === 'extra' ? 120 : 90;
      const siguienteSubfase = subfase === 'extra' ? 'resumen120' : 'resumen90';
      let finalizando = false;
      const terminarTramo = async () => {
        if (finalizando) return;
        clearInterval(relojTimer);
        pintarPartidosHasta(root, mundial, pasos[paso].partidos, limite);
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
        mundial,
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
        pintarPartidosHasta(root, mundial, pasos[paso].partidos, 90);
        terminar();
      });
      animarPartidos(
        root,
        mundial,
        pasos[paso].partidos,
        0,
        90,
        terminar,
        pasos[paso].faseAnimacion,
      );
    } else if (enPausa) {
      const minuto = subfase === 'resumen90' ? 90 : 120;
      pintarPartidosHasta(root, mundial, pasos[paso].partidos, minuto);
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
        const esSubcampeon = perdiFinal(mundial, miEq);
        const irAlPodio = () => {
          podioLocal = true;
          sessionStorage.setItem(kPodio, '1');
          paso = pasos.length - 1;
          subfase = null;
          if (esHost) void cambiarPaso(paso);
          dibujar();
        };
        // La derrota de la Final es subcampeonato, no una eliminación genérica.
        mostrarEliminado(
          root,
          mundial,
          () => sessionStorage.setItem(kElim, '1'),
          esSubcampeon ? irAlPodio : dibujar,
          { esSubcampeon },
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
          penales que no se juegan), márcalo como ausente: el Bot juega sus penales y el
          torneo sigue. Su equipo se queda en el cuadro.</p>
        <ul class="lista-gestion">
          ${app.estado.players.map(p => html`
            <li class="${aband.has(p.id) ? 'ausente' : ''}">
              <b>${esc(p.name)}</b>
              ${p.id === room.host_id
                ? '<span class="etiqueta-host">ANFITRIÓN</span>'
                : (aband.has(p.id)
                  ? `<span class="tag-ausente">ausente · juega el Bot</span>
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

function podioDelMundial(mundial) {
  const terceroId = mundial.tercerPuesto?.ganador || null;
  return [mundial.campeonId, mundial.subcampeonId, terceroId]
    .map((id, indice) => {
      const equipo = mundial.equipos.find(e => e.id === id);
      if (!equipo) return null;
      const place = indice + 1;
      if (!equipo.esIA) {
        return {
          place,
          isAI: false,
          teamId: equipo.id,
          playerId: equipo.id.startsWith('h-') ? equipo.id.slice(2) : equipo.id,
          displayName: equipo.nombre,
          nombreHtml: `⭐ ${esc(equipo.nombre)}`,
          detailHtml: 'DT humano',
        };
      }
      const squad = SQUADS_BY_KEY[equipo.squadKey];
      const displayName = squad ? `${squad.pais} ${squad.anio}` : equipo.nombre;
      return {
        place,
        isAI: true,
        teamId: equipo.id,
        displayName,
        squadKey: equipo.squadKey,
        nombreHtml: squad
          ? `<span class="flag-slot podio-bandera">${bandera(squad, 18)}</span>${esc(displayName)}`
          : esc(displayName),
        detailHtml: 'Selección histórica · BOT',
      };
    })
    .filter(Boolean);
}

function podioFinalHTML(mundial) {
  return podioDelMundial(mundial).map(item => {
    const clase = item.place === 1 ? 'podio-primero'
      : item.place === 2 ? 'podio-segundo' : 'podio-tercero';
    const premio = item.place === 1
      ? '<img class="icono-copa podio-copa copa-sticker" src="assets/stickerCopa.png" alt="Copa del Mundialito" />'
      : medallaMundialitoSvg(item.place === 2 ? 'plata' : 'bronce', {
        className: 'icono-medalla',
        title: item.place === 2 ? 'Medalla de plata' : 'Medalla de bronce',
      });
    return html`
      <article class="podio-tarjeta ${clase}">
        <span class="podio-posicion">${item.place}º</span>
        <div class="podio-premio">${premio}</div>
        <h3 class="podio-nombre">${item.nombreHtml}</h3>
        <p class="podio-detalle">${esc(item.detailHtml)}</p>
      </article>`;
  }).join('');
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

const TIPOS_EXPULSION = new Set(['roja_directa', 'segunda_amarilla']);

function esExpulsion(tipo) {
  return TIPOS_EXPULSION.has(tipo);
}

function expulsionesHasta(p, equipoId, hastaMin = Infinity) {
  return (p.tarjetas || []).filter(tarjeta =>
    tarjeta.equipoId === equipoId &&
    tarjeta.minuto <= hastaMin &&
    esExpulsion(tarjeta.tipo)).length;
}

function contenidoInferioridad(expulsiones) {
  if (expulsiones <= 0) return '';
  const jugadores = Math.max(0, 11 - expulsiones);
  return `<span class="inferioridad-rojas" aria-hidden="true">${'🟥'.repeat(expulsiones)}</span>` +
    `<b>${jugadores}</b>`;
}

function indicadorInferioridadHTML(p, equipoId, lado, hastaMin = Infinity) {
  const expulsiones = expulsionesHasta(p, equipoId, hastaMin);
  const jugadores = Math.max(0, 11 - expulsiones);
  return `<span class="inferioridad-equipo" data-inferioridad="${lado}"` +
    `${expulsiones ? ` aria-label="${jugadores} jugadores"` : ' hidden'}>` +
    `${contenidoInferioridad(expulsiones)}</span>`;
}

function actualizarInferioridad(cont, p, hastaMin) {
  [['A', p.idA], ['B', p.idB]].forEach(([lado, equipoId]) => {
    const indicador = $(`[data-inferioridad="${lado}"]`, cont);
    if (!indicador) return;
    const expulsiones = expulsionesHasta(p, equipoId, hastaMin);
    if (Number(indicador.dataset.expulsiones) === expulsiones) return;
    indicador.dataset.expulsiones = String(expulsiones);
    if (!expulsiones) {
      indicador.hidden = true;
      indicador.removeAttribute('aria-label');
      indicador.innerHTML = '';
      return;
    }
    const jugadores = Math.max(0, 11 - expulsiones);
    indicador.hidden = false;
    indicador.setAttribute('aria-label', `${jugadores} jugadores`);
    indicador.innerHTML = contenidoInferioridad(expulsiones);
  });
}

function pintarPartidosHasta(root, mundial, partidos, minuto) {
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
    actualizarInferioridad(cont, p, minutoPartido);
    const timeline = $('.timeline-partido', cont);
    if (timeline) {
      const corteAnterior = Number(timeline.dataset.hastaMin);
      const animarDesde = Number.isFinite(corteAnterior) && corteAnterior <= minutoPartido
        ? corteAnterior
        : minutoPartido;
      const nuevoTimeline = timelinePartidoHTML(mundial, p, minutoPartido, animarDesde);
      if (timeline.innerHTML !== nuevoTimeline) timeline.innerHTML = nuevoTimeline;
      timeline.dataset.hastaMin = String(minutoPartido);
    }

    const estado = $('.estado-partido', cont);
    if (estado && p.alargue && minutoPartido >= 90) {
      estado.innerHTML = etiquetaAlargueHTML(p, minutoPartido < 120);
    }
  }
}

function animarPartidos(root, mundial, partidos, desdeMin, hastaMin, alTerminar, faseAnimacion = 'grupos') {
  // En eliminación directa, cada tramo se detiene en su frontera para que el
  // resumen del host habilite explícitamente 91–120 o las tandas.
  let minuto = desdeMin;
  pintarPartidosHasta(root, mundial, partidos, minuto);
  relojTimer = setInterval(() => {
    minuto++;
    pintarPartidosHasta(root, mundial, partidos, minuto);
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

// El motor conserva goles, cambios y disciplina en colecciones separadas.
// La UI las combina únicamente para una cronología estable y sin spoilers.
const PRIORIDAD_EVENTO = Object.freeze({
  segunda_amarilla: 0,
  roja_directa: 1,
  cambio: 2,
  amarilla: 3,
  gol: 4,
});

function claveJugadorEvento(evento) {
  return String(evento.jugadorId || evento.entraId || evento.saleId || '');
}

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
  const tarjetas = (p.tarjetas || []).map((evento, orden) => ({
    ...evento,
    orden,
  }));
  const ordenados = [...goles, ...cambios, ...tarjetas]
    .filter(evento => evento.minuto <= hastaMin)
    .sort((a, b) => a.minuto - b.minuto ||
      (PRIORIDAD_EVENTO[a.tipo] ?? 9) - (PRIORIDAD_EVENTO[b.tipo] ?? 9) ||
      String(a.tipo).localeCompare(String(b.tipo)) ||
      String(a.equipoId).localeCompare(String(b.equipoId)) ||
      claveJugadorEvento(a).localeCompare(claveJugadorEvento(b)) ||
      a.orden - b.orden);

  let golesA = 0;
  let golesB = 0;
  const expulsiones = new Map([[p.idA, 0], [p.idB, 0]]);
  return ordenados.map(evento => {
    if (evento.tipo === 'gol') {
      if (evento.equipoId === p.idA) golesA++;
      else if (evento.equipoId === p.idB) golesB++;
      return { ...evento, marcadorA: golesA, marcadorB: golesB };
    }
    if (esExpulsion(evento.tipo)) {
      const cantidad = (expulsiones.get(evento.equipoId) || 0) + 1;
      expulsiones.set(evento.equipoId, cantidad);
      return { ...evento, jugadoresRestantes: Math.max(0, 11 - cantidad) };
    }
    return evento;
  });
}

function textoEventoHTML(evento) {
  if (evento.tipo === 'gol') {
    return `<span class="evento-mayor-cabecera">` +
      `<span class="evento-icono evento-icono-mayor" aria-hidden="true">⚽</span>` +
      `<strong>GOL</strong></span>` +
      `<b class="evento-jugador">${esc(nombreGoleador(evento))}</b>` +
      `<small>${evento.marcadorA}–${evento.marcadorB}</small>`;
  }
  if (evento.tipo === 'roja_directa' || evento.tipo === 'segunda_amarilla') {
    const esDoble = evento.tipo === 'segunda_amarilla';
    const icono = esDoble ? '🟨🟥' : '🟥';
    const titulo = esDoble ? 'SEGUNDA AMARILLA · EXPULSADO' : 'EXPULSADO · ROJA DIRECTA';
    return `<span class="evento-mayor-cabecera">` +
      `<span class="evento-icono evento-icono-mayor" aria-hidden="true">${icono}</span>` +
      `<strong>${titulo}</strong></span>` +
      `<b class="evento-jugador">${esc(nombreJugador(evento.jugadorId))}</b>` +
      `<small>Queda con ${evento.jugadoresRestantes} jugadores</small>`;
  }
  if (evento.tipo === 'amarilla') {
    return `<span class="evento-icono" aria-hidden="true">🟨</span>` +
      `<span><b>${esc(nombreJugador(evento.jugadorId))}</b>` +
      `<small>Tarjeta amarilla</small></span>`;
  }
  return `<span class="evento-icono cambio-icono" aria-hidden="true">⇄</span>` +
    `<span><b>Entra ${esc(nombreJugador(evento.entraId))}</b>` +
    `<small>Sale ${esc(nombreJugador(evento.saleId))}${evento.puesto ? ` · ${esc(evento.puesto)}` : ''}` +
    `</small></span>`;
}

function timelinePartidoHTML(mundial, p, hastaMin = Infinity, animarExpulsionesDesde = Infinity) {
  return eventosTimeline(p, hastaMin).map(evento => {
    const lado = evento.equipoId === p.idB ? 'lado-b' : 'lado-a';
    const esMayor = evento.tipo === 'gol' || esExpulsion(evento.tipo);
    const claseTipo = {
      gol: 'evento-gol',
      cambio: 'evento-cambio',
      amarilla: 'evento-amarilla',
      roja_directa: 'evento-roja',
      segunda_amarilla: 'evento-doble-amarilla',
    }[evento.tipo] || 'evento-desconocido';
    const esReciente = esExpulsion(evento.tipo) &&
      evento.minuto === hastaMin && evento.minuto > animarExpulsionesDesde;
    return `<div class="timeline-evento ${lado} ${claseTipo} ` +
      `${esMayor ? 'evento-mayor' : 'evento-menor'}${esReciente ? ' evento-reciente' : ''}">` +
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
  return `${bandera(s)} ${esc(s.pais)} ${s.anio} <span class="dt ia">· BOT</span>`;
}

function esMio(mundial, id) {
  const e = mundial.equipos.find(e => e.id === id);
  return e && e.id === 'h-' + miJugadorId();
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
          <span class="equipo">${nombreEquipo(mundial, p.idA)}${indicadorInferioridadHTML(p, p.idA, 'A', 0)}</span>
          <span class="resultado">0 – 0</span>
          <span class="equipo der">${nombreEquipo(mundial, p.idB)}${indicadorInferioridadHTML(p, p.idB, 'B', 0)}</span>
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
        <span class="equipo ${!pendiente && p.ganador === p.idA ? 'ganador' : ''}">${nombreEquipo(mundial, p.idA)}${indicadorInferioridadHTML(p, p.idA, 'A')}</span>
        <span class="resultado">${p.golesA} – ${p.golesB}</span>
        <span class="equipo der ${!pendiente && p.ganador === p.idB ? 'ganador' : ''}">${nombreEquipo(mundial, p.idB)}${indicadorInferioridadHTML(p, p.idB, 'B')}</span>
      </div>
      ${notas.length ? `<div class="estado-partido notas">${notas.join(' <span aria-hidden="true">·</span> ')}</div>` : ''}
      ${eventosTimeline(p).length ? `<div class="timeline-partido">${timelinePartidoHTML(mundial, p)}</div>` : ''}
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

const OPCIONES_TIRO_UI = Object.freeze([
  { id: 'izq-arriba', icono: '↖', texto: 'ARRIBA IZQ' },
  { id: 'centro', icono: '🎯', texto: 'AL MEDIO' },
  { id: 'der-arriba', icono: '↗', texto: 'ARRIBA DER' },
  { id: 'izq-abajo', icono: '↙', texto: 'ABAJO IZQ' },
  { id: 'panenka', icono: '😏', texto: 'PANENKA' },
  { id: 'der-abajo', icono: '↘', texto: 'ABAJO DER' },
]);

const OPCIONES_ARQUERO_UI = Object.freeze([
  { id: 'izq', icono: '←', texto: 'IZQUIERDA' },
  { id: 'centro', icono: '●', texto: 'MEDIO' },
  { id: 'der', icono: '→', texto: 'DERECHA' },
]);

// Helper puro y exportado para validar el contrato de la UI: el snapshot final
// manda, POR queda fuera y el desempate nunca depende del orden del navegador.
export function ordenarSlotsPateadoresTanda(slots = []) {
  return slots
    .filter(slot => slot?.puesto !== 'POR' && slot?.linea !== 'POR'
      && typeof slot?.id === 'string' && Number.isFinite(slot?.nivel))
    .map(slot => ({ ...slot }))
    .sort((a, b) => b.nivel - a.nivel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function slotArqueroTanda(slots = []) {
  const slot = slots.find(candidato => candidato?.puesto === 'POR' || candidato?.linea === 'POR');
  return slot && typeof slot.id === 'string' && Number.isFinite(slot.nivel) ? { ...slot } : null;
}

export function ganadorTandaInteractiva(penalesA = [], penalesB = []) {
  const golesA = penalesA.filter(Boolean).length;
  const golesB = penalesB.filter(Boolean).length;
  if (penalesA.length < 5 || penalesB.length < 5) {
    const restantesA = Math.max(0, 5 - penalesA.length);
    const restantesB = Math.max(0, 5 - penalesB.length);
    if (golesA > golesB + restantesB) return 'A';
    if (golesB > golesA + restantesA) return 'B';
    return null;
  }
  if (penalesA.length !== penalesB.length || golesA === golesB) return null;
  return golesA > golesB ? 'A' : 'B';
}

function ladoTexto(lado) {
  if (lado === 'izq') return 'izquierda';
  if (lado === 'der') return 'derecha';
  return 'medio';
}

function destinoArquero(lado) {
  return lado === 'centro' ? 'al medio' : `a la ${ladoTexto(lado)}`;
}

// El helper del motor determina probabilidad, acierto y tipo de desenlace. Aquí
// solo traducimos ese resultado a la narración solicitada, sin rehacer fórmulas.
export function narracionPenalInteractivo(resultado, pateador, arquero) {
  const { zonaTiro, zonaArquero, gol, desenlace, arqueroAdivino } = resultado;
  const ladoDelTiro = zonaTiro.startsWith('izq') ? 'izquierda' : 'derecha';
  const destino = destinoArquero(zonaArquero);

  if (zonaTiro === 'panenka') {
    if (zonaArquero === 'centro') return {
      titulo: '🧤 ¡LE LEYÓ LA PANENKA!',
      detalles: [`${pateador} quiso humillarlo, pero ${arquero} no se movió.`],
      clase: 'panenka-leida',
    };
    if (gol) return {
      titulo: '😏 ¡HUMILLADO!',
      detalles: [
        `${pateador} ha humillado a ${arquero}.`,
        `Panenka perfecta: ${arquero} se lanzó a la ${ladoTexto(zonaArquero)}.`,
      ],
      clase: 'gol-panenka',
    };
    return {
      titulo: '❌ ¡FALLÓ LA PANENKA!',
      detalles: [`${arquero} estaba vencido, pero ${pateador} ejecutó mal la Panenka.`],
      clase: 'fallo',
    };
  }

  if (zonaTiro === 'centro') {
    if (zonaArquero !== 'centro') return gol ? {
      titulo: '⚽ ¡GOOOL!',
      detalles: [`${pateador} engañó a ${arquero}: remató al medio y el arquero fue ${destino}.`],
      clase: 'gol',
    } : {
      titulo: '❌ ¡LO FALLÓ!',
      detalles: [`${arquero} estaba vencido, pero ${pateador} falló la ejecución.`],
      clase: 'fallo',
    };
    return gol ? {
      titulo: '⚽ ¡GOOOL!',
      detalles: [`${arquero} se quedó al medio, pero no pudo detener el remate de ${pateador}.`],
      clase: 'gol',
    } : {
      titulo: '🧤 ¡ATAJADO!',
      detalles: [`${arquero} se quedó al medio y ganó el duelo contra ${pateador}.`],
      clase: 'atajada',
    };
  }

  const esAbajo = zonaTiro.endsWith('abajo');
  if (!arqueroAdivino) {
    if (gol) return esAbajo ? {
      titulo: '⚽ ¡GOOOL!',
      detalles: [`${pateador} engañó a ${arquero}: remató abajo a la ${ladoDelTiro} y el arquero fue ${destino}.`],
      clase: 'gol',
    } : {
      titulo: '⚽ ¡GOLAZO!',
      detalles: [`${pateador} engañó a ${arquero} y la clavó arriba a la ${ladoDelTiro}.`],
      clase: 'gol',
    };
    return esAbajo ? {
      titulo: '❌ ¡LA TIRÓ AFUERA!',
      detalles: [`${arquero} estaba vencido, pero ${pateador} falló el remate abajo a la ${ladoDelTiro}.`],
      clase: 'fallo',
    } : {
      titulo: '❌ ¡SE LE FUE!',
      detalles: [`${arquero} estaba vencido, pero ${pateador} buscó demasiado el ángulo.`],
      clase: 'fallo',
    };
  }

  if (gol) return esAbajo ? {
    titulo: '⚽ ¡GOOOL!',
    detalles: [`${arquero} adivinó el lado, pero ${pateador} logró colocarla fuera de su alcance.`],
    clase: 'gol',
  } : {
    titulo: '⚽ ¡GOLAZO!',
    detalles: [`${arquero} adivinó el lado, pero el remate de ${pateador} fue imposible de alcanzar.`],
    clase: 'gol',
  };
  return esAbajo ? {
    titulo: '🧤 ¡ATAJADÓN!',
    detalles: [`${arquero} adivinó la ${ladoDelTiro} y detuvo el remate abajo de ${pateador}.`],
    clase: desenlace === 'atajada' ? 'atajada' : 'fallo',
  } : {
    titulo: '🧤 ¡ATAJADÓN!',
    detalles: [`${arquero} leyó la ${ladoDelTiro} y voló para sacar el remate de ${pateador}.`],
    clase: desenlace === 'atajada' ? 'atajada' : 'fallo',
  };
}

// Dos modos:
//  - contra la máquina: los lados de la IA salen al azar en el momento
//  - duelo entre dos DTs: cada uno elige su lado en su pantalla; las elecciones
//    viajan por la sala (resultados._t_<clave>) y el desenlace de cada penal es
//    determinista (semilla de sala + clave + número de penal), así ambos ven lo mismo
function abrirTanda(root, mundial, partido, room) {
  if (document.querySelector('.overlay-tanda')) return; // ya está abierta
  const modo = parseModo(room.modo).modo;
  const almanaque = modo === 'almanaque';
  const soloPenales = modo === 'penales';
  const miEq = 'h-' + miJugadorId();
  const soyA = partido.idA === miEq;
  const eqA = mundial.equipos.find(e => e.id === partido.idA);
  const eqB = mundial.equipos.find(e => e.id === partido.idB);
  const mio = soyA ? eqA : eqB;
  const rival = soyA ? eqB : eqA;
  const duelo = !rival.esIA;
  const rivalPid = duelo ? rival.id.slice(2) : null;
  const kT = '_t_' + partido.clave; // mis lados elegidos, guardados en mi fila
  const kArquero = '_gk_tanda_' + partido.clave;

  const nivelLineup = (eq, id) => eq.lineup?.slots?.find(s => s.id === id)?.nivel
    ?? JUGADORES_BY_ID[id]?.nivel ?? 70;
  const conNivelLineup = eq => id => ({ ...JUGADORES_BY_ID[id], nivel: nivelLineup(eq, id) });
  const pateadoresDesdeSlots = slots => ordenarSlotsPateadoresTanda(slots).flatMap(slot => {
    const jugador = JUGADORES_BY_ID[slot.id];
    return jugador ? [{ ...jugador, nivel: slot.nivel }] : [];
  });
  const pateadoresOriginales = eq => {
    if (Array.isArray(eq.lineup?.slots)) return pateadoresDesdeSlots(eq.lineup.slots);
    return [
      ...(eq.lineup?.DEF || []),
      ...(eq.lineup?.MED || []),
      ...(eq.lineup?.DEL || []),
    ].map(conNivelLineup(eq)).filter(jugador => jugador.id)
      .sort((a, b) => b.nivel - a.nivel || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  const pateadoresPartido = (eq, slotsFinales) => {
    // Un snapshot presente es la fuente de verdad aunque excepcionalmente quede
    // vacío: volver al XI original podría reintroducir a un expulsado. El
    // fallback queda reservado a Solo Penales y resultados legacy sin snapshot.
    return !soloPenales && Array.isArray(slotsFinales)
      ? pateadoresDesdeSlots(slotsFinales)
      : pateadoresOriginales(eq);
  };
  const patA = pateadoresPartido(eqA, partido.slotsFinalesA);
  const patB = pateadoresPartido(eqB, partido.slotsFinalesB);
  if (!patA.length || !patB.length) {
    toast('No hay pateadores de campo elegibles para iniciar la tanda.', true);
    return;
  }
  const arqueroDesdeSlots = (eq, slotsFinales) => {
    const slots = !soloPenales && Array.isArray(slotsFinales) ? slotsFinales : eq.lineup?.slots;
    if (Array.isArray(slots)) {
      const slot = slotArqueroTanda(slots);
      const jugador = slot && JUGADORES_BY_ID[slot.id];
      return jugador && Number.isFinite(slot.nivel) ? { ...jugador, nivel: slot.nivel } : null;
    }
    const id = eq.lineup?.POR?.[0];
    return id ? conNivelLineup(eq)(id) : null;
  };
  const arqueroActualA = arqueroDesdeSlots(eqA, partido.slotsFinalesA);
  const arqueroActualB = arqueroDesdeSlots(eqB, partido.slotsFinalesB);
  if (!arqueroActualA || !arqueroActualB) {
    toast('No hay un arquero elegible para iniciar la tanda.', true);
    return;
  }

  // La banca del draft guarda id y categoría. Una entrada legacy como string
  // también sirve si el jugador es realmente POR. Ante datos incompletos, la
  // tanda conserva el arquero actual en lugar de inventar uno.
  const arqueroReserva = (eq, actual) => {
    const reservas = (Array.isArray(eq.lineup?.bench) ? eq.lineup.bench : []).flatMap(suplente => {
      const id = typeof suplente === 'string' ? suplente : suplente?.id;
      const jugador = id && JUGADORES_BY_ID[id];
      const categoriaValida = typeof suplente === 'string' || suplente?.categoria === 'POR';
      const nivel = jugador?.pos === 'POR' && categoriaValida ? nivelEnPuesto(jugador, 'POR') : null;
      return jugador && id !== actual.id && Number.isFinite(nivel) ? [{ ...jugador, nivel }] : [];
    });
    return reservas.length === 1 ? reservas[0] : null;
  };
  const metaA = {
    actual: arqueroActualA,
    reserva: arqueroReserva(eqA, arqueroActualA),
    playerId: eqA.esIA ? null : eqA.id.slice(2),
  };
  const metaB = {
    actual: arqueroActualB,
    reserva: arqueroReserva(eqB, arqueroActualB),
    playerId: eqB.esIA ? null : eqB.id.slice(2),
  };
  let gkA = arqueroActualA;
  let gkB = arqueroActualB;

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
  let misLados = [...((app.estado.players.find(pl => pl.id === miJugadorId())?.resultados || {})[kT] || [])];
  const susLados = () => duelo
    ? ((app.estado.players.find(pl => pl.id === rivalPid)?.resultados || {})[kT] || [])
    : [];
  const resultadoGuardado = () => Object.assign({}, ...app.estado.players.map(p => p.resultados || {}))[partido.clave];

  let accion = null;     // callback al elegir lado
  let animando = false;  // no procesar doble durante una animación
  let publicandoEleccion = false;
  let publicandoArquero = false;
  let decisionesArqueroListas = false;
  let cerrado = false;
  let guardando = false;
  let avanceTimer = null;
  let avanceEnCurso = false;

  const cancelarAvancePendiente = () => {
    if (avanceTimer) clearTimeout(avanceTimer);
    avanceTimer = null;
  };

  // si el anfitrión marcó ausente a alguno de los dos, la máquina toma la tanda:
  // cierro este duelo y dejo que el Mundial siga con el resultado automático
  const hayAusenteEnDuelo = () => {
    const aband = (app.estado.players.find(p => p.id === room.host_id)?.resultados?._abandonados) || [];
    return [partido.idA, partido.idB].some(id => aband.includes(id.slice(2)));
  };
  const resultadosDe = playerId => app.estado.players.find(p => p.id === playerId)?.resultados || {};
  const requiereDecisionArquero = meta => Boolean(meta.playerId && meta.reserva);
  const idArqueroDecidido = meta => {
    if (!requiereDecisionArquero(meta)) return meta.actual.id;
    const resultados = resultadosDe(meta.playerId);
    if (!Object.hasOwn(resultados, kArquero)) return null;
    const id = resultados[kArquero]?.goalkeeperId;
    // Un id legacy o manipulado no habilita otro jugador: conserva al titular.
    return id === meta.actual.id || id === meta.reserva.id ? id : meta.actual.id;
  };
  const arqueroElegido = meta => idArqueroDecidido(meta) === meta.reserva?.id ? meta.reserva : meta.actual;
  const decisionesArqueroCompletas = () => [metaA, metaB]
    .every(meta => !requiereDecisionArquero(meta) || idArqueroDecidido(meta) !== null);
  const actualizarArquerosTanda = () => {
    gkA = arqueroElegido(metaA);
    gkB = arqueroElegido(metaB);
  };
  const tandaHandler = () => {
    if (cerrado) return;
    if (resultadoGuardado() || hayAusenteEnDuelo()) {
      cerrar();
      pantallaTorneo(root);
      return;
    }
    if (!animando && !publicandoEleccion && !publicandoArquero) prepararTanda();
  };
  if (duelo) document.addEventListener('sala:cambio', tandaHandler);
  const cerrar = () => {
    cerrado = true;
    cancelarAvancePendiente();
    if (duelo) document.removeEventListener('sala:cambio', tandaHandler);
    div.remove();
  };

  // publica el marcador parcial para que toda la sala lo vea en vivo
  const publicarLive = () => {
    const yo = app.estado.players.find(pl => pl.id === miJugadorId());
    if (!yo) return;
    yo.resultados = { ...(yo.resultados || {}), ['_live_' + partido.clave]: { a: goles(t.A), b: goles(t.B) } };
    net.actualizarJugador(room.code, miJugadorId(), { resultados: yo.resultados }).catch(() => {});
  };

  const marcas = (arr, total) => {
    const texto = Array.from({ length: total }, (_, i) =>
      i < arr.length ? (arr[i] ? 'gol' : 'fallo') : 'pendiente').join(', ');
    return `<span class="marcas" role="img" aria-label="${esc(texto)}">${Array.from({ length: total }, (_, i) => {
      const marca = i < arr.length ? (arr[i] ? '⚽' : '❌') : '·';
      return `<span class="marca-penal ${i < arr.length ? (arr[i] ? 'marca-gol' : 'marca-fallo') : 'marca-pendiente'}" aria-hidden="true">${marca}</span>`;
    }).join('')}</span>`;
  };

  const controlesEleccion = tipo => {
    const opciones = tipo === 'tiro' ? OPCIONES_TIRO_UI : OPCIONES_ARQUERO_UI;
    return `<div class="penal-opciones penal-opciones-${tipo}" role="group" aria-label="${tipo === 'tiro' ? 'Elegir zona del remate' : 'Elegir dirección del arquero'}">${opciones.map(opcion =>
      `<button type="button" class="penal-opcion penal-opcion-${tipo} penal-opcion-${opcion.id}" data-zona-penal="${opcion.id}" aria-label="${opcion.texto}"><span class="penal-opcion-icono" aria-hidden="true">${opcion.icono}</span><span>${opcion.texto}</span></button>`).join('')}</div>`;
  };

  const narracionHTML = narracion => `<span class="tanda-msg-titulo">${esc(narracion.titulo)}</span>${narracion.detalles
    .map(detalle => `<span class="tanda-msg-detalle">${esc(detalle)}</span>`).join('')}`;

  function dibujarDecisionArquero() {
    const miMeta = soyA ? metaA : metaB;
    const decisionMia = idArqueroDecidido(miMeta);
    const esperando = duelo && !decisionesArqueroCompletas();
    const puedoDecidir = requiereDecisionArquero(miMeta) && decisionMia === null;
    const contenido = puedoDecidir
      ? `<p class="decision-arquero-pregunta">¿Te interesa cambiar a <strong>${esc(miMeta.actual.nombre)}</strong> por <strong>${esc(miMeta.reserva.nombre)}</strong> para la tanda?</p>
        <div class="tanda-botones decision-arquero-acciones" role="group" aria-label="Decisión de arquero">
          <button type="button" class="btn" data-arquero-elegido="${esc(miMeta.reserva.id)}" ${publicandoArquero ? 'disabled' : ''}>SÍ</button>
          <button type="button" class="btn" data-arquero-elegido="${esc(miMeta.actual.id)}" ${publicandoArquero ? 'disabled' : ''}>NO</button>
        </div>
        ${publicandoArquero ? '<p class="decision-arquero-espera" aria-live="polite">Guardando decisión…</p>' : ''}`
      : esperando
        ? `<p class="decision-arquero-espera" aria-live="polite">⌛ Esperando la decisión de arquero de ${esc(rival.nombre)}…</p>`
        : '';
    div.innerHTML = html`
      <div class="tanda tanda-decision-arquero">
        <p class="tanda-titulo">🧤 DECISIÓN DE ARQUERO</p>
        ${contenido}
      </div>`;
    $$('[data-arquero-elegido]', div).forEach(boton => boton.addEventListener('click', () => {
      if (!publicandoArquero) publicarDecisionArquero(boton.dataset.arqueroElegido);
    }));
  }

  async function publicarDecisionArquero(id) {
    const miMeta = soyA ? metaA : metaB;
    if (!requiereDecisionArquero(miMeta) || (id !== miMeta.actual.id && id !== miMeta.reserva.id)) return;
    const yo = app.estado.players.find(pl => pl.id === miJugadorId());
    if (!yo || publicandoArquero) return;
    const resultadosPrevios = yo.resultados || {};
    yo.resultados = { ...resultadosPrevios, [kArquero]: { goalkeeperId: id } };
    publicandoArquero = true;
    dibujarDecisionArquero();
    try {
      await net.actualizarJugador(room.code, miJugadorId(), { resultados: yo.resultados });
    } catch (e) {
      yo.resultados = resultadosPrevios;
      toast('No se pudo enviar tu decisión de arquero: ' + e.message, true);
    } finally {
      publicandoArquero = false;
    }
    prepararTanda();
  }

  function prepararTanda() {
    if (cerrado || animando || publicandoEleccion || publicandoArquero) return;
    if (resultadoGuardado() || hayAusenteEnDuelo()) return;
    if (!decisionesArqueroCompletas()) {
      decisionesArqueroListas = false;
      dibujarDecisionArquero();
      return;
    }
    actualizarArquerosTanda();
    decisionesArqueroListas = true;
    procesar();
  }

  function dibujarTanda(msg, opts = {}) {
    const mias = soyA ? t.A : t.B;
    const suyas = soyA ? t.B : t.A;
    const totalMarcas = Math.max(5, t.A.length, t.B.length);
    div.innerHTML = html`
      <div class="tanda">
        <p class="tanda-titulo">🧤 TANDA DE PENALES</p>
        ${opts.turno ? `<div class="tanda-turno ${opts.turno.mio ? 'turno-mio' : 'turno-rival'}">
          <span class="turno-rol">${opts.turno.mio ? '⚽ TU PENAL' : '🧤 ¡ATAJÁS TÚ!'}</span>
          <span class="turno-quien">${opts.turno.label}</span>
        </div>` : ''}
        <div class="tanda-marcas">
          <div class="tanda-fila"><span class="tanda-eq">${etiquetaEquipo(mio)}</span>
            <b class="tanda-score">${goles(mias)}</b>${marcas(mias, totalMarcas)}</div>
          <div class="tanda-fila"><span class="tanda-eq">${etiquetaRival}</span>
            <b class="tanda-score">${goles(suyas)}</b>${marcas(suyas, totalMarcas)}</div>
        </div>
        <p class="tanda-msg ${opts.narracion?.clase || ''} ${opts.resultado ? 'tanda-msg-resultado' : ''}" aria-live="polite">${msg}</p>
        <div class="arco-zona ${opts.eleccion ? `eligiendo-${opts.eleccion}` : 'mostrando-resultado'}">
          <div class="arco ${opts.eleccion ? 'arco-interactivo' : ''}">
            <span class="golero ${opts.golero || ''}">🧤</span>
            ${opts.eleccion ? controlesEleccion(opts.eleccion) : ''}
          </div>
          <span class="balon ${opts.balon || ''}">⚽</span>
          ${opts.verdict ? `<div class="verdict ${opts.verdictClase || ''}">${opts.verdict}</div>` : ''}
        </div>
        <div class="tanda-botones">
          ${opts.resultado ? `<button id="tanda-siguiente-penal" class="btn btn-primario btn-grande">${opts.resultadoFinal ? 'VER RESULTADO' : 'SIGUIENTE PENAL'}</button>` : ''}
          ${opts.continuar ? '<button id="tanda-continuar" class="btn btn-primario btn-grande">Continuar ▶</button>' : ''}
        </div>
      </div>`;

    $$('[data-zona-penal]', div).forEach(b => b.addEventListener('click', () => {
      const cb = accion;
      accion = null;
      $$('[data-zona-penal]', div).forEach(btn => { btn.disabled = true; });
      if (cb) cb(b.dataset.zonaPenal);
    }));
    $('#tanda-siguiente-penal', div)?.addEventListener('click', avanzarResultado);
    $('#tanda-continuar', div)?.addEventListener('click', guardar);
  }

  function avanzarResultado() {
    if (cerrado || !animando || avanceEnCurso) return;
    avanceEnCurso = true;
    cancelarAvancePendiente();
    const boton = $('#tanda-siguiente-penal', div);
    if (boton) {
      boton.disabled = true;
      boton.setAttribute('aria-busy', 'true');
    }
    animando = false;
    procesar();
  }

  function pausarTrasResultado() {
    avanceEnCurso = false;
    cancelarAvancePendiente();
    avanceTimer = setTimeout(avanzarResultado, 15000);
  }

  function resolver(pateaA, zonaTiro, zonaArquero, resultado) {
    const lista = pateaA ? t.A : t.B;
    const pateador = (pateaA ? patA : patB)[lista.length % (pateaA ? patA : patB).length];
    const arquero = pateaA ? gkB : gkA;
    lista.push(resultado.gol);
    publicarLive();
    const pateoYo = pateaA === soyA;
    const narracion = narracionPenalInteractivo(
      { ...resultado, zonaTiro, zonaArquero }, pateador.nombre, arquero.nombre,
    );
    const esPanenkaLeida = zonaTiro === 'panenka' && zonaArquero === 'centro';
    animando = true;
    dibujarTanda(narracionHTML(narracion), {
      narracion,
      resultado: true,
      resultadoFinal: Boolean(ganadorTandaInteractiva(t.A, t.B)),
      balon: `${zonaTiro} ${resultado.desenlace}${esPanenkaLeida ? ' panenka-leida' : ''}`,
      golero: `${zonaArquero} ${resultado.arqueroAdivino ? 'adivino' : 'errado'}`,
      verdict: esPanenkaLeida ? '¡TE LEYERON!' : resultado.gol ? '¡GOL!' : resultado.desenlace === 'atajada' ? '¡ATAJADA!' : '¡FALLÓ!',
      verdictClase: narracion.clase,
      turno: { mio: pateoYo, label: etiquetaEquipo(pateaA ? eqA : eqB) },
    });
    pausarTrasResultado();
  }

  const eleccionNormalizada = (valor, esTiro) => {
    const zonas = esTiro ? ZONAS_TIRO_PENAL : ZONAS_ARQUERO_PENAL;
    if (zonas.includes(valor)) return valor;
    // Compatibilidad defensiva con una tanda que hubiera empezado justo antes de
    // actualizar: el viejo tiro lateral se interpreta como remate abajo.
    if (esTiro && valor === 'izq') return 'izq-abajo';
    if (esTiro && valor === 'der') return 'der-abajo';
    return 'centro';
  };

  const resolverDeterminista = (pateaA, k, zonaTiro, zonaArquero) => {
    const pateador = (pateaA ? patA : patB)[(pateaA ? t.A : t.B).length % (pateaA ? patA : patB).length];
    const arquero = pateaA ? gkB : gkA;
    const rng = new Rng(`tanda-resultado-${room.seed}-${partido.clave}-${k}`);
    const resultado = resolverPenalConRng(
      rng, pateador.nivel, arquero.nivel, zonaTiro, zonaArquero,
    );
    resolver(pateaA, zonaTiro, zonaArquero, resultado);
  };

  function procesar() {
    if (cerrado || animando || publicandoEleccion || publicandoArquero) return;
    if (!decisionesArqueroListas) return prepararTanda();
    const completas = t.A.length === t.B.length;
    // al mejor de 5: durante los primeros 5, termina apenas la ventaja sea
    // inalcanzable. en muerte súbita (ambos con 5+), solo cuando patearon
    // parejo y hay diferencia — nunca antes de que el segundo responda su penal.
    if (ganadorTandaInteractiva(t.A, t.B)) return terminar();

    const pateaA = completas; // A patea cuando van parejos en penales ejecutados
    const k = t.A.length + t.B.length; // número de penal (global)
    const lista = pateaA ? t.A : t.B;
    const pateador = (pateaA ? patA : patB)[lista.length % (pateaA ? patA : patB).length];
    const arquero = pateaA ? gkB : gkA;
    const pateoYo = pateaA === soyA;

    const pedirEleccion = () => dibujarTanda(pateoYo
      ? `Patea ${esc(pateador.nombre)}${nv(pateador)} contra ${esc(arquero.nombre)}${nv(arquero)}. ¿Dónde le pega?`
      : `Patea ${esc(pateador.nombre)}${nv(pateador)}. ${esc(arquero.nombre)}${nv(arquero)} está bajo los tres palos. ¿Hacia dónde se lanza?`,
      { eleccion: pateoYo ? 'tiro' : 'arquero', turno: { mio: pateoYo, label: etiquetaEquipo(pateaA ? eqA : eqB) } });

    if (!duelo) {
      // La elección de la IA usa un stream separado que no incluye ni observa la
      // elección humana. Un rerender produce exactamente la misma decisión.
      accion = eleccionHumana => {
        const rolIA = pateoYo ? 'arquero' : 'pateador';
        const zonasIA = pateoYo ? ZONAS_ARQUERO_PENAL : ZONAS_TIRO_PENAL;
        const rngIA = new Rng(`tanda-ia-eleccion-${room.seed}-${partido.clave}-${k}-${rolIA}`);
        const eleccionIA = zonasIA[rngIA.int(zonasIA.length)];
        const zonaTiro = pateoYo ? eleccionHumana : eleccionIA;
        const zonaArquero = pateoYo ? eleccionIA : eleccionHumana;
        resolverDeterminista(pateaA, k, zonaTiro, zonaArquero);
      };
      pedirEleccion();
      return;
    }

    // duelo entre DTs: este penal necesita el lado de ambos
    const sus = susLados();
    if (misLados.length > k && sus.length > k) {
      // ambos eligieron: desenlace determinista, idéntico en las dos pantallas
      const zonaTiro = eleccionNormalizada(pateoYo ? misLados[k] : sus[k], true);
      const zonaArquero = eleccionNormalizada(pateoYo ? sus[k] : misLados[k], false);
      resolverDeterminista(pateaA, k, zonaTiro, zonaArquero);
      return;
    }
    if (misLados.length > k) {
      dibujarTanda(`⏳ Esperando la elección de ${esc(rival.nombre)}…`, {});
      return;
    }
    accion = async zona => {
      const ladosPrevios = misLados.slice();
      const yo = app.estado.players.find(pl => pl.id === miJugadorId());
      const resultadosPrevios = yo.resultados || {};
      misLados = [...misLados, zona];
      yo.resultados = { ...resultadosPrevios, [kT]: misLados };
      publicandoEleccion = true;
      try {
        await net.actualizarJugador(room.code, miJugadorId(), { resultados: yo.resultados });
      } catch (e) {
        // Si la publicación falla, la elección no existe para el rival: se
        // revierte también localmente y se vuelve a habilitar el mismo turno.
        misLados = ladosPrevios;
        yo.resultados = resultadosPrevios;
        toast('No se pudo enviar tu elección: ' + e.message, true);
      } finally {
        publicandoEleccion = false;
      }
      prepararTanda();
    };
    pedirEleccion();
  }

  function terminar() {
    cancelarAvancePendiente();
    const gm = goles(soyA ? t.A : t.B);
    const gr = goles(soyA ? t.B : t.A);
    dibujarTanda(gm > gr ? '🏆 ¡GANASTE LA TANDA, DT!' : '😔 Perdiste la tanda…',
      { continuar: true, verdict: `${gm} – ${gr}` });
  }

  async function guardar() {
    if (guardando) return;
    guardando = true;
    // ambos DTs escriben el mismo resultado: da igual quién llegue primero
    const yo = app.estado.players.find(pl => pl.id === miJugadorId());
    const { ['_live_' + partido.clave]: _liveFin, ...resto } = (yo.resultados || {});
    const resultados = {
      ...resto,
      [partido.clave]: { penales: { golesA: goles(t.A), golesB: goles(t.B) } },
    };
    yo.resultados = resultados; // actualización optimista para recalcular al tiro
    try {
      await net.actualizarJugador(room.code, miJugadorId(), { resultados });
      cerrar();
      pantallaTorneo(root);
    } catch (e) {
      guardando = false;
      toast('No se pudo guardar la tanda: ' + e.message, true);
    }
  }

  prepararTanda();
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

function perdiFinal(mundial, miEq) {
  const final = mundial.llaves
    .find(ronda => ronda.nombre === 'Final')?.partidos
    .find(partido => partido.idA === miEq || partido.idB === miEq);
  return Boolean(final?.ganador && final.ganador !== miEq);
}

function mostrarEliminado(root, mundial, marcar, alSeguir, { esSubcampeon = false } = {}) {
  if (document.querySelector('.overlay-elim')) return;
  marcar();
  const titulo = esSubcampeon ? 'SUBCAMPEÓN 🥈' : 'ELIMINADO';
  const texto = esSubcampeon
    ? 'Llegaste hasta la Final.<br>Esta vez la copa se escapó, DT.'
    : 'Tu combinado quedó fuera del Mundialito.<br>Se acabó el juego para ti, DT. 😔';
  const boton = esSubcampeon ? 'VER PODIO' : '📺 Verlo por TV';
  const div = document.createElement('div');
  div.className = 'overlay-elim';
  div.innerHTML = html`
    <div class="cartel-elim" role="dialog" aria-modal="true" aria-labelledby="titulo-eliminado">
      <p class="elim-titulo" id="titulo-eliminado">${titulo}</p>
      <p class="elim-texto">${texto}</p>
      <div class="elim-botones">
        <button id="elim-mirar" class="btn">${boton}</button>
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
      const esMioCampeon = campeon.id === 'h-' + miJugadorId();
      return html`
        <div class="celebracion">
          <div class="podio-final">${podioFinalHTML(m)}</div>
          ${campeon.esIA
            ? '<p class="campeon-dt">El Bot se quedó con el Mundialito. 😅</p>'
            : `<p class="campeon-dt">${esMioCampeon ? '¡ERES EL CAMPEÓN, DT! 👑' : `DT campeón: <b>${esc(campeon.nombre)}</b> 👑`}</p>`}
          ${app.grupo?.group ? html`
            <div class="finalizacion-grupo">
              <p id="estado-finalizacion-grupo" class="nota" role="status">${app.estado?.room?.status === 'finished'
                ? 'Podio guardado en el historial del grupo.'
                : 'Guardando el podio en el historial del grupo…'}</p>
              <button type="button" id="btn-reintentar-finalizacion" class="btn btn-mini" hidden>Reintentar guardado</button>
              <button type="button" id="btn-volver-grupo" class="btn btn-primario" ${app.estado?.room?.status === 'finished' ? '' : 'disabled'}>
                Volver al grupo
              </button>
            </div>` : ''}
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
