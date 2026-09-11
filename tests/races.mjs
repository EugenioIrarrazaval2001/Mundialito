import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startServer} from './test-server.mjs';
const server=await startServer(),browser=await chromium.launch({channel:'msedge',headless:true});
const c=await browser.newContext(),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('https://fonts.googleapis.com/**',r=>r.abort());
const click=name=>p.getByRole('button',{name,exact:true}).click();
try {
 await p.goto(server.url);await click('COMENZAR');await click('CREAR GRUPO NUEVO');
 await p.locator('#inicio-nombre-grupo').fill('Grupo Resiliente');await p.locator('#inicio-nombre-miembro').fill('Juan-Pedro');await p.locator('#inicio-pin').fill('0012');await p.locator('#inicio-pin-confirmar').fill('0012');
 let lost=false;
 await p.route('**/rpc/mundialito_api',async route=>{
  if(route.request().postDataJSON().p_action==='group_create'&&!lost){lost=true;await route.fetch();await route.abort('connectionfailed');}
  else await route.continue();
 });
 await click('CREAR GRUPO');await p.locator('#inicio-error-crear:not([hidden])').waitFor();
 assert.equal((await server.db.query('select count(*)::int n from public.groups')).rows[0].n,1);
 await click('CREAR GRUPO');await p.locator('#btn-repartir').waitFor();
 assert.equal((await server.db.query('select count(*)::int n from public.group_members')).rows[0].n,1);
 await p.unroute('**/rpc/mundialito_api');await p.locator('#salida-global').click();
 const enterGroup=async()=>{await click('UNIRSE A GRUPO EXISTENTE');await p.locator('#inicio-buscar-grupo').fill('Grupo Resiliente');await click('BUSCAR GRUPO');await p.locator('#grupo-miembro-select').waitFor();const member=(await server.db.query('select id from public.group_members')).rows[0].id;await p.locator('#grupo-miembro-select').selectOption(member);await p.locator('#grupo-pin-existente').fill('0012');};
 await enterGroup();let failAccess=true;
 await p.route('**/rpc/mundialito_api',async route=>{if(route.request().postDataJSON().p_action==='group_access'&&failAccess){failAccess=false;await route.abort('connectionfailed');}else await route.continue();});
 await p.locator('#panel-miembro-existente button[type=submit]').click();await p.locator('#reintentar-acceso').waitFor();
 assert.equal(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('mundialito-grupo-sesion:'))),true);
 assert.equal(await p.locator('#volver-menu').isVisible(),true);await p.locator('#reintentar-acceso').click();await p.locator('#btn-repartir').waitFor();
 await p.unroute('**/rpc/mundialito_api');await p.locator('#salida-global').click();await enterGroup();
 let release,startedResolve;const started=new Promise(r=>startedResolve=r);const hold=new Promise(r=>release=r);
 await p.route('**/rpc/mundialito_api',async route=>{if(route.request().postDataJSON().p_action==='group_claim'){startedResolve();await hold;await route.continue();}else await route.continue();});
 await p.locator('#panel-miembro-existente button[type=submit]').click();await started;
 await p.locator('[data-inicio-volver-identidad]').click();release();await p.waitForTimeout(1200);
 assert.equal(await p.locator('#inicio-buscar-grupo').isVisible(),true);assert.equal(await p.evaluate(async()=>(await import('/js/main.js')).app.code),null);
 await p.unroute('**/rpc/mundialito_api');
 await p.locator('[data-inicio-volver]').click();await click('PARTIDA RÁPIDA');await click('CREAR PARTIDA RÁPIDA');await p.locator('#rapida-nombre').fill('Sala A');await p.locator('form button').click();await p.locator('#btn-repartir').waitFor();
 const oldRoom=await p.evaluate(async()=>(await import('/js/main.js')).app.roomId);
 let releaseState,resolveState;const oldStateStarted=new Promise(r=>resolveState=r),holdState=new Promise(r=>releaseState=r);
 await p.route('**/rpc/mundialito_api',async route=>{const d=route.request().postDataJSON();if(d.p_action==='state'&&d.p_payload.roomId===oldRoom){const response=await route.fetch();resolveState();await holdState;await route.fulfill({response});}else await route.continue();});
 await oldStateStarted;await p.locator('#salida-global').click();await click('PARTIDA RÁPIDA');await click('CREAR PARTIDA RÁPIDA');await p.locator('#rapida-nombre').fill('Sala B');await p.locator('form button').click();await p.locator('#btn-repartir').waitFor();
 const newRoom=await p.evaluate(async()=>(await import('/js/main.js')).app.roomId);assert.notEqual(newRoom,oldRoom);releaseState();await p.waitForTimeout(1000);
 assert.equal(await p.evaluate(async()=>(await import('/js/main.js')).app.roomId),newRoom);assert.equal(await p.locator('.nombre-jugador').innerText(),'Sala B');
 assert.deepEqual(errors,[]);console.log('PASS real browser + SQL: lost commit reply, atomic group retry, PIN then network failure/retry, late login after back, old A response after B');
}finally{await browser.close();await server.close();}
