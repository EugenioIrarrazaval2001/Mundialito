// Motor de simulación: fuerza de equipos, partidos y torneo completo.
// Todo es determinista a partir de la semilla de la sala.

import { Rng } from './rng.js';
import { SQUADS, FORMACIONES, FORMACION_SLOTS, JUGADORES_BY_ID, lineaDePuesto, nivelEnPuesto, puestosJugador } from '../data/squads.js';

// room.modo guarda juego y tamaño juntos, ej: 'clasico|32' (sin tocar el esquema)
export function parseModo(modoStr) {
  const [modo, total] = String(modoStr || 'clasico').split('|');
  return { modo, total: [8, 16, 32].includes(Number(total)) ? Number(total) : 16 };
}

// ---------- Equipos ----------

// Un "equipo" del torneo: dueño (humano o IA), plantel base y XI elegido.
// lineup = { POR: [playerId], DEF: [...], MED: [...], DEL: [...] }

// Formaciones que el plantel puede completar (algunos planteles antiguos
// tienen pocas opciones en alguna línea)
export function formacionesDisponibles(squadObj) {
  const disp = pos => squadObj.jugadores.filter(j => puestosJugador(j).some(p => lineaDePuesto(p.puesto) === pos)).length;
  return Object.keys(FORMACIONES).filter(f => {
    const c = FORMACIONES[f];
    return disp('DEF') >= c.DEF && disp('MED') >= c.MED && disp('DEL') >= c.DEL;
  });
}

export function mejorXI(squadObj, formacion = '4-3-3') {
  const slots = [];
  const usados = new Set();
  for (const puesto of FORMACION_SLOTS[formacion]) {
    const mejor = squadObj.jugadores
      .filter(j => !usados.has(j.id) && nivelEnPuesto(j, puesto) !== null)
      .map(j => ({ j, nivel: nivelEnPuesto(j, puesto) }))
      .sort((a, b) => b.nivel - a.nivel)[0];
    if (!mejor) continue;
    usados.add(mejor.j.id);
    slots.push({ puesto, linea: lineaDePuesto(puesto), id: mejor.j.id, nivel: mejor.nivel });
  }
  return lineupDesdeSlots(slots, 'equilibrado', crearBancaIA(squadObj, usados));
}

const CUOTAS_BANCA_IA = Object.freeze({ POR: 1, DEF: 2, MED: 2, DEL: 2 });

// Los planteles históricos no siempre tienen 18 jugadores. La IA intenta la
// composición reglamentaria y, si falta alguna categoría, completa únicamente
// con los mejores jugadores de campo reales que todavía estén libres.
function crearBancaIA(squadObj, usadosXI) {
  const libres = squadObj.jugadores
    .filter(j => !usadosXI.has(j.id))
    .sort((a, b) => b.nivel - a.nivel || a.id.localeCompare(b.id));
  const elegidos = [];
  const ids = new Set();

  for (const [categoria, cuota] of Object.entries(CUOTAS_BANCA_IA)) {
    for (const jugador of libres.filter(j => j.pos === categoria).slice(0, cuota)) {
      elegidos.push({ id: jugador.id, categoria: jugador.pos });
      ids.add(jugador.id);
    }
  }
  for (const jugador of libres) {
    if (elegidos.length >= 7) break;
    if (jugador.pos === 'POR' || ids.has(jugador.id)) continue;
    elegidos.push({ id: jugador.id, categoria: jugador.pos });
    ids.add(jugador.id);
  }
  return elegidos;
}

function jugadoresDe(ids) {
  return ids.map(id => JUGADORES_BY_ID[id]).filter(Boolean);
}

function entradasLinea(lineup, linea) {
  if (lineup.slots) {
    return lineup.slots
      .filter(s => s.linea === linea)
      .map(s => ({ jugador: JUGADORES_BY_ID[s.id], nivel: s.nivel }))
      .filter(e => e.jugador);
  }
  return jugadoresDe(lineup[linea] || []).map(jugador => ({ jugador, nivel: jugador.nivel }));
}

function nivelPromedio(lineup, linea) {
  const entradas = entradasLinea(lineup, linea);
  return entradas.length ? entradas.reduce((a, e) => a + e.nivel, 0) / entradas.length : 60;
}

export function lineupDesdeSlots(slots, estilo = 'equilibrado', bench = []) {
  return {
    POR: slots.filter(s => s.linea === 'POR').map(s => s.id),
    DEF: slots.filter(s => s.linea === 'DEF').map(s => s.id),
    MED: slots.filter(s => s.linea === 'MED').map(s => s.id),
    DEL: slots.filter(s => s.linea === 'DEL').map(s => s.id),
    slots,
    bench: (Array.isArray(bench) ? bench : []).flatMap(suplente => {
      const id = typeof suplente === 'string' ? suplente : suplente?.id;
      const jugador = JUGADORES_BY_ID[id];
      return jugador ? [{ id, categoria: suplente?.categoria || jugador.pos }] : [];
    }),
    estilo,
  };
}

export function fuerzaEquipo(equipo) {
  const gk = entradasLinea(equipo.lineup, 'POR')[0]?.nivel ?? 60;
  const def = nivelPromedio(equipo.lineup, 'DEF');
  const med = nivelPromedio(equipo.lineup, 'MED');
  const del = nivelPromedio(equipo.lineup, 'DEL');
  // estilo de juego: ofensivo arriesga (+ataque, -defensa); defensivo al revés
  const estilo = equipo.lineup.estilo || 'equilibrado';
  const fAtq = estilo === 'ofensivo' ? 1.06 : estilo === 'defensivo' ? 0.94 : 1;
  const fDef = estilo === 'ofensivo' ? 0.94 : estilo === 'defensivo' ? 1.06 : 1;
  return {
    gk, def, med, del,
    ataque: (0.62 * del + 0.38 * med) * fAtq,
    defensa: (0.48 * def + 0.20 * med + 0.32 * gk) * fDef,
  };
}

// ---------- Partido ----------

const LAMBDA_BASE = 1.05;
const DIFERENCIA_SATURACION = 9.5;
const SENSIBILIDAD_GOLES = 7;

const FACTORES_ETAPA = Object.freeze({
  grupos: 1.00,
  r32: 0.98,
  r16: 0.97,
  cuartos: 0.92,
  semifinal: 0.90,
  final: 0.88,
  tercerPuesto: 1.10,
});

const ETAPA_POR_RONDA = Object.freeze({
  'Dieciseisavos de Final': 'r32',
  'Octavos de Final': 'r16',
  'Cuartos de Final': 'cuartos',
  'Semifinales': 'semifinal',
  'Final': 'final',
});

function factorDeEtapa(etapa) {
  return Object.prototype.hasOwnProperty.call(FACTORES_ETAPA, etapa)
    ? FACTORES_ETAPA[etapa]
    : FACTORES_ETAPA.grupos;
}

function lambdaGoles(atk, rivalDef, etapa = 'grupos') {
  // Tanh conserva las diferencias pequeñas y satura las grandes; la etapa
  // modifica solo el ritmo goleador, no la calidad relativa de los equipos.
  const diferencia = atk - rivalDef;
  const diferenciaEfectiva = DIFERENCIA_SATURACION
    * Math.tanh(diferencia / DIFERENCIA_SATURACION);
  return LAMBDA_BASE
    * factorDeEtapa(etapa)
    * Math.pow(2, diferenciaEfectiva / SENSIBILIDAD_GOLES);
}

export const PESO_GOL_PUESTO = Object.freeze({
  DC: 5.0,
  EI: 4.0,
  ED: 4.0,
  MCO: 3.0,
  MI: 2.2,
  MD: 2.2,
  MC: 1.8,
  MCD: 1.1,
  LI: 0.7,
  LD: 0.7,
  DFC: 0.4,
  POR: 0,
});

const VENTANAS_CAMBIOS = Object.freeze([[60, 69], [70, 79], [80, 88]]);
const VENTANAS_ALARGUE = Object.freeze([[93, 104], [106, 116]]);

function slotsIniciales(equipo) {
  if (Array.isArray(equipo.lineup?.slots)) {
    return equipo.lineup.slots.flatMap((slot, slotIndex) => {
      const jugador = JUGADORES_BY_ID[slot.id];
      if (!jugador || !slot.puesto) return [];
      const nivel = Number.isFinite(slot.nivel)
        ? slot.nivel
        : nivelEnPuesto(jugador, slot.puesto);
      if (nivel === null) return [];
      return [{
        ...slot,
        slotIndex: slot.slotIndex ?? slotIndex,
        linea: slot.linea || lineaDePuesto(slot.puesto),
        nivel,
        titularOriginal: true,
      }];
    });
  }

  // Compatibilidad con lineups antiguos agrupados solamente por macroposición.
  const puestos = FORMACION_SLOTS[equipo.formacion] || FORMACION_SLOTS['4-3-3'];
  const usadosPorLinea = { POR: 0, DEF: 0, MED: 0, DEL: 0 };
  return puestos.flatMap((puesto, slotIndex) => {
    const linea = lineaDePuesto(puesto);
    const id = equipo.lineup?.[linea]?.[usadosPorLinea[linea]++];
    const jugador = JUGADORES_BY_ID[id];
    if (!jugador) return [];
    return [{
      puesto, linea, id,
      nivel: nivelEnPuesto(jugador, puesto) ?? jugador.nivel,
      slotIndex,
      titularOriginal: true,
    }];
  });
}

function crearEstadoPartido(equipo) {
  const slots = slotsIniciales(equipo).map(slot => ({ ...slot }));
  const titulares = new Set(slots.map(slot => slot.id));
  const vistos = new Set();
  const bench = (Array.isArray(equipo.lineup?.bench) ? equipo.lineup.bench : [])
    .flatMap(suplente => {
      const id = typeof suplente === 'string' ? suplente : suplente?.id;
      const jugador = JUGADORES_BY_ID[id];
      if (!jugador || titulares.has(id) || vistos.has(id)) return [];
      vistos.add(id);
      return [{ id, categoria: suplente?.categoria || jugador.pos }];
    });
  return { equipo, slots, bench, usados: new Set(), sustituciones: [] };
}

function equipoActivo(estado) {
  return {
    ...estado.equipo,
    lineup: {
      ...estado.equipo.lineup,
      slots: estado.slots,
    },
  };
}

function candidatosCambio(estado) {
  const candidatos = [];
  for (const suplente of estado.bench) {
    if (estado.usados.has(suplente.id)) continue;
    const jugador = JUGADORES_BY_ID[suplente.id];
    if (!jugador || jugador.pos === 'POR') continue;
    for (let slotIndex = 0; slotIndex < estado.slots.length; slotIndex++) {
      const slot = estado.slots[slotIndex];
      if (!slot.titularOriginal || slot.puesto === 'POR') continue;
      const nivel = nivelEnPuesto(jugador, slot.puesto);
      if (nivel !== null) candidatos.push({ suplente, jugador, slot, slotIndex, nivel });
    }
  }
  return candidatos;
}

function elegirSustitucion(rng, estado) {
  let mejor = null;
  for (const candidato of candidatosCambio(estado)) {
    const ruido = rng.next() * 5 - 2.5;
    const score = candidato.nivel - candidato.slot.nivel + ruido;
    if (!mejor || score > mejor.score) mejor = { ...candidato, score };
  }
  return mejor;
}

function aplicarSustitucion(estado, candidato, minuto) {
  if (!candidato) return null;
  const saleId = candidato.slot.id;
  estado.slots[candidato.slotIndex] = {
    ...candidato.slot,
    id: candidato.jugador.id,
    nivel: candidato.nivel,
    titularOriginal: false,
  };
  estado.usados.add(candidato.jugador.id);
  const evento = {
    minuto,
    saleId,
    entraId: candidato.jugador.id,
    equipoId: estado.equipo.id,
    puesto: candidato.slot.puesto,
  };
  estado.sustituciones.push(evento);
  return evento;
}

function intentosDeCambios(rng, ventanas) {
  const intentos = [];
  for (const [desde, hasta] of ventanas) {
    intentos.push({ minuto: desde + rng.int(hasta - desde + 1), lado: 'A' });
    intentos.push({ minuto: desde + rng.int(hasta - desde + 1), lado: 'B' });
  }
  return intentos.sort((a, b) => a.minuto - b.minuto || a.lado.localeCompare(b.lado));
}

function elegirGoleadorActivo(rng, estado) {
  const candidatos = estado.slots.flatMap(slot => {
    const jugador = JUGADORES_BY_ID[slot.id];
    const pesoBase = PESO_GOL_PUESTO[slot.puesto] ?? 0;
    const peso = pesoBase * (slot.nivel / 80);
    return jugador && peso > 0 ? [{ jugador, peso }] : [];
  });
  const total = candidatos.reduce((suma, candidato) => suma + candidato.peso, 0);
  // POR tiene peso cero también en entradas degeneradas: nunca lo usamos como
  // fallback de goleador si un lineup inválido no contiene jugadores de campo.
  if (!candidatos.length || total <= 0) return null;
  let valor = rng.next() * total;
  for (const candidato of candidatos) {
    valor -= candidato.peso;
    if (valor <= 0) return candidato.jugador;
  }
  return candidatos[candidatos.length - 1].jugador;
}

function golesConEventosActivos(rng, cantidad, estado, desdeMin, hastaMin) {
  const eventos = [];
  const duracion = hastaMin - desdeMin + 1;
  for (let i = 0; i < cantidad; i++) {
    const goleador = elegirGoleadorActivo(rng, estado);
    if (!goleador) continue;
    eventos.push({
      minuto: desdeMin + rng.int(duracion),
      jugador: goleador.nombre,
      jugadorId: goleador.id,
      equipoId: estado.equipo.id,
    });
  }
  return eventos;
}

function simularSegmento(rng, estadoA, estadoB, desdeMin, hastaMin, etapa, eventos) {
  if (hastaMin < desdeMin) return { golesA: 0, golesB: 0 };
  const duracion = hastaMin - desdeMin + 1;
  const eqA = equipoActivo(estadoA), eqB = equipoActivo(estadoB);
  const fA = fuerzaEquipo(eqA), fB = fuerzaEquipo(eqB);
  const golesA = rng.poisson(lambdaGoles(fA.ataque, fB.defensa, etapa) * duracion / 90);
  const golesB = rng.poisson(lambdaGoles(fB.ataque, fA.defensa, etapa) * duracion / 90);
  eventos.push(
    ...golesConEventosActivos(rng, golesA, estadoA, desdeMin, hastaMin),
    ...golesConEventosActivos(rng, golesB, estadoB, desdeMin, hastaMin),
  );
  return { golesA, golesB };
}

function simularPeriodo(rng, estadoA, estadoB, desdeMin, hastaMin, etapa, intentos, eventos) {
  let cursor = desdeMin;
  let golesA = 0, golesB = 0;
  let indice = 0;
  while (indice < intentos.length) {
    const minuto = intentos[indice].minuto;
    const lote = [];
    while (indice < intentos.length && intentos[indice].minuto === minuto) {
      lote.push(intentos[indice++]);
    }
    const posibles = lote.filter(intento =>
      candidatosCambio(intento.lado === 'A' ? estadoA : estadoB).length > 0);
    // Un intento sin pareja legal no crea un segmento artificial.
    if (!posibles.length) continue;

    const tramo = simularSegmento(rng, estadoA, estadoB, cursor, minuto - 1, etapa, eventos);
    golesA += tramo.golesA; golesB += tramo.golesB;
    for (const intento of posibles) {
      const estado = intento.lado === 'A' ? estadoA : estadoB;
      aplicarSustitucion(estado, elegirSustitucion(rng, estado), minuto);
    }
    cursor = minuto;
  }
  const tramoFinal = simularSegmento(rng, estadoA, estadoB, cursor, hastaMin, etapa, eventos);
  return { golesA: golesA + tramoFinal.golesA, golesB: golesB + tramoFinal.golesB };
}

function resolverPenales(rng, fA, fB, override) {
  // La tanda automática mantiene el mismo algoritmo y consumo del RNG. El
  // override interactivo se aplica después, como en la versión anterior.
  let pa = 0, pb = 0, ronda = 0;
  const pConvierte = (gkRival) => 0.78 - (gkRival - 80) * 0.004;
  while (true) {
    ronda++;
    const ca = rng.next() < pConvierte(fB.gk) ? 1 : 0;
    const cb = rng.next() < pConvierte(fA.gk) ? 1 : 0;
    pa += ca; pb += cb;
    const restantes = Math.max(0, 5 - ronda);
    if (pa > pb + restantes || pb > pa + restantes) break;
    if (ronda >= 12) { if (rng.next() < 0.5) pa++; else pb++; break; }
  }
  if (override?.penales) {
    return { golesA: override.penales.golesA, golesB: override.penales.golesB, auto: false };
  }
  return { golesA: pa, golesB: pb, auto: true };
}

export function simularPartido(rng, eqA, eqB, conDesempate = false, override = null, soloPenales = false, etapa = 'grupos') {
  // Solo Penales conserva una ruta temprana: no genera minutos, cambios,
  // Poisson ni alargue, y entra directamente a la tanda 0-0.
  if (soloPenales) {
    const fA = fuerzaEquipo(eqA), fB = fuerzaEquipo(eqB);
    const penales = resolverPenales(rng, fA, fB, override);
    const ganador = penales.golesA > penales.golesB ? eqA.id : eqB.id;
    return {
      idA: eqA.id, idB: eqB.id,
      goles90A: 0, goles90B: 0,
      golesA: penales.golesA, golesB: penales.golesB,
      eventos: [], sustituciones: [], alargue: false, duracion: 0,
      penales, ganador,
    };
  }

  const estadoA = crearEstadoPartido(eqA);
  const estadoB = crearEstadoPartido(eqB);
  const eventos = [];
  const regulares = simularPeriodo(
    rng, estadoA, estadoB, 1, 90, etapa,
    intentosDeCambios(rng, VENTANAS_CAMBIOS), eventos,
  );
  const goles90A = regulares.golesA, goles90B = regulares.golesB;
  let golesA = goles90A, golesB = goles90B;
  let alargue = false;

  if (conDesempate && golesA === golesB) {
    alargue = true;
    const extra = simularPeriodo(
      rng, estadoA, estadoB, 91, 120, etapa,
      intentosDeCambios(rng, VENTANAS_ALARGUE), eventos,
    );
    golesA += extra.golesA;
    golesB += extra.golesB;
  }

  let penales = null;
  if (conDesempate && golesA === golesB) {
    penales = resolverPenales(
      rng,
      fuerzaEquipo(equipoActivo(estadoA)),
      fuerzaEquipo(equipoActivo(estadoB)),
      override,
    );
  }

  eventos.sort((a, b) => a.minuto - b.minuto);
  const sustituciones = [...estadoA.sustituciones, ...estadoB.sustituciones]
    .sort((a, b) => a.minuto - b.minuto || a.equipoId.localeCompare(b.equipoId));
  const ganador = golesA > golesB ? eqA.id
    : golesB > golesA ? eqB.id
    : penales ? (penales.golesA > penales.golesB ? eqA.id : eqB.id)
    : null;

  return {
    idA: eqA.id, idB: eqB.id,
    goles90A, goles90B, golesA, golesB,
    eventos, sustituciones,
    alargue, duracion: alargue ? 120 : 90,
    penales, ganador,
  };
}

// ---------- Torneo ----------

// equiposHumanos: [{ id, nombre (dueño), squadKey, formacion, lineup }]
// overrides: { [clavePartido]: { penales: {golesA, golesB} } } — tandas jugadas por los DTs
// totalDeseado: 8, 16 o 32 equipos (32 = mundial con octavos de final)
// Devuelve el mundial completo ya simulado, listo para "reproducirse" en la UI.
export function simularMundial(seed, equiposHumanos, overrides = {}, totalDeseado = 16, soloPenales = false, poolSquads = SQUADS) {
  const rng = new Rng('mundial-' + seed);

  // el tamaño elegido, ampliado si hay más humanos que cupos
  const minimo = equiposHumanos.length <= 8 ? 8 : equiposHumanos.length <= 16 ? 16 : 32;
  const total = Math.max(totalDeseado, minimo);

  // Rellenar con equipos IA usando planteles no asignados del pool del modo
  const usados = new Set(equiposHumanos.map(e => e.squadKey));
  const libres = rng.shuffle(poolSquads.filter(s => !usados.has(s.key)));
  const equipos = [...equiposHumanos];
  let i = 0;
  while (equipos.length < total) {
    const s = libres[i++ % libres.length];
    const candidatas = ['4-3-3', '4-4-2', '3-5-2'].filter(f => formacionesDisponibles(s).includes(f));
    const formacion = rng.pick(candidatas.length ? candidatas : formacionesDisponibles(s));
    equipos.push({
      id: 'ia-' + s.key, nombre: null, esIA: true,
      squadKey: s.key, formacion, lineup: mejorXI(s, formacion),
    });
  }

  const eqById = Object.fromEntries(equipos.map(e => [e.id, e]));
  let grupos = [], faseGrupos = [], tablas = [], clasificados = [];

  if (soloPenales) {
    // Modo solo penales: sin fase de grupos. Todos los equipos entran a un
    // bracket de eliminación directa y cada cruce se resuelve en una tanda.
    const orden = rng.shuffle(equipos);
    for (let j = 0; j < orden.length; j += 2) clasificados.push([orden[j], orden[j + 1]]);
  } else {
    // Sorteo de grupos (de a 4)
    const orden = rng.shuffle(equipos);
    const nGrupos = total / 4;
    for (let g = 0; g < nGrupos; g++) {
      grupos.push({ nombre: String.fromCharCode(65 + g), equipos: orden.slice(g * 4, g * 4 + 4) });
    }

    // Fase de grupos: round robin en 3 fechas
    const fechas = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]; // índices: (a vs b, c vs d)
    for (let f = 0; f < 3; f++) {
      const partidos = [];
      for (const gr of grupos) {
        const [a, b, c, d] = fechas[f];
        partidos.push({ grupo: gr.nombre, ...simularPartido(rng, gr.equipos[a], gr.equipos[b], false, null, false, 'grupos') });
        partidos.push({ grupo: gr.nombre, ...simularPartido(rng, gr.equipos[c], gr.equipos[d], false, null, false, 'grupos') });
      }
      faseGrupos.push({ nombre: 'Fecha ' + (f + 1), partidos });
    }

    // Tablas de posiciones
    tablas = grupos.map(gr => {
      const filas = gr.equipos.map(e => ({ id: e.id, pts: 0, gf: 0, gc: 0, pj: 0 }));
      const fila = id => filas.find(x => x.id === id);
      for (const fecha of faseGrupos) {
        for (const p of fecha.partidos.filter(p => p.grupo === gr.nombre)) {
          const a = fila(p.idA), b = fila(p.idB);
          a.pj++; b.pj++;
          a.gf += p.golesA; a.gc += p.golesB;
          b.gf += p.golesB; b.gc += p.golesA;
          if (p.golesA > p.golesB) a.pts += 3;
          else if (p.golesB > p.golesA) b.pts += 3;
          else { a.pts++; b.pts++; }
        }
      }
      filas.sort((x, y) =>
        y.pts - x.pts || (y.gf - y.gc) - (x.gf - x.gc) || y.gf - x.gf || (x.id < y.id ? -1 : 1));
      return { grupo: gr.nombre, filas };
    });

    // Llaves: 1°A vs 2°B, 1°B vs 2°A, etc. (cruces clásicos)
    for (let g = 0; g < nGrupos; g += 2) {
      const A = tablas[g].filas, B = tablas[g + 1].filas;
      clasificados.push([eqById[A[0].id], eqById[B[1].id]]);
      clasificados.push([eqById[B[0].id], eqById[A[1].id]]);
    }
  }

  // Eliminación directa
  const llaves = [];
  let ronda = clasificados; // pares de equipos
  const nombresRonda = {
    2: ['Semifinales', 'Final'],
    4: ['Cuartos de Final', 'Semifinales', 'Final'],
    8: ['Octavos de Final', 'Cuartos de Final', 'Semifinales', 'Final'],
    16: ['Dieciseisavos de Final', 'Octavos de Final', 'Cuartos de Final', 'Semifinales', 'Final'],
  }[ronda.length];
  let tercerPuesto = null;
  for (let r = 0; r < nombresRonda.length; r++) {
    const etapa = ETAPA_POR_RONDA[nombresRonda[r]] ?? 'grupos';
    const partidos = ronda.map(([a, b], i) => {
      const clave = `k${r}-${i}`;
      return { ...simularPartido(rng, a, b, true, overrides[clave], soloPenales, etapa), clave };
    });
    llaves.push({ nombre: nombresRonda[r], partidos });
    const ganadores = partidos.map(p => eqById[p.ganador]);
    if (nombresRonda[r] === 'Semifinales') {
      const perdedores = partidos.map(p => eqById[p.ganador === p.idA ? p.idB : p.idA]);
      tercerPuesto = {
        ...simularPartido(rng, perdedores[0], perdedores[1], true, overrides['tp'], soloPenales, 'tercerPuesto'),
        clave: 'tp',
      };
    }
    if (ganadores.length === 1) break;
    const sig = [];
    for (let k = 0; k < ganadores.length; k += 2) sig.push([ganadores[k], ganadores[k + 1]]);
    ronda = sig;
  }

  const final = llaves[llaves.length - 1].partidos[0];
  const campeon = eqById[final.ganador];
  const subcampeon = eqById[final.ganador === final.idA ? final.idB : final.idA];

  // Goleadores del torneo
  const goles = {};
  const todosPartidos = [
    ...faseGrupos.flatMap(f => f.partidos),
    ...llaves.flatMap(l => l.partidos),
    ...(tercerPuesto ? [tercerPuesto] : []),
  ];
  for (const p of todosPartidos) {
    for (const ev of p.eventos) {
      const k = ev.equipoId + '|' + ev.jugador;
      goles[k] = (goles[k] || 0) + 1;
    }
  }
  const goleadores = Object.entries(goles)
    .map(([k, n]) => {
      const [equipoId, jugador] = k.split('|');
      return { equipoId, jugador, goles: n };
    })
    .sort((a, b) => b.goles - a.goles || (a.jugador < b.jugador ? -1 : 1))
    .slice(0, 10);

  return {
    equipos, grupos: grupos.map(g => ({ nombre: g.nombre, ids: g.equipos.map(e => e.id) })),
    faseGrupos, tablas, llaves, tercerPuesto,
    campeonId: campeon.id, subcampeonId: subcampeon.id, goleadores,
  };
}
