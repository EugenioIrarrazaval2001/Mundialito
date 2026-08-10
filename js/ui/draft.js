// Draft estilo 7a0: tiras el dado, sale una selección histórica de un mundial,
// eliges UN jugador de ella, y vuelves a tirar hasta completar el once.
// 3 comodines: re-sortear selección del mismo mundial, o mismo país de otro mundial.

import { net, miId } from '../net/net.js';
import { render, html, esc, $, $$, toast } from './dom.js';
import { app, soyHost, salirDeSala } from '../main.js';
import { SQUADS, FORMACIONES, FORMACION_SLOTS, JUGADORES_BY_ID, bandera, lineaDePuesto, nivelEnPuesto, puestosJugador, squadsParaModo } from '../data/squads.js';
import { lineupDesdeSlots, parseModo } from '../engine/engine.js';

// en almanaque los niveles van ocultos, pero se revelan al enviar el once
function nivelesOcultos(room, draft) {
  return parseModo(room.modo).modo === 'almanaque' && !draft.enviado;
}

// chip de estado del header: antes de empezar muestra el modo; una vez iniciado
// el draft, formación · estilo · modo (ya fijos, como en el 7a0)
function chipEstadoTexto(draft, room) {
  const m = parseModo(room.modo).modo;
  const corto = m === 'almanaque' ? 'ALMANAQUE' : m === 'penales' ? 'SOLO PENALES' : m === 'mundial2026' ? 'MUNDIAL 2026' : 'CLÁSICO';
  const emoji = m === 'almanaque' ? '📖' : m === 'penales' ? '🧤' : m === 'mundial2026' ? '🏆' : '⭐';
  if (!draft.iniciado) return `${emoji} ${corto}`;
  const estilo = { defensivo: 'DEFENSIVO', equilibrado: 'EQUILIBRADO', ofensivo: 'OFENSIVO' }[draft.estilo] || '';
  return `${draft.formacion} · ${estilo} · ${corto}`;
}

const ESTILOS = [['defensivo', 'Defensivo'], ['equilibrado', 'Equilibrado'], ['ofensivo', 'Ofensivo']];
const FILAS_CANCHA = [
  ['EI', 'DC', 'ED'],
  ['MI', 'MCO', 'MD'],
  ['MC', 'MCD'],
  ['LI', 'DFC', 'LD'],
  ['POR'],
];

export function pantallaDraft(root) {
  const yo = app.estado.players.find(p => p.id === miId());

  const picksIniciales = slotsDesdeLineup(yo.formacion || '4-3-3', yo.lineup);
  const draft = {
    formacion: yo.formacion || '4-3-3',
    estilo: yo.lineup?.estilo || 'equilibrado',
    picks: picksIniciales,
    comodines: 3,
    oferta: null,         // plantel sorteado este turno (null = hay que tirar)
    colocando: null,      // { id, puesto } elegido, esperando click en la cancha
    ofrecidas: new Set(), // keys ya ofrecidas, para no repetir
    enviado: yo.ready,
    // formación y estilo se eligen al principio; al empezar a armar quedan fijos
    // y el bloque de configuración desaparece para darle espacio a la lista
    iniciado: picksIniciales.length > 0 || yo.ready,
  };

  dibujarTodo(root, draft);

  const handler = () => actualizarRivales(root);
  document.addEventListener('sala:cambio', handler);
  app.limpiezaPantalla = () => document.removeEventListener('sala:cambio', handler);
}

// ---------- lógica ----------

function slotsFormacion(draft) { return FORMACION_SLOTS[draft.formacion] || FORMACION_SLOTS['4-3-3']; }
function totalPicks(draft) { return draft.picks.length; }
function completo(draft) { return totalPicks(draft) === 11; }

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

function idsElegidos(draft) {
  return new Set(draft.picks.map(p => p.id));
}

function puestosDisponibles(draft, jugador) {
  const usados = new Set(draft.picks.map(p => p.slotIndex));
  return slotsFormacion(draft)
    .map((puesto, i) => ({ puesto, i }))
    .filter(({ puesto, i }) => !usados.has(i) && nivelEnPuesto(jugador, puesto) !== null);
}

function jugadorColocando(draft) {
  return draft.colocando ? JUGADORES_BY_ID[draft.colocando.id] : null;
}

function elegibles(draft, squad) {
  const ya = idsElegidos(draft);
  // misma persona en distintos mundiales: no se puede tener 2 Messis
  const personas = new Set([...ya].map(id => {
    const j = JUGADORES_BY_ID[id];
    return j.squad.pais + '|' + j.nombre;
  }));
  return new Set(squad.jugadores
    .filter(j => !ya.has(j.id)
      && !personas.has(squad.pais + '|' + j.nombre)
      && puestosDisponibles(draft, j).length)
    .map(j => j.id));
}

// pool de selecciones del modo actual (en "mundial2026" solo las del Mundial 2026)
function poolSquads() {
  return squadsParaModo(parseModo(app.estado.room.modo).modo);
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

function bonusPuesto(jugador, puesto, almanaque = false) {
  if (almanaque) return '';
  const resumen = resumenPuestos(jugador);
  const nivel = nivelEnPuesto(jugador, puesto);
  const delta = nivel - resumen.min;
  return delta > 0 ? `+${delta}` : '';
}

function agregarPick(draft, jugador, puesto, slotIndex) {
  draft.picks.push({
    puesto,
    linea: lineaDePuesto(puesto),
    id: jugador.id,
    nivel: nivelEnPuesto(jugador, puesto) ?? jugador.nivel,
    slotIndex,
  });
  draft.colocando = null;
}

// ---------- UI ----------

function dibujarTodo(root, draft) {
  const { room } = app.estado;

  render(root, html`
    <div class="draft">
      <header class="cabecera-sala">
        <button id="btn-salir-draft" class="btn btn-mini">← Salir</button>
        <div class="ticket"><span class="ticket-label">SALA</span>
          <span class="ticket-codigo">${esc(room.code)}</span></div>
        <div class="sorteo-resultado">
          <span class="sorteo-label">ARMA TU COMBINADO HISTÓRICO</span>
          <span class="sorteo-equipo">Elección <span id="turno-num">${Math.min(totalPicks(draft) + 1, 11)}</span> de 11</span>
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
    if (draft.picks.length && !confirm(
      'Si sales, pierdes el equipo que llevas armado y vuelves al menú principal. ¿Seguro?')) return;
    salirDeSala();
  });

  dibujarEstado(root, draft);
  actualizarRivales(root);
}

function dibujarEstado(root, draft) {
  dibujarPanelIzq(root, draft);
  dibujarCancha(root, draft);
  dibujarBox(root, draft);
  const turno = $('#turno-num', root);
  if (turno) turno.textContent = Math.min(totalPicks(draft) + 1, 11);
  const chip = $('#chip-estado', root);
  if (chip) chip.textContent = chipEstadoTexto(draft, app.estado.room);
}

function dibujarPanelIzq(root, draft) {
  const { room } = app.estado;
  const almanaque = nivelesOcultos(room, draft);
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
      <div class="caja-tirar"><p>Once completo, DT.<br>Revisa la cancha y confírmalo.</p></div>
      <button id="btn-listo" class="btn-tirar">✓ ENVIAR MI ONCE</button>`;
  } else if (draft.girando) {
    sorteo = '<div class="salio ruleta" id="ruleta"><span class="salio-label">SORTEANDO…</span></div>';
  } else if (!draft.iniciado) {
    // setup: elige formación y estilo; al empezar a armar quedan fijos y este bloque se va
    sorteo = config + html`
      <div class="caja-tirar"><p>Elige tu <b>formación</b> y tu <b>estilo</b>.<br>
        Al empezar a armar quedan fijos.</p></div>
      <button id="btn-tirar" class="btn-tirar">🎲 EMPEZAR A ARMAR</button>`;
  } else if (!draft.oferta) {
    sorteo = html`
      <div class="caja-tirar"><p>Tira para sortear una<br>selección y un Mundial</p></div>
      <button id="btn-tirar" class="btn-tirar">TIRAR 🎲</button>`;
  } else {
    const s = draft.oferta;
    const sel = elegibles(draft, s);
    const candM = mismoMundial(draft);
    const candP = mismaSeleccion(draft);
    sorteo = html`
      <div class="salio">
        <span class="salio-label">SALIÓ</span>
        <span class="salio-pais">${bandera(s, 21)} ${esc(s.pais)}</span>
        <span class="salio-mundial">Mundial ${s.anio}</span>
        <span class="salio-apodo">"${esc(s.apodo)}"</span>
      </div>
      <div class="resorteo">
        <span class="resorteo-titulo">¿NO TE GUSTÓ? RE-SORTEA · ${draft.comodines} RESTANTES</span>
        <div class="resorteo-botones">
          <button id="cmd-mundial" class="btn btn-mini"
            ${draft.comodines > 0 && candM.length ? '' : 'disabled'}>↺ OTRA SELECCIÓN</button>
          <button id="cmd-pais" class="btn btn-mini"
            ${draft.comodines > 0 && candP.length ? '' : 'disabled'}>↺ OTRO MUNDIAL</button>
        </div>
      </div>
      <h4 class="titulo-pos">ELIGE UN JUGADOR</h4>
      ${draft.colocando ? html`
        <p class="nota jugador-seleccionado">
          Seleccionado: <b>${esc(jugadorColocando(draft).nombre)}</b>.
          Elige un círculo rojo o cambia de jugador en la lista.
        </p>` : ''}
      <div class="lista-elegir">
        ${s.jugadores.map(j => {
          const resumen = resumenPuestos(j, almanaque);
          return html`<button class="fila-jugador ${draft.colocando?.id === j.id ? 'seleccionado' : ''}" data-id="${j.id}" ${sel.has(j.id) ? '' : 'disabled'}>
            <span class="fj-nombre">${esc(j.nombre)}</span>
            <span class="fj-pos">${resumen.puestos}</span>
            <span class="fj-nivel">${resumen.nivel}</span>
          </button>`;
        }).join('')}
      </div>
      ${sel.size ? '' : html`
        <button id="cmd-pasar" class="btn btn-mini btn-primario pasar-btn">
          ⏭ Sin cupos en esta selección — pasar gratis</button>`}`;
  }

  // botón de escape: volver al menú de formación/estilo (descarta el equipo en curso)
  const volverBtn = (draft.iniciado && !draft.enviado && !draft.girando)
    ? '<button id="btn-volver-setup" class="btn btn-volver">↩ Cambiar formación / estilo</button>'
    : '';
  zona.innerHTML = sorteo + volverBtn;
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

  $('#btn-volver-setup', zona)?.addEventListener('click', () => {
    if (draft.picks.length && !confirm(
      'Volver al menú borra el equipo que llevas armado y te deja elegir de nuevo la formación y el estilo. ¿Seguro?')) return;
    draft.iniciado = false;
    draft.picks = [];
    draft.oferta = null;
    draft.colocando = null;
    draft.comodines = 3;
    draft.ofrecidas = new Set();
    draft.girando = false;
    dibujarEstado(root, draft);
  });

  $$('.fila-jugador:not(:disabled)', zona).forEach(b => b.addEventListener('click', () => {
    const j = JUGADORES_BY_ID[b.dataset.id];
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
    draft.comodines--;
    girarYSortear(root, draft, mismoMundial(draft));
  });
  $('#cmd-pais', zona)?.addEventListener('click', () => {
    draft.comodines--;
    girarYSortear(root, draft, mismaSeleccion(draft));
  });
  $('#cmd-pasar', zona)?.addEventListener('click', () => {
    girarYSortear(root, draft);
  });

  $('#btn-listo', zona)?.addEventListener('click', async () => {
    const { room } = app.estado;
    draft.enviado = true;
    try {
      await net.actualizarJugador(room.code, miId(), {
        formacion: draft.formacion,
        lineup: lineupDesdeSlots(draft.picks, draft.estilo),
        ready: true,
      });
    } catch (e) {
      draft.enviado = false;
      toast('No se pudo enviar tu equipo: ' + e.message, true);
    }
    dibujarEstado(root, draft);
  });
}

function dibujarCancha(root, draft) {
  const { room } = app.estado;
  const almanaque = nivelesOcultos(room, draft);
  const slots = slotsFormacion(draft).map((puesto, i) => ({ puesto, i }));
  const colocando = jugadorColocando(draft);
  const disponible = new Set(colocando
    ? puestosDisponibles(draft, colocando).map(o => o.i)
    : []);
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
              <span class="slot-circulo">${almanaque ? '⚽' : pick.nivel}</span>
              <span class="slot-puesto">${puesto}</span>
              <span class="slot-nombre">${bandera(j.squad, 12)} ${esc(j.nombre)}</span>
            </button>`;
        }
        const puede = disponible.has(i);
        const bonus = puede && colocando ? bonusPuesto(colocando, puesto, almanaque) : '';
        return html`
          <button class="slot ${puede ? 'slot-disponible' : ''}" data-slot="${i}" ${puede ? '' : 'disabled'}>
            <span class="slot-circulo vacio"><span class="slot-pos-label">${puesto}</span>${bonus ? `<small>${bonus}</small>` : ''}</span>
          </button>`;
      });
    return `<div class="fila-cancha7">${slotsFila.join('')}</div>`;
  }).join('');

  $('#cancha7', root).innerHTML = html`<div class="pasto7">${filas}</div>`;

  $$('.slot-disponible', root).forEach(b => b.addEventListener('click', () => {
    const j = jugadorColocando(draft);
    const puesto = slotsFormacion(draft)[Number(b.dataset.slot)];
    agregarPick(draft, j, puesto, Number(b.dataset.slot));
    draft.oferta = null;
    dibujarEstado(root, draft);
  }));
}

function dibujarBox(root, draft) {
  const { room } = app.estado;
  const almanaque = nivelesOcultos(room, draft); // al enviar el once, se revelan

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
          <span class="box-nivel">${j ? (almanaque ? '?' : pick.nivel) : ''}</span>
        </div>`;
    }).join('');

  $('#boxscore', root).innerHTML = html`
    <div class="boxscore">
      <div class="box-cabecera">
        <span class="box-titulo">BOX SCORE · ${totalPicks(draft)}/11</span>
        <span class="box-fuerzas">
          <b class="atq">${v(ataque)}</b> ATAQUE&nbsp;&nbsp;<b class="dfn">${v(defensa)}</b> DEFENSA
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
        <span class="rival-equipo">${p.ready ? 'once listo' : 'armando su once…'}</span>
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
