import test from 'node:test';
import assert from 'node:assert/strict';
import {Meter} from '../src/meter.mjs';
const event=(m,type,data={},at=0)=>m.ingest({type,at,...data});
const hit=(m,at,rest={})=>event(m,'damage',{actor:1,target:99,damage:100,skill:11010000,...rest},at);
function setup(){const m=new Meter();event(m,'player',{entity:1,self:true,name:'Me'});event(m,'spawn',{entity:99,npc:10001});event(m,'combat-state',{entity:1,inCombat:false},1000);return m;}
test('new own attacks recover visibility from a stale false flag for at most three seconds',()=>{
 const m=setup();hit(m,20000);assert.equal(m.combatState(20000).active,true);assert.equal(m.combatState(22999).active,true);
 assert.equal(m.combatState(23000).active,false);assert.equal(m.snapshot().damage,100);
 hit(m,24000);assert.equal(m.combatState(25000).active,true);
});
test('new combat exit cancels recovery immediately and equal timestamps respect event order',()=>{
 const m=setup();hit(m,2000);event(m,'combat-state',{entity:1,inCombat:false},2000);
 assert.equal(m.combatState(2000).active,false);
 hit(m,2000);assert.equal(m.combatState(2000).active,true);
 event(m,'combat-state',{entity:1,inCombat:false},2000);assert.equal(m.combatState(2000).active,false);
});
test('pets, periodic damage and nearby players cannot keep the panel visible; zone reset clears evidence',()=>{
 const m=setup();hit(m,2000);assert.equal(m.combatState(5000).active,false);
 event(m,'spawn',{entity:20,owner:1});hit(m,6000,{actor:20});
 event(m,'damage-over-time',{actor:1,target:99,damage:100,skill:11010000},6000);
 event(m,'player',{entity:2,name:'Other'});hit(m,6000,{actor:2});
 assert.equal(m.combatState(6000).active,false);
 event(m,'map',{map:123},6500);assert.equal(m.combatState(6500).active,false);
});
