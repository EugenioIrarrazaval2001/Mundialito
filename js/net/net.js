// Capa de red: salas multijugador vía Supabase, o modo local si no hay config.
//
// Modelo de datos:
//   rooms:   code (pk), status: lobby|draft|running, seed, host_id, modo ('clasico'|'almanaque')
//   players: id (pk), room_code, name, squad_key, formacion, lineup (json), ready

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const MAX_JUGADORES = 32;

let supabase = null;
async function client() {
  if (!supabase) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

// Identidad local persistente (sin login: cada navegador tiene un id)
export function miId() {
  let id = localStorage.getItem('mundialito-id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('mundialito-id', id);
  }
  return id;
}

function codigoSala() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += letras[Math.floor(Math.random() * letras.length)];
  return c;
}

// ---------- MODO ONLINE ----------

async function onlineCrearSala(nombre, modo) {
  const sb = await client();
  const code = codigoSala();
  const seed = Math.floor(Math.random() * 2 ** 31);
  const { error: e1 } = await sb.from('rooms')
    .insert({ code, status: 'lobby', seed, host_id: miId(), modo });
  if (e1) throw e1;
  const { error: e2 } = await sb.from('players')
    .insert({ id: miId(), room_code: code, name: nombre, ready: false });
  if (e2) throw e2;
  return code;
}

async function onlineUnirse(code, nombre) {
  const sb = await client();
  code = code.toUpperCase().trim();
  const { data: room, error } = await sb.from('rooms').select().eq('code', code).maybeSingle();
  if (error) throw error;
  if (!room) throw new Error('No existe una sala con ese código.');
  if (room.status !== 'lobby') throw new Error('Esa sala ya empezó a jugar.');
  const { data: players, error: ePlayers } = await sb.from('players').select('id').eq('room_code', code);
  if (ePlayers) throw ePlayers;
  const yaEstoy = (players ?? []).some(p => p.id === miId());
  if (!yaEstoy && (players ?? []).length >= MAX_JUGADORES) {
    throw new Error(`La sala ya tiene ${MAX_JUGADORES} jugadores, el máximo para un mundial.`);
  }
  const { error: e2 } = await sb.from('players')
    .upsert({ id: miId(), room_code: code, name: nombre, ready: false });
  if (e2) throw e2;
  return code;
}

async function onlineEstado(code) {
  const sb = await client();
  const [{ data: room }, { data: players }] = await Promise.all([
    sb.from('rooms').select().eq('code', code).maybeSingle(),
    sb.from('players').select().eq('room_code', code).order('joined_at'),
  ]);
  return { room, players: players ?? [] };
}

async function onlineActualizarSala(code, cambios) {
  const sb = await client();
  const { error } = await sb.from('rooms').update(cambios).eq('code', code);
  if (error) throw error;
}

async function onlineActualizarJugador(code, playerId, cambios) {
  const sb = await client();
  const { error } = await sb.from('players')
    .update(cambios).eq('id', playerId).eq('room_code', code);
  if (error) throw error;
}

async function onlineEliminarJugador(code, playerId) {
  const sb = await client();
  const { error } = await sb.from('players')
    .delete().eq('id', playerId).eq('room_code', code);
  if (error) throw error;
}

// Suscripción: callback con el estado completo ante cualquier cambio.
// Usa realtime si está disponible y además sondea cada 3 s como respaldo.
function onlineSuscribir(code, callback) {
  let activo = true;
  const refrescar = async () => {
    if (!activo) return;
    try { callback(await onlineEstado(code)); } catch { /* reintenta en el próximo tick */ }
  };
  let canal = null;
  client().then(sb => {
    canal = sb.channel('sala-' + code)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_code=eq.${code}` }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, refrescar)
      .subscribe();
  });
  const timer = setInterval(refrescar, 3000);
  refrescar();
  return () => {
    activo = false;
    clearInterval(timer);
    if (canal) client().then(sb => sb.removeChannel(canal));
  };
}

// ---------- MODO LOCAL (sin Supabase: 1 jugador vs la máquina) ----------

const local = { room: null, players: [], listeners: new Set() };

function localEmitir() {
  const estado = { room: { ...local.room }, players: local.players.map(p => ({ ...p })) };
  for (const cb of local.listeners) cb(estado);
}

async function localCrearSala(nombre, modo) {
  local.room = {
    code: 'LOCAL', status: 'lobby',
    seed: Math.floor(Math.random() * 2 ** 31), host_id: miId(), modo,
  };
  local.players = [{ id: miId(), room_code: 'LOCAL', name: nombre, ready: false, squad_key: null, formacion: null, lineup: null, resultados: {} }];
  return 'LOCAL';
}

async function localEstado() {
  return { room: local.room, players: local.players };
}

async function localActualizarSala(_code, cambios) {
  Object.assign(local.room, cambios);
  localEmitir();
}

async function localActualizarJugador(_code, playerId, cambios) {
  const p = local.players.find(p => p.id === playerId);
  if (p) Object.assign(p, cambios);
  localEmitir();
}

async function localEliminarJugador(_code, playerId) {
  local.players = local.players.filter(p => p.id !== playerId);
  localEmitir();
}

function localSuscribir(_code, callback) {
  local.listeners.add(callback);
  localEstado().then(callback);
  return () => local.listeners.delete(callback);
}

// ---------- API unificada ----------

export const net = ONLINE
  ? {
      crearSala: onlineCrearSala, unirse: onlineUnirse, estado: onlineEstado,
      actualizarSala: onlineActualizarSala, actualizarJugador: onlineActualizarJugador,
      eliminarJugador: onlineEliminarJugador,
      suscribir: onlineSuscribir,
    }
  : {
      crearSala: localCrearSala,
      unirse: async () => { throw new Error('Modo local: solo se puede crear sala (configura Supabase para jugar online).'); },
      estado: localEstado,
      actualizarSala: localActualizarSala, actualizarJugador: localActualizarJugador,
      eliminarJugador: localEliminarJugador,
      suscribir: localSuscribir,
    };
