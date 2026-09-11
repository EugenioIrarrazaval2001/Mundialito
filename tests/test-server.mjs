// Servidor aislado: archivos reales + RPC SQL reales en PostgreSQL/WASM.
// No conecta a Supabase, no usa datos del propietario.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { database,rpc } from './database.mjs';
export async function startServer(port=0) {
 const db=await database(), root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const server=createServer(async(req,res)=>{
  try {
   if(req.url==='/rest/v1/rpc/mundialito_api') {
    let data='';for await(const chunk of req)data+=chunk;const p=JSON.parse(data);
    const result=await rpc(db,p.p_action,p.p_payload);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
   }
   const url=new URL(req.url,'http://localhost');let path=decodeURIComponent(url.pathname);if(path==='/')path='/index.html';
   const absolute=resolve(root,'.'+path);if(!absolute.startsWith(root+sep))throw Error('path');
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'})[extname(path)]||'text/plain');
   if(path==='/js/config.js')res.end(`export const SUPABASE_URL=location.origin;export const SUPABASE_ANON_KEY='isolated-test';`);
   else res.end(await readFile(absolute));
  } catch(e){res.statusCode=500;res.end(JSON.stringify({message:e.message}));}
 });
 await new Promise(done=>server.listen(port,'127.0.0.1',done));
 return {db,url:'http://127.0.0.1:'+server.address().port,close:async()=>{await new Promise(done=>server.close(done));await db.close();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=await startServer(8765);console.log('Isolated test server: '+server.url);}
