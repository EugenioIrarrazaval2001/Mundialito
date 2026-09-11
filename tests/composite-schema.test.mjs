import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database, identity, rpc } from './database.mjs';

// Schema reported by the owner: UUID player/host IDs and PK (room_code,id).
// Legacy clients could reuse the same player ID across independent rooms.
test('composite UUID player key: upgrade and every own write preserve the other room', async () => {
  const db = await database({uuidIds:true, compositePlayerKey:true, legacyMigrations:true});
  try {
    async function group(clave) {
      const req = {clave,nombre:'Juan-Pedro',pin:'0012',...identity()};
      const g = await rpc(db,'group_create',req);
      assert.equal(g.ok,true);
      const access = {groupId:g.group.id,memberId:g.member.id,token:req.token};
      const room = await rpc(db,'group_access',access);
      assert.equal(room.ok,true);
      return {...room,token:req.token,access};
    }
    const a = await group('Grupo Compuesto A'), b = await group('Grupo Compuesto B');
    await db.exec("begin; select set_config('mundialito.persistent_group_rpc','on',true)");
    await db.query('update public.players set id=$1 where room_code=$2',[a.playerId,b.code]);
    await db.query('update public.rooms set host_id=$1 where code=$2',[a.playerId,b.code]);
    await db.exec('commit');
    const other = async () => (await db.query('select to_jsonb(p) as snapshot from public.players p where room_code=$1',[b.code])).rows[0].snapshot;
    const original = await other();
    // Reapplying the upgrade must not deduplicate, move or delete legacy rows.
    await db.exec(await readFile(new URL('../supabase/quick_rooms_lifecycle.sql',import.meta.url),'utf8'));
    assert.equal((await db.query('select count(*)::int n from public.players where id=$1',[a.playerId])).rows[0].n,2);
    await db.exec('set role anon');
    async function isolated(action,payload=a) {
      const result = await rpc(db,action,payload);
      assert.equal(result.ok,true,JSON.stringify(result));
      await db.exec('reset role');
      assert.deepEqual(await other(),original,`${action} changed the other room`);
      await db.exec('set role anon');
      return result;
    }
    await isolated('group_access',a.access);
    await isolated('heartbeat',{...a,visible:true});
    await isolated('leave');
    await isolated('reconnect');
    await isolated('start_draft');
    const state = {picks:[{id:'confirmed'}],bench:[],formacion:'4-3-3',offer:[{id:'pending'}]};
    assert.equal((await isolated('save_draft',{...a,expectedRevision:0,state})).revision,1);
    await isolated('update_player',{...a,targetId:a.playerId,changes:{ready:true,draft_revision:1,lineup:{slots:state.picks,bench:state.bench},formacion:state.formacion}});
    await isolated('start_tournament');
    await isolated('update_player',{...a,targetId:a.playerId,changes:{resultados:{_paso:1,match:{score:'1-0'}}}});
    assert.equal((await rpc(db,'state',a)).players[0].resultados._paso,1);
    await isolated('finalize',{...a,podium:[{place:1,teamId:'h-'+a.playerId},{place:2,teamId:'ai-1'},{place:3,teamId:'ai-2'}]});
    assert.equal((await rpc(db,'state',{...b,playerId:a.playerId,token:a.token})).code,'INVALID_SESSION');
    await db.exec('reset role');
    assert.equal((await db.query('select status from public.rooms where code=$1',[b.code])).rows[0].status,'lobby');
  } finally { await db.close(); }
});
