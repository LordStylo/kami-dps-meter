import test from 'node:test';
import assert from 'node:assert/strict';
import {Meter} from '../src/meter.mjs';
import {decodePacket} from '../src/protocol/packets.mjs';
import {frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';

const ingest = (m,type,data,at=0) => m.ingest({type,at,...data});
const damage = (m,actor,amount,at,target=99) => ingest(m,'damage',{actor,target,damage:amount,skill:11010000},at);
const heal = (m,actor,amount,at,rest={}) => ingest(m,'heal',{actor,target:1,amount,skill:18290130,...rest},at);
function setup() {
  const m=new Meter();
  ingest(m,'player',{entity:1,name:'Me',self:true});
  ingest(m,'player',{entity:2,name:'Healer'});
  ingest(m,'player',{entity:3,name:'Stranger'});
  ingest(m,'roster',{members:[{entity:1,name:'Me'},{entity:2,name:'Healer'}]});
  ingest(m,'spawn',{entity:99,npc:123});
  return m;
}

test('healing totals and grouped skill HPS use the common damage window without changing DPS',()=>{
  const m=setup();damage(m,1,1000,1000);heal(m,2,300,1500);heal(m,2,500,2000,{skill:18290240});
  heal(m,2,200,2500,{skill:18100130});damage(m,1,1000,3000);
  const s=m.snapshot(),p=s.healers[0];
  assert.equal(s.damage,2000);assert.equal(s.dps,1000);assert.equal(s.seconds,2);
  assert.equal(s.healing,1000);assert.equal(s.hps,500);assert.equal(s.healingSeconds,2);
  assert.equal(p.name,'Healer');assert.equal(p.healing,1000);assert.equal(p.hps,500);assert.equal(p.events,3);
  assert.equal(p.skills.length,2);assert.equal(p.skills[0].id,18290000);assert.equal(p.skills[0].name,'Spinning Strike');
  assert.equal(p.skills[0].healing,800);assert.equal(p.skills[0].hps,400);assert.equal(p.skills[0].share,80);
  assert.equal(p.skills.reduce((sum,s)=>sum+s.hps,0),p.hps);
  assert.equal(s.players.length,1,'a healer with no damage does not alter DPS ranking');
});

test('healing alone, invalid amounts and enemy healing cannot start or extend a DPS encounter',()=>{
  const m=setup();heal(m,2,500,0);assert.equal(m.snapshot().healing,0);assert.equal(m.hits.length,0);
  damage(m,1,1000,1000);damage(m,1,1000,3000);
  for(const amount of [0,-1,NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1])heal(m,2,amount,3500);
  heal(m,99,999,3500);heal(m,2,999,3500,{target:99});
  heal(m,2,600,5000);
  const s=m.snapshot();assert.equal(s.healing,600);assert.equal(s.hps,300);assert.equal(s.endedAt,3000);assert.equal(s.seconds,2);
  m.tick(19000);assert.equal(m.history[0].healing,600);assert.equal(m.history[0].dps,1000);
});

test('individual healing works for a pure healer using the party encounter duration',()=>{
  const m=setup();m.self=2;damage(m,1,1000,1000);heal(m,2,600,1500);damage(m,1,1000,4000);
  const s=m.snapshot({scope:'self'});
  assert.equal(s.damage,0);assert.equal(s.seconds,0);assert.equal(s.players.length,0);
  assert.equal(s.healing,600);assert.equal(s.healingSeconds,3);assert.equal(s.hps,200);
  assert.equal(s.healers[0].self,true);
});

test('late party membership recovers healing and keeps its encounter attribution after departure',()=>{
  const m=setup();damage(m,1,1000,1000);heal(m,3,700,1500);heal(m,2,300,1600);damage(m,1,1000,2000);
  assert.equal(m.snapshot().healing,300);assert.equal(m.snapshot({scope:'all'}).healing,1000);
  ingest(m,'party-member',{entity:3,hp:100,maxHp:200},2200);
  assert.equal(m.snapshot().healing,1000);assert.equal(m.fightParty.has(3),true);
  ingest(m,'party-left',{},2300);assert.equal(m.snapshot().healing,1000);
  assert.deepEqual(m.snapshot().healers.map(p=>p.name),['Stranger','Healer']);
});

test('pet healing ownership is fixed at the event and accepts healing of friendly pets',()=>{
  const m=setup();ingest(m,'spawn',{entity:20,owner:1});ingest(m,'spawn',{entity:21,owner:2});
  damage(m,1,1000,1000);heal(m,20,400,1500,{target:21});
  ingest(m,'removed',{entity:20,reason:7},1700);heal(m,20,200,1800);
  ingest(m,'spawn',{entity:20,owner:2});heal(m,20,500,2000);damage(m,1,1000,3000);
  const s=m.snapshot(),me=s.healers.find(p=>p.entity===1),other=s.healers.find(p=>p.entity===2);
  assert.equal(s.healing,1100);assert.equal(me.healing,600);assert.equal(me.petHealing,600);
  assert.equal(other.healing,500);assert.equal(other.petHealing,500);
  assert.equal(s.players[0].healing,600);assert.equal(s.players[0].healingSkills[0].healing,600);
});

test('healing remains encounter-wide when enemy target filters change',()=>{
  const m=setup();damage(m,1,1000,1000);heal(m,2,1000,1500);damage(m,1,1000,3000,98);
  const s=m.snapshot({target:99});assert.equal(s.damage,1000);assert.equal(s.seconds,1);
  assert.equal(s.healing,1000);assert.equal(s.healingSeconds,2);assert.equal(s.hps,500);assert.equal(s.healingScope,'encounter');
});

test('completed fight healing and skill metadata stay immutable across the next encounter and zone',()=>{
  const m=setup();damage(m,1,1000,1000);heal(m,2,600,1500);damage(m,1,1000,3000);m.finish('kill',3500);
  ingest(m,'player',{entity:2,name:'Renamed'});ingest(m,'party-member',{entity:2,hp:100,maxHp:200});damage(m,1,1000,4000);heal(m,2,500,4500);
  assert.equal(m.snapshot().healing,500);assert.equal(m.lastFight.snapshot().healing,600);
  assert.equal(m.lastFight.snapshot().healers[0].name,'Healer');assert.equal(m.history[0].hps,300);
  ingest(m,'map',{map:101},5000);assert.equal(m.snapshot().healing,0);assert.equal(m.history[1].healing,600);
});

test('periodic heal skill metadata is recovered from the tracked buff',()=>{
  const m=setup();damage(m,1,1000,1000);ingest(m,'buff',{target:1,uid:7,buff:500,skill:18290130,caster:2},1100);
  heal(m,2,300,1500,{skill:undefined,uid:7});damage(m,1,1000,2000);
  assert.equal(m.snapshot().healers[0].skills[0].id,18290000);
  assert.equal(m.snapshot().healers[0].skills[0].name,'Spinning Strike');
});

test('decoded direct and periodic healing packets feed HPS without producing damage',()=>{
  const m=setup();ingest(m,'player',{entity:7,name:'Wire Healer'});ingest(m,'player',{entity:50,name:'Receiver'});
  ingest(m,'party-member',{entity:7,hp:100,maxHp:200});damage(m,1,1000,1000);
  for(const [frame,at] of [[f.direct({actor:7,target:50,damage:600,effect:41}),1500],[f.dot({damage:400,effect:2941}),2000]]) {
    const h=frameHeader(frame);for(const e of decodePacket(h.opcode,frame.subarray(h.payloadOffset),at).events)m.ingest(e);
  }
  damage(m,1,1000,3000);const s=m.snapshot();
  assert.equal(s.healing,1000);assert.equal(s.hps,500);assert.equal(s.damage,2000);assert.equal(s.healers[0].name,'Wire Healer');
});
