// Pantalla de inicio: crear sala o unirse

import { net, ONLINE } from '../net/net.js';
import { render, html, esc, $, toast } from './dom.js';
import { entrarASala } from '../main.js';
import {
  SQUADS_HISTORICAS_AMPLIADAS, RESULTADO_MUNDIAL, bandera, squadsParaModo,
} from '../data/squads.js';

const ORDEN_LINEAS = ['POR', 'DEF', 'MED', 'DEL'];
const NOMBRE_LINEA = {
  POR: 'ARQUEROS', DEF: 'DEFENSAS', MED: 'MEDIOCAMPISTAS', DEL: 'DELANTEROS',
};
const PRESENTACION_RESULTADO = {
  'Campeón': { texto: '🏆 CAMPEÓN', clase: 'campeon' },
  'Subcampeón': { texto: '🥈 SUBCAMPEÓN', clase: 'subcampeon' },
  'Tercer lugar': { texto: '🥉 TERCER LUGAR', clase: 'tercero' },
  'Cuarto lugar': { texto: '4.º LUGAR', clase: 'cuarto' },
  'Cuartos de final': { texto: 'CUARTOS DE FINAL', clase: 'eliminatoria' },
  'Octavos de final': { texto: 'OCTAVOS DE FINAL', clase: 'eliminatoria' },
  'Fase de grupos': { texto: 'FASE DE GRUPOS', clase: 'fase' },
  'Segunda fase (Top 8)': { texto: 'SEGUNDA FASE · TOP 8', clase: 'fase' },
  'Segunda fase (Top 12)': { texto: 'SEGUNDA FASE · TOP 12', clase: 'fase' },
};

// Configuración temporal de Home: persiste al abrir/cerrar el menú, pero no se
// guarda en localStorage. Al recargar, vuelve a comenzar con todas activadas.
const enabledSquadKeys = new Set(SQUADS_HISTORICAS_AMPLIADAS.map(s => s.key));

function mundialesDelPoolPrincipal() {
  const porAnio = new Map();
  for (const squad of SQUADS_HISTORICAS_AMPLIADAS) {
    if (!porAnio.has(squad.anio)) porAnio.set(squad.anio, []);
    porAnio.get(squad.anio).push(squad);
  }
  return [...porAnio.entries()].sort(([anioA], [anioB]) => anioA - anioB);
}

function keysActivasOrdenadas() {
  return SQUADS_HISTORICAS_AMPLIADAS
    .filter(squad => enabledSquadKeys.has(squad.key))
    .map(squad => squad.key);
}

// El universo elegido pertenece al prÃ³ximo torneo, no al grupo. Se expone
// aquÃ­ para que el dashboard pueda reutilizar el selector completo sin
// duplicar su estado ni su lÃ³gica de validaciÃ³n.
export function keysDraftActivas() {
  return keysActivasOrdenadas();
}

export function configuracionDraftValida(modo = 'almanaque') {
  return squadsParaModo(modo, keysActivasOrdenadas()).length > 0;
}

export function resumenUniversoDraft(modo = 'almanaque') {
  return {
    activos: squadsParaModo(modo, keysActivasOrdenadas()).length,
    total: squadsParaModo(modo).length,
  };
}

function presentacionResultado(squad) {
  const resultado = RESULTADO_MUNDIAL[squad.key];
  const presentacion = PRESENTACION_RESULTADO[resultado];
  if (!presentacion) throw new Error(`Falta resultado mundial para ${squad.key}`);
  return { resultado, ...presentacion };
}

function badgeResultado(squad) {
  const { resultado, texto, clase } = presentacionResultado(squad);
  return `<span class="resultado-badge resultado-${clase}" title="${esc(resultado)}">${esc(texto)}</span>`;
}

function mediaPlantel(squad) {
  const total = squad.jugadores.reduce((suma, jugador) => suma + jugador.nivel, 0);
  return (total / squad.jugadores.length).toFixed(1);
}

function detallePlantelHtml(squad) {
  return html`
    <section class="panel-detalle-seleccion" role="dialog" aria-modal="true"
      aria-labelledby="titulo-detalle-${esc(squad.key)}">
      <header class="detalle-seleccion-cabecera">
        <button type="button" class="btn btn-volver-detalle">← Volver</button>
        <div class="detalle-seleccion-identidad">
          <span class="flag-slot flag-slot-grande">${bandera(squad, 24)}</span>
          <div>
            <h2 id="titulo-detalle-${esc(squad.key)}">${esc(squad.pais)} · ${squad.anio}</h2>
            ${badgeResultado(squad)}
          </div>
        </div>
      </header>
      <div class="detalle-seleccion-contenido">
        <div class="detalle-estadisticas">
          <div class="detalle-estadistica">
            <span>MEDIA DEL PLANTEL</span>
            <strong>${mediaPlantel(squad)}</strong>
          </div>
          <div class="detalle-estadistica">
            <span>JUGADORES</span>
            <strong>${squad.jugadores.length}</strong>
          </div>
        </div>
        <div class="plantel-grupos">
          ${ORDEN_LINEAS.map(pos => {
            const jugadores = squad.jugadores.filter(jugador => jugador.pos === pos);
            if (!jugadores.length) return '';
            return html`
              <section class="plantel-grupo">
                <h3>${NOMBRE_LINEA[pos]}</h3>
                <div class="plantel-lista">
                  ${jugadores.map(jugador => html`
                    <div class="plantel-jugador">
                      <span class="plantel-jugador-nombre">${esc(jugador.nombre)}</span>
                      <span class="plantel-jugador-pos">${jugador.pos}</span>
                      <strong class="plantel-jugador-rating">${jugador.nivel}</strong>
                    </div>
                  `).join('')}
                </div>
              </section>`;
          }).join('')}
        </div>
      </div>
    </section>
  `;
}

function abrirSeleccionesMundiales(disparador, {
  alCambiar, configuracionValida, resumenDraft,
}) {
  if (document.querySelector('.overlay-selecciones-mundiales')) return;

  const mundiales = mundialesDelPoolPrincipal();
  const squadsByKey = new Map(SQUADS_HISTORICAS_AMPLIADAS.map(s => [s.key, s]));
  const appRoot = document.getElementById('app');
  const appEraInerte = appRoot?.hasAttribute('inert') ?? false;
  const overlay = document.createElement('div');
  overlay.className = 'overlay-selecciones-mundiales';
  overlay.innerHTML = html`
    <section class="panel-selecciones-mundiales" role="dialog" aria-modal="true"
      aria-labelledby="titulo-selecciones-mundiales"
      aria-describedby="explicacion-selecciones-mundiales">
      <header class="selecciones-mundiales-cabecera">
        <div>
          <h2 id="titulo-selecciones-mundiales">UNIVERSO DEL DRAFT</h2>
          <p id="explicacion-selecciones-mundiales" class="selecciones-explicacion">
            Elige qué planteles pueden aparecer mientras armas tu equipo.
            Esto no afecta a los rivales que podrás enfrentar en el torneo.
          </p>
          <p class="selecciones-conteo-global" aria-live="polite">
            <strong data-total-activas></strong>
          </p>
          <p class="selecciones-aviso-draft" hidden>
            Activa al menos un plantel para el draft.
          </p>
        </div>
        <button type="button" class="btn btn-volver-selecciones">Volver</button>
      </header>
      <div class="selecciones-mundiales-contenido">
        ${mundiales.map(([anio, squads]) => html`
          <section class="mundial-acordeon" data-anio="${anio}">
            <header class="mundial-acordeon-cabecera">
              <button type="button" class="mundial-acordeon-trigger"
                aria-expanded="false" aria-controls="panel-mundial-${anio}">
                <span class="mundial-resumen-linea">
                  <strong class="mundial-anio">${anio}</strong>
                  <span class="mundial-conteo" data-conteo-anio></span>
                  <span class="mundial-estado" data-estado-anio></span>
                  <span class="mundial-chevron" aria-hidden="true">▼</span>
                </span>
                <span class="mundial-preview">${squads.map(s => esc(s.pais)).join(' · ')}</span>
              </button>
              <label class="interruptor interruptor-mundial">
                <input type="checkbox" data-switch-anio="${anio}"
                  aria-label="Incluir o excluir planteles del Mundial ${anio} en el draft">
                <span class="interruptor-pista" aria-hidden="true"><span></span></span>
                <span class="interruptor-estado" aria-hidden="true"></span>
              </label>
            </header>
            <div id="panel-mundial-${anio}" class="mundial-acordeon-panel" hidden>
              <div class="selecciones-mundial-grid">
                ${squads.map(squad => html`
                  <article class="seleccion-mundial" data-squad-key="${esc(squad.key)}">
                    <button type="button" class="seleccion-detalle-trigger"
                      data-detalle-squad="${esc(squad.key)}"
                      aria-label="Ver plantel de ${esc(squad.pais)} ${squad.anio}">
                      <span class="flag-slot">${bandera(squad, 18)}</span>
                      <span class="seleccion-identidad">
                        <strong>${esc(squad.pais)}</strong>
                        ${badgeResultado(squad)}
                      </span>
                    </button>
                    <label class="interruptor interruptor-seleccion">
                      <input type="checkbox" data-switch-squad="${esc(squad.key)}"
                        aria-label="Incluir o excluir ${esc(squad.pais)} ${squad.anio} del draft">
                      <span class="interruptor-pista" aria-hidden="true"><span></span></span>
                      <span class="interruptor-estado" aria-hidden="true"></span>
                    </label>
                  </article>
                `).join('')}
              </div>
            </div>
          </section>
        `).join('')}
      </div>
    </section>
  `;

  const panelPrincipal = overlay.querySelector('.panel-selecciones-mundiales');
  let panelDetalle = null;
  let retornoDetalle = null;

  const elementosEnfocables = panel => [...panel.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(el => !el.closest('[hidden]'));

  const cerrarDetalle = () => {
    if (!panelDetalle) return;
    panelDetalle.remove();
    panelDetalle = null;
    panelPrincipal.hidden = false;
    if (retornoDetalle?.isConnected) retornoDetalle.focus();
    retornoDetalle = null;
  };

  const cerrar = () => {
    document.removeEventListener('keydown', gestionarTeclado);
    overlay.remove();
    if (appRoot && !appEraInerte) appRoot.inert = false;
    if (disparador?.isConnected) disparador.focus();
  };
  const gestionarTeclado = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (panelDetalle) cerrarDetalle();
      else cerrar();
      return;
    }
    if (e.key !== 'Tab') return;
    const panelActivo = panelDetalle || panelPrincipal;
    const focos = elementosEnfocables(panelActivo);
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (!panelActivo.contains(document.activeElement)) {
      e.preventDefault();
      primero.focus();
    } else if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  const actualizarEstadoVisual = () => {
    for (const [anio, squads] of mundiales) {
      const bloque = overlay.querySelector(`.mundial-acordeon[data-anio="${anio}"]`);
      const activas = squads.filter(s => enabledSquadKeys.has(s.key)).length;
      const parcial = activas > 0 && activas < squads.length;
      const estado = activas === 0 ? 'OFF' : parcial ? 'PARCIAL' : 'ON';
      const master = bloque.querySelector('[data-switch-anio]');
      master.checked = activas === squads.length;
      master.indeterminate = parcial;
      master.setAttribute('aria-checked', parcial ? 'mixed' : String(master.checked));
      bloque.querySelector('[data-conteo-anio]').textContent =
        `${activas} / ${squads.length} disponibles`;
      const etiquetaEstado = bloque.querySelector('[data-estado-anio]');
      etiquetaEstado.textContent = estado;
      etiquetaEstado.className = `mundial-estado mundial-estado-${estado.toLowerCase()}`;
      bloque.querySelector('.interruptor-estado').textContent = estado;
    }

    overlay.querySelectorAll('[data-squad-key]').forEach(card => {
      const activa = enabledSquadKeys.has(card.dataset.squadKey);
      card.dataset.enabled = String(activa);
      card.classList.toggle('seleccion-off', !activa);
      const input = card.querySelector('[data-switch-squad]');
      input.checked = activa;
      card.querySelector('.interruptor-estado').textContent = activa ? 'ON' : 'OFF';
    });

    const { activos, total } = resumenDraft();
    const descripcionCantidad = activos === 1
      ? 'plantel disponible en el draft'
      : 'planteles disponibles en el draft';
    overlay.querySelector('[data-total-activas]').textContent =
      `${activos} / ${total} ${descripcionCantidad}`;
    overlay.querySelector('.selecciones-aviso-draft').hidden = configuracionValida();
  };

  overlay.addEventListener('click', e => {
    const acordeon = e.target.closest('.mundial-acordeon-trigger');
    if (acordeon) {
      const panel = document.getElementById(acordeon.getAttribute('aria-controls'));
      const abrir = acordeon.getAttribute('aria-expanded') !== 'true';
      acordeon.setAttribute('aria-expanded', String(abrir));
      panel.hidden = !abrir;
      return;
    }

    const detalleTrigger = e.target.closest('[data-detalle-squad]');
    if (detalleTrigger) {
      const squad = squadsByKey.get(detalleTrigger.dataset.detalleSquad);
      if (!squad) return;
      retornoDetalle = detalleTrigger;
      panelPrincipal.hidden = true;
      overlay.insertAdjacentHTML('beforeend', detallePlantelHtml(squad));
      panelDetalle = overlay.querySelector('.panel-detalle-seleccion');
      panelDetalle.querySelector('.btn-volver-detalle').addEventListener('click', cerrarDetalle);
      panelDetalle.querySelector('.btn-volver-detalle').focus();
    }
  });

  overlay.addEventListener('change', e => {
    const switchAnio = e.target.closest('[data-switch-anio]');
    if (switchAnio) {
      const squads = mundiales.find(([anio]) => anio === Number(switchAnio.dataset.switchAnio))?.[1] || [];
      for (const squad of squads) {
        if (switchAnio.checked) enabledSquadKeys.add(squad.key);
        else enabledSquadKeys.delete(squad.key);
      }
      actualizarEstadoVisual();
      alCambiar();
      return;
    }

    const switchSquad = e.target.closest('[data-switch-squad]');
    if (switchSquad) {
      if (switchSquad.checked) enabledSquadKeys.add(switchSquad.dataset.switchSquad);
      else enabledSquadKeys.delete(switchSquad.dataset.switchSquad);
      actualizarEstadoVisual();
      alCambiar();
    }
  });

  overlay.querySelector('.btn-volver-selecciones').addEventListener('click', cerrar);
  overlay.addEventListener('click', e => {
    if (e.target !== overlay) return;
    if (panelDetalle) cerrarDetalle();
    else cerrar();
  });
  if (appRoot) appRoot.inert = true;
  document.addEventListener('keydown', gestionarTeclado);
  document.body.appendChild(overlay);
  actualizarEstadoVisual();
  overlay.querySelector('.btn-volver-selecciones').focus();
}

export function abrirUniversoDraft(disparador, { modo = 'almanaque', alCambiar = () => {} } = {}) {
  const modoActual = () => typeof modo === 'function' ? modo() : modo;
  abrirSeleccionesMundiales(disparador, {
    alCambiar,
    configuracionValida: () => configuracionDraftValida(modoActual()),
    resumenDraft: () => resumenUniversoDraft(modoActual()),
  });
}

export function pantallaHome(root) {
  const nombreGuardado = localStorage.getItem('mundialito-nombre') || '';

  render(root, html`
    <div class="home">
      <header class="home-cabecera">
        <div class="estrellas">★ ★ ★</div>
        <h1 class="titulo">MUNDIALITO</h1>
        <p class="subtitulo">EL TORNEO DE SELECCIONES HISTÓRICAS</p>
        ${ONLINE ? '' : html`
          <p class="aviso-local">⚠ Modo local de prueba (sin Supabase configurado):
          puedes jugar solo contra la máquina. Para jugar online con otros jugadores, sigue el README.</p>`}
      </header>

      <div class="home-tarjetas">
        <section class="tarjeta">
          <h2>Tu nombre</h2>
          <input id="nombre" maxlength="18" placeholder="ej: Matías" value="${esc(nombreGuardado)}" />
        </section>

        <section class="tarjeta">
          <h2>Crear una sala</h2>
          <p class="nota">Tú serás el anfitrión: repartes los planteles y das el pitazo inicial.</p>
          <div class="campo">
            <label>Modo de juego</label>
            <div class="opciones-modo">
              <label class="radio"><input type="radio" name="modo" value="almanaque" checked />
                <span><b>Selecciones históricas</b> — niveles ocultos, pura memoria futbolera</span></label>
              <label class="radio"><input type="radio" name="modo" value="penales" />
                <span><b>Solo Penales</b> — eliminación directa: cada partido se define en una tanda y tú pateas la tuya</span></label>
            </div>
          </div>
          <button type="button" id="btn-selecciones-mundiales" class="btn">
            Configurar universo del draft
          </button>
          <button id="btn-crear" class="btn btn-primario">Crear sala</button>
        </section>

        <section class="tarjeta ${ONLINE ? '' : 'deshabilitada'}">
          <h2>Unirse a una sala</h2>
          <p class="nota">Pide el código de 5 letras al anfitrión.</p>
          <input id="codigo" maxlength="5" placeholder="CÓDIGO" class="input-codigo"
            ${ONLINE ? '' : 'disabled'} />
          <button id="btn-unirse" class="btn" ${ONLINE ? '' : 'disabled'}>Unirse</button>
        </section>
      </div>

      <footer class="home-pie">155 planteles históricos + 16 octavofinalistas de 2026 · 2 modos de juego</footer>
    </div>
  `);

  const modoSeleccionado = () =>
    root.querySelector('input[name=modo]:checked')?.value || 'almanaque';
  let solicitudEnCurso = false;
  // enabled_squads limita solo la ruleta del draft. Los rivales del torneo se
  // reconstruyen siempre desde el universo base completo del modo.
  const poolDraftConfigurado = () =>
    squadsParaModo(modoSeleccionado(), keysActivasOrdenadas());
  const configuracionValida = () => poolDraftConfigurado().length > 0;
  const resumenDraft = () => ({
    activos: poolDraftConfigurado().length,
    total: squadsParaModo(modoSeleccionado()).length,
  });
  const actualizarDisponibilidadCrear = () => {
    const valida = configuracionValida();
    $('#btn-crear', root).disabled = solicitudEnCurso || !valida;
    const btnUnirse = $('#btn-unirse', root);
    if (btnUnirse) btnUnirse.disabled = solicitudEnCurso || !ONLINE;
    return valida;
  };

  const leerNombre = () => {
    const n = $('#nombre', root).value.trim();
    if (!n) { toast('Primero pon tu nombre', true); return null; }
    localStorage.setItem('mundialito-nombre', n);
    return n;
  };

  $('#btn-crear', root).addEventListener('click', async () => {
    if (solicitudEnCurso) return;
    if (!actualizarDisponibilidadCrear()) return;
    const nombre = leerNombre();
    if (!nombre) return;
    const modo = modoSeleccionado();
    const enabledSquads = keysActivasOrdenadas();
    solicitudEnCurso = true;
    actualizarDisponibilidadCrear();
    try {
      const code = await net.crearSala(nombre, `${modo}|32`, enabledSquads);
      entrarASala(code);
    } catch (e) {
      solicitudEnCurso = false;
      actualizarDisponibilidadCrear();
      toast('No se pudo crear la sala: ' + e.message, true);
    }
  });

  $('#btn-selecciones-mundiales', root).addEventListener('click', e => {
    abrirSeleccionesMundiales(e.currentTarget, {
      alCambiar: actualizarDisponibilidadCrear,
      configuracionValida,
      resumenDraft,
    });
  });

  root.querySelectorAll('input[name=modo]').forEach(input =>
    input.addEventListener('change', actualizarDisponibilidadCrear));

  $('#btn-unirse', root).addEventListener('click', async () => {
    if (solicitudEnCurso) return;
    const nombre = leerNombre();
    if (!nombre) return;
    const code = $('#codigo', root).value.trim().toUpperCase();
    if (code.length !== 5) { toast('El código tiene 5 letras', true); return; }
    solicitudEnCurso = true;
    actualizarDisponibilidadCrear();
    try {
      await net.unirse(code, nombre);
      entrarASala(code);
    } catch (e) {
      solicitudEnCurso = false;
      actualizarDisponibilidadCrear();
      toast(e.message, true);
    }
  });

  $('#codigo', root)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#btn-unirse', root).click();
  });

  actualizarDisponibilidadCrear();
}
