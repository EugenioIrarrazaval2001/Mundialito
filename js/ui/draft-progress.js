// PostgreSQL jsonb reordena las claves. La identidad del progreso depende de
// sus valores; comparar JSON.stringify sin normalizar hacía que dos pestañas
// volvieran a publicar continuamente el mismo draft.
export function firmaProgreso(value) {
  const ordenar = dato => Array.isArray(dato) ? dato.map(ordenar)
    : dato && typeof dato === 'object'
      ? Object.fromEntries(Object.keys(dato).sort().map(key => [key, ordenar(dato[key])]))
      : dato;
  return JSON.stringify(ordenar(value));
}

export function leerRespaldoDraft(storageKey) {
  try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); }
  catch { return null; }
}

export function escribirRespaldoDraft(storageKey, state) {
  // Modo privado/cuota agotada no deben impedir confirmar en el servidor.
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch { /* El estado confirmado sigue disponible en el servidor. */ }
}
