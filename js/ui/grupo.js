// Dashboard e identidad persistente de un grupo de Mundialito.

import {
  net, ONLINE, limpiarNombreGrupo, validarClaveGrupo,
} from '../net/net.js';
import { render, html, esc, $, toast } from './dom.js';
import {
  app, entrarAGrupo, salirDeGrupo, entrarASala, refrescarGrupo,
} from '../main.js';
import {
  abrirUniversoDraft, keysDraftActivas, configuracionDraftValida, resumenUniversoDraft,
} from './home.js';
import { medallaMundialitoSvg } from './icons.js';

const PIN_VALIDO = /^\d{4,6}$/;
const PREMIOS = {
  1: { nombre: 'Campeón', clase: 'campeon' },
  2: { nombre: 'Segundo', clase: 'plata' },
  3: { nombre: 'Tercero', clase: 'bronce' },
};

function primerObjeto(valor) {
  if (Array.isArray(valor)) return valor[0] || null;
  return valor || null;
}

function idGrupo(grupo) {
  return grupo?.id ?? grupo?.group_id ?? grupo?.groupId ?? null;
}

function idMiembro(miembro) {
  return miembro?.id ?? miembro?.member_id ?? miembro?.memberId ?? null;
}

function nombreVisible(entidad, fallback = '') {
  if (typeof entidad === 'string') return entidad;
  return entidad?.display_name ?? entidad?.displayName ?? entidad?.name ?? entidad?.nombre ?? fallback;
}

function numero(entidad, ...campos) {
  for (const campo of campos) {
    const valor = Number(entidad?.[campo]);
    if (Number.isFinite(valor)) return valor;
  }
  return 0;
}

function grupoActual() {
  return app.grupo?.group || app.grupo?.grupo || null;
}

function miembroActual() {
  return app.grupo?.member || app.grupo?.miembro || null;
}

function tokenActual() {
  return app.grupo?.token || app.grupo?.session_token || app.grupo?.sessionToken || null;
}

function dashboardActual() {
  return app.grupo?.dashboard || {};
}

function miembrosDashboard(dashboard) {
  const fuente = dashboard?.members ?? dashboard?.miembros ?? [];
  return Array.isArray(fuente) ? fuente : [];
}

function rankingDashboard(dashboard) {
  const miembros = miembrosDashboard(dashboard);
  const fuente = dashboard?.ranking ?? dashboard?.standings ?? miembros;
  const porId = new Map();

  for (const miembro of [...miembros, ...(Array.isArray(fuente) ? fuente : [])]) {
    const id = idMiembro(miembro) || `nombre:${nombreVisible(miembro)}`;
    porId.set(id, { ...(porId.get(id) || {}), ...miembro });
  }

  return [...porId.values()].sort((a, b) =>
    numero(b, 'cups', 'copas') - numero(a, 'cups', 'copas') ||
    numero(b, 'silvers', 'platas') - numero(a, 'silvers', 'platas') ||
    numero(b, 'bronzes', 'bronces') - numero(a, 'bronzes', 'bronces') ||
    nombreVisible(a).localeCompare(nombreVisible(b), 'es', { sensitivity: 'base' }));
}

function historialDashboard(dashboard) {
  const fuente = dashboard?.recent_tournaments ?? dashboard?.recentTournaments ??
    dashboard?.ultimos_torneos ?? dashboard?.history ?? [];
  return Array.isArray(fuente) ? fuente : [];
}

function torneoActivoDashboard(dashboard) {
  return dashboard?.active_room ?? dashboard?.activeRoom ?? dashboard?.torneo_activo ?? null;
}

function parsearJson(valor, fallback) {
  if (typeof valor !== 'string') return valor ?? fallback;
  try { return JSON.parse(valor); } catch { return fallback; }
}

function entradaPodio(entrada, place) {
  if (entrada == null) return null;
  if (typeof entrada === 'string') {
    return { place, display_name: entrada, human: null, member_id: null };
  }
  return {
    ...entrada,
    place: Number(entrada.place ?? entrada.puesto ?? place),
    display_name: nombreVisible(entrada, entrada.team_name ?? entrada.equipo ?? '—'),
    human: entrada.human ?? entrada.es_humano ?? entrada.is_human ??
      Boolean(entrada.member_id ?? entrada.memberId),
    member_id: entrada.member_id ?? entrada.memberId ?? null,
  };
}

function normalizarPodio(torneo) {
  const crudo = parsearJson(
    torneo?.podium ?? torneo?.podio ?? torneo?.final_podium ?? torneo?.finalPodium,
    [],
  );
  if (Array.isArray(crudo)) {
    return crudo
      .map((entrada, indice) => entradaPodio(entrada, indice + 1))
      .filter(Boolean)
      .sort((a, b) => a.place - b.place)
      .slice(0, 3);
  }
  if (crudo && typeof crudo === 'object') {
    const entradas = [
      crudo.champion ?? crudo.campeon ?? crudo.first ?? crudo.primero,
      crudo.runner_up ?? crudo.subcampeon ?? crudo.second ?? crudo.segundo,
      crudo.third ?? crudo.tercero,
    ];
    return entradas.map((entrada, indice) => entradaPodio(entrada, indice + 1)).filter(Boolean);
  }
  const entradas = [
    torneo?.champion ?? torneo?.campeon ?? torneo?.champion_name,
    torneo?.runner_up ?? torneo?.subcampeon ?? torneo?.runner_up_name,
    torneo?.third ?? torneo?.tercero ?? torneo?.third_name,
  ];
  return entradas.map((entrada, indice) => entradaPodio(entrada, indice + 1)).filter(Boolean);
}

function iconoPremio(place, clase = '') {
  if (place === 1) {
    return copaSticker({ className: clase, title: 'Copa de campeón' });
  }
  return medallaMundialitoSvg(place === 3 ? 'bronze' : 'silver', {
    className: clase,
    title: place === 3 ? 'Medalla de bronce' : 'Medalla de plata',
  });
}

function copaSticker({ className = '', title = 'Copa de campeón', decorative = false } = {}) {
  const accesibilidad = decorative
    ? 'alt="" aria-hidden="true"'
    : `alt="${esc(title)}"`;
  return `<img class="copa-sticker ${esc(className)}" src="assets/stickerCopa.png" ${accesibilidad} />`;
}

function fechaTorneo(torneo) {
  const valor = torneo?.finished_at ?? torneo?.finishedAt ?? torneo?.finalized_at ??
    torneo?.created_at ?? torneo?.date;
  if (!valor) return 'Fecha sin registrar';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(fecha).replace('.', '');
}

function etiquetaModo(modoCrudo) {
  const modo = String(modoCrudo || 'almanaque').split('|')[0];
  return modo === 'penales' ? 'Solo Penales' : 'Selecciones Históricas';
}

function etiquetaEstado(status) {
  return ({
    lobby: 'En convocatoria', draft: 'Draft en curso', running: 'Mundialito en juego',
    finished: 'Finalizado',
  })[status] || 'Mundialito activo';
}

function extraerSesion(respuesta) {
  const dato = primerObjeto(respuesta?.data ?? respuesta);
  const member = dato?.member ?? dato?.miembro ?? dato?.group_member ?? null;
  const token = dato?.token ?? dato?.session_token ?? dato?.sessionToken ?? null;
  const expiresAt = dato?.expires_at ?? dato?.expiresAt ?? null;
  if (!member || !token) throw new Error('El servidor no devolvió una sesión de miembro válida.');
  return { member, token, expires_at: expiresAt };
}

function extraerIngreso(respuesta) {
  const dato = primerObjeto(respuesta?.data ?? respuesta);
  if (typeof dato === 'string') return { code: dato, playerId: null };
  const code = dato?.code ?? dato?.room_code ?? dato?.roomCode ?? dato?.room?.code;
  const playerId = dato?.playerId ?? dato?.player_id ?? dato?.player?.id ?? null;
  if (!code || !playerId) throw new Error('No se pudo identificar tu participación en el Mundialito.');
  return { code, playerId };
}

function cabeceraGrupo(grupo, { mostrarMiembro = false } = {}) {
  const miembro = miembroActual();
  return html`
    <header class="grupo-cabecera">
      <div class="grupo-cabecera-marca" aria-hidden="true">★ MUNDIALITO ★</div>
      <div class="grupo-cabecera-fila">
        <div>
          <p class="grupo-sobretitulo">GRUPO PERMANENTE</p>
          <h1>${esc(nombreVisible(grupo, 'Grupo Mundialito'))}</h1>
          ${mostrarMiembro && miembro ? html`
            <p class="grupo-sesion">Jugando como <strong>${esc(nombreVisible(miembro))}</strong></p>` : ''}
        </div>
        <button type="button" class="btn btn-salir-grupo">Salir del grupo</button>
      </div>
    </header>`;
}

function htmlLandingGrupo() {
  return html`
    <main class="home home-grupo grupo-landing">
      <header class="home-cabecera">
        <div class="estrellas">★ ★ ★</div>
        <h1 class="titulo">MUNDIALITO</h1>
        <p class="subtitulo">EL TORNEO DE SELECCIONES HISTÓRICAS</p>
        ${ONLINE ? '' : html`
          <p class="aviso-local">
            ⚠ Modo local de prueba: el grupo y su historial vivirán solo en este navegador.
            Para recuperarlos desde otro dispositivo, configura Supabase y aplica la migración de grupos.
          </p>`}
      </header>

      <section class="tarjeta tarjeta-grupo-entrada" aria-labelledby="titulo-entrada-grupo">
        <p class="grupo-sobretitulo">TU LIGA PRIVADA</p>
        <h2 id="titulo-entrada-grupo">GRUPO</h2>
        <p class="nota">
          Usa una clave de grupo para acumular historial entre partidas.<br />
          Ejemplo: <strong>Grupo Familia Riesco</strong>
        </p>
        <form id="form-entrar-grupo" novalidate>
          <label class="sr-only" for="clave-grupo">Clave de tu grupo</label>
          <input id="clave-grupo" class="input-clave-grupo" maxlength="50"
            autocomplete="organization" autocapitalize="words" spellcheck="false"
            placeholder="Escribe la clave de tu grupo" required />
          <p id="error-clave-grupo" class="grupo-error-campo" role="alert" hidden></p>
          <button type="submit" class="btn btn-primario btn-grande btn-buscar-grupo">
            Entrar al grupo
          </button>
        </form>

        <div class="grupo-crear-confirmacion" hidden aria-live="polite">
          <p>No existe este grupo.</p>
          <p>¿Quieres crear <strong class="ticket-grupo" data-clave-por-crear></strong>?</p>
          <div class="grupo-crear-acciones">
            <button type="button" class="btn btn-cancelar-grupo">Corregir clave</button>
            <button type="button" class="btn btn-primario btn-confirmar-grupo">Crear grupo</button>
          </div>
        </div>
      </section>

      <footer class="home-pie">
        Un grupo permanente · muchos Mundialitos · una sola historia
      </footer>
    </main>`;
}

function conectarLanding(root) {
  const form = $('#form-entrar-grupo', root);
  const input = $('#clave-grupo', root);
  const errorCampo = $('#error-clave-grupo', root);
  const confirmacion = $('.grupo-crear-confirmacion', root);
  const btnBuscar = $('.btn-buscar-grupo', root);
  const btnCrear = $('.btn-confirmar-grupo', root);
  let clavePendiente = null;
  let operacionEnCurso = false;

  const mostrarError = mensaje => {
    errorCampo.textContent = mensaje || '';
    errorCampo.hidden = !mensaje;
    input.setAttribute('aria-invalid', String(Boolean(mensaje)));
  };
  const ocultarConfirmacion = () => {
    clavePendiente = null;
    confirmacion.hidden = true;
    form.hidden = false;
  };
  const bloquear = (bloqueado, texto = 'Buscando…') => {
    operacionEnCurso = bloqueado;
    input.disabled = bloqueado;
    btnBuscar.disabled = bloqueado;
    btnCrear.disabled = bloqueado;
    if (bloqueado) {
      btnBuscar.dataset.textoOriginal ||= btnBuscar.textContent;
      btnBuscar.textContent = texto;
    } else {
      btnBuscar.textContent = btnBuscar.dataset.textoOriginal || 'Entrar al grupo';
    }
  };

  input.addEventListener('input', () => {
    mostrarError('');
    if (!confirmacion.hidden) ocultarConfirmacion();
  });

  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (operacionEnCurso) return;
    const validacion = validarClaveGrupo(input.value);
    if (!validacion.valida) {
      mostrarError(validacion.error || 'Escribe una clave válida para el grupo.');
      input.focus();
      return;
    }
    input.value = validacion.display;
    mostrarError('');
    bloquear(true);
    try {
      const encontrado = primerObjeto(await net.grupoBuscar(validacion.display));
      if (encontrado) {
        await entrarAGrupo(encontrado);
        return;
      }
      clavePendiente = validacion.display;
      $('[data-clave-por-crear]', confirmacion).textContent = `“${clavePendiente}”`;
      form.hidden = true;
      confirmacion.hidden = false;
      bloquear(false);
      btnCrear.focus();
    } catch (error) {
      bloquear(false);
      mostrarError(error?.message || 'No se pudo buscar el grupo.');
      input.focus();
    }
  });

  $('.btn-cancelar-grupo', root).addEventListener('click', () => {
    ocultarConfirmacion();
    input.focus();
  });

  btnCrear.addEventListener('click', async () => {
    if (operacionEnCurso || !clavePendiente) return;
    // Se vuelve a sanear antes de escribir: el servidor repite la misma
    // validación y la restricción UNIQUE resuelve carreras entre navegadores.
    const display = limpiarNombreGrupo(clavePendiente);
    bloquear(true, 'Creando…');
    btnCrear.textContent = 'Creando…';
    try {
      const creado = primerObjeto(await net.grupoCrear(display));
      if (!creado) throw new Error('El servidor no devolvió el grupo creado.');
      await entrarAGrupo(creado);
      toast('¡Grupo creado! Ahora registra tu miembro.');
    } catch (error) {
      bloquear(false);
      btnCrear.textContent = 'Crear grupo';
      toast(error?.message || 'No se pudo crear el grupo.', true);
    }
  });

  // En escritorio agiliza la entrada; en teléfonos evita intentar abrir el
  // teclado virtual apenas carga la portada.
  if (window.matchMedia?.('(pointer: fine)').matches) input.focus();
}

const inicio = { paso: 'portada', grupo: null, dashboard: null };

function botonVolver(destino) {
  return html`<button type="button" class="inicio-volver" data-inicio-volver="${destino}">← Volver</button>`;
}

function htmlInicioPortada() {
  return html`
    <main class="inicio inicio-portada">
      <div class="inicio-portada-contenido">
        <img class="inicio-copa" src="assets/copa-del-mundo-750x485.jpg" alt="Copa del Mundo" />
        <h1>MUNDIALITO</h1>
        <button type="button" class="btn inicio-comenzar" data-inicio-comenzar>COMENZAR</button>
      </div>
    </main>`;
}

function htmlInicioOpciones() {
  return html`
    <main class="inicio inicio-opciones">
      ${botonVolver('portada')}
      <div class="inicio-acciones">
        <button type="button" class="btn inicio-accion" data-inicio-crear>CREAR GRUPO NUEVO</button>
        <button type="button" class="btn inicio-accion" data-inicio-unir>UNIRSE A GRUPO EXISTENTE</button>
      </div>
    </main>`;
}

function htmlInicioCrear() {
  return html`
    <main class="inicio inicio-formulario">
      ${botonVolver('opciones')}
      <section class="inicio-panel" aria-labelledby="inicio-titulo-crear">
        <h1 id="inicio-titulo-crear">CREAR GRUPO NUEVO</h1>
        <form id="form-inicio-crear" novalidate>
          <div class="campo"><label for="inicio-nombre-grupo">Nombre del grupo</label>
            <input id="inicio-nombre-grupo" maxlength="50" autocomplete="organization" autocapitalize="words" spellcheck="false" required /></div>
          <div class="campo"><label for="inicio-nombre-miembro">Tu nombre</label>
            <input id="inicio-nombre-miembro" maxlength="30" autocomplete="name" required /></div>
          <div class="inicio-pin-doble">
            <div class="campo"><label for="inicio-pin">Crea tu PIN</label>
              <input id="inicio-pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="6" pattern="[0-9]{4,6}" required /></div>
            <div class="campo"><label for="inicio-pin-confirmar">Repite tu PIN</label>
              <input id="inicio-pin-confirmar" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" maxlength="6" pattern="[0-9]{4,6}" required /></div>
          </div>
          <p id="inicio-error-crear" class="inicio-error" role="alert" hidden></p>
          <button type="submit" class="btn inicio-confirmar">CREAR GRUPO</button>
        </form>
      </section>
    </main>`;
}

function htmlInicioUnir() {
  return html`
    <main class="inicio inicio-formulario">
      ${botonVolver('opciones')}
      <section class="inicio-panel" aria-labelledby="inicio-titulo-unir">
        <h1 id="inicio-titulo-unir">UNIRSE A GRUPO EXISTENTE</h1>
        <form id="form-inicio-unir" novalidate>
          <div class="campo"><label for="inicio-buscar-grupo">Nombre del grupo</label>
            <input id="inicio-buscar-grupo" maxlength="50" autocomplete="organization" autocapitalize="words" spellcheck="false" required /></div>
          <p id="inicio-error-unir" class="inicio-error" role="alert" hidden></p>
          <button type="submit" class="btn inicio-confirmar">BUSCAR GRUPO</button>
        </form>
      </section>
    </main>`;
}

function mostrarErrorInicio(campo, input, mensaje) {
  campo.textContent = mensaje || '';
  campo.hidden = !mensaje;
  input?.setAttribute('aria-invalid', String(Boolean(mensaje)));
}

function conectarInicioCrear(root) {
  const form = $('#form-inicio-crear', root);
  const grupoInput = $('#inicio-nombre-grupo', root);
  const nombreInput = $('#inicio-nombre-miembro', root);
  const pinInput = $('#inicio-pin', root);
  const confirmarInput = $('#inicio-pin-confirmar', root);
  const errorCampo = $('#inicio-error-crear', root);
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    const validacion = validarClaveGrupo(grupoInput.value);
    const nombre = nombreInput.value.trim().replace(/\s+/g, ' ');
    const pin = pinInput.value.trim();
    const confirmar = confirmarInput.value.trim();
    if (!validacion.valida) return mostrarErrorInicio(errorCampo, grupoInput, validacion.error || 'Escribe un nombre de grupo válido.');
    if (nombre.length < 2) return mostrarErrorInicio(errorCampo, nombreInput, 'Escribe un nombre de al menos 2 caracteres.');
    if (!PIN_VALIDO.test(pin)) return mostrarErrorInicio(errorCampo, pinInput, 'El PIN debe tener entre 4 y 6 dígitos.');
    if (pin !== confirmar) return mostrarErrorInicio(errorCampo, confirmarInput, 'Los dos PIN no coinciden.');
    mostrarErrorInicio(errorCampo, grupoInput, '');
    bloquearFormulario(form, true, 'Creando…');
    try {
      const display = limpiarNombreGrupo(validacion.display);
      const existente = primerObjeto(await net.grupoBuscar(display));
      if (existente) {
        mostrarErrorInicio(errorCampo, grupoInput, 'Ya existe un grupo con ese nombre. Puedes unirte a él desde "Unirse a grupo existente".');
        bloquearFormulario(form, false);
        return;
      }
      const creado = primerObjeto(await net.grupoCrear(display));
      if (!creado) throw new Error('El servidor no devolvió el grupo creado.');
      const respuesta = await net.grupoCrearMiembro({ groupId: idGrupo(creado), nombre, pin });
      pinInput.value = '';
      confirmarInput.value = '';
      await completarIdentidad(creado, respuesta);
    } catch (error) {
      pinInput.value = '';
      confirmarInput.value = '';
      bloquearFormulario(form, false);
      mostrarErrorInicio(errorCampo, grupoInput, error?.message || 'No se pudo crear el grupo.');
    }
  });
}

function conectarInicioUnir(root) {
  const form = $('#form-inicio-unir', root);
  const input = $('#inicio-buscar-grupo', root);
  const errorCampo = $('#inicio-error-unir', root);
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    const validacion = validarClaveGrupo(input.value);
    if (!validacion.valida) return mostrarErrorInicio(errorCampo, input, validacion.error || 'Escribe un nombre de grupo válido.');
    input.value = validacion.display;
    mostrarErrorInicio(errorCampo, input, '');
    bloquearFormulario(form, true, 'Buscando…');
    try {
      const grupo = primerObjeto(await net.grupoBuscar(validacion.display));
      if (!grupo) {
        bloquearFormulario(form, false);
        mostrarErrorInicio(errorCampo, input, 'No encontramos un grupo con ese nombre.');
        return;
      }
      const dashboard = await net.grupoDashboard(idGrupo(grupo));
      inicio.paso = 'identidad';
      inicio.grupo = dashboard?.group || grupo;
      inicio.dashboard = dashboard || {};
      pantallaInicio(root);
    } catch (error) {
      bloquearFormulario(form, false);
      mostrarErrorInicio(errorCampo, input, error?.message || 'No se pudo buscar el grupo.');
    }
  });
}

/** Portada obligatoria y flujo manual para entrar a un grupo. */
export function pantallaInicio(root) {
  const paso = inicio.paso;
  if (paso === 'portada') render(root, htmlInicioPortada());
  else if (paso === 'opciones') render(root, htmlInicioOpciones());
  else if (paso === 'crear') render(root, htmlInicioCrear());
  else if (paso === 'unir') render(root, htmlInicioUnir());
  else if (paso === 'identidad' && inicio.grupo) render(root,
    htmlGateMiembro(inicio.grupo, inicio.dashboard, { onboarding: true }));
  else { inicio.paso = 'portada'; return pantallaInicio(root); }

  $('[data-inicio-comenzar]', root)?.addEventListener('click', () => {
    inicio.paso = 'opciones'; pantallaInicio(root);
  });
  $('[data-inicio-crear]', root)?.addEventListener('click', () => {
    inicio.paso = 'crear'; pantallaInicio(root);
  });
  $('[data-inicio-unir]', root)?.addEventListener('click', () => {
    inicio.paso = 'unir'; pantallaInicio(root);
  });
  root.querySelectorAll('[data-inicio-volver]').forEach(boton => boton.addEventListener('click', () => {
    inicio.paso = boton.dataset.inicioVolver;
    inicio.grupo = null;
    inicio.dashboard = null;
    pantallaInicio(root);
  }));
  if (paso === 'crear') conectarInicioCrear(root);
  if (paso === 'unir') conectarInicioUnir(root);
  if (paso === 'identidad') conectarGate(root, inicio.grupo, { onVolver: () => {
    inicio.paso = 'unir'; inicio.grupo = null; inicio.dashboard = null; pantallaInicio(root);
  } });
}

function htmlGateMiembro(grupo, dashboard, { onboarding = false } = {}) {
  const miembros = miembrosDashboard(dashboard);
  const hayMiembros = miembros.length > 0;
  return html`
    <main class="grupo grupo-identidad">
      ${onboarding ? html`
        <header class="inicio-identidad-cabecera">
          <button type="button" class="inicio-volver" data-inicio-volver-identidad>← Volver</button>
          <p>GRUPO ENCONTRADO</p>
          <h1>${esc(nombreVisible(grupo, 'Grupo Mundialito'))}</h1>
        </header>` : cabeceraGrupo(grupo)}
      <section class="grupo-panel grupo-panel-identidad" aria-labelledby="titulo-identidad">
        <div class="grupo-panel-sello" aria-hidden="true">IDENTIDAD</div>
        <h2 id="titulo-identidad">${hayMiembros ? 'IDENTIFÍCATE EN EL GRUPO' : 'GRUPO CREADO'}</h2>
        <p class="grupo-intro">
          ${hayMiembros
            ? 'Tu miembro guarda copas, medallas y participaciones a través del tiempo.'
            : '¡El grupo ya está listo! Crea el primer miembro para inaugurar su historia.'}
        </p>

        ${hayMiembros ? html`
          <div class="grupo-identidad-tabs" role="tablist" aria-label="Forma de ingreso">
            <button type="button" class="grupo-tab activo" id="tab-miembro-existente"
              role="tab" aria-selected="true" aria-controls="panel-miembro-existente">
              Ya soy miembro
            </button>
            <button type="button" class="grupo-tab" id="tab-miembro-nuevo"
              role="tab" aria-selected="false" aria-controls="panel-miembro-nuevo">
              Soy nuevo
            </button>
          </div>

          <form id="panel-miembro-existente" class="grupo-form-miembro" role="tabpanel"
            aria-labelledby="tab-miembro-existente" novalidate>
            <div class="campo">
              <label for="grupo-miembro-select">Miembro</label>
              <select id="grupo-miembro-select" required autocomplete="username">
                <option value="">Elige tu nombre</option>
                ${miembros.map(miembro => html`
                  <option value="${esc(idMiembro(miembro))}">${esc(nombreVisible(miembro))}</option>
                `).join('')}
              </select>
            </div>
            <div class="campo">
              <label for="grupo-pin-existente">PIN personal</label>
              <input id="grupo-pin-existente" type="password" inputmode="numeric"
                autocomplete="current-password" minlength="4" maxlength="6" pattern="[0-9]{4,6}"
                placeholder="4 a 6 dígitos" required />
            </div>
            <p class="grupo-ayuda-pin">El PIN permite recuperar tu misma identidad desde otro dispositivo.</p>
            <button type="submit" class="btn btn-primario btn-grande">Entrar como miembro</button>
          </form>
        ` : ''}

        <form id="panel-miembro-nuevo" class="grupo-form-miembro"
          role="tabpanel" aria-labelledby="${hayMiembros ? 'tab-miembro-nuevo' : 'titulo-identidad'}"
          ${hayMiembros ? 'hidden' : ''} novalidate>
          <div class="campo">
            <label for="grupo-nombre-nuevo">Tu nombre en este grupo</label>
            <input id="grupo-nombre-nuevo" maxlength="30" autocomplete="name"
              placeholder="ej. Eugenio" required />
          </div>
          <div class="grupo-pin-doble">
            <div class="campo">
              <label for="grupo-pin-nuevo">Crea tu PIN</label>
              <input id="grupo-pin-nuevo" type="password" inputmode="numeric"
                autocomplete="new-password" minlength="4" maxlength="6" pattern="[0-9]{4,6}"
                placeholder="4 a 6 dígitos" required />
            </div>
            <div class="campo">
              <label for="grupo-pin-confirmar">Repite tu PIN</label>
              <input id="grupo-pin-confirmar" type="password" inputmode="numeric"
                autocomplete="new-password" minlength="4" maxlength="6" pattern="[0-9]{4,6}"
                placeholder="Mismo PIN" required />
            </div>
          </div>
          <p class="grupo-ayuda-pin">Recuérdalo: el PIN no se muestra ni se guarda en este navegador.</p>
          <button type="submit" class="btn btn-primario btn-grande">Crear mi miembro</button>
        </form>
      </section>
    </main>`;
}

function htmlRanking(dashboard) {
  const ranking = rankingDashboard(dashboard);
  if (!ranking.length) {
    return html`
      <div class="grupo-vacio">
        <span aria-hidden="true">☆</span>
        <p>El medallero espera su primer Mundialito.</p>
      </div>`;
  }
  return html`
    <div class="grupo-tabla-scroll">
      <table class="grupo-ranking">
        <caption class="sr-only">Ranking histórico del grupo</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Jugador</th>
            <th scope="col" title="Copas de campeón">
              ${copaSticker({ className: 'grupo-ranking-icono', decorative: true })}
              <span class="sr-only">Copas</span>
            </th>
            <th scope="col" title="Medallas de plata">
              ${medallaMundialitoSvg('silver', { className: 'grupo-ranking-icono', title: 'Platas' })}
              <span class="sr-only">Platas</span>
            </th>
            <th scope="col" title="Medallas de bronce">
              ${medallaMundialitoSvg('bronze', { className: 'grupo-ranking-icono', title: 'Bronces' })}
              <span class="sr-only">Bronces</span>
            </th>
            <th scope="col" title="Mundialitos jugados">PJ</th>
          </tr>
        </thead>
        <tbody>
          ${ranking.map((miembro, indice) => html`
            <tr class="${idMiembro(miembro) === idMiembro(miembroActual()) ? 'es-miembro-actual' : ''}">
              <td data-label="#"><strong>${indice + 1}</strong></td>
              <th scope="row" data-label="Jugador">
                ${esc(nombreVisible(miembro, 'Miembro'))}
                ${idMiembro(miembro) === idMiembro(miembroActual())
                  ? '<span class="grupo-tu-tag">TÚ</span>' : ''}
              </th>
              <td data-label="Copas" class="grupo-numero grupo-numero-copa">${numero(miembro, 'cups', 'copas')}</td>
              <td data-label="Platas" class="grupo-numero">${numero(miembro, 'silvers', 'platas')}</td>
              <td data-label="Bronces" class="grupo-numero">${numero(miembro, 'bronzes', 'bronces')}</td>
              <td data-label="PJ" class="grupo-numero">${numero(miembro, 'played', 'pj', 'tournaments_played')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function htmlPodioCompacto(podio) {
  if (!podio.length) return '<span class="grupo-sin-podio">Podio no disponible</span>';
  return html`
    <ol class="grupo-historial-podio">
      ${podio.map(entrada => {
        const premio = PREMIOS[entrada.place] || PREMIOS[3];
        return html`
          <li class="premio-${premio.clase}">
            ${iconoPremio(entrada.place, 'grupo-historial-icono')}
            <span class="grupo-podio-lugar">${entrada.place}º</span>
            <strong>${esc(nombreVisible(entrada, '—'))}</strong>
            ${entrada.human === false ? '<span class="grupo-ia-tag">IA</span>' : ''}
          </li>`;
      }).join('')}
    </ol>`;
}

function htmlHistorial(dashboard) {
  const torneos = historialDashboard(dashboard);
  if (!torneos.length) {
    return html`
      <div class="grupo-vacio grupo-vacio-historial">
        <span aria-hidden="true">○</span>
        <p>Aún no hay Mundialitos finalizados.</p>
      </div>`;
  }
  return html`
    <ol class="grupo-historial-lista">
      ${torneos.map((torneo, indice) => {
        const numeroTorneo = torneo?.tournament_number ?? torneo?.tournamentNumber ??
          torneo?.number ?? (torneos.length - indice);
        return html`
          <li class="grupo-historial-item">
            <div class="grupo-historial-meta">
              <strong>Mundialito #${esc(numeroTorneo)}</strong>
              <time datetime="${esc(torneo?.finished_at ?? torneo?.finishedAt ?? '')}">${esc(fechaTorneo(torneo))}</time>
              <span>${esc(etiquetaModo(torneo?.modo ?? torneo?.mode))}</span>
            </div>
            ${htmlPodioCompacto(normalizarPodio(torneo))}
          </li>`;
      }).join('')}
    </ol>`;
}

function ultimoCampeon(dashboard) {
  const directo = dashboard?.last_champion ?? dashboard?.lastChampion ?? dashboard?.ultimo_campeon;
  if (directo) return entradaPodio(primerObjeto(directo), 1);
  const ultimo = historialDashboard(dashboard)[0];
  return ultimo ? normalizarPodio(ultimo).find(entrada => entrada.place === 1) || null : null;
}

function htmlUltimoCampeon(dashboard) {
  const campeon = ultimoCampeon(dashboard);
  return html`
    <section class="grupo-ultimo-campeon ${campeon ? '' : 'sin-campeon'}"
      aria-labelledby="titulo-ultimo-campeon">
      <div class="grupo-ultimo-copa">
        ${copaSticker({ className: 'grupo-copa-grande', decorative: true })}
      </div>
      <div>
        <h2 id="titulo-ultimo-campeon">ÚLTIMO CAMPEÓN</h2>
        ${campeon ? html`
          <strong>${esc(nombreVisible(campeon, '—'))}</strong>
          ${campeon.human === false ? '<span class="grupo-ia-tag">IA</span>' : ''}
        ` : '<p>La copa todavía no tiene dueño.</p>'}
      </div>
    </section>`;
}

function htmlEstadoTorneo(activo) {
  if (activo) {
    const status = activo?.status ?? activo?.estado ?? 'running';
    return html`
      <section class="grupo-accion grupo-accion-activa" aria-labelledby="titulo-torneo-activo">
        <div class="grupo-estado-luz" aria-hidden="true"></div>
        <div class="grupo-accion-texto">
          <p class="grupo-sobretitulo">MUNDIALITO ACTIVO</p>
          <h2 id="titulo-torneo-activo">${esc(etiquetaEstado(status))}</h2>
          <p>${esc(etiquetaModo(activo?.modo ?? activo?.mode))} · puedes retomar con tu mismo miembro.</p>
        </div>
        <button type="button" class="btn btn-primario btn-grande btn-entrar-torneo">
          Entrar al Mundialito en curso
        </button>
      </section>`;
  }
  return html`
    <section class="grupo-accion" aria-labelledby="titulo-sin-torneo">
      <div class="grupo-estado-luz apagada" aria-hidden="true"></div>
      <div class="grupo-accion-texto">
        <p class="grupo-sobretitulo">ESTADO DEL GRUPO</p>
        <h2 id="titulo-sin-torneo">Sin Mundialito activo</h2>
        <p>El próximo torneo tendrá su propia configuración y quedará en este historial.</p>
      </div>
      <button type="button" class="btn btn-primario btn-grande btn-nuevo-torneo">
        Nuevo Mundialito
      </button>
    </section>
    <section class="grupo-config-torneo" hidden aria-labelledby="titulo-config-torneo">
      <div class="grupo-config-cabecera">
        <div>
          <p class="grupo-sobretitulo">NUEVA EDICIÓN</p>
          <h2 id="titulo-config-torneo">Configurar Mundialito</h2>
        </div>
        <button type="button" class="btn btn-mini btn-cerrar-config" aria-label="Cerrar configuración">Cerrar</button>
      </div>
      <fieldset class="grupo-modos">
        <legend>Modo de juego</legend>
        <label class="grupo-modo-card">
          <input type="radio" name="grupo-modo" value="almanaque" checked />
          <span><strong>Selecciones históricas</strong><small>Niveles ocultos, pura memoria futbolera</small></span>
        </label>
        <label class="grupo-modo-card">
          <input type="radio" name="grupo-modo" value="penales" />
          <span><strong>Solo Penales</strong><small>Eliminación directa definida desde los doce pasos</small></span>
        </label>
      </fieldset>
      <div class="grupo-universo-fila">
        <div>
          <strong>Universo del draft</strong>
          <p class="nota grupo-universo-resumen" aria-live="polite"></p>
        </div>
        <button type="button" class="btn btn-configurar-universo">Configurar planteles</button>
      </div>
      <p class="grupo-config-nota">
        Esta elección vale solo para este draft. Los rivales del torneo mantienen el universo completo del modo.
      </p>
      <button type="button" class="btn btn-primario btn-grande btn-crear-torneo">
        Crear Mundialito
      </button>
    </section>`;
}

function htmlDashboard(grupo, dashboard) {
  const activo = torneoActivoDashboard(dashboard);
  return html`
    <main class="grupo grupo-dashboard">
      ${cabeceraGrupo(grupo, { mostrarMiembro: true })}
      ${htmlUltimoCampeon(dashboard)}
      ${htmlEstadoTorneo(activo)}
      <div class="grupo-dashboard-grid">
        <section class="grupo-panel grupo-panel-ranking" aria-labelledby="titulo-ranking-grupo">
          <div class="grupo-seccion-cabecera">
            <div>
              <p class="grupo-sobretitulo">MEDALLERO MUNDIALERO</p>
              <h2 id="titulo-ranking-grupo">RANKING HISTÓRICO</h2>
            </div>
            <button type="button" class="btn btn-mini btn-refrescar-grupo" aria-label="Actualizar historial">
              Actualizar
            </button>
          </div>
          ${htmlRanking(dashboard)}
        </section>
        <section class="grupo-panel grupo-panel-historial" aria-labelledby="titulo-historial-grupo">
          <div class="grupo-seccion-cabecera">
            <div>
              <p class="grupo-sobretitulo">ARCHIVO DEL GRUPO</p>
              <h2 id="titulo-historial-grupo">ÚLTIMOS MUNDIALITOS</h2>
            </div>
          </div>
          ${htmlHistorial(dashboard)}
        </section>
      </div>
    </main>`;
}

function cambiarTabIdentidad(root, tab) {
  const existente = tab === 'existente';
  const tabExistente = $('#tab-miembro-existente', root);
  const tabNuevo = $('#tab-miembro-nuevo', root);
  const panelExistente = $('#panel-miembro-existente', root);
  const panelNuevo = $('#panel-miembro-nuevo', root);
  if (!tabExistente || !tabNuevo || !panelExistente || !panelNuevo) return;
  tabExistente.classList.toggle('activo', existente);
  tabNuevo.classList.toggle('activo', !existente);
  tabExistente.setAttribute('aria-selected', String(existente));
  tabNuevo.setAttribute('aria-selected', String(!existente));
  panelExistente.hidden = !existente;
  panelNuevo.hidden = existente;
  (existente ? $('#grupo-miembro-select', root) : $('#grupo-nombre-nuevo', root))?.focus();
}

function bloquearFormulario(form, bloqueado, textoBloqueado) {
  if (!form) return;
  form.setAttribute('aria-busy', String(bloqueado));
  form.querySelectorAll('button, input, select').forEach(control => { control.disabled = bloqueado; });
  const boton = form.querySelector('button[type="submit"], .btn-crear-torneo');
  if (!boton) return;
  if (bloqueado) {
    boton.dataset.textoOriginal = boton.textContent;
    boton.textContent = textoBloqueado;
  } else if (boton.dataset.textoOriginal) {
    boton.textContent = boton.dataset.textoOriginal;
    delete boton.dataset.textoOriginal;
  }
}

async function completarIdentidad(grupo, respuesta) {
  const sesion = extraerSesion(respuesta);
  await Promise.resolve(entrarAGrupo(grupo, sesion));
}

function conectarGate(root, grupo, { onVolver = null } = {}) {
  let operacionEnCurso = false;

  $('[data-inicio-volver-identidad]', root)?.addEventListener('click', () => onVolver?.());

  $('#tab-miembro-existente', root)?.addEventListener('click', () => cambiarTabIdentidad(root, 'existente'));
  $('#tab-miembro-nuevo', root)?.addEventListener('click', () => cambiarTabIdentidad(root, 'nuevo'));

  const formExistente = $('#panel-miembro-existente', root);
  formExistente?.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (operacionEnCurso) return;
    const memberId = $('#grupo-miembro-select', formExistente).value;
    const pinInput = $('#grupo-pin-existente', formExistente);
    const pin = pinInput.value.trim();
    if (!memberId) { toast('Elige tu nombre en el grupo.', true); return; }
    if (!PIN_VALIDO.test(pin)) { toast('El PIN debe tener entre 4 y 6 dígitos.', true); return; }

    operacionEnCurso = true;
    bloquearFormulario(formExistente, true, 'Comprobando…');
    try {
      const respuesta = await net.grupoReclamarMiembro({
        groupId: idGrupo(grupo), memberId, pin,
      });
      pinInput.value = '';
      await completarIdentidad(grupo, respuesta);
      toast('¡Bienvenido de vuelta!');
    } catch (error) {
      pinInput.value = '';
      operacionEnCurso = false;
      bloquearFormulario(formExistente, false);
      toast(error?.message || 'No se pudo comprobar el PIN.', true);
      pinInput.focus();
    }
  });

  const formNuevo = $('#panel-miembro-nuevo', root);
  formNuevo?.addEventListener('submit', async evento => {
    evento.preventDefault();
    if (operacionEnCurso) return;
    const nombreInput = $('#grupo-nombre-nuevo', formNuevo);
    const pinInput = $('#grupo-pin-nuevo', formNuevo);
    const confirmarInput = $('#grupo-pin-confirmar', formNuevo);
    const nombre = nombreInput.value.trim().replace(/\s+/g, ' ');
    const pin = pinInput.value.trim();
    const confirmar = confirmarInput.value.trim();
    if (nombre.length < 2) { toast('Escribe un nombre de al menos 2 caracteres.', true); return; }
    if (!PIN_VALIDO.test(pin)) { toast('El PIN debe tener entre 4 y 6 dígitos.', true); return; }
    if (pin !== confirmar) { toast('Los dos PIN no coinciden.', true); return; }

    operacionEnCurso = true;
    bloquearFormulario(formNuevo, true, 'Creando…');
    try {
      const respuesta = await net.grupoCrearMiembro({
        groupId: idGrupo(grupo), nombre, pin,
      });
      pinInput.value = '';
      confirmarInput.value = '';
      await completarIdentidad(grupo, respuesta);
      toast('¡Tu miembro quedó creado!');
    } catch (error) {
      pinInput.value = '';
      confirmarInput.value = '';
      operacionEnCurso = false;
      bloquearFormulario(formNuevo, false);
      toast(error?.message || 'No se pudo crear el miembro.', true);
      nombreInput.focus();
    }
  });
}

function conectarSalida(root) {
  $('.btn-salir-grupo', root)?.addEventListener('click', async evento => {
    const boton = evento.currentTarget;
    if (boton.disabled) return;
    boton.disabled = true;
    boton.setAttribute('aria-busy', 'true');
    const texto = boton.textContent;
    boton.textContent = 'Saliendo…';
    try { await Promise.resolve(salirDeGrupo()); }
    catch (error) {
      if (boton.isConnected) {
        boton.disabled = false;
        boton.removeAttribute('aria-busy');
        boton.textContent = texto;
      }
      toast(error?.message || 'No se pudo cerrar la sesión del grupo.', true);
    }
  });
}

function conectarDashboard(root, grupo, dashboard) {
  const miembro = miembroActual();
  const token = tokenActual();
  let accionEnCurso = false;

  const ejecutarIngreso = async accion => {
    if (accionEnCurso) return;
    const boton = accion === 'iniciar'
      ? $('.btn-crear-torneo', root)
      : $('.btn-entrar-torneo', root);
    accionEnCurso = true;
    if (boton) {
      boton.disabled = true;
      boton.dataset.textoOriginal = boton.textContent;
      boton.textContent = accion === 'iniciar' ? 'Creando…' : 'Entrando…';
      boton.setAttribute('aria-busy', 'true');
    }
    try {
      let respuesta;
      if (accion === 'iniciar') {
        const modoBase = root.querySelector('input[name="grupo-modo"]:checked')?.value || 'almanaque';
        if (!configuracionDraftValida(modoBase)) {
          throw new Error('Activa al menos un plantel para el draft.');
        }
        respuesta = await net.grupoIniciarTorneo({
          groupId: idGrupo(grupo),
          memberId: idMiembro(miembro),
          sessionToken: token,
          modo: `${modoBase}|32`,
          enabledSquads: keysDraftActivas(),
        });
      } else {
        respuesta = await net.grupoUnirseTorneo({
          groupId: idGrupo(grupo),
          memberId: idMiembro(miembro),
          sessionToken: token,
        });
      }
      const { code, playerId } = extraerIngreso(respuesta);
      entrarASala(code, { playerId });
    } catch (error) {
      accionEnCurso = false;
      if (boton?.isConnected) {
        boton.disabled = false;
        boton.removeAttribute('aria-busy');
        boton.textContent = boton.dataset.textoOriginal ||
          (accion === 'iniciar' ? 'Crear Mundialito' : 'Entrar al Mundialito en curso');
      }
      toast(error?.message || 'No se pudo abrir el Mundialito.', true);
    }
  };

  $('.btn-entrar-torneo', root)?.addEventListener('click', () => ejecutarIngreso('unirse'));

  const btnNuevo = $('.btn-nuevo-torneo', root);
  const config = $('.grupo-config-torneo', root);
  btnNuevo?.addEventListener('click', () => {
    btnNuevo.closest('.grupo-accion').hidden = true;
    config.hidden = false;
    config.scrollIntoView({ behavior: 'smooth', block: 'start' });
    config.querySelector('input[name="grupo-modo"]')?.focus();
  });
  $('.btn-cerrar-config', root)?.addEventListener('click', () => {
    config.hidden = true;
    btnNuevo.closest('.grupo-accion').hidden = false;
    btnNuevo.focus();
  });

  const resumenUniverso = () => {
    const modo = root.querySelector('input[name="grupo-modo"]:checked')?.value || 'almanaque';
    const { activos, total } = resumenUniversoDraft(modo);
    const valido = configuracionDraftValida(modo);
    const salida = $('.grupo-universo-resumen', root);
    if (salida) {
      salida.textContent = valido
        ? `${activos} de ${total} planteles habilitados para la ruleta`
        : 'Activa al menos un plantel para este modo';
      salida.classList.toggle('error-lobby', !valido);
    }
    const crear = $('.btn-crear-torneo', root);
    if (crear) crear.disabled = accionEnCurso || !valido;
  };

  $('.btn-configurar-universo', root)?.addEventListener('click', evento => {
    abrirUniversoDraft(evento.currentTarget, {
      modo: () => root.querySelector('input[name="grupo-modo"]:checked')?.value || 'almanaque',
      alCambiar: resumenUniverso,
    });
  });
  root.querySelectorAll('input[name="grupo-modo"]').forEach(input =>
    input.addEventListener('change', resumenUniverso));
  $('.btn-crear-torneo', root)?.addEventListener('click', () => ejecutarIngreso('iniciar'));

  $('.btn-refrescar-grupo', root)?.addEventListener('click', async evento => {
    const boton = evento.currentTarget;
    if (boton.disabled) return;
    boton.disabled = true;
    boton.textContent = 'Actualizando…';
    try {
      const actualizado = await Promise.resolve(refrescarGrupo({ renderizar: true }));
      if (!actualizado && boton.isConnected) {
        boton.disabled = false;
        boton.textContent = 'Actualizar';
      }
    } catch (error) {
      if (boton.isConnected) {
        boton.disabled = false;
        boton.textContent = 'Actualizar';
      }
      toast(error?.message || 'No se pudo actualizar el historial.', true);
    }
  });

  resumenUniverso();
}

/** Renderiza la identificación o el dashboard del grupo actualmente activo. */
export function pantallaGrupo(root) {
  const grupo = grupoActual();
  if (!grupo) {
    inicio.paso = 'portada';
    inicio.grupo = null;
    inicio.dashboard = null;
    pantallaInicio(root);
    return;
  }
  const dashboard = dashboardActual();
  if (!miembroActual() || !tokenActual()) {
    render(root, htmlGateMiembro(grupo, dashboard));
    conectarSalida(root);
    conectarGate(root, grupo);
    return;
  }
  render(root, htmlDashboard(grupo, dashboard));
  conectarSalida(root);
  conectarDashboard(root, grupo, dashboard);
}
