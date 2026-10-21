import test from 'node:test';
import assert from 'node:assert/strict';
import {Meter} from '../src/meter.mjs';

function setup(options={}){
  const meter=new Meter(options),event=(type,data,at)=>meter.ingest({type,...data,at});
  event('player',{entity:1,self:true,id:'self-id',name:'Me',server:1001,class:'Ranger'},0);
  event('player',{entity:2,id:'enemy-id',name:'Enemy',server:1002,class:'Ranger'},0);
  return {meter,event};
}

test('PvP common clock keeps incoming damage before and after outgoing hits plus a later confirmed death',()=>{
  const archived=[],{meter,event}=setup({onEncounter:snapshot=>archived.push(snapshot)});
  event('damage',{actor:2,target:1,damage:100,skill:11010000},1000);
  event('damage',{actor:1,target:2,damage:200,skill:11010000},2000);
  event('damage',{actor:2,target:1,damage:300,skill:11010000},4000);
  event('death',{entity:1,killer:2},4500);
  meter.finish('manual',5000);
  assert.equal(archived.length,1);
  const snapshot=archived[0];
  assert.equal(snapshot.kind,'pvp');assert.equal(snapshot.startedAt,1000);assert.equal(snapshot.endedAt,4500);
  assert.equal(snapshot.details.pvp.taken,400);assert.equal(snapshot.details.pvp.deaths,1);
  assert.equal(snapshot.seconds,3.5);assert.equal(snapshot.dps,200/3.5);
  assert.equal(snapshot.players[0].dps,200/3.5);
  assert.equal(snapshot.details.players.find(p=>p.entity===1).damageTaken,400);
  assert.equal(snapshot.deaths[0].at,4500);
});

test('incoming-only PvP is an active encounter and emits a completed archive snapshot with no outgoing damage',()=>{
  const archived=[],{meter,event}=setup({onEncounter:snapshot=>archived.push(snapshot)});
  event('damage',{actor:2,target:1,damage:100,skill:11010000},1000);
  assert.equal(meter.hits.length,0);assert.equal(meter.combatState(1000).encounterActive,true);
  assert.equal(meter.combatState(1000).active,true);
  event('damage',{actor:2,target:1,damage:300,skill:11010000},4000);
  event('death',{entity:1,killer:2},4500);
  meter.tick(20001);
  assert.equal(archived.length,1);assert.equal(archived[0].damage,0);assert.equal(archived[0].kind,'pvp');
  assert.equal(archived[0].details.pvp.taken,400);assert.equal(archived[0].details.pvp.deaths,1);
  assert.equal(archived[0].seconds,3.5);assert.equal(meter.combatState(20001).encounterActive,false);
});
