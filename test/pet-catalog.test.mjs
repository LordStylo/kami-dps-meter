import test from 'node:test';
import assert from 'node:assert/strict';
import {petCatalog,petForId,petSpawns,petIcon,petNpcIds} from '../src/pet-catalog.mjs';
import {petMapCatalog,petMapImage} from '../src/pet-map-catalog.mjs';
import {projectWorld} from '../public/cube-map.js';
test('public pet facts join monster template IDs to spawn data, not pet IDs',()=>{
 assert.ok(petCatalog.pets.length>=100);const krall=petForId(1002);assert.equal(krall.name,'Krall Laborer');assert.ok(krall.monsters.some(n=>n.id===2100075));assert.ok(petNpcIds.has(2100075));assert.equal(petNpcIds.has(1002),false);
 const spawns=petSpawns(1002);assert.ok(spawns.length>0);assert.ok(spawns.every(s=>krall.monsters.some(n=>n.id===s.npcId)));assert.equal(petSpawns(999999),null);
});
test('static marker Y is converted to raw world Y exactly once using an independent named coordinate oracle',()=>{
 const all=petCatalog.pets.flatMap(p=>petSpawns(p.id));
 const point=all.find(s=>s.id==='npc-2600011-20-32005.86328125--25838.654296875:0');assert.ok(point);assert.equal(point.x,32005.86328125);assert.equal(point.y,-25838.654296875);
 const map=petMapCatalog.maps.find(m=>m.id===20),pixel=projectWorld(map,point);assert.ok(pixel.y<2048); // The mirrored API Y would put this point below center.
});
test('Middle Reshanta uses the verified 2x2 tile row orientation and raw map bounds',()=>{
 const map=petMapCatalog.maps.find(m=>m.id===22);assert.equal(map.tiles.length,4);assert.deepEqual(projectWorld(map,{x:-102000,y:-102000}),{x:0,y:0});assert.deepEqual(projectWorld(map,{x:102000,y:102000}),{x:2048,y:2048});
 const corner=map.tiles.find(t=>t.image.endsWith('_01_00.webp'));assert.equal(corner.x,1024);assert.equal(corner.y,0);assert.ok(petMapImage(corner.image));assert.equal(petMapImage('/pet-maps/../../settings/private.webp'),null);
});
test('pet artwork is a strict local allowlist with source and hash metadata',()=>{
 const icon=petCatalog.pets.find(p=>p.icon)?.icon;assert.ok(petIcon(icon));assert.match(petIcon(icon).sha256,/^[a-f0-9]{64}$/);assert.equal(petIcon('/icons/pets/unknown.webp'),null);assert.equal(petIcon('/icons/pets/../skills/x.webp'),null);
});
