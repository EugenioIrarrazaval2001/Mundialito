// Pantalla de inicio: crear sala o unirse

import { net, ONLINE } from '../net/net.js';
import { render, html, esc, $, toast } from './dom.js';
import { entrarASala } from '../main.js';

export function pantallaHome(root) {
  const nombreGuardado = localStorage.getItem('mundialito-nombre') || '';

  render(root, html`
    <div class="home">
      <header class="home-cabecera">
        <div class="estrellas">★ ★ ★</div>
        <h1 class="titulo">MUNDIALITO</h1>
        <p class="subtitulo">EL TORNEO DE LA OFICINA · PLANTELES HISTÓRICOS</p>
        ${ONLINE ? '' : html`
          <p class="aviso-local">⚠ Modo local de prueba (sin Supabase configurado):
          puedes jugar solo contra la máquina. Para jugar con tu oficina, sigue el README.</p>`}
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
              <label class="radio"><input type="radio" name="modo" value="clasico" checked />
                <span><b>Clásico</b> — se ve el nivel de cada jugador</span></label>
              <label class="radio"><input type="radio" name="modo" value="almanaque" />
                <span><b>Almanaque</b> — niveles ocultos, pura memoria futbolera</span></label>
              <label class="radio"><input type="radio" name="modo" value="penales" />
                <span><b>Solo Penales</b> — eliminación directa: cada partido se define en una tanda y tú pateas la tuya</span></label>
              <label class="radio"><input type="radio" name="modo" value="mundial2026" />
                <span><b>Mundial 2026</b> — solo las 48 selecciones del Mundial de Canadá-México-EE.UU.</span></label>
            </div>
          </div>
          <div class="campo">
            <label>Tamaño del mundial</label>
            <div class="opciones-modo">
              <label class="radio"><input type="radio" name="tamano" value="16" checked />
                <span><b>16 equipos</b> — cuartos, semis y final</span></label>
              <label class="radio"><input type="radio" name="tamano" value="32" />
                <span><b>32 equipos</b> — el mundial completo, con octavos</span></label>
              <label class="radio"><input type="radio" name="tamano" value="8" />
                <span><b>8 equipos</b> — torneo relámpago</span></label>
            </div>
          </div>
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

      <footer class="home-pie">156 planteles históricos (1950–2022) + las 48 selecciones del Mundial 2026 · 5 modos de juego</footer>
    </div>
  `);

  const leerNombre = () => {
    const n = $('#nombre', root).value.trim();
    if (!n) { toast('Primero pon tu nombre', true); return null; }
    localStorage.setItem('mundialito-nombre', n);
    return n;
  };

  $('#btn-crear', root).addEventListener('click', async () => {
    const nombre = leerNombre();
    if (!nombre) return;
    const modo = root.querySelector('input[name=modo]:checked').value;
    const tamano = root.querySelector('input[name=tamano]:checked').value;
    try {
      const code = await net.crearSala(nombre, `${modo}|${tamano}`);
      entrarASala(code);
    } catch (e) { toast('No se pudo crear la sala: ' + e.message, true); }
  });

  $('#btn-unirse', root).addEventListener('click', async () => {
    const nombre = leerNombre();
    if (!nombre) return;
    const code = $('#codigo', root).value.trim().toUpperCase();
    if (code.length !== 5) { toast('El código tiene 5 letras', true); return; }
    try {
      await net.unirse(code, nombre);
      entrarASala(code);
    } catch (e) { toast(e.message, true); }
  });

  $('#codigo', root)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#btn-unirse', root).click();
  });
}
