import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startServer } from './test-server.mjs';
const server = await startServer(), browser = await chromium.launch({channel: 'msedge', headless: true});
const context = await browser.newContext(), page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('https://fonts.googleapis.com/**', route => route.abort());
const click = name => page.getByRole('button', {name, exact: true}).click();
const deferred = () => {let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve};};
async function create(name) {
  await click('PARTIDA RÁPIDA'); await click('CREAR PARTIDA RÁPIDA');
  await page.locator('#rapida-nombre').fill(name); await page.locator('form button').click();
  await page.locator('#btn-repartir').waitFor();
}
try {
  await page.goto(server.url); await click('COMENZAR'); await create('Reconexión tardía');
  const started = deferred(), release = deferred();
  await page.route('**/rpc/mundialito_api', async route => {
    if (route.request().postDataJSON().p_action === 'reconnect') {
      const response = await route.fetch(); started.resolve(); await release.promise; await route.fulfill({response});
    } else await route.continue();
  });
  await page.reload({waitUntil: 'domcontentloaded'}); await started.promise;
  await page.locator('#volver-menu').click(); release.resolve(); await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-inicio-rapida]').count(), 1, 'autoentrada tardía no repone la portada ni la sala');
  await page.unroute('**/rpc/mundialito_api');
  await create('Snapshot de la misma sala');
  const oldRead = deferred(), releaseOld = deferred(); let first = true;
  await page.route('**/rpc/mundialito_api', async route => {
    if (route.request().postDataJSON().p_action === 'state' && first) {
      first = false; const response = await route.fetch(); oldRead.resolve(); await releaseOld.promise; await route.fulfill({response});
    } else await route.continue();
  });
  await oldRead.promise; await page.locator('#btn-repartir').click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('#btn-tirar').waitFor(); releaseOld.resolve(); await page.waitForTimeout(700);
  assert.equal(await page.locator('#btn-tirar').count(), 1, 'snapshot viejo de lobby no revierte draft en la misma sala');
  await page.unroute('**/rpc/mundialito_api');
  // Quota is simulated only for the optional auto-entry backup. Local exit
  // and cleanup must remain usable; the authoritative database stays real.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'mundialito-resume-v2') throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('#salida-global').click(); await page.locator('[data-inicio-rapida]').waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/main.js')).app.code), null);
  assert.deepEqual(errors, []);
  console.log('PASS Edge + SQL: stale automatic resume, same-room snapshot order and local exit despite quota failure');
} finally {await browser.close(); await server.close();}
