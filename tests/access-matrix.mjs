// Formularios reales contra SQL aislado. Los fixtures preparan casos terminales
// y cupos; no sustituyen los recorridos deportivos de game-journey.mjs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startServer } from './test-server.mjs';
import { identity, rpc } from './database.mjs';
const server = await startServer(), browser = await chromium.launch({channel: 'msedge', headless: true});
const errors = [];
async function page() {
  const context = await browser.newContext({viewport: {width: 390, height: 844}});
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('https://flagcdn.com/**', route => route.abort());
  await page.goto(server.url); await page.getByRole('button', {name: 'COMENZAR', exact: true}).click();
  return page;
}
async function quick(name) {
  const request = {nombre: name, ...identity()}, result = await rpc(server.db, 'quick_create', request);
  assert.equal(result.ok, true); return {...result, token: request.token};
}
const join = async (room, name) => rpc(server.db, 'quick_join', {nombre: name, code: room.code, ...identity()});
async function form(p) {
  await p.getByRole('button', {name: 'PARTIDA RÁPIDA', exact: true}).click();
  await p.getByRole('button', {name: 'UNIRSE A PARTIDA RÁPIDA', exact: true}).click();
}
async function groupLogin(p, groupName, memberId) {
  await p.getByRole('button', {name: 'UNIRSE A GRUPO EXISTENTE', exact: true}).click();
  await p.locator('#inicio-buscar-grupo').fill(groupName); await p.getByRole('button', {name: 'BUSCAR GRUPO', exact: true}).click();
  await p.locator('#grupo-miembro-select').selectOption(memberId); await p.locator('#grupo-pin-existente').fill('0012');
  await p.locator('#panel-miembro-existente button[type=submit]').click();
}
try {
  const full = await quick('Sala Llena'), started = await quick('Mismo Nombre'), finished = await quick('Finalizada'), cancelled = await quick('Cancelada'), expired = await quick('Caducada');
  for (let i = 0; i < 31; i++) assert.equal((await join(full, 'Amigo ' + i)).ok, true);
  await rpc(server.db, 'start_draft', started);
  await rpc(server.db, 'start_draft', finished);
  await rpc(server.db, 'update_player', {...finished, targetId: finished.playerId, changes: {ready: true, lineup: {fixture: true}, formacion: '4-3-3'}});
  await rpc(server.db, 'start_tournament', finished);
  await rpc(server.db, 'finalize', {...finished, podium: [{place: 1, teamId: 'ai-1'}, {place: 2, teamId: 'ai-2'}, {place: 3, teamId: 'ai-3'}]});
  await rpc(server.db, 'cancel', cancelled);
  await server.db.query("update public.rooms set last_activity_at=clock_timestamp()-interval '601 seconds' where id=$1", [expired.roomId]);
  await server.db.query("update public.players set last_seen=clock_timestamp()-interval '601 seconds' where room_code=$1", [expired.code]);
  const missing = 'ZZZZZ'; assert.equal((await server.db.query('select code from public.rooms where code=$1', [missing])).rows.length, 0);
  for (const [code, message] of [['zz', /cinco letras/], [missing, /No existe/], [full.code, /llena/], [started.code, /ya empezó/], [finished.code, /ya terminó/], [cancelled.code, /cancelada/], [expired.code, /caducó/]]) {
    const p = await page(); await form(p); await p.locator('#rapida-nombre').fill('Mismo Nombre'); await p.locator('#rapida-codigo').fill(code); await p.locator('form button').click();
    await p.locator('#rapida-error:not([hidden])').waitFor(); assert.match(await p.locator('#rapida-error').innerText(), message);
    await p.locator('[data-inicio-volver]').click(); await p.locator('[data-inicio-volver]').click(); await p.locator('[data-inicio-rapida]').waitFor();
    await p.context().close();
  }
  assert.equal((await rpc(server.db, 'reconnect', started)).playerId, started.playerId);
  console.log('PASS mobile join errors: invalid, missing, full, started, finished, cancelled, expired; back always works');

  const capacityHost = await page();
  await capacityHost.getByRole('button', {name:'PARTIDA RÁPIDA',exact:true}).click();await capacityHost.getByRole('button',{name:'CREAR PARTIDA RÁPIDA',exact:true}).click();
  await capacityHost.locator('#rapida-nombre').fill('Cupos visibles');await capacityHost.locator('form button').click();await capacityHost.locator('#btn-repartir').waitFor();
  const capacityRoom = await capacityHost.evaluate(async()=>{const {app}=await import('/js/main.js');return {code:app.code,roomId:app.roomId,playerId:app.playerId};});
  let absent;
  for(let i=0;i<31;i++)absent=await join(capacityRoom,'Desconectado '+i);
  await server.db.query("update public.players set last_seen=clock_timestamp()-interval '91 seconds' where room_code=$1 and id<>$2",[capacityRoom.code,capacityRoom.playerId]);
  await capacityHost.waitForFunction(()=>document.querySelectorAll('.jugador-item').length===32&&document.body.textContent.includes('31 desconectados'));
  capacityHost.once('dialog',dialog=>dialog.accept());await capacityHost.locator(`[data-kick="${absent.playerId}"]`).click();
  await capacityHost.waitForFunction(()=>document.querySelectorAll('.jugador-item').length===31&&document.body.textContent.includes('1 cupos disponibles'));
  const lastFriend=await page();await form(lastFriend);await lastFriend.locator('#rapida-nombre').fill('Último cupo');await lastFriend.locator('#rapida-codigo').fill(capacityRoom.code);await lastFriend.locator('form button').click();
  await lastFriend.waitForFunction(()=>document.querySelectorAll('.jugador-item').length===32);
  assert.equal((await server.db.query('select count(*)::int n from public.players where room_code=$1 and expelled_at is null',[capacityRoom.code])).rows[0].n,32);
  await lastFriend.context().close();await capacityHost.context().close();
  console.log('PASS 32 visible occupied slots including disconnected players; host exclusion frees one slot and friend joins');

  const host = await page();
  await host.getByRole('button', {name: 'CREAR GRUPO NUEVO', exact: true}).click();
  await host.locator('#inicio-nombre-grupo').fill('Grupo Recuperable'); await host.locator('#inicio-nombre-miembro').fill('Juan-Pedro');
  await host.locator('#inicio-pin').fill('0012'); await host.locator('#inicio-pin-confirmar').fill('0012'); await host.getByRole('button', {name: 'CREAR GRUPO', exact: true}).click();
  await host.locator('#btn-repartir').waitFor();
  const before = await host.evaluate(async () => {const {app} = await import('/js/main.js'); return {roomId: app.roomId, playerId: app.playerId, memberId: app.grupo.member.id};});
  await host.locator('#btn-configurar-planteles').click();
  await host.locator('.interruptor-mundial').first().click();
  assert.equal(await host.locator('[data-switch-anio]').first().isChecked(), false);
  await host.waitForFunction(async () => {const {app} = await import('/js/main.js'); const {net} = await import('/js/net/net.js'); return Array.isArray((await net.estado(app.code)).room.enabled_squads);});
  await host.locator('.btn-volver-selecciones').click();
  await host.locator('#btn-repartir').click(); await host.locator('#btn-tirar').click();
  await host.waitForFunction(() => document.querySelector('.draft-sync')?.textContent === 'Progreso confirmado' && !document.querySelector('#ruleta'));
  await host.locator('.fila-jugador:not(:disabled)').first().click();
  await host.waitForFunction(() => document.querySelector('.draft-sync')?.textContent === 'Progreso confirmado');
  await host.locator('.slot-disponible,.banca-disponible').first().click();
  await host.waitForFunction(() => document.querySelector('.draft-sync')?.textContent === 'Progreso confirmado');
  const confirmed = (await server.db.query('select draft_state from public.players where id=$1', [before.playerId])).rows[0].draft_state;
  const secondDevice = await page(); await groupLogin(secondDevice, 'Grupo Recuperable', before.memberId);
  await secondDevice.locator('.draft-sync').waitFor();
  const after = await secondDevice.evaluate(async () => {const {app} = await import('/js/main.js'); return {roomId: app.roomId, playerId: app.playerId, memberId: app.grupo.member.id};});
  assert.deepEqual(after, before);
  assert.deepEqual((await server.db.query('select draft_state from public.players where id=$1', [before.playerId])).rows[0].draft_state, confirmed);
  assert.equal((await server.db.query('select count(*)::int n from public.players where room_code=(select code from public.rooms where id=$1)', [before.roomId])).rows[0].n, 1);
  await host.context().close();
  // A brief visibility change never removes the confirmed participation.
  await secondDevice.evaluate(() => {Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'}); document.dispatchEvent(new Event('visibilitychange'));});
  const hiddenAt = (await server.db.query('select last_seen from public.players where id=$1', [before.playerId])).rows[0].last_seen;
  await secondDevice.evaluate(async () => {const {app} = await import('/js/main.js'); const {net} = await import('/js/net/net.js'); await net.mantenerPresencia(app.code);});
  assert.equal(new Date((await server.db.query('select last_seen from public.players where id=$1', [before.playerId])).rows[0].last_seen).getTime(), new Date(hiddenAt).getTime());
  await secondDevice.evaluate(() => {Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'}); document.dispatchEvent(new Event('visibilitychange'));});
  await secondDevice.locator('#salida-global').click(); await secondDevice.locator('[data-inicio-rapida]').waitFor();
  assert.equal(await secondDevice.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('mundialito-grupo-sesion:'))), true);
  console.log('PASS real group forms: squads saved, PIN on independent browser restores same participation/draft, brief hidden heartbeat does not refresh presence, exit preserves group identity');
  assert.deepEqual(errors, []);
} finally {await browser.close(); await server.close();}
