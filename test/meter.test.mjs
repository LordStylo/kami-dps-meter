import test from 'node:test';
import assert from 'node:assert/strict';
import { Meter } from '../src/meter.mjs';
const ingest=(m,type,data,at=0)=>m.ingest({type,at,...data});
const hit=(m,actor,damage,at,rest={})=>ingest(m,'damage',{actor,target:99,damage,skill:11010130,hits:1,...rest},at);
function setup(){const m=new Meter();ingest(m,'player',{entity:1,name:'A',self:true});ingest(m,'player',{entity:2,name:'B'});ingest(m,'roster',{members:[{entity:1,name:'A'},{entity:2,name:'B'}]});return m;}
test('party uses one common combat duration and filters targets',()=>{
  const m=setup();hit(m,1,1000,1000);hit(m,2,3000,3000);hit(m,2,5000,4000,{target:98});
  const s=m.snapshot({scope:'party',target:99});assert.equal(s.damage,4000);assert.equal(s.seconds,2);assert.deepEqual(s.players.map(x=>x.dps),[1500,500]);
});
test('pet ownership is fixed at event time, including later reassignment',()=>{
  const m=setup();ingest(m,'spawn',{entity:20,owner:1});hit(m,20,500,1000);ingest(m,'spawn',{entity:20,owner:2});hit(m,20,700,2000);
  const s=m.snapshot();assert.equal(s.damage,1200);assert.equal(s.players.find(x=>x.entity===1).damage,500);
});
test('unidentified damage stays out of totals even if a pet appears later',()=>{
  const m=setup();hit(m,30,999,1000);ingest(m,'spawn',{entity:30,owner:1});hit(m,30,100,2000);
  assert.equal(m.snapshot().damage,100);assert.equal(m.snapshot().issues.unknownHits,1);
});
test('critical rate counts direct damage events, not extra-hit weights or DoT',()=>{
  const m=setup();hit(m,1,1000,1000,{critical:true,hits:5});hit(m,1,1000,2000);ingest(m,'damage-over-time',{actor:1,target:99,damage:1000,skill:11010240},3000);
  const p=m.snapshot().players[0];assert.equal(p.critRate,50);assert.equal(p.skills.length,1);assert.equal(p.dotDamage,1000);
});
test('idle encounter boundaries and map reset preserve completed history',()=>{
  const m=setup();hit(m,1,1000,1000);hit(m,1,1000,17000);assert.equal(m.history.length,1);assert.equal(m.snapshot().damage,1000);
  ingest(m,'map',{map:100},18000);assert.equal(m.entities.size,0);assert.equal(m.self,null);assert.equal(m.history.length,2);
});
test('enemy damage, healing and inactive wall time do not increase player DPS',()=>{
  const m=setup();ingest(m,'spawn',{entity:99});hit(m,99,9999,1000,{target:1});ingest(m,'heal',{actor:1,target:1,amount:9999},1000);hit(m,1,1000,2000);
  assert.equal(m.snapshot().damage,1000);assert.equal(m.snapshot().seconds,1);m.tick(30000);assert.equal(m.history[0].dps,1000);
});
test('completed fight supports independent player and target filters',()=>{
  const m=setup();hit(m,1,1000,1000);hit(m,2,3000,2000,{target:98});m.finish();
  ingest(m,'player',{entity:1,name:'Changed'});
  assert.equal(m.lastFight.snapshot({scope:'self'}).damage,1000);
  assert.equal(m.lastFight.snapshot({scope:'all',target:98}).damage,3000);
  assert.equal(m.lastFight.snapshot({scope:'self'}).players[0].name,'A');
});
test('skill DPS adds to player DPS; grouped critical rates exclude DoT and extra-hit weights',()=>{
  const m=setup();
  hit(m,1,1000,1000,{skill:18290130,critical:true,hits:5});
  hit(m,1,500,2000,{skill:18290240});
  ingest(m,'damage-over-time',{actor:1,target:99,damage:500,skill:18290130},3000);
  hit(m,1,2000,5000,{skill:18100130});
  const p=m.snapshot().players[0], spinning=p.skills.find(s=>s.id===18290000);
  assert.equal(p.skills.reduce((sum,s)=>sum+s.dps,0),p.dps);
  assert.equal(spinning.dps,500);assert.equal(spinning.share,50);
  assert.equal(spinning.critRate,50);assert.equal(spinning.directHits,2);assert.equal(spinning.criticalHits,1);
  assert.equal(spinning.name,'Spinning Strike');assert.match(spinning.icon,/ICON_CH_SKILL_029\.webp$/);
  m.finish();assert.equal(m.lastFight.snapshot().players[0].skills.find(s=>s.id===18290000).critRate,50);
  assert.equal(m.lastFight.snapshot({target:98}).players.length,0);
});
test('DoT-only skills have no critical percentage and unknown skills retain their identifier',()=>{
  const m=setup();ingest(m,'damage-over-time',{actor:1,target:99,damage:100,skill:99999999},1000);
  const s=m.snapshot().players[0].skills[0];
  assert.equal(s.critRate,null);assert.equal(s.name,'Yetenek 99999999');assert.equal(s.icon,null);assert.equal(s.dps,100);
});
