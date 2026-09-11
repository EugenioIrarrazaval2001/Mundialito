import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFile } from 'node:fs/promises';
export async function database({uuidIds=false,legacyMigrations=false,compositePlayerKey=false}={}) {
  const db=new PGlite({extensions:{pgcrypto,unaccent}});
  for(const path of ['../tests/base-fixture.sql','../supabase/add_persistent_groups.sql',...(legacyMigrations?['../supabase/unified_group_lobby.sql','../supabase/abandoned_tournament_recovery.sql']:[]),'../supabase/quick_rooms_lifecycle.sql']) {
    let sql=await readFile(new URL(path,import.meta.url),'utf8');
    if(uuidIds&&path.includes('fixture'))sql=sql.replace('host_id text','host_id uuid').replace('id text primary key','id uuid primary key');
    if(compositePlayerKey&&path.includes('fixture'))sql+='\nalter table public.players drop constraint players_pkey; alter table public.players add primary key(room_code,id);';
    await db.exec(sql);
  }
  return db;
}
export const identity=()=>({operationId:crypto.randomUUID(),token:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')});
export async function rpc(db,action,payload={}) {
  return (await db.query('select public.mundialito_api($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result;
}
