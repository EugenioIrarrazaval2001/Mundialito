// Iconos originales de premios de Mundialito.
// Se dibujan en SVG para no depender de imágenes ni marcas oficiales.

function xmlEsc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[caracter]));
}

function opcionesIcono(opciones, tituloPorDefecto) {
  if (typeof opciones === 'string') opciones = { className: opciones };
  const {
    className = '',
    title = tituloPorDefecto,
    decorative = false,
  } = opciones || {};
  const clase = ['premio-svg', className].filter(Boolean).map(xmlEsc).join(' ');
  const accesibilidad = decorative
    ? 'aria-hidden="true" focusable="false"'
    : `role="img" aria-label="${xmlEsc(title)}" focusable="false"`;
  return { clase, accesibilidad };
}

/**
 * Copa mundialera original. No reproduce ningún trofeo o logotipo oficial.
 * @param {{className?: string, title?: string, decorative?: boolean}|string} opciones
 */
export function copaMundialitoSvg(opciones = {}) {
  const { clase, accesibilidad } = opcionesIcono(opciones, 'Copa de campeón');
  return `
    <svg class="${clase} copa-mundialito-svg" viewBox="0 0 72 96"
      ${accesibilidad} xmlns="http://www.w3.org/2000/svg">
      <path class="copa-svg-sombra" d="M18 88h36l4 6H14z"/>
      <path class="copa-svg-base" d="M22 77h28l3 11H19z"/>
      <path class="copa-svg-borde" d="M25 72h22l3 7H22z"/>
      <path class="copa-svg-cuerpo"
        d="M29 31c-1 10-7 14-9 21-2 8 4 15 12 18l-2 5h12l-2-5c8-3 14-10 12-18-2-7-8-11-9-21z"/>
      <path class="copa-svg-brillo" d="M33 35c-1 9-7 15-7 20 0 5 3 8 7 10-2-7 2-12 5-17 2-4 2-8 1-13z"/>
      <circle class="copa-svg-mundo" cx="36" cy="22" r="18"/>
      <path class="copa-svg-continente"
        d="M24 13l7-5 7 3 2 5 8 2 2 6-6 3-2 8-6 3-4-7-6-2-4-7z"/>
      <path class="copa-svg-orbita" d="M19 21c8 5 26 7 34-2M25 8c3 8 11 13 24 14"/>
      <path class="copa-svg-asas" d="M28 36c-8 0-14 5-13 13 1 6 5 10 12 11M44 36c8 0 14 5 13 13-1 6-5 10-12 11"/>
    </svg>`;
}

/**
 * Medalla original para segundo y tercer lugar.
 * @param {'silver'|'bronze'|'plata'|'bronce'} tipo
 * @param {{className?: string, title?: string, decorative?: boolean}|string} opciones
 */
export function medallaMundialitoSvg(tipo = 'silver', opciones = {}) {
  const bronce = tipo === 'bronze' || tipo === 'bronce';
  const metal = bronce ? 'bronze' : 'silver';
  const titulo = bronce ? 'Medalla de bronce' : 'Medalla de plata';
  const { clase, accesibilidad } = opcionesIcono(opciones, titulo);
  return `
    <svg class="${clase} medalla-mundialito-svg medalla-${metal}"
      viewBox="0 0 64 80" ${accesibilidad} xmlns="http://www.w3.org/2000/svg">
      <path class="medalla-svg-cinta medalla-svg-cinta-a" d="M10 3h18l8 36-15 5z"/>
      <path class="medalla-svg-cinta medalla-svg-cinta-b" d="M36 3h18L43 44l-15-5z"/>
      <circle class="medalla-svg-sombra" cx="32" cy="53" r="24"/>
      <circle class="medalla-svg-metal" cx="32" cy="50" r="23"/>
      <circle class="medalla-svg-borde" cx="32" cy="50" r="17"/>
      <path class="medalla-svg-estrella"
        d="M32 36l4.1 8.3 9.2 1.3-6.7 6.5 1.6 9.2-8.2-4.4-8.2 4.4 1.6-9.2-6.7-6.5 9.2-1.3z"/>
    </svg>`;
}
