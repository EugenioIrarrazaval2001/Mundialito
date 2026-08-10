// Draft estilo 7a0: tiras el dado, sale una selección histórica de un mundial,
// eliges UN jugador de ella, y vuelves a tirar hasta completar XI y banca.
// 6 comodines en dos bolsas independientes: 3 para otra selección del mismo
// Mundial y 3 para la misma selección en otro Mundial.

import { net, miId } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, soyHost, salirDeSala } from '../main.js';
import { SQUADS, SQUADS_BY_KEY, FORMACIONES, FORMACION_SLOTS, JUGADORES_BY_ID, RESULTADO_MUNDIAL, bandera, estadoPuestoJugador, lineaDePuesto, nivelEnPuesto, puestosJugador, squadsParaModo } from '../data/squads.js';
import { lineupDesdeSlots, parseModo } from '../engine/engine.js';

// En almanaque los candidatos permanecen ocultos. Cada jugador se revela al
// colocarlo; los promedios generales se mantienen ocultos hasta enviar el equipo.
function nivelesOcultos(room, draft) {
  return parseModo(room.modo).modo === 'almanaque' && !draft.enviado;
}

// chip de estado del header: antes de empezar muestra el modo; una vez iniciado
// el draft, formación · estilo · modo (ya fijos, como en el 7a0)
function chipEstadoTexto(draft, room) {
  const m = parseModo(room.modo).modo;
  const corto = m === 'penales' ? 'SOLO PENALES' : 'SELECCIONES HISTÓRICAS';
  const emoji = m === 'penales' ? '🧤' : '📖';
  if (!draft.iniciado) return `${emoji} ${corto}`;
  const estilo = { defensivo: 'DEFENSIVO', equilibrado: 'EQUILIBRADO', ofensivo: 'OFENSIVO' }[draft.estilo] || '';
  return `${draft.formacion} · ${estilo} · ${corto}`;
}

const ESTILOS = [['defensivo', 'Defensivo'], ['equilibrado', 'Equilibrado'], ['ofensivo', 'Ofensivo']];
const ESTILOS_VALIDOS = new Set(ESTILOS.map(([valor]) => valor));
const PROGRESO_DRAFT_VERSION = 3;
const COMODINES_POR_TIPO = 3;
const CUOTAS_BANCA = Object.freeze({ POR: 1, DEF: 2, MED: 2, DEL: 2 });
const SLOTS_BANCA = Object.freeze(['POR', 'DEF', 'DEF', 'MED', 'MED', 'DEL', 'DEL']);
const TOTAL_BANCA = SLOTS_BANCA.length;
const FILAS_CANCHA = [
  ['EI', 'DC', 'ED'],
  ['MI', 'MCO', 'MD'],
  ['MC', 'MCD'],
  ['LI', 'DFC', 'LD'],
  ['POR'],
];

function claveProgresoDraft(room, playerId) {
  if (!room?.code || room.seed == null || !playerId) return null;
  return `mundialito-draft-${room.code}-${room.seed}-${playerId}`;
}

function limpiarProgresoDraft(draft) {
  if (!draft?.storageKey) return;
  try { sessionStorage.removeItem(draft.storageKey); } catch { /* almacenamiento no disponible */ }
}

function guardarProgresoDraft(draft) {
  if (!draft?.storageKey) return;
  if (draft.enviado) { limpiarProgresoDraft(draft); return; }
  const progreso = {
    version: PROGRESO_DRAFT_VERSION,
    formacion: draft.formacion,
    estilo: draft.estilo,
    picks: draft.picks.map(p => ({
      id: p.id,
      puesto: p.puesto,
      linea: p.linea,
      nivel: p.nivel,
      slotIndex: p.slotIndex,
    })),
    bench: draft.bench.map(b => ({ id: b.id, categoria: b.categoria })),
    comodinesOtraSeleccion: draft.comodinesOtraSeleccion,
    comodinesOtroMundial: draft.comodinesOtroMundial,
    oferta: draft.oferta?.key ?? null,
    colocando: draft.colocando
      ? { id: draft.colocando.id, puesto: draft.colocando.puesto }
      : null,
    ofrecidas: [...draft.ofrecidas],
    iniciado: draft.iniciado,
    // girando es deliberadamente transitorio: al recargar se muestra la oferta ya decidida.
  };
  try { sessionStorage.setItem(draft.storageKey, JSON.stringify(progreso)); } catch { /* sin cuota */ }
}

function restaurarProgresoDraft(base, room) {
  if (!base.storageKey) return null;
  let raw;
  try {
    const guardado = sessionStorage.getItem(base.storageKey);
    if (!guardado) return null;
    raw = JSON.parse(guardado);
  } catch {
    limpiarProgresoDraft(base);
    return null;
  }

  // La v1 tenía una sola bolsa compartida. Conservamos sus picks y estrenamos
  // las dos bolsas nuevas completas, igual que en la migración previa.
  if (raw?.version === 1 && Number.isInteger(raw.comodines) &&
      raw.comodines >= 0 && raw.comodines <= 3) {
    raw = {
      ...raw,
      version: PROGRESO_DRAFT_VERSION,
      bench: [],
      comodinesOtraSeleccion: COMODINES_POR_TIPO,
      comodinesOtroMundial: COMODINES_POR_TIPO,
    };
  } else if (raw?.version === 2) {
    // La v2 terminaba al completar el XI. Un progreso parcial continúa ahora
    // con exactamente los mismos picks y la banca vacía.
    raw = { ...raw, version: PROGRESO_DRAFT_VERSION, bench: [] };
  }

  const invalido = () => {
    limpiarProgresoDraft(base);
    return null;
  };
  if (!raw || raw.version !== PROGRESO_DRAFT_VERSION ||
      !Object.hasOwn(FORMACION_SLOTS, raw.formacion) ||
      !ESTILOS_VALIDOS.has(raw.estilo) ||
      !Array.isArray(raw.picks) || !Array.isArray(raw.bench) || !Array.isArray(raw.ofrecidas) ||
      !Number.isInteger(raw.comodinesOtraSeleccion) ||
      raw.comodinesOtraSeleccion < 0 || raw.comodinesOtraSeleccion > COMODINES_POR_TIPO ||
      !Number.isInteger(raw.comodinesOtroMundial) ||
      raw.comodinesOtroMundial < 0 || raw.comodinesOtroMundial > COMODINES_POR_TIPO ||
      typeof raw.iniciado !== 'boolean') return invalido();

  const pool = squadsParaModo(parseModo(room.modo).modo, room.enabled_squads);
  const poolKeys = new Set(pool.map(s => s.key));
  const slots = FORMACION_SLOTS[raw.formacion];
  const slotsUsados = new Set();
  const idsUsados = new Set();
  const personasUsadas = new Set();
  const picks = [];
  if (raw.picks.length > slots.length) return invalido();

  for (const pick of raw.picks) {
    if (!pick || typeof pick.id !== 'string' ||
        !Number.isInteger(pick.slotIndex) || pick.slotIndex < 0 || pick.slotIndex >= slots.length ||
        slotsUsados.has(pick.slotIndex) || idsUsados.has(pick.id)) return invalido();
    const jugador = JUGADORES_BY_ID[pick.id];
    const puesto = slots[pick.slotIndex];
    const persona = jugador ? `${jugador.squad.pais}|${jugador.nombre}` : null;
    if (!jugador || !poolKeys.has(jugador.squad.key) || pick.puesto !== puesto ||
        nivelEnPuesto(jugador, puesto) === null || personasUsadas.has(persona)) return invalido();
    slotsUsados.add(pick.slotIndex);
    idsUsados.add(pick.id);
    personasUsadas.add(persona);
    picks.push({
      id: jugador.id,
      puesto,
      linea: lineaDePuesto(puesto),
      nivel: nivelEnPuesto(jugador, puesto),
      slotIndex: pick.slotIndex,
    });
  }

  const bench = [];
  const conteoBanca = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  if (raw.bench.length > TOTAL_BANCA || (raw.bench.length && picks.length !== slots.length)) {
    return invalido();
  }
  for (const suplente of raw.bench) {
    if (!suplente || typeof suplente.id !== 'string' ||
        !Object.hasOwn(CUOTAS_BANCA, suplente.categoria) ||
        idsUsados.has(suplente.id)) return invalido();
    const jugador = JUGADORES_BY_ID[suplente.id];
    const persona = jugador ? `${jugador.squad.pais}|${jugador.nombre}` : null;
    if (!jugador || !poolKeys.has(jugador.squad.key) ||
        jugador.pos !== suplente.categoria || personasUsadas.has(persona) ||
        conteoBanca[suplente.categoria] >= CUOTAS_BANCA[suplente.categoria]) return invalido();
    idsUsados.add(jugador.id);
    personasUsadas.add(persona);
    conteoBanca[suplente.categoria]++;
    bench.push({ id: jugador.id, categoria: jugador.pos });
  }

  const ofrecidas = new Set(raw.ofrecidas);
  if (ofrecidas.size !== raw.ofrecidas.length ||
      [...ofrecidas].some(key => typeof key !== 'string' || !poolKeys.has(key))) return invalido();
  const oferta = raw.oferta === null ? null : SQUADS_BY_KEY[raw.oferta];
  if (raw.oferta !== null && (typeof raw.oferta !== 'string' || !oferta ||
      !poolKeys.has(raw.oferta) || !ofrecidas.has(raw.oferta))) return invalido();
  if (!raw.iniciado && (picks.length || bench.length || oferta || ofrecidas.size || raw.colocando)) return invalido();

  const restaurado = {
    ...base,
    formacion: raw.formacion,
    estilo: raw.estilo,
    picks,
    bench,
    comodinesOtraSeleccion: raw.comodinesOtraSeleccion,
    comodinesOtroMundial: raw.comodinesOtroMundial,
    oferta,
    colocando: null,
    ofrecidas,
    iniciado: raw.iniciado,
    girando: false,
  };
  if (raw.colocando !== null) {
    if (!raw.colocando || typeof raw.colocando.id !== 'string' ||
        typeof raw.colocando.puesto !== 'string' || !oferta || picks.length === slots.length) return invalido();
    const jugador = JUGADORES_BY_ID[raw.colocando.id];
    const persona = jugador ? `${jugador.squad.pais}|${jugador.nombre}` : null;
    const opciones = jugador && jugador.squad.key === oferta.key &&
      !idsUsados.has(jugador.id) && !personasUsadas.has(persona)
      ? puestosDisponibles(restaurado, jugador)
      : [];
    if (!opciones.some(o => o.puesto === raw.colocando.puesto)) return invalido();
    restaurado.colocando = { id: jugador.id, puesto: raw.colocando.puesto };
  }
  return restaurado;
}

export function pantallaDraft(root) {
  const yo = app.estado.players.find(p => p.id === miId());
  const { room } = app.estado;

  const picksIniciales = slotsDesdeLineup(yo.formacion || '4-3-3', yo.lineup);
  const benchInicial = benchDesdeLineup(yo.lineup, picksIniciales);
  const tieneLineupServidor = Boolean(yo.lineup);
  const base = {
    formacion: yo.formacion || '4-3-3',
    estilo: yo.lineup?.estilo || 'equilibrado',
    picks: picksIniciales,
    bench: benchInicial,
    comodinesOtraSeleccion: COMODINES_POR_TIPO,
    comodinesOtroMundial: COMODINES_POR_TIPO,
    oferta: null,         // plantel sorteado este turno (null = hay que tirar)
    colocando: null,      // { id, puesto } elegido, esperando click en la cancha
    ofrecidas: new Set(), // keys ya ofrecidas, para no repetir
    enviado: yo.ready,
    // formación y estilo se eligen al principio; al empezar a armar quedan fijos
    // y el bloque de configuración desaparece para darle espacio a la lista
    iniciado: picksIniciales.length > 0 || benchInicial.length > 0 || yo.ready,
    enviando: false,
    storageKey: claveProgresoDraft(room, yo.id),
  };
  if (yo.ready || tieneLineupServidor) limpiarProgresoDraft(base);
  const draft = (!yo.ready && !tieneLineupServidor && restaurarProgresoDraft(base, room)) || base;

  dibujarTodo(root, draft);

  const handler = () => actualizarRivales(root);
  document.addEventListener('sala:cambio', handler);
  app.limpiezaPantalla = () => document.removeEventListener('sala:cambio', handler);
}

// ---------- lógica ----------

function slotsFormacion(draft) { return FORMACION_SLOTS[draft.formacion] || FORMACION_SLOTS['4-3-3']; }
function totalTitulares(draft) { return draft.picks.length; }
function totalBanca(draft) { return draft.bench.length; }
function totalElegidos(draft) { return totalTitulares(draft) + totalBanca(draft); }
function onceCompleto(draft) { return totalTitulares(draft) === 11; }

function conteoBanca(draft) {
  const conteo = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  for (const suplente of draft.bench) {
    if (Object.hasOwn(conteo, suplente.categoria)) conteo[suplente.categoria]++;
  }
  return conteo;
}

function bancaCompleta(draft) {
  if (totalBanca(draft) !== TOTAL_BANCA) return false;
  const conteo = conteoBanca(draft);
  return Object.entries(CUOTAS_BANCA).every(([categoria, cuota]) => conteo[categoria] === cuota);
}

function completo(draft) {
  if (!onceCompleto(draft) || !bancaCompleta(draft)) return false;
  const slots = slotsFormacion(draft);
  const slotsUsados = new Set();
  const idsUsados = new Set();
  const personasUsadas = new Set();
  const agregarPersona = jugador => {
    const persona = `${jugador.squad.pais}|${jugador.nombre}`;
    if (idsUsados.has(jugador.id) || personasUsadas.has(persona)) return false;
    idsUsados.add(jugador.id);
    personasUsadas.add(persona);
    return true;
  };
  for (const pick of draft.picks) {
    const jugador = JUGADORES_BY_ID[pick.id];
    if (!jugador || !Number.isInteger(pick.slotIndex) ||
        slotsUsados.has(pick.slotIndex) || slots[pick.slotIndex] !== pick.puesto ||
        nivelEnPuesto(jugador, pick.puesto) !== pick.nivel || !agregarPersona(jugador)) return false;
    slotsUsados.add(pick.slotIndex);
  }
  for (const suplente of draft.bench) {
    const jugador = JUGADORES_BY_ID[suplente.id];
    if (!jugador || suplente.categoria !== jugador.pos || !agregarPersona(jugador)) return false;
  }
  return true;
}

function slotsDesdeLineup(formacion, lineup) {
  if (!lineup) return [];
  if (lineup.slots) return lineup.slots.map((s, i) => ({ ...s, slotIndex: s.slotIndex ?? i }));
  const slots = FORMACION_SLOTS[formacion] || FORMACION_SLOTS['4-3-3'];
  const usadosPorLinea = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  return slots.flatMap((puesto, slotIndex) => {
    const linea = lineaDePuesto(puesto);
    const id = lineup[linea]?.[usadosPorLinea[linea]++];
    if (!id) return [];
    const j = JUGADORES_BY_ID[id];
    return [{ puesto, linea, id, nivel: nivelEnPuesto(j, puesto) ?? j.nivel, slotIndex }];
  });
}

function benchDesdeLineup(lineup, picks = []) {
  if (!Array.isArray(lineup?.bench)) return [];
  if (lineup.bench.length > TOTAL_BANCA || (lineup.bench.length && picks.length !== 11)) return [];
  const ids = new Set(picks.map(p => p.id));
  const personas = new Set(picks.map(p => {
    const jugador = JUGADORES_BY_ID[p.id];
    return jugador ? `${jugador.squad.pais}|${jugador.nombre}` : null;
  }).filter(Boolean));
  const conteo = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  const bench = [];
  for (const suplente of lineup.bench) {
    const jugador = suplente && typeof suplente.id === 'string'
      ? JUGADORES_BY_ID[suplente.id]
      : null;
    const persona = jugador ? `${jugador.squad.pais}|${jugador.nombre}` : null;
    if (!jugador || suplente.categoria !== jugador.pos ||
        !Object.hasOwn(CUOTAS_BANCA, suplente.categoria) ||
        ids.has(jugador.id) || personas.has(persona) ||
        conteo[suplente.categoria] >= CUOTAS_BANCA[suplente.categoria]) return [];
    ids.add(jugador.id);
    personas.add(persona);
    conteo[suplente.categoria]++;
    bench.push({ id: jugador.id, categoria: jugador.pos });
  }
  return bench;
}

function idsElegidos(draft) {
  return new Set([
    ...draft.picks.map(p => p.id),
    ...draft.bench.map(b => b.id),
  ]);
}

function puestosDisponibles(draft, jugador) {
  const usados = new Set(draft.picks.map(p => p.slotIndex));
  return slotsFormacion(draft)
    .map((puesto, i) => ({ puesto, i }))
    .filter(({ puesto, i }) => !usados.has(i) && nivelEnPuesto(jugador, puesto) !== null);
}

function cupoBancaDisponible(draft, jugador) {
  if (!onceCompleto(draft) || !Object.hasOwn(CUOTAS_BANCA, jugador.pos)) return false;
  return conteoBanca(draft)[jugador.pos] < CUOTAS_BANCA[jugador.pos];
}

function jugadorColocando(draft) {
  return draft.colocando ? JUGADORES_BY_ID[draft.colocando.id] : null;
}

function elegibles(draft, squad) {
  const ya = idsElegidos(draft);
  // misma persona en distintos mundiales: no se puede tener 2 Messis
  const personas = new Set([...ya].map(id => {
    const j = JUGADORES_BY_ID[id];
    return j ? j.squad.pais + '|' + j.nombre : null;
  }).filter(Boolean));
  const eligeBanca = onceCompleto(draft);
  return new Set(squad.jugadores
    .filter(j => !ya.has(j.id)
      && !personas.has(squad.pais + '|' + j.nombre)
      && (eligeBanca ? cupoBancaDisponible(draft, j) : puestosDisponibles(draft, j).length))
    .map(j => j.id));
}

// pool de selecciones del modo actual (principal ampliado o históricas en penales)
function poolSquads() {
  const { room } = app.estado;
  return squadsParaModo(parseModo(room.modo).modo, room.enabled_squads);
}

function sortearOferta(draft, candidatas = null) {
  let pool = (candidatas ?? poolSquads()).filter(s => !draft.ofrecidas.has(s.key));
  if (!pool.length) pool = candidatas ?? poolSquads();
  const s = pool[Math.floor(Math.random() * pool.length)];
  draft.oferta = s;
  draft.ofrecidas.add(s.key);
}

function mismoMundial(draft) {
  return poolSquads().filter(s => s.anio === draft.oferta.anio && s.key !== draft.oferta.key);
}
function mismaSeleccion(draft) {
  return poolSquads().filter(s => s.pais === draft.oferta.pais && s.key !== draft.oferta.key);
}

// efecto máquina tragamonedas: gira entre selecciones antes de revelar la sorteada
function girarYSortear(root, draft, candidatas = null) {
  if (draft.girando) return;
  // Una nueva oferta invalida cualquier jugador marcado de la oferta anterior.
  draft.colocando = null;
  draft.preservarScrollLista = false;
  sortearOferta(draft, candidatas); // el resultado ya está decidido
  const elegida = draft.oferta;
  const pool = (candidatas && candidatas.length ? candidatas : poolSquads());
  draft.girando = true;
  dibujarEstado(root, draft);

  let tick = 0, delay = 50;
  const TICKS = 9;
  const paso = () => {
    tick++;
    const s = tick >= TICKS ? elegida : pool[Math.floor(Math.random() * pool.length)];
    const el = $('#ruleta', root);
    if (!el) { draft.girando = false; return; } // se fue de la pantalla
    el.innerHTML = html`
      <span class="salio-label">${tick >= TICKS ? 'SALIÓ' : 'SORTEANDO…'}</span>
      <span class="salio-pais">${bandera(s, 21)} ${esc(s.pais)}</span>
      <span class="salio-mundial">Mundial ${s.anio}</span>`;
    if (tick < TICKS) {
      delay *= 1.18; // se va frenando como ruleta
      setTimeout(paso, delay);
    } else {
      el.classList.add('ruleta-final');
      setTimeout(() => { draft.girando = false; dibujarEstado(root, draft); }, 400);
    }
  };
  paso();
}

function promSlots(slots) {
  return slots.length ? Math.round(slots.reduce((a, s) => a + s.nivel, 0) / slots.length) : null;
}

function resumenPuestos(jugador, almanaque = false) {
  const puestos = puestosJugador(jugador);
  const max = Math.max(...puestos.map(p => p.nivel));
  const min = Math.min(...puestos.map(p => p.nivel));
  return {
    puestos: puestos.map(p => {
      const delta = p.nivel - min;
      return `${p.puesto}${delta > 0 && !almanaque ? ` <small>+${delta}</small>` : ''}`;
    }).join('/'),
    nivel: almanaque ? '?' : max,
    min,
  };
}

function agregarPick(draft, jugador, puesto, slotIndex) {
  const nivel = nivelEnPuesto(jugador, puesto);
  if (nivel === null) throw new Error(`Puesto no permitido: ${puesto}`);
  const pick = {
    puesto,
    linea: lineaDePuesto(puesto),
    id: jugador.id,
    nivel,
    slotIndex,
  };
  draft.picks.push(pick);
  draft.colocando = null;
  return pick;
}

function agregarBanca(draft, jugador) {
  if (!cupoBancaDisponible(draft, jugador)) {
    throw new Error(`Cupo de banca no disponible: ${jugador.pos}`);
  }
  const elegidos = idsElegidos(draft);
  const persona = `${jugador.squad.pais}|${jugador.nombre}`;
  const personas = new Set([...elegidos].map(id => {
    const elegido = JUGADORES_BY_ID[id];
    return elegido ? `${elegido.squad.pais}|${elegido.nombre}` : null;
  }).filter(Boolean));
  if (elegidos.has(jugador.id) || personas.has(persona)) {
    throw new Error(`Jugador repetido: ${jugador.nombre}`);
  }
  const suplente = { id: jugador.id, categoria: jugador.pos };
  draft.bench.push(suplente);
  draft.colocando = null;
  return suplente;
}

// ---------- UI ----------

function dibujarTodo(root, draft) {
  const { room } = app.estado;

  render(root, html`
    <div class="draft">
      <header class="cabecera-sala">
        <button id="btn-salir-draft" class="btn btn-mini" ${draft.enviando ? 'disabled' : ''}>← Salir</button>
        <div class="ticket"><span class="ticket-label">SALA</span>
          <span class="ticket-codigo">${esc(room.code)}</span></div>
        <div class="sorteo-resultado">
          <span class="sorteo-label">ARMA TU COMBINADO HISTÓRICO</span>
          <span class="sorteo-equipo">
            Elección <span id="turno-num">${Math.min(totalElegidos(draft) + 1, 18)}</span>/18 ·
            XI <span id="xi-num">${totalTitulares(draft)}</span>/11 ·
            BANCA <span id="banca-num">${totalBanca(draft)}</span>/7
          </span>
        </div>
        <span class="chip-modo" id="chip-estado">${chipEstadoTexto(draft, room)}</span>
      </header>

      <div class="draft7">
        <section class="panel-izq" id="panel-izq"></section>
        <section class="cancha7" id="cancha7"></section>
        <aside class="panel-box">
          <div id="boxscore"></div>
          <div id="rivales" class="rivales"></div>
          <div id="zona-host"></div>
        </aside>
      </div>
    </div>
  `);

  $('#btn-salir-draft', root).addEventListener('click', () => {
    if (draft.enviando) return;
    if (totalElegidos(draft) && !confirm(
      'Si sales, pierdes el equipo que llevas armado y vuelves al menú principal. ¿Seguro?')) return;
    limpiarProgresoDraft(draft);
    salirDeSala();
  });

  dibujarEstado(root, draft);
  actualizarRivales(root);
}

function dibujarEstado(root, draft) {
  guardarProgresoDraft(draft);
  const salir = $('#btn-salir-draft', root);
  if (salir) salir.disabled = draft.enviando;
  dibujarPanelIzq(root, draft);
  dibujarCancha(root, draft);
  dibujarBox(root, draft);
  const turno = $('#turno-num', root);
  if (turno) turno.textContent = Math.min(totalElegidos(draft) + 1, 18);
  const xi = $('#xi-num', root);
  if (xi) xi.textContent = totalTitulares(draft);
  const banca = $('#banca-num', root);
  if (banca) banca.textContent = totalBanca(draft);
  const chip = $('#chip-estado', root);
  if (chip) chip.textContent = chipEstadoTexto(draft, app.estado.room);
}

function dibujarPanelIzq(root, draft) {
  const { room } = app.estado;
  const almanaque = nivelesOcultos(room, draft);
  const eligeBanca = onceCompleto(draft);
  const cuotasBanca = conteoBanca(draft);
  const textoCuotasBanca = Object.entries(CUOTAS_BANCA)
    .map(([categoria, cuota]) => `${categoria} ${cuotasBanca[categoria]}/${cuota}`)
    .join(' · ');
  const zona = $('#panel-izq', root);
  const scrollLista = $('.lista-elegir', zona)?.scrollTop ?? 0;
  // --- configuración inicial: formación y estilo (solo durante el setup) ---
  const config = html`
    <div class="config-bloque">
      <h4 class="titulo-pos">FORMACIÓN</h4>
      <div class="grilla-form">
        ${Object.keys(FORMACIONES).map(f => html`
          <button class="btn-form ${f === draft.formacion ? 'activo' : ''}" data-form="${f}">${f}</button>`).join('')}
      </div>
      <h4 class="titulo-pos">ESTILO</h4>
      <div class="grilla-form">
        ${ESTILOS.map(([v, n]) => html`
          <button class="btn-form ${v === draft.estilo ? 'activo' : ''}" data-estilo="${v}">${n}</button>`).join('')}
      </div>
    </div>`;

  // --- zona principal del panel ---
  let sorteo;
  if (draft.enviado) {
    sorteo = '<p class="nota centrada listo-check">✓ Equipo enviado.<br>Espera a los demás DTs.</p>';
  } else if (completo(draft)) {
    sorteo = html`
      <div class="caja-tirar"><p>Equipo completo, DT.<br>XI 11/11 · BANCA 7/7</p></div>
      <button id="btn-listo" class="btn-tirar" ${draft.enviando ? 'disabled aria-busy="true"' : ''}>
        ${draft.enviando ? 'ENVIANDO MI EQUIPO…' : '✓ ENVIAR MI EQUIPO'}
      </button>`;
  } else if (draft.girando) {
    sorteo = '<div class="salio ruleta" id="ruleta"><span class="salio-label">SORTEANDO…</span></div>';
  } else if (!draft.iniciado) {
    // setup: elige formación y estilo; al empezar a armar quedan fijos y este bloque se va
    sorteo = config + html`
      <div class="caja-tirar"><p>Elige tu <b>formación</b> y tu <b>estilo</b>.<br>
        Al empezar a armar quedan fijos.</p></div>
      <button id="btn-tirar" class="btn-tirar">🎲 EMPEZAR A ARMAR</button>`;
  } else if (!draft.oferta) {
    sorteo = eligeBanca
      ? html`
        <h4 class="titulo-pos">ELIGE TU BANCA</h4>
        <p class="nota centrada">${textoCuotasBanca}</p>
        <div class="caja-tirar"><p>Tu XI está completo.<br>Tira para elegir un suplente.</p></div>
        <button id="btn-tirar" class="btn-tirar">TIRAR 🎲</button>`
      : html`
        <div class="caja-tirar"><p>Tira para sortear una<br>selección y un Mundial</p></div>
        <button id="btn-tirar" class="btn-tirar">TIRAR 🎲</button>`;
  } else {
    const s = draft.oferta;
    const resultadoMundial = RESULTADO_MUNDIAL[s.key];
    const sel = elegibles(draft, s);
    const candM = mismoMundial(draft);
    const candP = mismaSeleccion(draft);
    const comodinesRestantes = draft.comodinesOtraSeleccion + draft.comodinesOtroMundial;
    sorteo = html`
      <div class="salio">
        <span class="salio-label">SALIÓ</span>
        <span class="salio-pais">${bandera(s, 21)} ${esc(s.pais)}</span>
        <span class="salio-mundial">Mundial ${s.anio}</span>
        ${resultadoMundial
          ? `<span class="salio-resultado">${esc(resultadoMundial)}</span>`
          : ''}
      </div>
      <div class="resorteo">
        <span class="resorteo-titulo">¿NO TE GUSTÓ? RE-SORTEA · ${comodinesRestantes} COMODINES RESTANTES</span>
        <div class="resorteo-botones">
          <button id="cmd-mundial" class="btn btn-mini"
            ${draft.comodinesOtraSeleccion > 0 && candM.length ? '' : 'disabled'}>
            ↺ OTRA SELECCIÓN · ${draft.comodinesOtraSeleccion}/${COMODINES_POR_TIPO}</button>
          <button id="cmd-pais" class="btn btn-mini"
            ${draft.comodinesOtroMundial > 0 && candP.length ? '' : 'disabled'}>
            ↺ OTRO MUNDIAL · ${draft.comodinesOtroMundial}/${COMODINES_POR_TIPO}</button>
        </div>
      </div>
      <h4 class="titulo-pos">${eligeBanca ? 'ELIGE TU BANCA' : 'ELIGE UN JUGADOR'}</h4>
      ${eligeBanca ? `<p class="nota centrada">${textoCuotasBanca}</p>` : ''}
      ${!eligeBanca && draft.colocando ? html`
        <p class="nota jugador-seleccionado">
          Seleccionado: <b>${esc(jugadorColocando(draft).nombre)}</b>.
          Elige una posición verde o naranja, o cambia de jugador en la lista.
        </p>` : ''}
      <div class="lista-elegir">
        ${s.jugadores.map(j => {
          const resumen = resumenPuestos(j, almanaque);
          return html`<button class="fila-jugador ${draft.colocando?.id === j.id ? 'seleccionado' : ''}" data-id="${j.id}" ${sel.has(j.id) ? '' : 'disabled'}>
            <span class="fj-nombre">${esc(j.nombre)}</span>
            <span class="fj-pos">${eligeBanca ? `${j.pos} · ` : ''}${resumen.puestos}</span>
            <span class="fj-nivel">${resumen.nivel}</span>
          </button>`;
        }).join('')}
      </div>
      ${sel.size ? '' : html`
        <button id="cmd-pasar" class="btn btn-mini btn-primario pasar-btn">
          ⏭ Sin jugadores elegibles — pasar gratis</button>`}`;
  }

  zona.innerHTML = sorteo;
  const nuevaLista = $('.lista-elegir', zona);
  if (nuevaLista) nuevaLista.scrollTop = draft.preservarScrollLista ? scrollLista : 0;
  if (nuevaLista && draft.preservarScrollLista && draft.colocando?.id) {
    const fila = $$('.fila-jugador', nuevaLista).find(f => f.dataset.id === draft.colocando.id);
    if (fila) {
      const arriba = fila.offsetTop;
      const abajo = arriba + fila.offsetHeight;
      if (arriba < nuevaLista.scrollTop) nuevaLista.scrollTop = arriba;
      else if (abajo > nuevaLista.scrollTop + nuevaLista.clientHeight) {
        nuevaLista.scrollTop = abajo - nuevaLista.clientHeight;
      }
    }
  }
  draft.preservarScrollLista = false;

  // --- listeners ---
  $$('.btn-form[data-form]', zona).forEach(b => b.addEventListener('click', () => {
    draft.formacion = b.dataset.form;
    dibujarEstado(root, draft);
  }));
  $$('.btn-form[data-estilo]', zona).forEach(b => b.addEventListener('click', () => {
    draft.estilo = b.dataset.estilo;
    dibujarEstado(root, draft);
  }));

  $('#btn-tirar', zona)?.addEventListener('click', () => {
    draft.iniciado = true; // a partir de aquí, formación y estilo quedan fijos
    girarYSortear(root, draft);
  });

  $$('.fila-jugador:not(:disabled)', zona).forEach(b => b.addEventListener('click', () => {
    const j = JUGADORES_BY_ID[b.dataset.id];
    if (eligeBanca) {
      agregarBanca(draft, j);
      draft.oferta = null;
      draft.preservarScrollLista = false;
      dibujarEstado(root, draft);
      const detalleNivel = parseModo(room.modo).modo === 'almanaque' ? '' : ` · media ${j.nivel}`;
      toast(`Has elegido para la banca a ${j.nombre} · ${j.pos} · ${j.squad.pais} ${j.squad.anio}${detalleNivel}`);
      return;
    }
    const opciones = puestosDisponibles(draft, j);
    draft.colocando = { id: j.id, puesto: opciones[0].puesto };
    draft.preservarScrollLista = true;
    dibujarEstado(root, draft);
  }));

  $('#btn-cancelar-pos', zona)?.addEventListener('click', () => {
    draft.colocando = null;
    draft.preservarScrollLista = true;
    dibujarEstado(root, draft);
  });

  $('#cmd-mundial', zona)?.addEventListener('click', () => {
    const candidatas = mismoMundial(draft);
    if (draft.girando || draft.comodinesOtraSeleccion <= 0 || !candidatas.length) return;
    draft.comodinesOtraSeleccion--;
    girarYSortear(root, draft, candidatas);
  });
  $('#cmd-pais', zona)?.addEventListener('click', () => {
    const candidatas = mismaSeleccion(draft);
    if (draft.girando || draft.comodinesOtroMundial <= 0 || !candidatas.length) return;
    draft.comodinesOtroMundial--;
    girarYSortear(root, draft, candidatas);
  });
  $('#cmd-pasar', zona)?.addEventListener('click', () => {
    girarYSortear(root, draft);
  });

  $('#btn-listo', zona)?.addEventListener('click', async () => {
    if (draft.enviando || draft.enviado || !completo(draft)) return;
    const { room } = app.estado;
    draft.enviando = true;
    dibujarEstado(root, draft);
    try {
      await net.actualizarJugador(room.code, miId(), {
        formacion: draft.formacion,
        lineup: lineupDesdeSlots(draft.picks, draft.estilo, draft.bench),
        ready: true,
      });
      draft.enviado = true;
      limpiarProgresoDraft(draft);
    } catch (e) {
      toast('No se pudo enviar tu equipo: ' + e.message, true);
    } finally {
      draft.enviando = false;
      dibujarEstado(root, draft);
    }
  });
}

function dibujarCancha(root, draft) {
  const slots = slotsFormacion(draft).map((puesto, i) => ({ puesto, i }));
  const colocando = jugadorColocando(draft);
  const pickEn = i => draft.picks.find(p => p.slotIndex === i);

  const filas = FILAS_CANCHA.map(puestosFila => {
    const slotsFila = slots
      .filter(s => puestosFila.includes(s.puesto))
      .map(({ puesto, i }) => {
        const pick = pickEn(i);
        if (pick) {
          const j = JUGADORES_BY_ID[pick.id];
          return html`
            <button class="slot lleno" disabled title="${esc(j.squad.pais)} ${j.squad.anio}">
              <span class="slot-circulo">${pick.nivel}</span>
              <span class="slot-puesto">${puesto}</span>
              <span class="slot-nombre">${bandera(j.squad, 12)} ${esc(j.nombre)}</span>
            </button>`;
        }
        const estado = colocando ? estadoPuestoJugador(colocando, puesto) : null;
        const puede = Boolean(estado?.permitido);
        const claseEstado = estado ? `slot-${estado.tipo}` : '';
        const penalizacion = estado?.tipo === 'adaptado' ? estado.penalizacion : null;
        const descripcion = estado?.tipo === 'natural'
          ? `${puesto}: posición natural`
          : estado?.tipo === 'adaptado'
            ? `${puesto}: adaptado ${penalizacion}`
            : estado?.tipo === 'imposible'
              ? `${puesto}: posición no permitida`
              : puesto;
        return html`
          <button class="slot ${puede ? 'slot-disponible' : ''} ${claseEstado}"
            data-slot="${i}" aria-label="${esc(descripcion)}" ${puede ? '' : 'disabled'}>
            <span class="slot-circulo vacio">
              <span class="slot-pos-label">${puesto}</span>
              ${penalizacion !== null ? `<small class="slot-penalizacion">${penalizacion}</small>` : ''}
            </span>
          </button>`;
      });
    return `<div class="fila-cancha7">${slotsFila.join('')}</div>`;
  }).join('');

  $('#cancha7', root).innerHTML = html`<div class="pasto7">${filas}</div>`;

  $$('.slot-disponible', root).forEach(b => b.addEventListener('click', () => {
    const j = jugadorColocando(draft);
    const puesto = slotsFormacion(draft)[Number(b.dataset.slot)];
    const pick = agregarPick(draft, j, puesto, Number(b.dataset.slot));
    draft.oferta = null;
    dibujarEstado(root, draft);
    toast(`Has elegido a ${j.nombre} · ${puesto} · ${j.squad.pais} ${j.squad.anio} · media ${pick.nivel}`);
  }));
}

function dibujarBox(root, draft) {
  const { room } = app.estado;
  const almanaque = nivelesOcultos(room, draft); // los promedios se revelan al enviar el equipo
  const ocultarNivelBanca = parseModo(room.modo).modo === 'almanaque';

  const ataque = promSlots(draft.picks.filter(p => ['MED', 'DEL'].includes(p.linea)));
  const defensa = promSlots(draft.picks.filter(p => ['POR', 'DEF'].includes(p.linea)));
  const v = x => almanaque ? '?' : (x ?? '—');

  const filas = slotsFormacion(draft).map((puesto, i) => {
      const pick = draft.picks.find(p => p.slotIndex === i);
      const j = pick ? JUGADORES_BY_ID[pick.id] : null;
      return html`
        <div class="box-fila ${j ? 'con-jugador' : ''}">
          <span class="box-pos">${puesto}</span>
          <span class="box-nombre">${j
            ? `${bandera(j.squad, 12)} ${esc(j.nombre)} <i class="ficha-anio">${j.squad.anio}</i>`
            : '<span class="box-vacio">———</span>'}</span>
          <span class="box-nivel">${j ? pick.nivel : ''}</span>
        </div>`;
    }).join('');

  const bancaPorCategoria = Object.fromEntries(
    Object.keys(CUOTAS_BANCA).map(categoria => [
      categoria,
      draft.bench.filter(b => b.categoria === categoria),
    ])
  );
  const indiceCategoria = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  const filasBanca = SLOTS_BANCA.map(categoria => {
    const suplente = bancaPorCategoria[categoria][indiceCategoria[categoria]++];
    const jugador = suplente ? JUGADORES_BY_ID[suplente.id] : null;
    return html`
      <div class="box-fila ${jugador ? 'con-jugador' : ''}">
        <span class="box-pos">${categoria}</span>
        <span class="box-nombre">${jugador
          ? `${bandera(jugador.squad, 12)} ${esc(jugador.nombre)} <i class="ficha-anio">${jugador.squad.anio}</i>`
          : '<span class="box-vacio">———</span>'}</span>
        <span class="box-nivel">${jugador ? (ocultarNivelBanca ? '?' : jugador.nivel) : ''}</span>
      </div>`;
  }).join('');
  const cuotas = conteoBanca(draft);
  const resumenBanca = Object.entries(CUOTAS_BANCA)
    .map(([categoria, cuota]) => `${categoria} ${cuotas[categoria]}/${cuota}`)
    .join(' · ');

  $('#boxscore', root).innerHTML = html`
    <div class="boxscore">
      <div class="box-cabecera">
        <span class="box-titulo">BOX SCORE · XI ${totalTitulares(draft)}/11</span>
        <span class="box-fuerzas">
          <b class="atq">${v(ataque)}</b> ATAQUE&nbsp;&nbsp;<b class="dfn">${v(defensa)}</b> DEFENSA
        </span>
      </div>
      ${filas}
    </div>
    <div class="boxscore banca-score">
      <div class="box-cabecera">
        <span class="box-titulo">BANCA · ${totalBanca(draft)}/7</span>
        <span class="box-fuerzas">${resumenBanca}</span>
      </div>
      ${filasBanca}
    </div>`;
}

function actualizarRivales(root) {
  const { room, players } = app.estado;
  const cont = $('#rivales', root);
  if (!cont) return;

  cont.innerHTML = html`
    <h3 class="titulo-mini">Los demás DTs</h3>
    <ul class="lista-rivales">
      ${players.map(p => html`<li class="${p.ready ? 'listo' : ''}">
        ${p.ready ? '✓' : '⏳'} <b>${esc(p.name)}</b>
        <span class="rival-equipo">${p.ready ? 'equipo listo' : 'armando su equipo…'}</span>
        ${soyHost() && p.id !== room.host_id
          ? `<button class="btn-kick" data-kick="${p.id}" title="Sacar del juego">✕</button>`
          : ''}
      </li>`).join('')}
    </ul>`;

  // el anfitrión puede sacar a un DT que se desconectó, para no quedar esperándolo
  $$('.btn-kick', cont).forEach(b => b.addEventListener('click', async () => {
    const pid = b.dataset.kick;
    const pl = players.find(p => p.id === pid);
    if (!confirm(`¿Sacar a ${pl?.name ?? 'este DT'} del juego? Su equipo no entrará al Mundial.`)) return;
    b.disabled = true;
    try { await net.eliminarJugador(room.code, pid); }
    catch (e) { b.disabled = false; toast('No se pudo sacar al DT: ' + e.message, true); }
  }));

  const zonaHost = $('#zona-host', root);
  if (soyHost() && zonaHost) {
    const todosListos = players.length > 0 && players.every(p => p.ready);
    zonaHost.innerHTML = html`
      <button id="btn-pitazo" class="btn btn-grande ${todosListos ? 'btn-primario' : ''}"
        ${todosListos ? '' : 'disabled'}>
        ⚽ ¡Que ruede la pelota!
      </button>
      ${todosListos ? '' : '<p class="nota centrada">Se habilita cuando todos hayan enviado su equipo.</p>'}`;
    $('#btn-pitazo', root)?.addEventListener('click', async () => {
      try { await net.actualizarSala(room.code, { status: 'running' }); }
      catch (e) { toast('No se pudo arrancar: ' + e.message, true); }
    });
  }
}
