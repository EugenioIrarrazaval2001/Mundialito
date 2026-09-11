// PostgreSQL nativo, conexiones psql independientes y locks realmente contendidos.
// Crea y elimina SOLO una base de prueba nueva en 127.0.0.1; nunca usa Supabase.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (!process.env.MUNDIALITO_PG_BIN) throw Error('Define MUNDIALITO_PG_BIN con el directorio de psql del PostgreSQL de pruebas local.');
const binary = resolve(process.env.MUNDIALITO_PG_BIN, process.platform === 'win32' ? 'psql.exe' : 'psql');
const port = process.env.MUNDIALITO_PG_PORT || '55437';
assert.match(port, /^\d{1,5}$/);
const dbName = 'mundialito_test_' + randomUUID().replaceAll('-', '');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const args = db => ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', db];
const env = {...process.env, PGCLIENTENCODING: 'UTF8', PGAPPNAME: 'mundialito-native-test', PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=12000'};
function sql(command, db = dbName) {
  return new Promise((done, fail) => {
    const child = spawn(binary, args(db), {env, windowsHide: true});
    let output = '', error = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => error += data);
    child.on('error', fail);
    child.on('exit', code => code === 0 ? done(output.trim()) : fail(Error(error || 'psql failed')));
    child.stdin.end(command);
  });
}
const identity = () => ({operationId: randomUUID(), token: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')});
const rpc = async (action, payload = {}) => JSON.parse(await sql(`select public.mundialito_api(${quote(action)},${quote(JSON.stringify(payload))}::jsonb);`));
const quick = async (nombre = 'Jugador') => {
  const request = {nombre, ...identity()}, result = await rpc('quick_create', request);
  assert.equal(result.ok, true, JSON.stringify(result));
  return {...result, token: request.token, request};
};
const join = async (room, nombre) => {
  const request = {nombre, code: room.code, ...identity()};
  return {...await rpc('quick_join', request), token: request.token};
};
const fixture = command => sql(`begin; select set_config('mundialito.persistent_group_rpc','on',true); ${command}; commit;`);
async function hold(table, id) {
  const child = spawn(binary, args(dbName), {env, windowsHide: true});
  let output = '', error = '';
  child.stderr.on('data', data => error += data);
  const finished = new Promise((done, fail) => {
    child.on('error', fail);
    child.on('exit', code => code === 0 ? done() : fail(Error(error || 'lock holder failed')));
  });
  const locked = new Promise((done, fail) => {
    child.stdout.on('data', data => {output += data; if (output.includes('LOCKED')) done();});
    child.on('error', fail);
    child.on('exit', () => {if (!output.includes('LOCKED')) fail(Error(error || 'lock not acquired'));});
  });
  // Only callers below select these two fixed table names.
  assert.ok(['rooms', 'groups'].includes(table));
  child.stdin.write(`begin; select id from public.${table} where id=${quote(id)} for update; select 'LOCKED';\n`);
  await locked;
  return async () => {child.stdin.end('commit;\n'); await finished;};
}
async function raceUnderLock(table, id, actions) {
  const release = await hold(table, id);
  const pending = actions.map(run => run());
  // Attach handlers immediately; if the barrier fails, no unhandled rejections.
  const settled = Promise.allSettled(pending);
  try {
    let waiters = 0;
    for (let i = 0; i < 80 && waiters < actions.length; i++) {
      waiters = Number(await sql("select count(*) from pg_stat_activity where datname=current_database() and application_name='mundialito-native-test' and wait_event_type='Lock';"));
      if (waiters < actions.length) await new Promise(done => setTimeout(done, 40));
    }
    assert.ok(waiters >= actions.length, `Expected real lock contention from ${actions.length} connections, observed ${waiters}`);
  } finally {await release();}
  const results = await settled;
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results.map(result => result.value);
}
async function prepareRunning(room) {
  const draft = await rpc('start_draft', room);
  assert.equal(draft.ok, true, JSON.stringify(draft));
  // Owner-only fixture prepares teams; the transition itself is the real API.
  await fixture(`update public.players set ready=true,formacion='4-3-3',lineup='{"testFixture":true}' where room_code=${quote(room.code)}`);
  assert.equal((await rpc('start_tournament', room)).ok, true);
}
let created = false;
try {
  await sql(`create database ${dbName} encoding 'UTF8' template template0;`, 'postgres'); created = true;
  const base = (await readFile(new URL('./base-fixture.sql', import.meta.url), 'utf8'))
    .replace(/create role (anon|authenticated|service_role);/g, (_, role) => `do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$;`);
  await sql(base);
  for (const path of ['add_persistent_groups.sql', 'quick_rooms_lifecycle.sql']) await sql(await readFile(new URL('../supabase/' + path, import.meta.url), 'utf8'));
  console.log('PostgreSQL nativo:', await sql('show server_version;'));

  const request = {nombre: 'Un solo intento', ...identity()};
  const duplicates = await Promise.all(Array.from({length: 12}, () => rpc('quick_create', request)));
  assert.ok(duplicates.every(result => result.ok && result.roomId === duplicates[0].roomId));
  assert.equal(Number(await sql('select count(*) from public.rooms;')), 1);
  console.log('PASS 12 concurrent create retries: one room and participation');

  const full = await quick('Anfitrión cupos');
  for (let i = 0; i < 30; i++) assert.equal((await join(full, 'Jugador ' + i)).ok, true);
  const last = await raceUnderLock('rooms', full.roomId, [() => join(full, 'Último A'), () => join(full, 'Último B')]);
  assert.equal(last.filter(result => result.ok).length, 1);
  assert.equal(last.find(result => !result.ok).code, 'FULL');
  assert.equal((await rpc('state', full)).players.length, 32);
  console.log('PASS independent connections race for final slot: exactly 32');

  const groupRequest = {clave: 'Grupo concurrencia', nombre: 'Primero', pin: '0012', ...identity()};
  const group = await rpc('group_create', groupRequest); assert.equal(group.ok, true);
  const memberRequest = {groupId: group.group.id, nombre: 'Segundo', pin: '0023', ...identity()};
  const member = await rpc('group_member_create', memberRequest); assert.equal(member.ok, true);
  const accessA = {groupId: group.group.id, memberId: group.member.id, token: groupRequest.token};
  const accessB = {groupId: group.group.id, memberId: member.member.id, token: memberRequest.token};
  const old = await rpc('group_access', accessA);
  for (const status of ['lobby', 'draft', 'running']) {
    const active = await rpc('group_access', accessA);
    await fixture(`update public.rooms set status=${quote(status)},last_activity_at=clock_timestamp()-interval '601 seconds' where id=${quote(active.roomId)}; update public.players set last_seen=clock_timestamp()-interval '601 seconds' where room_code=${quote(active.code)}`);
    const recovered = await raceUnderLock('groups', group.group.id, [() => rpc('group_access', accessA), () => rpc('group_access', accessB)]);
    assert.ok(recovered.every(result => result.ok)); assert.equal(recovered[0].roomId, recovered[1].roomId); assert.notEqual(recovered[0].roomId, active.roomId);
    assert.equal(await sql(`select status from public.rooms where id=${quote(active.roomId)};`), 'cancelled');
    assert.equal(Number(await sql(`select count(*) from public.rooms where group_id=${quote(group.group.id)} and status in ('lobby','draft','running');`)), 1);
  }
  assert.notEqual((await rpc('group_access', accessA)).roomId, old.roomId);
  console.log('PASS group recovery in lobby/draft/running: both connections obtain one new room');

  const starting = await quick('Inicio atómico');
  const started = await raceUnderLock('rooms', starting.roomId, [() => rpc('start_draft', starting), () => join(starting, 'Llegada simultánea')]);
  assert.equal(started[0].ok, true); assert.ok(started[1].ok || started[1].code === 'STARTED');
  await fixture(`update public.players set ready=true,formacion='4-3-3',lineup='{"testFixture":true}' where room_code=${quote(starting.code)}`);
  assert.equal((await rpc('start_tournament', starting)).ok, true);
  const running = await rpc('state', starting); assert.equal(running.room.roster.length, started[1].ok ? 2 : 1);
  assert.deepEqual(running.room.roster.map(p => p.id).sort(), running.players.map(p => p.id).sort());
  console.log('PASS atomic draft start versus join: no omitted participant in frozen roster');

  const groupParticipantA = {...await rpc('group_access', accessA), token: groupRequest.token};
  const groupState = await rpc('state', groupParticipantA);
  // Either member can win the concurrent recovery; use the actual host, not
  // an assumed winner whose scheduling happens to be common on this machine.
  const gRoom = groupState.room.host_id === groupParticipantA.playerId ? groupParticipantA
    : {...await rpc('group_access', accessB), token: memberRequest.token};
  await prepareRunning(gRoom);
  const podium = [{place: 1, teamId: 'h-' + gRoom.playerId}, {place: 2, teamId: 'ai-1'}, {place: 3, teamId: 'ai-2'}];
  const finalized = await raceUnderLock('groups', group.group.id, [() => rpc('finalize', {...gRoom, podium}), () => rpc('finalize', {...gRoom, podium}), () => rpc('group_access', accessB)]);
  assert.ok(finalized.slice(0, 2).every(result => result.finalized)); assert.equal(finalized[2].ok, true);
  // Ranking awards belong only to humans; bots remain in the room podium.
  assert.equal(Number(await sql(`select count(*) from public.tournament_results where room_code=${quote(gRoom.code)};`)), 1);
  assert.equal(Number(await sql(`select jsonb_array_length(final_podium) from public.rooms where id=${quote(gRoom.roomId)};`)), 3);
  assert.equal(Number(await sql(`select count(*) from public.tournament_participants where room_code=${quote(gRoom.code)};`)), 2);
  console.log('PASS concurrent finalization and group access: one podium, no duplicated awards');

  const cancelled = await quick('Cancelación concurrente'); await prepareRunning(cancelled);
  const closed = await raceUnderLock('rooms', cancelled.roomId, [() => rpc('cancel', cancelled), () => rpc('heartbeat', {...cancelled, visible: true})]);
  assert.equal(closed[0].ok, true); assert.ok(closed[1].ok || closed[1].code === 'CANCELLED');
  assert.equal((await rpc('heartbeat', {...cancelled, visible: true})).code, 'CANCELLED');
  assert.equal((await rpc('update_player', {...cancelled, targetId: cancelled.playerId, changes: {resultados: {old: true}}})).code, 'CANCELLED');
  console.log('PASS cancellation versus heartbeat: terminal room cannot revive or accept old writes');

  const maintenanceRoom = await rpc('group_access', accessA);
  await fixture(`update public.rooms set last_activity_at=clock_timestamp()-interval '601 seconds' where id=${quote(maintenanceRoom.roomId)}; update public.players set last_seen=clock_timestamp()-interval '601 seconds' where room_code=${quote(maintenanceRoom.code)}`);
  const maintained = await raceUnderLock('groups', group.group.id, [() => sql('select public.mundialito_maintenance();'), () => rpc('group_access', accessA)]);
  assert.equal(maintained[1].ok, true); assert.notEqual(maintained[1].roomId, maintenanceRoom.roomId);
  console.log('PASS maintenance versus group recovery: consistent lock order, no deadlock in exercised race');

  await sql(await readFile(new URL('../supabase/quick_rooms_lifecycle.sql', import.meta.url), 'utf8'));
  await sql(await readFile(new URL('../supabase/verify_lifecycle.sql', import.meta.url), 'utf8'));
  console.log('PASS final migration reapplies to existing terminal rooms and verification queries execute');
} finally {
  if (created) {
    assert.match(dbName, /^mundialito_test_[a-f0-9]{32}$/);
    await sql(`drop database ${dbName};`, 'postgres');
    console.log('Removed disposable database created by this run; owner data was never accessed.');
  }
}
