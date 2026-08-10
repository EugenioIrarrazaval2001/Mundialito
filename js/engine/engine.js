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
  return lineupDesdeSlots(slots, 'equilibrado');
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

export function lineupDesdeSlots(slots, estilo = 'equilibrado') {
  return {
    POR: slots.filter(s => s.linea === 'POR').map(s => s.id),
    DEF: slots.filter(s => s.linea === 'DEF').map(s => s.id),
    MED: slots.filter(s => s.linea === 'MED').map(s => s.id),
    DEL: slots.filter(s => s.linea === 'DEL').map(s => s.id),
    slots,
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

function lambdaGoles(atk, rivalDef) {
  // diferencia de ~14 puntos duplica/halvea los goles esperados
  const l = 1.05 * Math.pow(2, (atk - rivalDef) / 14);
  return Math.min(4.0, Math.max(0.15, l));
}

function elegirGoleador(rng, equipo) {
  const cand = [];
  for (const [pos, peso] of [['DEL', 5], ['MED', 2.2], ['DEF', 0.6]]) {
    for (const { jugador, nivel } of entradasLinea(equipo.lineup, pos)) {
      cand.push({ j: jugador, w: peso * (nivel / 80) });
    }
  }
  const total = cand.reduce((a, c) => a + c.w, 0);
  let r = rng.next() * total;
  for (const c of cand) { r -= c.w; if (r <= 0) return c.j; }
  return cand[cand.length - 1].j;
}

function golesConEventos(rng, n, equipo, desdeMin = 1, hastaMin = 90) {
  const eventos = [];
  for (let i = 0; i < n; i++) {
    eventos.push({
      minuto: desdeMin + rng.int(hastaMin - desdeMin + 1),
      jugador: elegirGoleador(rng, equipo).nombre,
      equipoId: equipo.id,
    });
  }
  return eventos;
}

export function simularPartido(rng, eqA, eqB, conDesempate = false, override = null, soloPenales = false) {
  const fA = fuerzaEquipo(eqA), fB = fuerzaEquipo(eqB);
  // modo "solo penales": no se juega el partido, va directo a la tanda (0-0)
  let golesA = soloPenales ? 0 : rng.poisson(lambdaGoles(fA.ataque, fB.defensa));
  let golesB = soloPenales ? 0 : rng.poisson(lambdaGoles(fB.ataque, fA.defensa));
  const eventos = soloPenales ? [] : [
    ...golesConEventos(rng, golesA, eqA),
    ...golesConEventos(rng, golesB, eqB),
  ];
  let penales = null;

  if (soloPenales || (conDesempate && golesA === golesB)) {
    // Empate (o modo solo penales) → tanda. Determinista SIEMPRE (consumo estable
    // del RNG entre clientes); si hubo tanda interactiva del DT (override), manda ese.
    let pa = 0, pb = 0, ronda = 0;
    const pConvierte = (gkRival) => 0.78 - (gkRival - 80) * 0.004;
    while (true) {
      ronda++;
      const ca = rng.next() < pConvierte(fB.gk) ? 1 : 0;
      const cb = rng.next() < pConvierte(fA.gk) ? 1 : 0;
      pa += ca; pb += cb;
      // al mejor de 5: termina apenas la ventaja sea inalcanzable
      const restantes = Math.max(0, 5 - ronda);
      if (pa > pb + restantes || pb > pa + restantes) break;
      if (ronda >= 12) { if (rng.next() < 0.5) pa++; else pb++; break; }
    }
    penales = { golesA: pa, golesB: pb, auto: true };
    if (override?.penales) {
      penales = { golesA: override.penales.golesA, golesB: override.penales.golesB, auto: false };
    }
    // en modo solo penales, el marcador del partido ES el de la tanda
    if (soloPenales) { golesA = penales.golesA; golesB = penales.golesB; }
  }

  eventos.sort((a, b) => a.minuto - b.minuto);
  const ganador = golesA > golesB ? eqA.id
    : golesB > golesA ? eqB.id
    : penales ? (penales.golesA > penales.golesB ? eqA.id : eqB.id)
    : null;

  return { idA: eqA.id, idB: eqB.id, golesA, golesB, eventos, penales, ganador };
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
        partidos.push({ grupo: gr.nombre, ...simularPartido(rng, gr.equipos[a], gr.equipos[b]) });
        partidos.push({ grupo: gr.nombre, ...simularPartido(rng, gr.equipos[c], gr.equipos[d]) });
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
    const partidos = ronda.map(([a, b], i) => {
      const clave = `k${r}-${i}`;
      return { ...simularPartido(rng, a, b, true, overrides[clave], soloPenales), clave };
    });
    llaves.push({ nombre: nombresRonda[r], partidos });
    const ganadores = partidos.map(p => eqById[p.ganador]);
    if (nombresRonda[r] === 'Semifinales') {
      const perdedores = partidos.map(p => eqById[p.ganador === p.idA ? p.idB : p.idA]);
      tercerPuesto = { ...simularPartido(rng, perdedores[0], perdedores[1], true, overrides['tp'], soloPenales), clave: 'tp' };
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
