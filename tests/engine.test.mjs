import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {simularMundial,mejorXI} from '../js/engine/engine.js';import {SQUADS,squadsParaModo} from '../js/data/squads.js';
test('engine, RNG and squads match original files byte-for-byte',async()=>{
 for(const [path,hash] of [['engine/engine.js','ccc232dcdd5887e4e74e1195bd239b8db43d64773d947ea2c9b776ab06feaed5'],['engine/rng.js','c348b91d3bc7dbbc823fc01e688a46b6550d1007b1c61ea1e9c5c8b48a08cdef'],['data/squads.js','f5c5c45e9e8533657357f7986b62e98dc06b8d2c950d2575ba920eb387466a00']])assert.equal(createHash('sha256').update(await readFile(new URL('../js/'+path,import.meta.url))).digest('hex'),hash);
});
test('same seed/roster/decisions produces identical sports outcomes',()=>{
 const squad=SQUADS.find(s=>{try{return Boolean(mejorXI(s));}catch{return false;}});
 const humans=[{id:'h-fixed',nombre:'DT',esIA:false,squadKey:null,formacion:'4-3-3',lineup:mejorXI(squad)}];
 const first=simularMundial(81723,humans,{},32,false,squadsParaModo('almanaque'));
 const second=simularMundial(81723,structuredClone(humans),{},32,false,squadsParaModo('almanaque'));
 assert.deepEqual(second,first);
});
