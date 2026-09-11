import test from 'node:test';
import assert from 'node:assert/strict';
import { firmaProgreso, leerRespaldoDraft, escribirRespaldoDraft } from '../js/ui/draft-progress.js';

test('la firma de draft ignora el orden de claves jsonb, pero conserva elecciones y orden', () => {
  const local = { formacion: '4-3-3', picks: [{ id: 'uno', puesto: 'POR' }], oferta: 'oferta' };
  const servidor = { oferta: 'oferta', picks: [{ puesto: 'POR', id: 'uno' }], formacion: '4-3-3' };
  assert.equal(firmaProgreso(local), firmaProgreso(servidor));
  assert.notEqual(firmaProgreso(local), firmaProgreso({ ...servidor, oferta: 'otra' }));
  assert.notEqual(firmaProgreso({ picks: [1, 2] }), firmaProgreso({ picks: [2, 1] }));
});

test('respaldo corrupto/cuota agotada no impiden recuperar el draft del servidor', () => {
  const anterior = globalThis.localStorage;
  globalThis.localStorage = { getItem() { return '{invalido'; }, setItem() { throw Error('quota'); } };
  try {
    assert.equal(leerRespaldoDraft('participacion'), null);
    assert.doesNotThrow(() => escribirRespaldoDraft('participacion', { picks: [] }));
  } finally { globalThis.localStorage = anterior; }
});
