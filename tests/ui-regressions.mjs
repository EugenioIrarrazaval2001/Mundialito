// Navegador Edge real + RPC SQL real aislada. Solo se retienen/pierden
// respuestas de transporte para reproducir las carreras de pestañas.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startServer } from './test-server.mjs';

const server = await startServer();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('https://fonts.googleapis.com/**', route => route.abort());
await context.route('https://flagcdn.com/**', route => route.abort());
const a = await context.newPage();
const confirmed = page => page.waitForFunction(() =>
  document.querySelector('.draft-sync')?.textContent === 'Progreso confirmado' && !document.querySelector('#ruleta'));
const read = async () => (await server.db.query('select id, draft_revision, draft_state from public.players')).rows[0];
try {
  await a.goto(server.url);
  for (const name of ['COMENZAR', 'PARTIDA RÁPIDA', 'CREAR PARTIDA RÁPIDA']) {
    await a.getByRole('button', { name, exact: true }).click();
  }
  await a.locator('#rapida-nombre').fill('Dos pestañas');
  await a.locator('form button').click();
  await a.locator('#btn-repartir').click();
  await confirmed(a);
  const initial = await read();
  const b = await context.newPage();
  await b.goto(server.url);
  await confirmed(b);
  assert.equal(await b.evaluate(async () => (await import('/js/main.js')).app.playerId), initial.id);
  await a.waitForTimeout(3400);
  assert.equal((await read()).draft_revision, initial.draft_revision, 'dos pestañas no vuelven a guardar JSONB idéntico');

  const held = [];
  let holding = true;
  await context.route('**/rpc/mundialito_api', async route => {
    if (holding && route.request().postDataJSON().p_action === 'save_draft') {
      await new Promise(release => held.push({ route, release }));
    }
    await route.continue();
  });
  await a.locator('[data-form="4-4-2"]').click();
  await b.locator('[data-form="3-5-2"]').click();
  await a.waitForFunction(() => document.querySelector('.draft-sync')?.textContent === 'Guardando progreso…');
  await b.waitForFunction(() => document.querySelector('.draft-sync')?.textContent === 'Guardando progreso…');
  while (held.length < 2) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(held[0].route.request().postDataJSON().p_payload.expectedRevision,
    held[1].route.request().postDataJSON().p_payload.expectedRevision);
  holding = false;
  held[0].release();
  await confirmed(a);
  held[1].release();
  await confirmed(b);
  assert.equal((await read()).draft_state.formacion, '4-4-2');
  assert.equal(await b.locator('.formacion-card.seleccionada').getAttribute('data-form'), '4-4-2');
  const afterConflict = (await read()).draft_revision;
  await a.waitForTimeout(3300);
  assert.equal((await read()).draft_revision, afterConflict, 'recuperar un conflicto no publica de nuevo');
  await context.unroute('**/rpc/mundialito_api');

  await a.locator('#btn-tirar').click();
  await confirmed(a);
  await b.waitForFunction(() => Boolean(document.querySelector('.salio-pais')));
  await confirmed(b);
  assert.equal(await a.locator('.salio-pais').innerText(), await b.locator('.salio-pais').innerText());
  await a.locator('.fila-jugador:not(:disabled)').first().click();
  await confirmed(a);
  await a.locator('.slot-disponible,.banca-disponible').first().click();
  await confirmed(a);
  const picked = await read();
  assert.equal(picked.draft_state.picks.length + picked.draft_state.bench.length, 1);
  await b.waitForFunction(() => document.querySelector('.box-titulo')?.textContent.includes('XI 1/11') ||
    document.querySelector('.banca-ocupada'));
  await b.reload();
  await confirmed(b);
  assert.deepEqual((await read()).draft_state.picks, picked.draft_state.picks);
  assert.equal((await server.db.query('select count(*)::int n from public.players')).rows[0].n, 1);

  let lost = false;
  await a.route('**/rpc/mundialito_api', async route => {
    if (!lost && route.request().postDataJSON().p_action === 'save_draft') {
      lost = true;
      await route.fetch();
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await a.locator('#btn-tirar').click();
  await confirmed(a);
  assert.equal(lost, true);
  assert.ok((await read()).draft_state.oferta, 'la oferta comprometida sobrevive a perder la respuesta');
  await a.unroute('**/rpc/mundialito_api');
  await b.reload();
  await confirmed(b);
  assert.equal(await a.locator('.salio-pais').innerText(), await b.locator('.salio-pais').innerText());

  await a.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('mundialito-draft-')) localStorage.setItem(key, '{corrupto');
  });
  await a.reload();
  await confirmed(a);
  assert.equal((await read()).draft_state.picks.length + (await read()).draft_state.bench.length, 1);
  assert.deepEqual(errors, []);
  console.log('PASS Edge + SQL: identidad gemela, CAS simultáneo, sin ping-pong jsonb, picks/oferta recuperados, respuesta perdida y respaldo corrupto');
} finally {
  await browser.close();
  await server.close();
}
