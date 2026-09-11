import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startServer } from './test-server.mjs';
import { fileURLToPath } from 'node:url';
const localMode=process.env.MUNDIALITO_TEST_MODE==='local';
const groupMode=process.env.MUNDIALITO_TEST_MODE==='group';
const handoffMode=process.env.MUNDIALITO_TEST_MODE==='handoff';
const failureMode=handoffMode||process.env.MUNDIALITO_TEST_FAILURES==='1';
const solo=localMode||groupMode||process.env.MUNDIALITO_TEST_MODE==='solo';
const server=await startServer();
const browser=await chromium.launch({channel:'msedge',headless:true});
const contexts=[],pages=[],errors=[];
let finalizeFailures=0, retried=false, transferred=false;
async function page(){const c=await browser.newContext();contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});await p.route('https://fonts.googleapis.com/**',r=>r.abort());await p.route('https://flagcdn.com/**',r=>r.abort());if(localMode)await p.route('**/js/config.js',r=>r.fulfill({contentType:'text/javascript',body:"export const SUPABASE_URL='';export const SUPABASE_ANON_KEY='';"}));
 if(failureMode)await p.route('**/rpc/mundialito_api',async route=>{
  if(route.request().postDataJSON().p_action==='finalize'&&finalizeFailures<2){
   const stage=finalizeFailures++;if(stage===1)await route.fetch();
   await route.abort('connectionfailed');
  }else await route.continue();
 });
 pages.push(p);return p;}
async function menu(p){await p.goto(server.url);await p.getByRole('button',{name:'COMENZAR',exact:true}).click();await p.getByRole('button',{name:'PARTIDA RÁPIDA',exact:true}).click();}
async function confirmed(p){await p.waitForFunction(()=>document.querySelector('.draft-sync')?.textContent==='Progreso confirmado'&&!document.querySelector('#ruleta'),{},{timeout:20000});}
async function draft(p,label){
 for(let turn=0;turn<100;turn++){
  await confirmed(p);
  if(await p.locator('#btn-listo').count()){await p.locator('#btn-listo').click();console.log(label+' draft completed with real UI choices');return;}
  if(await p.locator('#btn-tirar').count()){await p.locator('#btn-tirar').click();await confirmed(p);}
  const candidates=p.locator('.fila-jugador:not(:disabled)');
  if(!await candidates.count()){await p.locator('#cmd-pasar').click();continue;}
  await candidates.first().click();await confirmed(p);
  const natural=p.locator('.slot-disponible.slot-natural');
  const any=p.locator('.slot-disponible,.banca-disponible');
  if(await natural.count())await natural.first().click();else await any.first().click();
 }
 throw Error('Draft exceeded 100 offers');
}
async function advance(p){
 for(const selector of ['#elim-mirar','#resumen-continuar','[data-arquero-elegido]','#tanda-siguiente-penal','#tanda-continuar','[data-zona-penal]','#btn-skip','#btn-sig']){
  const b=p.locator(selector).first();if(await b.count()&&await b.isVisible()&&await b.isEnabled()){
   await b.click({timeout:3000}).catch(()=>{});return;
  }
 }
}
try{
 const a=await page(),b=solo?null:await page();let driver=a;
 if(groupMode){
  await a.goto(server.url);await a.getByRole('button',{name:'COMENZAR',exact:true}).click();await a.getByRole('button',{name:'CREAR GRUPO NUEVO',exact:true}).click();
  await a.locator('#inicio-nombre-grupo').fill('Grupo Recorrido');await a.locator('#inicio-nombre-miembro').fill('Juan-Pedro');await a.locator('#inicio-pin').fill('0012');await a.locator('#inicio-pin-confirmar').fill('0012');await a.getByRole('button',{name:'CREAR GRUPO',exact:true}).click();
 }else{await menu(a);await a.getByRole('button',{name:'CREAR PARTIDA RÁPIDA',exact:true}).click();await a.locator('#rapida-nombre').fill('Anfitrión');await a.locator('form button').click();}
 await a.locator('#btn-repartir').waitFor();
 const code=await a.locator('.ticket-codigo').innerText();
 const originalRoomId=await a.evaluate(async()=>(await import('/js/main.js')).app.roomId);
 if(b){await menu(b);await b.getByRole('button',{name:'UNIRSE A PARTIDA RÁPIDA',exact:true}).click();await b.locator('#rapida-nombre').fill('Amigo');await b.locator('#rapida-codigo').fill(code);await b.locator('form button').click();await b.locator('.lista-jugadores').waitFor();await a.waitForFunction(()=>document.querySelectorAll('.jugador-item').length===2);}
 await a.locator('#btn-repartir').click();
 await Promise.all(pages.map(p=>p.locator('#btn-tirar').waitFor()));
 await Promise.all(pages.map((p,i)=>draft(p,i===0?'host':'friend')));
 await a.waitForFunction(()=>document.querySelector('#btn-pitazo')&&!document.querySelector('#btn-pitazo').disabled);
 await a.locator('#btn-pitazo').click();await Promise.all(pages.map(p=>p.locator('.torneo').waitFor({timeout:60000})));
 console.log('Running tournament: '+(groupMode?'SQL group':localMode?'local solo':solo?'SQL solo':'SQL multiplayer'));
 const until=Date.now()+360000;let loops=0;
 while(Date.now()<until){
  const current=await driver.evaluate(async()=>{const {app}=await import('/js/main.js');const {net}=await import('/js/net/net.js');return (await net.estado(app.code)).room;});
  if(current.status==='finished')break;
  const retry=driver.locator('#btn-reintentar-finalizacion');
  if(failureMode&&!retried&&await retry.count()&&await retry.isVisible()&&await retry.isEnabled()){
   assert.equal(current.status,'running');assert.match(await driver.locator('#estado-finalizacion-grupo').innerText(),/No se confirmó/);
   assert.equal(await driver.locator('#btn-volver-grupo').isEnabled(),true);retried=true;
   if(handoffMode){
    await a.locator('#salida-global').click();await a.locator('[data-inicio-rapida]').waitFor();driver=b;transferred=true;
    await b.waitForFunction(async()=>{const {app}=await import('/js/main.js');return app.estado?.room.host_id===app.playerId;},{},{timeout:20000});
   }else await retry.click();
  }
  await Promise.all(pages.map(advance));await new Promise(r=>setTimeout(r,150));
  if(++loops%40===0)console.log('Tournament UI steps',loops,await driver.locator('.miga.activa').innerText().catch(()=>''));
 }
 const room=await driver.evaluate(async()=>{const {app}=await import('/js/main.js');const {net}=await import('/js/net/net.js');return (await net.estado(app.code)).room;});assert.equal(room.status,'finished');assert.equal(room.final_podium.length,3);
 if(failureMode){assert.equal(finalizeFailures,2);assert.equal(retried,true);if(handoffMode)assert.equal(transferred,true);}
 if(groupMode){
  const awards=(await server.db.query('select count(*)::int n from public.tournament_results')).rows[0].n;
  assert.equal((await server.db.query('select count(*)::int n from public.group_members')).rows[0].n,1);
  assert.equal((await server.db.query('select count(*)::int n from public.tournament_participants')).rows[0].n,1);
  await a.locator('#btn-volver-grupo').click();await a.locator('[data-inicio-rapida]').waitFor();
  // A fresh browser recovers the group identity with PIN and gets a new lobby.
  const next=await page();await next.goto(server.url);await next.getByRole('button',{name:'COMENZAR',exact:true}).click();await next.getByRole('button',{name:'UNIRSE A GRUPO EXISTENTE',exact:true}).click();
  await next.locator('#inicio-buscar-grupo').fill('Grupo Recorrido');await next.getByRole('button',{name:'BUSCAR GRUPO',exact:true}).click();
  const member=(await server.db.query('select id from public.group_members')).rows[0].id;
  await next.locator('#grupo-miembro-select').selectOption(member);await next.locator('#grupo-pin-existente').fill('0012');await next.locator('#panel-miembro-existente button[type=submit]').click();await next.locator('#btn-repartir').waitFor();
  assert.notEqual(await next.evaluate(async()=>(await import('/js/main.js')).app.roomId),originalRoomId);
  assert.equal((await server.db.query('select count(*)::int n from public.tournament_results')).rows[0].n,awards);
 }else{
  await driver.locator('#btn-otra-rapida').waitFor();await driver.locator('#btn-otra-rapida').click();await driver.locator('#rapida-nombre').fill('Otra partida');await driver.locator('form button').click();await driver.locator('#btn-repartir').waitFor();
  assert.notEqual(await driver.locator('.ticket-codigo').innerText(),code);
  assert.notEqual(await driver.evaluate(async()=>(await import('/js/main.js')).app.roomId),originalRoomId);
  assert.equal((await server.db.query('select count(*)::int n from public.group_members')).rows[0].n,0);
  if(b&&!transferred){await b.locator('#btn-volver-grupo').click();await b.locator('[data-inicio-rapida]').waitFor();}
 }
 assert.deepEqual(errors,[]);console.log('PASS full '+(groupMode?'SQL group with PIN recovery/history':localMode?'local solo':solo?'SQL solo':handoffMode?'SQL multiplayer with pending podium host handoff':'SQL multiplayer')+' draft -> tournament -> confirmed podium -> menu/new identity'+(failureMode?', finalize errors before and after commit':''));
}catch(e){for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:fileURLToPath(new URL(`journey-failure-${i}.png`,import.meta.url)),fullPage:true}).catch(()=>{});throw e;}
finally{await browser.close();await server.close();}
