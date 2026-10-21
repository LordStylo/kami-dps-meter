import test from 'node:test';
import assert from 'node:assert/strict';
import {Meter} from '../src/meter.mjs';
import {decodePacket} from '../src/protocol/packets.mjs';
import * as f from './wire-fixtures.mjs';
const event=(m,type,data={},at=0)=>m.ingest({type,at,...data});
const hit=(m,target=99,at=1000,actor=1,damage=100)=>event(m,'damage',{actor,target,damage,skill:11010000},at);
function setup(boss=true,options){
 const m=new Meter(options);
 event(m,'player',{entity:1,self:true,name:'Me'});event(m,'player',{entity:2,name:'Friend'});
 event(m,'roster',{members:[{entity:1},{entity:2}]});
 event(m,'spawn',{entity:99,npc:boss?2300471:10001,hp:10000,maxHp:10000});
 return m;
}
test('boss death separates consecutive bosses, ignores dead-target residual hits and retains exact DPS duration',()=>{
 const m=setup();hit(m);hit(m,99,3000,2,300);event(m,'death',{entity:99},3500);
 assert.equal(m.hits.length,0);assert.equal(m.lastFight.snapshot().damage,400);
 assert.equal(m.history[0].dps,200);assert.equal(m.history[0].seconds,2);assert.equal(m.history[0].reason,'kill');
 hit(m,99,3600);assert.equal(m.hits.length,0);
 event(m,'spawn',{entity:98,npc:2300471});hit(m,98,4000,1,75);
 assert.equal(m.snapshot().damage,75);assert.equal(m.history[0].damage,400);
});
test('add death and unrelated boss death cannot finish the party boss fight',()=>{
 const m=setup();hit(m);event(m,'spawn',{entity:98,npc:10001});hit(m,98,2000);
 event(m,'death',{entity:98},2100);event(m,'spawn',{entity:97,npc:2300471});event(m,'death',{entity:97},2200);
 assert.equal(m.hits.length,2);assert.equal(m.history.length,0);
});
test('normal kills wait for known party combat exit; unknown combat permits kill completion',()=>{
 const m=setup(false);event(m,'combat-state',{entity:1,inCombat:true});hit(m);event(m,'death',{entity:99},1500);
 assert.equal(m.history.length,0);
 event(m,'combat-state',{entity:1,inCombat:false},1800);
 assert.equal(m.history[0].reason,'kill');assert.equal(m.history[0].finishedAt,1800);
 const unknown=setup(false);hit(unknown);event(unknown,'death',{entity:99},1500);
 assert.equal(unknown.history[0].reason,'kill');
});
test('party out-of-combat ignores unknown members, but waits for any known member still fighting',()=>{
 for(const friendKnown of [false,true]){
  const m=setup(false);event(m,'combat-state',{entity:1,inCombat:true});
  if(friendKnown)event(m,'combat-state',{entity:2,inCombat:true});
  hit(m);hit(m,99,2000,2);event(m,'combat-state',{entity:1,inCombat:false},2500);
  assert.equal(m.history.length,friendKnown?0:1);
  if(friendKnown)event(m,'combat-state',{entity:2,inCombat:false},2600);
  assert.equal(m.history[0].reason,'idle');assert.equal(m.history[0].seconds,1);
 }
});
test('boss intermission hides the DPS panel without splitting the encounter on self combat exit',()=>{
 const m=setup();event(m,'combat-state',{entity:1,inCombat:true});hit(m);
 assert.equal(m.combatState().active,true);
 event(m,'combat-state',{entity:1,inCombat:false},2000);
 assert.deepEqual(m.combatState(),{active:false,known:true,encounterActive:true});
 assert.equal(m.history.length,0);
 event(m,'combat-state',{entity:99,inCombat:false},2200);
 assert.equal(m.history[0].reason,'wipe');
});
test('HP zero alone and dungeon reward notifications do not end encounters; boss HP reset is a wipe',()=>{
 const m=setup();hit(m);event(m,'hp',{entity:99,hp:0},1500);
 event(m,'dungeon-boss-killed',{npc:2300471},1600);assert.equal(m.history.length,0);
 event(m,'hp',{entity:99,hp:10000},1700);assert.equal(m.history[0].reason,'wipe');
});
test('removal uses boss membership and reason, keeping died distinct from scripted despawn',()=>{
 for(const [reason,expected] of [[3,null],['died',null],[7,'despawn'],['despawned','despawn'],[1,'wipe']]){
  const m=setup();hit(m);event(m,'removed',{entity:99,reason},2000);
  assert.equal(m.history[0]?.reason??null,expected);
  if(expected===null){event(m,'death',{entity:99},2100);assert.equal(m.history[0].reason,'kill');}
 }
 const m=setup(false);hit(m);event(m,'removed',{entity:99,reason:7},2000);assert.equal(m.history.length,0);
});
test('timer and returning hits both wait 90s for a boss with missing or stale combat state',()=>{
 const timer=setup();hit(timer);timer.tick(16001);assert.equal(timer.history.length,0);timer.tick(91001);assert.equal(timer.history[0].reason,'idle');
 for(const inCombat of [undefined,false,true]){
  const m=setup();if(inCombat!==undefined)event(m,'combat-state',{entity:99,inCombat});
  hit(m);hit(m,99,17000);assert.equal(m.history.length,0);
 }
});
test('nearby strangers cannot start encounters or extend the party idle timeout',()=>{
 const m=setup(false);event(m,'player',{entity:3,name:'Stranger'});hit(m,99,1000,3);
 assert.equal(m.hits.length,0);hit(m);hit(m,99,15000,3);m.tick(16001);
 assert.equal(m.history.length,1);assert.equal(m.history[0].finishedAt,1000);
 assert.equal(m.lastFight.snapshot().damage,100);
});
test('selected player/target DPS uses first and last eligible hits with a one-second floor',()=>{
 const m=setup();hit(m,99,1000,1,100);hit(m,99,2000,2,300);hit(m,98,5000,1,1000);
 assert.equal(m.snapshot({scope:'self',target:99}).dps,100);
 assert.equal(m.snapshot({scope:'party',target:99}).dps,400);
 assert.equal(m.snapshot().dps,350);m.tick(100000);assert.equal(m.lastFight.snapshot().dps,350);
});
test('replay mode suppresses encounter splitting even for deaths, combat exit, and boss resets',()=>{
 const m=setup(true,{splitIdle:false});hit(m);event(m,'death',{entity:99},2000);hit(m,99,3000);
 event(m,'combat-state',{entity:99,inCombat:false},4000);m.tick(200000);
 assert.equal(m.history.length,0);assert.equal(m.snapshot().damage,200);
});
test('groggy packets identify uncatalogued bosses and reject malformed payloads',()=>{
 const payload=f.cat(f.vu(99),f.u8(63),f.u8(1),f.i32(500),f.i32(400),f.i32(1),f.i64(10),f.i64(20),f.u8(3),f.i64(30));
 const decoded=decodePacket(0xe005,payload,1000);assert.equal(decoded.complete,true);
 assert.deepEqual(decoded.events,[{type:'stagger',entity:99,max:500,current:400,state:1,broken:false,at:1000}]);
 for(const bad of [payload.subarray(0,-1),f.cat(payload,f.u8(0))])assert.throws(()=>decodePacket(0xe005,bad,1000));
 const m=setup(false);m.ingest(decoded.events[0]);hit(m);event(m,'combat-state',{entity:1,inCombat:true});event(m,'death',{entity:99},2000);
 assert.equal(m.history[0].reason,'kill');
});
test('max HP only changes cannot manufacture an undefined HP event',()=>{
 assert.deepEqual(decodePacket(0x8d00,f.cat(f.vu(99),f.u8(1),f.vu(1),f.u8(7),f.i32(1000)),1000).events,[]);
});
test('despawned pet periodic damage still belongs to its owner until entity reuse',()=>{
 const m=setup();event(m,'spawn',{entity:20,owner:2});hit(m,99,1000,20,100);
 event(m,'removed',{entity:20,reason:7},1500);
 event(m,'damage-over-time',{actor:20,target:99,damage:50,skill:11010000},2000);
 assert.equal(m.snapshot().players[0].entity,2);assert.equal(m.snapshot().damage,150);
 event(m,'spawn',{entity:20,npc:10001});hit(m,99,3000,20,999);
 assert.equal(m.snapshot().damage,150);
});
