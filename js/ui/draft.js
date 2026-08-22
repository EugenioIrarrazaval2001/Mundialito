// Draft estilo 7a0: tiras el dado, sale una selección histórica de un mundial,
// eliges UN jugador y lo colocas en XI o banca. Ambos se construyen en paralelo
// y cada colocación es irreversible.
// 6 comodines en dos bolsas independientes: 3 para otra selección del mismo
// Mundial y 3 para la misma selección en otro Mundial.

import { net } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, soyHost, miJugadorId } from '../main.js';
import { SQUADS, SQUADS_BY_KEY, FORMACION_SLOTS, JUGADORES_BY_ID, RESULTADO_MUNDIAL, TACTICA_POR_FORMACION, bandera, estadoPuestoJugador, estiloDeFormacion, lineaDePuesto, nivelEnPuesto, puestosJugador, squadsParaModo, tacticaDeFormacion } from '../data/squads.js';
import { lineupDesdeSlots, parseModo } from '../engine/engine.js';

// En Almanaque los candidatos permanecen ocultos; titulares y suplentes revelan
// su nivel al colocarlos. Los promedios siguen ocultos hasta enviar el equipo.
function nivelesOcultos(room, draft) {
  return parseModo(room.modo).modo === 'almanaque' && !draft.enviado;
}

// Chip de estado del header: antes de empezar muestra el modo; una vez iniciado,
// la formación muestra su identidad táctica derivada y el modo.
function chipEstadoTexto(draft, room) {
  const m = parseModo(room.modo).modo;
  const corto = m === 'penales' ? 'SOLO PENALES' : 'SELECCIONES HISTÓRICAS';
  const emoji = m === 'penales' ? '🧤' : '📖';
  if (!draft.iniciado) return `${emoji} ${corto}`;
  const categoria = tacticaDeFormacion(draft.formacion).categoria;
  return `${draft.formacion} · ${categoria} · ${corto}`;
}

const PROGRESO_DRAFT_VERSION = 4;
const COMODINES_POR_TIPO = 3;
const CUOTAS_BANCA = Object.freeze({ POR: 1, DEF: 2, MED: 2, DEL: 2 });
const SLOTS_BANCA = Object.freeze(['POR', 'DEF', 'DEF', 'MED', 'MED', 'DEL', 'DEL']);
const TOTAL_BANCA = SLOTS_BANCA.length;
// Filas exclusivamente visuales: no cambian la formación ni el slot que cada
// botón representa. MI/MC/MCD/MD comparten mediocampo; solo MCO se adelanta.
const FILAS_CANCHA = Object.freeze([
  Object.freeze({ puestos: Object.freeze(['EI', 'DC', 'ED']), miniY: 14 }),
  Object.freeze({ puestos: Object.freeze(['MCO']), miniY: 31 }),
  Object.freeze({ puestos: Object.freeze(['MI', 'MC', 'MCD', 'MD']), miniY: 48 }),
  Object.freeze({ puestos: Object.freeze(['LI', 'DFC', 'LD']), miniY: 70 }),
  Object.freeze({ puestos: Object.freeze(['POR']), miniY: 90 }),
]);
const ORDEN_HORIZONTAL_PUESTO = Object.freeze({
  LI: 0, MI: 0, EI: 0,
  DFC: 1, MC: 1, MCD: 1, MCO: 1, DC: 1,
  LD: 2, MD: 2, ED: 2,
});
const CATEGORIAS_TACTICAS = Object.freeze([
  Object.freeze({ categoria: 'OFENSIVA', titulo: 'OFENSIVAS', clase: 'ofensiva' }),
  Object.freeze({ categoria: 'EQUILIBRADA', titulo: 'EQUILIBRADAS', clase: 'equilibrada' }),
  Object.freeze({ categoria: 'DEFENSIVA', titulo: 'DEFENSIVAS', clase: 'defensiva' }),
]);
const COORDENADAS_MINICANCHA = Object.freeze({
  POR: Object.freeze({ y: 90 }),
  LI: Object.freeze({ y: 70 }),
  DFC: Object.freeze({ y: 70 }),
  LD: Object.freeze({ y: 70 }),
  MI: Object.freeze({ y: 48 }),
  MC: Object.freeze({ y: 48 }),
  MCD: Object.freeze({ y: 48 }),
  MD: Object.freeze({ y: 48 }),
  MCO: Object.freeze({ y: 31 }),
  EI: Object.freeze({ y: 14 }),
  DC: Object.freeze({ y: 14 }),
  ED: Object.freeze({ y: 14 }),
});

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
  const estilo = estiloDeFormacion(draft.formacion);
  draft.estilo = estilo;
  const progreso = {
    version: PROGRESO_DRAFT_VERSION,
    formacion: draft.formacion,
    estilo,
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
    colocando: draft.colocando ? { id: draft.colocando.id } : null,
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
      colocando: raw.colocando ? { id: raw.colocando.id } : null,
      comodinesOtraSeleccion: COMODINES_POR_TIPO,
      comodinesOtroMundial: COMODINES_POR_TIPO,
    };
  } else if (raw?.version === 2) {
    // La v2 terminaba al completar el XI. Un progreso parcial continúa ahora
    // con exactamente los mismos picks y la banca vacía.
    raw = {
      ...raw,
      version: PROGRESO_DRAFT_VERSION,
      bench: [],
      colocando: raw.colocando ? { id: raw.colocando.id } : null,
    };
  } else if (raw?.version === 3) {
    // La v3 ya guardaba banca, pero la habilitaba solo después del XI y
    // preseleccionaba un puesto de cancha. Conservamos todo el progreso válido.
    raw = {
      ...raw,
      version: PROGRESO_DRAFT_VERSION,
      colocando: raw.colocando ? { id: raw.colocando.id } : null,
    };
  }

  const invalido = () => {
    limpiarProgresoDraft(base);
    return null;
  };
  if (!raw || raw.version !== PROGRESO_DRAFT_VERSION ||
      !Object.hasOwn(FORMACION_SLOTS, raw.formacion) ||
      !Array.isArray(raw.picks) || !Array.isArray(raw.bench) || !Array.isArray(raw.ofrecidas) ||
      !Number.isInteger(raw.comodinesOtraSeleccion) ||
      raw.comodinesOtraSeleccion < 0 || raw.comodinesOtraSeleccion > COMODINES_POR_TIPO ||
      !Number.isInteger(raw.comodinesOtroMundial) ||
      raw.comodinesOtroMundial < 0 || raw.comodinesOtroMundial > COMODINES_POR_TIPO ||
      typeof raw.iniciado !== 'boolean') return invalido();

  const pool = poolDraftDeSala(room);
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
  if (raw.bench.length > TOTAL_BANCA || raw.picks.length + raw.bench.length > 18) return invalido();
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
    // La formación es la fuente de verdad incluso para snapshots antiguos que
    // guardaron una combinación formación/estilo hoy imposible.
    estilo: estiloDeFormacion(raw.formacion),
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
        !oferta) return invalido();
    const jugador = JUGADORES_BY_ID[raw.colocando.id];
    const persona = jugador ? `${jugador.squad.pais}|${jugador.nombre}` : null;
    const puedeColocarse = jugador && jugador.squad.key === oferta.key &&
      !idsUsados.has(jugador.id) && !personasUsadas.has(persona) &&
      tieneDestinoDisponible(restaurado, jugador);
    if (!puedeColocarse) return invalido();
    restaurado.colocando = { id: jugador.id };
  }
  return restaurado;
}

export function pantallaDraft(root) {
  const yo = app.estado.players.find(p => p.id === miJugadorId());
  const { room } = app.estado;

  const formacionInicial = Object.hasOwn(FORMACION_SLOTS, yo.formacion) ? yo.formacion : '4-3-3';
  const picksIniciales = slotsDesdeLineup(formacionInicial, yo.lineup);
  const benchInicial = benchDesdeLineup(yo.lineup, picksIniciales);
  const tieneLineupServidor = Boolean(yo.lineup);
  const base = {
    formacion: formacionInicial,
    // Los lineups ya enviados conservan su estilo histórico. Un draft nuevo lo
    // deriva siempre de la formación, empezando por el default actual 4-3-3.
    estilo: tieneLineupServidor
      ? (yo.lineup?.estilo || 'equilibrado')
      : estiloDeFormacion(formacionInicial),
    picks: picksIniciales,
    bench: benchInicial,
    comodinesOtraSeleccion: COMODINES_POR_TIPO,
    comodinesOtroMundial: COMODINES_POR_TIPO,
    oferta: null,         // plantel sorteado este turno (null = hay que tirar)
    colocando: null,      // { id } elegido, esperando click en XI o banca
    ofrecidas: new Set(), // keys ya ofrecidas, para no repetir
    enviado: yo.ready,
    // La formación se elige al principio y determina automáticamente el estilo;
    // al empezar a armar queda fija y el setup desaparece.
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
function aplicarFormacion(draft, formacion) {
  if (!Object.hasOwn(FORMACION_SLOTS, formacion) ||
      !Object.hasOwn(TACTICA_POR_FORMACION, formacion)) return false;
  draft.formacion = formacion;
  draft.estilo = estiloDeFormacion(formacion);
  return true;
}
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
  if (!Object.hasOwn(CUOTAS_BANCA, jugador.pos)) return false;
  return conteoBanca(draft)[jugador.pos] < CUOTAS_BANCA[jugador.pos];
}

function tieneDestinoDisponible(draft, jugador) {
  return puestosDisponibles(draft, jugador).length > 0 ||
    cupoBancaDisponible(draft, jugador);
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
  return new Set(squad.jugadores
    .filter(j => !ya.has(j.id)
      && !personas.has(squad.pais + '|' + j.nombre)
      && tieneDestinoDisponible(draft, j))
    .map(j => j.id));
}

// La columna enabled_squads se conserva por compatibilidad, pero limita
// exclusivamente el universo compartido del draft de la sala.
function poolDraftDeSala(room) {
  return squadsParaModo(parseModo(room.modo).modo, room.enabled_squads);
}

function poolDraft() {
  return poolDraftDeSala(app.estado.room);
}

function sortearOferta(draft, candidatas = null) {
  const universo = candidatas ?? poolDraft();
  let pool = universo.filter(s => !draft.ofrecidas.has(s.key));
  if (!pool.length) pool = universo;
  if (!pool.length) {
    draft.oferta = null;
    return null;
  }
  const s = pool[Math.floor(Math.random() * pool.length)];
  draft.oferta = s;
  draft.ofrecidas.add(s.key);
  return s;
}

function mismoMundial(draft) {
  return poolDraft().filter(s => s.anio === draft.oferta.anio && s.key !== draft.oferta.key);
}
function mismaSeleccion(draft) {
  return poolDraft().filter(s => s.pais === draft.oferta.pais && s.key !== draft.oferta.key);
}

// efecto máquina tragamonedas: gira entre selecciones antes de revelar la sorteada
function girarYSortear(root, draft, candidatas = null) {
  if (draft.girando) return;
  // Una nueva oferta invalida cualquier jugador marcado de la oferta anterior.
  draft.colocando = null;
  draft.preservarScrollLista = false;
  const elegida = sortearOferta(draft, candidatas); // el resultado ya está decidido
  if (!elegida) {
    draft.girando = false;
    dibujarEstado(root, draft);
    toast('No hay planteles habilitados para el draft.', true);
    return false;
  }
  const pool = (candidatas && candidatas.length ? candidatas : poolDraft());
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
  return true;
}

function promNiveles(niveles) {
  return niveles.length ? Math.round(niveles.reduce((suma, nivel) => suma + nivel, 0) / niveles.length) : null;
}

function promSlots(slots) { return promNiveles(slots.map(slot => slot.nivel)); }

function promBanca(draft) {
  const niveles = draft.bench
    .map(suplente => JUGADORES_BY_ID[suplente.id]?.nivel)
    .filter(Number.isFinite);
  return promNiveles(niveles);
}

function resumenPuestos(jugador, almanaque = false) {
  const puestosUnicos = new Map();
  for (const posicion of puestosJugador(jugador)) {
    const anterior = puestosUnicos.get(posicion.puesto);
    if (anterior && anterior.nivel !== posicion.nivel) {
      console.warn(`Posición duplicada con niveles distintos para ${jugador.id}: ${posicion.puesto}`);
    }
    if (!anterior || posicion.nivel > anterior.nivel) puestosUnicos.set(posicion.puesto, posicion);
  }
  const puestos = [...puestosUnicos.values()];
  const max = Math.max(...puestos.map(p => p.nivel));
  const min = Math.min(...puestos.map(p => p.nivel));
  return {
    puestos: puestos.map(p => {
      const delta = p.nivel - min;
      return `${p.puesto}${delta > 0 && !almanaque ? ` <small>+${delta}</small>` : ''}`;
    }).join('/'),
    nivel: almanaque ? '?' : max,
    min,
    incluyeCategoria: puestos.some(p => p.puesto === jugador.pos),
  };
}

function agregarPick(draft, jugador, puesto, slotIndex) {
  const slots = slotsFormacion(draft);
  if (totalElegidos(draft) >= 18 || !Number.isInteger(slotIndex) ||
      slots[slotIndex] !== puesto || draft.picks.some(p => p.slotIndex === slotIndex)) {
    throw new Error(`Slot de XI no disponible: ${puesto}`);
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
  if (totalElegidos(draft) >= 18) throw new Error('El draft ya está completo');
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

function porcentajeTactico(factor) {
  return Math.round((factor - 1) * 100);
}

function porcentajeVisible(valor) {
  return `${valor > 0 ? '+' : ''}${valor}%`;
}

function efectoTacticoHTML(tactica) {
  const ataque = porcentajeTactico(tactica.ataque);
  const defensa = porcentajeTactico(tactica.defensa);
  if (ataque === 0 && defensa === 0) {
    return '<span class="formacion-efecto-neutro">SIN MODIFICADOR</span>';
  }
  return html`
    <span>ATAQUE <b>${porcentajeVisible(ataque)}</b></span>
    <span>DEFENSA <b>${porcentajeVisible(defensa)}</b></span>`;
}

function efectoTacticoAria(tactica) {
  const describir = (nombre, factor) => {
    const valor = porcentajeTactico(factor);
    if (valor === 0) return `${nombre} sin cambio`;
    return `${nombre} ${valor > 0 ? 'más' : 'menos'} ${Math.abs(valor)} por ciento`;
  };
  if (tactica.ataque === 1 && tactica.defensa === 1) return 'sin modificador';
  return `${describir('ataque', tactica.ataque)}, ${describir('defensa', tactica.defensa)}`;
}

function ordenarFilaVisual(slots) {
  return [...slots].sort((a, b) =>
    (ORDEN_HORIZONTAL_PUESTO[a.puesto] ?? 1) - (ORDEN_HORIZONTAL_PUESTO[b.puesto] ?? 1) ||
    a.i - b.i);
}

function filasVisualesCancha(slots) {
  return FILAS_CANCHA.map(fila => ({
    ...fila,
    slots: ordenarFilaVisual(slots.filter(slot => fila.puestos.includes(slot.puesto))),
  })).filter(fila => fila.slots.length);
}

function coordenadaHorizontalMini(indice, total) {
  if (total <= 1) return 50;
  // Deja margen para círculos de 21px en móvil y reparte cada línea simétrica.
  const margen = 14;
  return margen + (indice * (100 - 2 * margen)) / (total - 1);
}

// FORMACION_SLOTS sigue siendo la fuente de identidad y de slotIndex. Esta
// función solo reutiliza las mismas filas visuales de la cancha grande.
function posicionesMiniCancha(formacion) {
  const slots = (FORMACION_SLOTS[formacion] || []).map((puesto, i) => ({ puesto, i }));
  return filasVisualesCancha(slots).flatMap(fila =>
    fila.slots.map((slot, indice) => ({
      puesto: slot.puesto,
      x: coordenadaHorizontalMini(indice, fila.slots.length),
      y: COORDENADAS_MINICANCHA[slot.puesto]?.y ?? fila.miniY,
    })));
}

function miniCanchaHTML(formacion) {
  return html`
    <span class="mini-cancha-tactica" aria-hidden="true">
      <span class="mini-cancha-mitad"></span>
      ${posicionesMiniCancha(formacion).map(({ puesto, x, y }) => html`
        <span class="mini-jugador" style="left:${x}%;top:${y}%">
          <span>${puesto}</span>
        </span>`).join('')}
    </span>`;
}

function cardFormacionHTML(formacion, draft, claseCategoria) {
  const tactica = tacticaDeFormacion(formacion);
  const seleccionada = draft.formacion === formacion;
  const aria = `${formacion}, formación ${tactica.categoria.toLowerCase()}, ${efectoTacticoAria(tactica)}`;
  return html`
    <button type="button"
      class="formacion-card tactica-${claseCategoria} ${seleccionada ? 'seleccionada' : ''}"
      data-form="${formacion}"
      aria-pressed="${seleccionada ? 'true' : 'false'}"
      aria-label="${esc(aria)}">
      <span class="formacion-card-cabecera">
        <strong class="formacion-card-nombre">${formacion}</strong>
        <span class="formacion-card-categoria">${tactica.categoria}</span>
      </span>
      ${miniCanchaHTML(formacion)}
      <span class="formacion-efecto">${efectoTacticoHTML(tactica)}</span>
      <span class="formacion-card-check" aria-hidden="true">✓ SELECCIONADA</span>
    </button>`;
}

function selectorFormacionesHTML(draft) {
  const orden = Object.keys(TACTICA_POR_FORMACION);
  return CATEGORIAS_TACTICAS.map(grupo => {
    const formaciones = orden.filter(formacion =>
      tacticaDeFormacion(formacion).categoria === grupo.categoria);
    const idTitulo = `titulo-tactica-${grupo.clase}`;
    return html`
      <section class="formacion-grupo tactica-${grupo.clase}" aria-labelledby="${idTitulo}">
        <h4 id="${idTitulo}" class="formacion-grupo-titulo">${grupo.titulo}</h4>
        <div class="formacion-cards">
          ${formaciones.map(formacion => cardFormacionHTML(formacion, draft, grupo.clase)).join('')}
        </div>
      </section>`;
  }).join('');
}

// ---------- UI ----------

function dibujarTodo(root, draft) {
  const { room } = app.estado;

  render(root, html`
    <div class="draft">
      <header class="cabecera-sala">
        <div class="ticket"><span class="ticket-label">${app.grupo?.group ? 'GRUPO' : 'SALA'}</span>
          <span class="ticket-codigo ${app.grupo?.group ? 'ticket-grupo' : ''}">${esc(app.grupo?.group?.displayName || app.grupo?.group?.display_name || room.group_name || room.code)}</span></div>
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

      <div class="draft7 ${!draft.iniciado ? 'draft7-configuracion' : ''}">
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

  dibujarEstado(root, draft);
  actualizarRivales(root);
}

function dibujarEstado(root, draft) {
  guardarProgresoDraft(draft);
  const layout = $('.draft7', root);
  if (layout) layout.classList.toggle('draft7-configuracion', !draft.iniciado);
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
  const zona = $('#panel-izq', root);
  const scrollLista = $('.lista-elegir', zona)?.scrollTop ?? 0;
  // --- configuración inicial: la formación determina también el estilo ---
  const config = html`
    <div class="formacion-setup">
      <header class="formacion-setup-cabecera">
        <h3>ELIGE TU FORMACIÓN</h3>
        <p>La formación define tu disposición y tu estilo de juego.</p>
      </header>
      ${selectorFormacionesHTML(draft)}
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
  } else if (!poolDraft().length) {
    sorteo = html`
      <div class="caja-tirar"><p>No hay planteles habilitados para el draft.<br>
        Sal de la sala y crea una nueva con al menos uno.</p></div>`;
  } else if (!draft.iniciado) {
    // Setup: la formación define el estilo; al empezar a armar queda fija.
    sorteo = config + html`
      <div class="caja-tirar"><p>Elige tu <b>formación táctica</b>.<br>
        Al empezar a armar queda fija.</p></div>
      <button id="btn-tirar" class="btn-tirar">🎲 EMPEZAR A ARMAR</button>`;
  } else if (!draft.oferta) {
    sorteo = html`
      <div class="caja-tirar"><p>Tira para seguir armando<br>tu XI y tu banca</p></div>
      <button id="btn-tirar" class="btn-tirar">TIRAR 🎲</button>`;
  } else {
    const s = draft.oferta;
    const resultadoMundial = RESULTADO_MUNDIAL[s.key];
    const sel = elegibles(draft, s);
    const seleccionado = jugadorColocando(draft);
    const tieneXI = seleccionado ? puestosDisponibles(draft, seleccionado).length > 0 : false;
    const tieneBanca = seleccionado ? cupoBancaDisponible(draft, seleccionado) : false;
    const instruccionDestino = tieneXI && tieneBanca
      ? 'Elige una posición verde o naranja del XI, o un cupo disponible de la banca.'
      : tieneXI
        ? 'Elige una posición verde o naranja disponible del XI.'
        : 'Solo tiene disponible un lugar en la banca.';
    const candM = mismoMundial(draft);
    const candP = mismaSeleccion(draft);
    const comodinesRestantes = draft.comodinesOtraSeleccion + draft.comodinesOtroMundial;
    sorteo = html`
      <div class="salio">
        <span class="salio-label">SALIÓ</span>
        <span class="salio-pais">${bandera(s, 21)} ${esc(s.pais)}</span>
        <span class="salio-mundial">Mundial ${s.anio}</span>
        ${resultadoMundial
          ? html`<span class="salio-resultado">
              <span>POSICIÓN OBTENIDA EN ${s.anio}</span>
              <strong>${esc(resultadoMundial)}</strong>
            </span>`
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
      <h4 class="titulo-pos">${draft.colocando ? 'ELIGE SU DESTINO' : 'ELIGE UN JUGADOR'}</h4>
      ${draft.colocando ? html`
        <p class="nota jugador-seleccionado">
          Seleccionado: <b>${esc(seleccionado.nombre)}</b>.
          ${instruccionDestino} También puedes cambiar de jugador en la lista.
        </p>` : ''}
      <div class="lista-elegir">
        ${s.jugadores.map(j => {
          const resumen = resumenPuestos(j, almanaque);
          return html`<button class="fila-jugador ${draft.colocando?.id === j.id ? 'seleccionado' : ''}" data-id="${j.id}" ${sel.has(j.id) ? '' : 'disabled'}>
            <span class="fj-nombre">${esc(j.nombre)}</span>
            <span class="fj-pos">${resumen.incluyeCategoria ? '' : `${j.pos} · `}${resumen.puestos}</span>
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
  $$('.formacion-card[data-form]', zona).forEach(b => b.addEventListener('click', () => {
    if (!aplicarFormacion(draft, b.dataset.form)) return;
    dibujarEstado(root, draft);
  }));

  $('#btn-tirar', zona)?.addEventListener('click', () => {
    draft.estilo = estiloDeFormacion(draft.formacion);
    draft.iniciado = true; // a partir de aquí, la formación táctica queda fija
    girarYSortear(root, draft);
  });

  $$('.fila-jugador:not(:disabled)', zona).forEach(b => b.addEventListener('click', () => {
    const j = JUGADORES_BY_ID[b.dataset.id];
    draft.colocando = { id: j.id };
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
    const estilo = estiloDeFormacion(draft.formacion);
    draft.estilo = estilo;
    draft.enviando = true;
    dibujarEstado(root, draft);
    try {
      await net.actualizarJugador(room.code, miJugadorId(), {
        formacion: draft.formacion,
        lineup: lineupDesdeSlots(draft.picks, estilo, draft.bench),
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

  const filas = filasVisualesCancha(slots).map(({ slots: slotsFilaVisual }) => {
    const slotsFila = slotsFilaVisual
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

  const bancaPorCategoria = Object.fromEntries(
    Object.keys(CUOTAS_BANCA).map(categoria => [
      categoria,
      draft.bench.filter(suplente => suplente.categoria === categoria),
    ])
  );
  const indiceCategoria = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  const slotsBanca = SLOTS_BANCA.map(categoria => {
    const suplente = bancaPorCategoria[categoria][indiceCategoria[categoria]++];
    const jugador = suplente ? JUGADORES_BY_ID[suplente.id] : null;
    if (jugador) {
      return html`
        <div class="banca-slot banca-slot-ocupado" title="${esc(jugador.squad.pais)} ${jugador.squad.anio}">
          <span class="banca-circulo">${jugador.nivel}</span>
          <span class="banca-categoria">${categoria}</span>
          <span class="banca-nombre">${bandera(jugador.squad, 12)} ${esc(jugador.nombre)}</span>
          <span class="banca-anio">${jugador.squad.anio}</span>
        </div>`;
    }

    const esDestino = colocando?.pos === categoria && cupoBancaDisponible(draft, colocando);
    const contenido = html`
      <span class="banca-circulo banca-circulo-vacio">${categoria}</span>
      <span class="banca-categoria">${categoria}</span>
      <span class="banca-nombre banca-vacia">${esDestino ? 'COLOCAR AQUÍ' : 'VACÍO'}</span>`;
    return esDestino
      ? html`<button type="button" class="banca-slot banca-disponible"
          data-banca-categoria="${categoria}"
          aria-label="Enviar a ${esc(colocando.nombre)} a banca como ${categoria}">
          ${contenido}
        </button>`
      : html`<div class="banca-slot banca-slot-vacio">${contenido}</div>`;
  });
  const cuotas = conteoBanca(draft);
  const resumenBanca = Object.entries(CUOTAS_BANCA)
    .map(([categoria, cuota]) => `${categoria} ${cuotas[categoria]}/${cuota}`)
    .join(' · ');
  const banca = html`
    <section class="banca-cancha" aria-labelledby="titulo-banca-cancha">
      <header class="banca-cancha-cabecera">
        <h3 id="titulo-banca-cancha">BANCA</h3>
        <p>${resumenBanca}</p>
      </header>
      <div class="banca-fila banca-fila-cuatro">${slotsBanca.slice(0, 4).join('')}</div>
      <div class="banca-fila banca-fila-tres">${slotsBanca.slice(4).join('')}</div>
    </section>`;

  const cancha = $('#cancha7', root);
  cancha.innerHTML = html`<div class="pasto7">${filas}</div>${banca}`;

  $$('.slot-disponible', root).forEach(b => b.addEventListener('click', () => {
    const j = jugadorColocando(draft);
    if (!j || !draft.oferta) return;
    const puesto = slotsFormacion(draft)[Number(b.dataset.slot)];
    let pick;
    try {
      pick = agregarPick(draft, j, puesto, Number(b.dataset.slot));
    } catch (e) {
      toast('No se pudo colocar al jugador: ' + e.message, true);
      return;
    }
    draft.oferta = null;
    draft.preservarScrollLista = false;
    dibujarEstado(root, draft);
    toast(`Has elegido a ${j.nombre} · ${puesto} · ${j.squad.pais} ${j.squad.anio} · media ${pick.nivel}`);
  }));

  $$('.banca-disponible', cancha).forEach(b => b.addEventListener('click', () => {
    const jugador = jugadorColocando(draft);
    if (!jugador || !draft.oferta || b.dataset.bancaCategoria !== jugador.pos ||
        !cupoBancaDisponible(draft, jugador)) return;
    try {
      agregarBanca(draft, jugador);
    } catch (e) {
      toast('No se pudo colocar al jugador en banca: ' + e.message, true);
      return;
    }
    draft.oferta = null;
    draft.preservarScrollLista = false;
    dibujarEstado(root, draft);
    toast(`Has elegido para la banca a ${jugador.nombre} · ${jugador.pos} · ${jugador.squad.pais} ${jugador.squad.anio} · media ${jugador.nivel}`);
  }));
}

function dibujarBox(root, draft) {
  const { room } = app.estado;
  const almanaque = nivelesOcultos(room, draft); // los promedios se revelan al enviar el equipo

  const ataque = promSlots(draft.picks.filter(p => ['MED', 'DEL'].includes(p.linea)));
  const defensa = promSlots(draft.picks.filter(p => ['POR', 'DEF'].includes(p.linea)));
  const banca = promBanca(draft);
  const totalEquipo = [ataque, defensa, banca].every(Number.isFinite)
    ? Math.round(ataque * 0.45 + defensa * 0.45 + banca * 0.10)
    : null;
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

  $('#boxscore', root).innerHTML = html`
    <div class="boxscore">
      <div class="box-cabecera">
        <span class="box-titulo">BOX SCORE · XI ${totalTitulares(draft)}/11</span>
        <span class="box-fuerzas">
          <span class="box-fuerza"><b class="atq">${v(ataque)}</b><span>ATAQUE</span></span>
          <span class="box-fuerza"><b class="dfn">${v(defensa)}</b><span>DEFENSA</span></span>
          <span class="box-fuerza"><b class="bnc">${v(banca)}</b><span>BANCA</span></span>
          <span class="box-fuerza box-fuerza-total"><b class="tot">${v(totalEquipo)}</b><span>TOTAL EQUIPO</span></span>
        </span>
      </div>
      ${filas}
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
