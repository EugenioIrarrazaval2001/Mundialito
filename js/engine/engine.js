// Motor de simulación: fuerza de equipos, partidos y torneo completo.
// Todo es determinista a partir de la semilla de la sala.

import { Rng } from './rng.js';
import { SQUADS, FORMACIONES, FORMACION_SLOTS, JUGADORES_BY_ID, estiloDeFormacion, lineaDePuesto, nivelEnPuesto, puestosJugador } from '../data/squads.js';

// room.modo guarda juego y tamaño juntos, ej: 'clasico|32' (sin tocar el esquema)
export function parseModo(modoStr) {
  const [modo, total] = String(modoStr || 'clasico').split('|');
  return { modo, total: [8, 16, 32].includes(Number(total)) ? Number(total) : 16 };
}

// ---------- Equipos ----------

// Un "equipo" del torneo: dueño (humano o IA), plantel base y XI elegido.
// lineup = { POR: [playerId], DEF: [...], MED: [...], DEL: [...] }

// La máquina solo utiliza puestos explícitos del jugador. Las conversiones
// generales están reservadas para el draft/equipos humanos.
export function nivelEnPuestoMaquina(jugador, puesto) {
  const posicion = puestosJugador(jugador).find(p => p.puesto === puesto);
  return posicion ? posicion.nivel : null;
}

function asignacionPreferidaMaquina(candidata, actual) {
  if (!actual) return true;
  for (let i = 0; i < candidata.length; i++) {
    const idCandidato = candidata[i]?.jugador.id;
    const idActual = actual[i]?.jugador.id;
    if (idCandidato === idActual) continue;
    return idCandidato < idActual;
  }
  return false;
}

// Asignación global ponderada: cada estado representa los slots ya cubiertos.
// Al procesar cada jugador una sola vez, nunca puede ocupar dos puestos; conservar
// solo el mejor estado por máscara maximiza la suma total sin una elección greedy.
function resolverAsignacionMaquina(squadObj, formacion) {
  const puestos = FORMACION_SLOTS[formacion];
  if (!puestos || puestos.length !== 11) return null;

  const jugadores = [...squadObj.jugadores]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const estados = new Map([[0, { total: 0, asignacion: Array(puestos.length).fill(null) }]]);

  for (const jugador of jugadores) {
    const compatibles = puestos.flatMap((puesto, slotIndex) => {
      const nivel = nivelEnPuestoMaquina(jugador, puesto);
      return nivel === null ? [] : [{ slotIndex, nivel }];
    });
    if (!compatibles.length) continue;

    // La instantánea impide que las actualizaciones del mismo jugador se vuelvan
    // a usar en esta iteración para llenar un segundo slot.
    const anteriores = [...estados.entries()];
    for (const [mascara, estado] of anteriores) {
      for (const compatible of compatibles) {
        const bit = 1 << compatible.slotIndex;
        if (mascara & bit) continue;
        const nuevaMascara = mascara | bit;
        const total = estado.total + compatible.nivel;
        const existente = estados.get(nuevaMascara);
        const asignacion = [...estado.asignacion];
        asignacion[compatible.slotIndex] = { jugador, nivel: compatible.nivel };
        if (
          !existente
          || total > existente.total
          || (total === existente.total
            && asignacionPreferidaMaquina(asignacion, existente.asignacion))
        ) {
          estados.set(nuevaMascara, { total, asignacion });
        }
      }
    }
  }

  return estados.get((1 << puestos.length) - 1) || null;
}

// Una formación de IA solo está disponible si existe un matching exacto de
// once jugadores distintos con los once puestos explícitos requeridos.
export function formacionesDisponiblesMaquina(squadObj) {
  return Object.keys(FORMACIONES)
    .filter(formacion => resolverAsignacionMaquina(squadObj, formacion) !== null);
}

export function mejorXIMaquina(squadObj, formacion = '4-3-3') {
  const solucion = resolverAsignacionMaquina(squadObj, formacion);
  if (!solucion || solucion.asignacion.length !== 11 || solucion.asignacion.some(a => !a)) {
    throw new Error(`El Bot no puede completar ${formacion} con el plantel ${squadObj.key}.`);
  }

  const ids = new Set(solucion.asignacion.map(a => a.jugador.id));
  if (ids.size !== 11) {
    throw new Error(`El XI del Bot para ${squadObj.key} contiene jugadores repetidos.`);
  }

  const slots = solucion.asignacion.map(({ jugador, nivel }, slotIndex) => {
    const puesto = FORMACION_SLOTS[formacion][slotIndex];
    return { puesto, linea: lineaDePuesto(puesto), id: jugador.id, nivel, slotIndex };
  });
  return lineupDesdeSlots(slots, estiloDeFormacion(formacion), crearBancaIA(squadObj, ids));
}

// Alias conservados para callers antiguos del motor; la UI humana no los usa.
export function formacionesDisponibles(squadObj) {
  return formacionesDisponiblesMaquina(squadObj);
}

export function mejorXI(squadObj, formacion = '4-3-3') {
  return mejorXIMaquina(squadObj, formacion);
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
  const fAtq = estilo === 'ofensivo' ? 1.05 : estilo === 'defensivo' ? 0.95 : 1;
  const fDef = estilo === 'ofensivo' ? 0.95 : estilo === 'defensivo' ? 1.05 : 1;
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

const FACTOR_ATAQUE_POR_EXPULSION = 0.90;
const FACTOR_DEFENSA_POR_EXPULSION = 0.90;

// Zonas compartidas por el motor y la tanda interactiva. Los identificadores
// forman parte del contrato persistido entre clientes durante un duelo humano.
export const ZONAS_TIRO_PENAL = Object.freeze([
  'izq-arriba',
  'izq-abajo',
  'centro',
  'panenka',
  'der-abajo',
  'der-arriba',
]);

export const ZONAS_ARQUERO_PENAL = Object.freeze(['izq', 'centro', 'der']);

function clamp(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

function validarIntentoPenal(ratingPateador, ratingArquero, zonaTiro, zonaArquero) {
  if (!Number.isFinite(ratingPateador) || !Number.isFinite(ratingArquero)) {
    throw new TypeError('Los ratings del penal deben ser números finitos.');
  }
  if (!ZONAS_TIRO_PENAL.includes(zonaTiro)) {
    throw new RangeError(`Zona de tiro inválida: ${zonaTiro}`);
  }
  if (!ZONAS_ARQUERO_PENAL.includes(zonaArquero)) {
    throw new RangeError(`Zona de arquero inválida: ${zonaArquero}`);
  }
}

// Fuente de verdad de la matriz 6 x 3. Solo interviene el rating del arquero
// cuando este adivina la zona lateral o permanece al medio ante un tiro central.
export function evaluarPenal(ratingPateador, ratingArquero, zonaTiro, zonaArquero) {
  validarIntentoPenal(ratingPateador, ratingArquero, zonaTiro, zonaArquero);

  const ladoTiro = zonaTiro.startsWith('izq-')
    ? 'izq'
    : zonaTiro.startsWith('der-') ? 'der' : 'centro';
  const tipoTiro = zonaTiro.endsWith('-arriba')
    ? 'arriba'
    : zonaTiro.endsWith('-abajo') ? 'abajo' : zonaTiro;
  const arqueroAdivino = ladoTiro === zonaArquero;
  let probabilidad;

  if (tipoTiro === 'panenka') {
    probabilidad = arqueroAdivino
      ? 0
      : clamp((ratingPateador - 50) / 50, 0.10, 0.95);
  } else if (tipoTiro === 'centro') {
    probabilidad = arqueroAdivino
      ? clamp(0.35 + 0.015 * (ratingPateador - ratingArquero), 0.10, 0.70)
      : Math.min(ratingPateador / 100, 0.97);
  } else if (tipoTiro === 'abajo') {
    probabilidad = arqueroAdivino
      ? clamp(0.30 + 0.015 * (ratingPateador - ratingArquero), 0.08, 0.60)
      : clamp(0.93 + 0.003 * (ratingPateador - 80), 0.85, 0.97);
  } else {
    probabilidad = arqueroAdivino
      ? clamp(0.52 + 0.015 * (ratingPateador - ratingArquero), 0.18, 0.82)
      : clamp(0.80 + 0.006 * (ratingPateador - 80), 0.65, 0.95);
  }

  return {
    probabilidad,
    arqueroAdivino,
    tipoTiro,
    ladoTiro,
    ladoArquero: zonaArquero,
  };
}

export function resolverPenalConRng(
  rng,
  ratingPateador,
  ratingArquero,
  zonaTiro,
  zonaArquero,
) {
  if (!rng || typeof rng.next !== 'function') {
    throw new TypeError('resolverPenalConRng requiere una instancia de Rng.');
  }
  const evaluacion = evaluarPenal(
    ratingPateador,
    ratingArquero,
    zonaTiro,
    zonaArquero,
  );
  const azar = rng.next();
  const gol = azar < evaluacion.probabilidad;
  return {
    ...evaluacion,
    azar,
    gol,
    desenlace: gol ? 'gol' : evaluacion.arqueroAdivino ? 'atajada' : 'fallo',
  };
}

// Tasas aproximadas de los Mundiales 2014, 2018 y 2022. Las tarjetas viven
// solamente durante este partido y usan un RNG propio; no generan suspensiones.
export const DISCIPLINA = Object.freeze({
  lambdaAmarillasObjetivo: 3.30,
  lambdaAmarillaOrdinaria: 3.21,
  lambdaRojaDirecta: 0.052,
  lambdaDobleAmarilla: 0.042,
  factorAtaquePorExpulsion: FACTOR_ATAQUE_POR_EXPULSION,
  factorDefensaPorExpulsion: FACTOR_DEFENSA_POR_EXPULSION,
  pesosExpulsionLinea: Object.freeze({ DEF: 0.35, MED: 0.43, DEL: 0.22 }),
});

const ORDEN_EXPULSION = Object.freeze({ segunda_amarilla: 0, roja_directa: 1 });
const ORDEN_TARJETA = Object.freeze({ segunda_amarilla: 0, roja_directa: 1, amarilla: 2 });

function slotsIniciales(equipo) {
  if (Array.isArray(equipo.lineup?.slots)) {
    return equipo.lineup.slots.flatMap((slot, slotIndex) => {
      const jugador = JUGADORES_BY_ID[slot.id];
      if (!jugador || !slot.puesto) return [];
      const nivelPermitido = equipo.esIA === true
        ? nivelEnPuestoMaquina(jugador, slot.puesto)
        : nivelEnPuesto(jugador, slot.puesto);
      const nivel = equipo.esIA === true
        ? nivelPermitido
        : Number.isFinite(slot.nivel) ? slot.nivel : nivelPermitido;
      if (nivel === null) return [];
      return [{
        ...slot,
        slotIndex: slot.slotIndex ?? slotIndex,
        linea: slot.linea || lineaDePuesto(slot.puesto),
        nivel,
        titularOriginal: true,
        minutoEntrada: 1,
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
    const nivelPosicional = equipo.esIA === true
      ? nivelEnPuestoMaquina(jugador, puesto)
      : nivelEnPuesto(jugador, puesto);
    if (equipo.esIA === true && nivelPosicional === null) return [];
    return [{
      puesto, linea, id,
      nivel: nivelPosicional ?? jugador.nivel,
      slotIndex,
      titularOriginal: true,
      minutoEntrada: 1,
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
  return {
    equipo,
    slots,
    bench,
    usados: new Set(),
    sustituciones: [],
    amarillas: new Map(),
    expulsados: new Set(),
    tarjetas: [],
    numeroExpulsados: 0,
  };
}

function snapshotSlots(estado) {
  return estado.slots.map(({ puesto, linea, id, nivel, slotIndex }) => ({
    puesto, linea, id, nivel, slotIndex,
  }));
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
      const nivel = estado.equipo.esIA === true
        ? nivelEnPuestoMaquina(jugador, slot.puesto)
        : nivelEnPuesto(jugador, slot.puesto);
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
    minutoEntrada: minuto,
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

function programarDisciplinaPeriodo(rng, desdeMin, hastaMin) {
  const proporcion = (hastaMin - desdeMin + 1) / 90;
  const cantidadAmarillas = rng.poisson(DISCIPLINA.lambdaAmarillaOrdinaria * proporcion);
  const cantidadRojas = rng.poisson(DISCIPLINA.lambdaRojaDirecta * proporcion);
  const cantidadDobles = rng.poisson(DISCIPLINA.lambdaDobleAmarilla * proporcion);
  const amarillas = [];
  const expulsiones = [];
  let orden = 0;
  const minuto = (desde, hasta) => desde + rng.int(hasta - desde + 1);
  const lado = () => rng.next() < 0.5 ? 'A' : 'B';

  for (let i = 0; i < cantidadAmarillas; i++) {
    amarillas.push({ minuto: minuto(desdeMin, hastaMin), lado: lado(), orden: orden++ });
  }
  for (let i = 0; i < cantidadRojas; i++) {
    expulsiones.push({
      minuto: minuto(desdeMin, hastaMin),
      lado: lado(),
      tipo: 'roja_directa',
      orden: orden++,
    });
  }
  const desdeDoble = desdeMin <= 90 ? Math.max(15, desdeMin) : desdeMin;
  for (let i = 0; i < cantidadDobles; i++) {
    expulsiones.push({
      minuto: minuto(desdeDoble, hastaMin),
      lado: lado(),
      tipo: 'segunda_amarilla',
      orden: orden++,
    });
  }

  amarillas.sort((a, b) => a.minuto - b.minuto || a.lado.localeCompare(b.lado) || a.orden - b.orden);
  expulsiones.sort((a, b) =>
    a.minuto - b.minuto
    || ORDEN_EXPULSION[a.tipo] - ORDEN_EXPULSION[b.tipo]
    || a.lado.localeCompare(b.lado)
    || a.orden - b.orden);
  return { amarillas, expulsiones, indiceAmarilla: 0 };
}

function registrarTarjeta(estado, minuto, jugadorId, tipo) {
  const tarjeta = { minuto, equipoId: estado.equipo.id, jugadorId, tipo };
  estado.tarjetas.push(tarjeta);
  return tarjeta;
}

function registrarAmarillaOrdinaria(rng, estado, minuto) {
  // La amarilla ordinaria nunca provoca por accidente una segunda amarilla.
  const disponibles = estado.slots.filter(slot => !estado.amarillas.has(slot.id));
  if (!disponibles.length) return null;
  const slot = disponibles[rng.int(disponibles.length)];
  estado.amarillas.set(slot.id, 1);
  return registrarTarjeta(estado, minuto, slot.id, 'amarilla');
}

function procesarAmarillasHasta(rng, programa, limite, estadoA, estadoB) {
  while (
    programa
    && programa.indiceAmarilla < programa.amarillas.length
    && programa.amarillas[programa.indiceAmarilla].minuto <= limite
  ) {
    const programada = programa.amarillas[programa.indiceAmarilla++];
    registrarAmarillaOrdinaria(
      rng,
      programada.lado === 'A' ? estadoA : estadoB,
      programada.minuto,
    );
  }
}

function slotExpulsableAleatorio(rng, estado) {
  const lineas = Object.entries(DISCIPLINA.pesosExpulsionLinea).flatMap(([linea, peso]) => {
    const slots = estado.slots.filter(slot => slot.linea === linea && slot.puesto !== 'POR');
    return slots.length ? [{ linea, peso, slots }] : [];
  });
  const pesoTotal = lineas.reduce((total, entrada) => total + entrada.peso, 0);
  if (!lineas.length || pesoTotal <= 0) return null;
  let valor = rng.next() * pesoTotal;
  let elegida = lineas[lineas.length - 1];
  for (const entrada of lineas) {
    valor -= entrada.peso;
    if (valor <= 0) {
      elegida = entrada;
      break;
    }
  }
  return elegida.slots[rng.int(elegida.slots.length)];
}

function expulsarJugador(estado, jugadorId) {
  const indice = estado.slots.findIndex(slot => slot.id === jugadorId);
  if (indice < 0) return false;
  estado.slots.splice(indice, 1);
  estado.expulsados.add(jugadorId);
  estado.numeroExpulsados = estado.expulsados.size;
  return true;
}

function aplicarExpulsionProgramada(rng, estado, programada) {
  const slot = slotExpulsableAleatorio(rng, estado);
  if (!slot) return null;

  if (programada.tipo === 'segunda_amarilla') {
    if (!estado.amarillas.has(slot.id)) {
      const desde = Math.max(1, slot.minutoEntrada ?? 1);
      const hasta = programada.minuto - 1;
      if (hasta < desde) return null;
      const minutoPrimera = desde + rng.int(hasta - desde + 1);
      estado.amarillas.set(slot.id, 1);
      registrarTarjeta(estado, minutoPrimera, slot.id, 'amarilla');
    }
    estado.amarillas.set(slot.id, (estado.amarillas.get(slot.id) || 0) + 1);
  }

  registrarTarjeta(estado, programada.minuto, slot.id, programada.tipo);
  expulsarJugador(estado, slot.id);
  return slot;
}

function hayJugadorExpulsable(estado) {
  return estado.slots.some(slot => slot.puesto !== 'POR' && ['DEF', 'MED', 'DEL'].includes(slot.linea));
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

function fuerzaActiva(estado) {
  const fuerza = fuerzaEquipo(equipoActivo(estado));
  if (!estado.numeroExpulsados) return fuerza;
  const factorAtaque = Math.pow(
    DISCIPLINA.factorAtaquePorExpulsion,
    estado.numeroExpulsados,
  );
  const factorDefensa = Math.pow(
    DISCIPLINA.factorDefensaPorExpulsion,
    estado.numeroExpulsados,
  );
  return {
    ...fuerza,
    ataque: fuerza.ataque * factorAtaque,
    defensa: fuerza.defensa * factorDefensa,
  };
}

function simularSegmento(rng, estadoA, estadoB, desdeMin, hastaMin, etapa, eventos) {
  if (hastaMin < desdeMin) return { golesA: 0, golesB: 0 };
  const duracion = hastaMin - desdeMin + 1;
  const fA = fuerzaActiva(estadoA), fB = fuerzaActiva(estadoB);
  const golesA = rng.poisson(lambdaGoles(fA.ataque, fB.defensa, etapa) * duracion / 90);
  const golesB = rng.poisson(lambdaGoles(fB.ataque, fA.defensa, etapa) * duracion / 90);
  eventos.push(
    ...golesConEventosActivos(rng, golesA, estadoA, desdeMin, hastaMin),
    ...golesConEventosActivos(rng, golesB, estadoB, desdeMin, hastaMin),
  );
  return { golesA, golesB };
}

function simularPrefijoAntesDeExpulsion(
  rng,
  estadoA,
  estadoB,
  desdeMin,
  hastaPlanificado,
  minutoExpulsion,
  etapa,
  eventos,
) {
  // Una roja no debe volver a sortear el pasado. Previsualizamos el segmento
  // completo que el motor habría generado hasta su próxima frontera legacy,
  // conservamos literalmente su prefijo y descartamos solo el futuro afectado.
  const temporales = [];
  simularSegmento(
    rng,
    estadoA,
    estadoB,
    desdeMin,
    hastaPlanificado,
    etapa,
    temporales,
  );
  const preservados = temporales.filter(evento => evento.minuto < minutoExpulsion);
  eventos.push(...preservados);
  return {
    golesA: preservados.filter(evento => evento.equipoId === estadoA.equipo.id).length,
    golesB: preservados.filter(evento => evento.equipoId === estadoB.equipo.id).length,
  };
}

function proximoMinutoCambioRealizable(intentos, desdeIndice, estadoA, estadoB, fallback) {
  for (let i = desdeIndice; i < intentos.length; i++) {
    const intento = intentos[i];
    const estado = intento.lado === 'A' ? estadoA : estadoB;
    if (candidatosCambio(estado).length > 0) return intento.minuto;
  }
  return fallback;
}

function simularPeriodo(
  rng,
  estadoA,
  estadoB,
  desdeMin,
  hastaMin,
  etapa,
  intentos,
  eventos,
  disciplina = null,
) {
  let cursor = desdeMin;
  let golesA = 0, golesB = 0;
  let indiceCambio = 0;
  let indiceExpulsion = 0;
  const expulsiones = disciplina?.programa.expulsiones || [];

  while (indiceCambio < intentos.length || indiceExpulsion < expulsiones.length) {
    const minutoCambio = intentos[indiceCambio]?.minuto ?? Infinity;
    const minutoExpulsion = expulsiones[indiceExpulsion]?.minuto ?? Infinity;
    const minuto = Math.min(minutoCambio, minutoExpulsion);
    const loteCambios = [];
    const loteExpulsiones = [];
    while (indiceCambio < intentos.length && intentos[indiceCambio].minuto === minuto) {
      loteCambios.push(intentos[indiceCambio++]);
    }
    while (indiceExpulsion < expulsiones.length && expulsiones[indiceExpulsion].minuto === minuto) {
      loteExpulsiones.push(expulsiones[indiceExpulsion++]);
    }

    // Las amarillas anteriores al corte se asignan con el XI que estaba activo,
    // pero nunca crean por sí mismas un segmento ni consumen RNG deportivo.
    procesarAmarillasHasta(
      disciplina?.rng,
      disciplina?.programa,
      minuto - 1,
      estadoA,
      estadoB,
    );

    const posiblesAntes = loteCambios.filter(intento =>
      candidatosCambio(intento.lado === 'A' ? estadoA : estadoB).length > 0);
    const hayExpulsion = loteExpulsiones.some(programada =>
      hayJugadorExpulsable(programada.lado === 'A' ? estadoA : estadoB));
    // Un intento sin pareja legal ni expulsión realizable no crea un segmento.
    if (!posiblesAntes.length && !hayExpulsion) {
      procesarAmarillasHasta(
        disciplina?.rng,
        disciplina?.programa,
        minuto,
        estadoA,
        estadoB,
      );
      continue;
    }

    const proximoCambio = posiblesAntes.length
      ? minuto
      : proximoMinutoCambioRealizable(
        intentos,
        indiceCambio,
        estadoA,
        estadoB,
        hastaMin + 1,
      );
    const tramo = hayExpulsion
      ? simularPrefijoAntesDeExpulsion(
        rng,
        estadoA,
        estadoB,
        cursor,
        Math.min(hastaMin, proximoCambio - 1),
        minuto,
        etapa,
        eventos,
      )
      : simularSegmento(rng, estadoA, estadoB, cursor, minuto - 1, etapa, eventos);
    golesA += tramo.golesA; golesB += tramo.golesB;

    // Convención del minuto compartido: expulsión, sustitución y luego goles.
    let huboExpulsion = false;
    for (const programada of loteExpulsiones) {
      const estado = programada.lado === 'A' ? estadoA : estadoB;
      if (aplicarExpulsionProgramada(disciplina.rng, estado, programada)) {
        huboExpulsion = true;
      }
    }
    // El prefijo ya consumió los valores legacy que lo originaron. Desde la
    // primera roja, todo el deporte futuro usa el substream local del partido;
    // nunca reutiliza como Poisson valores legacy destinados a cambios futuros.
    if (huboExpulsion) rng.usarFallback?.();
    const posibles = loteExpulsiones.length
      ? loteCambios.filter(intento =>
        candidatosCambio(intento.lado === 'A' ? estadoA : estadoB).length > 0)
      : posiblesAntes;
    for (const intento of posibles) {
      const estado = intento.lado === 'A' ? estadoA : estadoB;
      aplicarSustitucion(estado, elegirSustitucion(rng, estado), minuto);
    }
    procesarAmarillasHasta(
      disciplina?.rng,
      disciplina?.programa,
      minuto,
      estadoA,
      estadoB,
    );
    cursor = minuto;
  }
  procesarAmarillasHasta(
    disciplina?.rng,
    disciplina?.programa,
    hastaMin,
    estadoA,
    estadoB,
  );
  const tramoFinal = simularSegmento(rng, estadoA, estadoB, cursor, hastaMin, etapa, eventos);
  return { golesA: golesA + tramoFinal.golesA, golesB: golesB + tramoFinal.golesB };
}

function resolverPenales(rng, fA, fB, override, ambosIA = false) {
  let pa = 0, pb = 0;

  if (ambosIA) {
    // En un cruce puramente automático la clasificación es un volado exacto:
    // el primer valor elige al ganador y el segundo solo un marcador plausible.
    // Ningún rating participa en esta rama.
    const ganaA = rng.next() < 0.5;
    const marcadoresGanador = [[3, 2], [4, 2], [4, 3], [5, 4], [6, 5], [7, 6]];
    const [golesGanador, golesPerdedor] = rng.pick(marcadoresGanador);
    [pa, pb] = ganaA
      ? [golesGanador, golesPerdedor]
      : [golesPerdedor, golesGanador];
  } else {
    // Los cruces con un humano conservan el fallback automático previo. Sirve
    // como resultado provisional (o definitivo si el DT queda ausente) y el
    // override interactivo continúa reemplazándolo al final.
    let ronda = 0;
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
  }
  if (override?.penales) {
    return { golesA: override.penales.golesA, golesB: override.penales.golesB, auto: false };
  }
  return { golesA: pa, golesB: pb, auto: true };
}

function rngDesdeNext(next) {
  const rng = {
    next,
    int(n) { return Math.floor(this.next() * n); },
    pick(arr) { return arr[this.int(arr.length)]; },
    shuffle(arr) {
      const copia = arr.slice();
      for (let i = copia.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [copia[i], copia[j]] = [copia[j], copia[i]];
      }
      return copia;
    },
    poisson(lambda) {
      const limite = Math.exp(-lambda);
      let k = 0, producto = 1;
      do { k++; producto *= this.next(); } while (producto > limite);
      return k - 1;
    },
  };
  return rng;
}

function rngGrabador(rngOriginal, valores) {
  return rngDesdeNext(() => {
    const valor = rngOriginal.next();
    valores.push(valor);
    return valor;
  });
}

function rngReplay(valores, rngFallback) {
  let indice = 0;
  let soloFallback = false;
  const rng = rngDesdeNext(() =>
    !soloFallback && indice < valores.length ? valores[indice++] : rngFallback.next());
  rng.usarFallback = () => { soloFallback = true; };
  return rng;
}

function simularPartidoInterno(rng, eqA, eqB, conDesempate, override, etapa, disciplina = null) {
  const estadoA = crearEstadoPartido(eqA);
  const estadoB = crearEstadoPartido(eqB);
  const eventos = [];
  const disciplinaRegular = disciplina ? {
    rng: disciplina.rng,
    programa: programarDisciplinaPeriodo(disciplina.rng, 1, 90),
  } : null;
  const regulares = simularPeriodo(
    rng, estadoA, estadoB, 1, 90, etapa,
    intentosDeCambios(rng, VENTANAS_CAMBIOS), eventos,
    disciplinaRegular,
  );
  const goles90A = regulares.golesA, goles90B = regulares.golesB;
  let golesA = goles90A, golesB = goles90B;
  let alargue = false;

  if (conDesempate && golesA === golesB) {
    alargue = true;
    // El stream disciplinario continúa, pero 91-120 solo se programa cuando el
    // empate real confirma que ese periodo existe.
    const disciplinaExtra = disciplina ? {
      rng: disciplina.rng,
      programa: programarDisciplinaPeriodo(disciplina.rng, 91, 120),
    } : null;
    const extra = simularPeriodo(
      rng, estadoA, estadoB, 91, 120, etapa,
      intentosDeCambios(rng, VENTANAS_ALARGUE), eventos,
      disciplinaExtra,
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
      eqA.esIA === true && eqB.esIA === true,
    );
  }

  eventos.sort((a, b) => a.minuto - b.minuto);
  const sustituciones = [...estadoA.sustituciones, ...estadoB.sustituciones]
    .sort((a, b) => a.minuto - b.minuto || a.equipoId.localeCompare(b.equipoId));
  const tarjetas = [...estadoA.tarjetas, ...estadoB.tarjetas]
    .sort((a, b) =>
      a.minuto - b.minuto
      || ORDEN_TARJETA[a.tipo] - ORDEN_TARJETA[b.tipo]
      || a.equipoId.localeCompare(b.equipoId)
      || a.jugadorId.localeCompare(b.jugadorId));
  const ganador = golesA > golesB ? eqA.id
    : golesB > golesA ? eqB.id
    : penales ? (penales.golesA > penales.golesB ? eqA.id : eqB.id)
    : null;

  return {
    idA: eqA.id, idB: eqB.id,
    goles90A, goles90B, golesA, golesB,
    eventos, sustituciones, tarjetas,
    slotsFinalesA: snapshotSlots(estadoA),
    slotsFinalesB: snapshotSlots(estadoB),
    alargue, duracion: alargue ? 120 : 90,
    penales, ganador,
  };
}

export function simularPartido(
  rng,
  eqA,
  eqB,
  conDesempate = false,
  override = null,
  soloPenales = false,
  etapa = 'grupos',
  claveDisciplina = null,
) {
  // Solo Penales conserva la ruta temprana legacy: no genera minutos, cambios,
  // disciplina, Poisson de partido ni alargue, y entra directamente a la tanda.
  if (soloPenales) {
    const fA = fuerzaEquipo(eqA), fB = fuerzaEquipo(eqB);
    const penales = resolverPenales(
      rng,
      fA,
      fB,
      override,
      eqA.esIA === true && eqB.esIA === true,
    );
    const ganador = penales.golesA > penales.golesB ? eqA.id : eqB.id;
    return {
      idA: eqA.id, idB: eqB.id,
      goles90A: 0, goles90B: 0,
      golesA: penales.golesA, golesB: penales.golesB,
      eventos: [], sustituciones: [], tarjetas: [], alargue: false, duracion: 0,
      penales, ganador,
    };
  }

  const clave = String(claveDisciplina ?? `${eqA.id}-${eqB.id}-${etapa}`);
  const valoresLegacy = [];

  // La simulación sombra avanza el RNG deportivo global exactamente como lo
  // hacía el motor sin disciplina (incluidos alargue y tanda). El partido visible
  // reproduce esos valores; si una roja crea cortes adicionales, usa un fallback
  // deportivo local. Así ninguna tarjeta desplaza el stream de partidos futuros.
  simularPartidoInterno(
    rngGrabador(rng, valoresLegacy),
    eqA, eqB, conDesempate, override, etapa, null,
  );
  const rngDeporte = rngReplay(
    valoresLegacy,
    new Rng(`deporte-disciplina-${clave}`),
  );
  return simularPartidoInterno(
    rngDeporte,
    eqA,
    eqB,
    conDesempate,
    override,
    etapa,
    { rng: new Rng(`disciplina-${clave}`) },
  );
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
  const libres = rng.shuffle(poolSquads
    .filter(s => !usados.has(s.key))
    .map(s => ({ squad: s, formaciones: formacionesDisponiblesMaquina(s) }))
    .filter(candidato => candidato.formaciones.length > 0));
  const equipos = [...equiposHumanos];
  let i = 0;
  while (equipos.length < total) {
    const { squad: s, formaciones: disponibles } = libres[i++ % libres.length];
    const candidatas = ['4-3-3', '4-4-2', '3-5-2'].filter(f => disponibles.includes(f));
    const formacion = rng.pick(candidatas.length ? candidatas : disponibles);
    equipos.push({
      id: 'ia-' + s.key, nombre: null, esIA: true,
      squadKey: s.key, formacion, lineup: mejorXIMaquina(s, formacion),
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
        const claveA = `g-fecha${f + 1}-${gr.nombre}-0`;
        const claveB = `g-fecha${f + 1}-${gr.nombre}-1`;
        partidos.push({
          grupo: gr.nombre,
          ...simularPartido(
            rng, gr.equipos[a], gr.equipos[b], false, null, false, 'grupos', `${seed}-${claveA}`,
          ),
        });
        partidos.push({
          grupo: gr.nombre,
          ...simularPartido(
            rng, gr.equipos[c], gr.equipos[d], false, null, false, 'grupos', `${seed}-${claveB}`,
          ),
        });
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
      return {
        ...simularPartido(
          rng, a, b, true, overrides[clave], soloPenales, etapa, `${seed}-${clave}`,
        ),
        clave,
      };
    });
    llaves.push({ nombre: nombresRonda[r], partidos });
    const ganadores = partidos.map(p => eqById[p.ganador]);
    if (nombresRonda[r] === 'Semifinales') {
      const perdedores = partidos.map(p => eqById[p.ganador === p.idA ? p.idB : p.idA]);
      tercerPuesto = {
        ...simularPartido(
          rng,
          perdedores[0],
          perdedores[1],
          true,
          overrides['tp'],
          soloPenales,
          'tercerPuesto',
          `${seed}-tp`,
        ),
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
