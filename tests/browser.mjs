import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startServer } from './test-server.mjs';
const server=await startServer();
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[];
const context=await browser.newContext({viewport:{width:390,height:844}});
context.on('page',p=>p.on('pageerror',e=>{errors.push(e.message);console.log('BROWSER ERROR',e.message);}));
const page=await context.newPage();
const wait=async (page,selector)=>page.locator(selector).waitFor({state:'visible',timeout:20000});
async function create(page,name){await page.goto(server.url);await page.getByRole('button',{name:'COMENZAR',exact:true}).click();await page.getByRole('button',{name:'PARTIDA RÁPIDA',exact:true}).click();await page.getByRole('button',{name:'CREAR PARTIDA RÁPIDA',exact:true}).click();assert.equal(await page.locator('form input').count(),1);await page.locator('#rapida-nombre').fill(name);await page.locator('form button[type=submit]').click();await wait(page,'#btn-repartir');return page.locator('.ticket-codigo').innerText();}
try {
 await page.goto(server.url);await page.getByRole('button',{name:'COMENZAR',exact:true}).click();
 assert.deepEqual(await page.locator('.inicio-acciones > button').allTextContents(),['CREAR GRUPO NUEVO','UNIRSE A GRUPO EXISTENTE','PARTIDA RÁPIDA','VER LAS MATEMÁTICAS DEL JUEGO']);
 const code=await create(page,'Juan-Pedro');assert.match(code,/^[A-Z]{5}$/);assert.equal(await page.locator('#btn-ranking-historico').count(),0);
 await context.grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#copiar-codigo').click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),code);
 const other=await browser.newContext();const friend=await other.newPage();friend.on('pageerror',e=>errors.push(e.message));
 await friend.goto(server.url);await friend.getByRole('button',{name:'COMENZAR',exact:true}).click();await friend.getByRole('button',{name:'PARTIDA RÁPIDA',exact:true}).click();await friend.getByRole('button',{name:'UNIRSE A PARTIDA RÁPIDA',exact:true}).click();assert.equal(await friend.locator('form input').count(),2);
 await friend.locator('#rapida-nombre').fill('Amigo');await friend.locator('#rapida-codigo').fill(' '+code.toLowerCase()+' ');await friend.locator('form button[type=submit]').click();await wait(friend,'.lista-jugadores');
 await page.waitForFunction(()=>document.querySelectorAll('.jugador-item').length===2);
 const ids=await page.evaluate(async()=>{const {app}=await import('/js/main.js');return {room:app.roomId,player:app.playerId};});
 await page.locator('#btn-repartir').click();await wait(page,'#btn-tirar');await wait(friend,'#btn-tirar');
 await page.locator('#btn-tirar').click();await page.waitForFunction(()=>document.querySelector('.salio-pais')&&!document.querySelector('#ruleta'));
 await page.waitForFunction(()=>document.querySelector('.draft-sync')?.textContent==='Progreso confirmado');
 const snapshot=await page.evaluate(async()=>{const {app}=await import('/js/main.js');const {net}=await import('/js/net/net.js');const s=await net.estado(app.code);return s.players.find(x=>x.id===app.playerId).draft_state;});
 assert.ok(snapshot.oferta);
 await page.reload();await wait(page,'.salio-pais');
 const resumed=await page.evaluate(async()=>{const {app}=await import('/js/main.js');return {room:app.roomId,player:app.playerId};});assert.deepEqual(resumed,ids);
 const twin=await context.newPage();await twin.goto(server.url);await wait(twin,'.salio-pais');assert.equal(await twin.evaluate(async()=>(await import('/js/main.js')).app.playerId),ids.player);
 await context.setOffline(true);await page.locator('#salida-global').click();await wait(page,'[data-inicio-rapida]');await context.setOffline(false);
 await page.waitForTimeout(3200);assert.equal(await page.locator('[data-inicio-rapida]').count(),1);
 await other.close();await twin.close();
 console.log('PASS mobile menu, minimal forms, two independent friends, code normalization, shared lobby/draft, reload/twin identity+offer, offline exit');
 assert.deepEqual(errors,[]);
} finally {await browser.close();await server.close();}
