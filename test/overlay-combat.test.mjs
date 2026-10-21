import test from 'node:test';
import assert from 'node:assert/strict';
import {combatView} from '../overlay/combat-view.mjs';
const self={entity:7,self:true,name:'Self',damage:200,dps:20,skills:[{id:1,damage:200,dps:20}]};
const other={entity:9,self:false,name:'Other',damage:800,dps:80,skills:[{id:2,damage:800,dps:80}]};
const fight={damage:1000,dps:100,seconds:10,players:[other,self]};
test('individual mode uses self identity and the party duration, regardless of ranking or selected player',()=>{
 const view=combatView({current:fight},'individual',9);
 assert.equal(view.player,self);assert.equal(view.damage,200);assert.equal(view.dps,20);assert.equal(view.seconds,10);
 assert.equal(view.player.skills[0].id,1);assert.equal(view.previous,false);
 const party=combatView({current:fight},'party',9);
 assert.equal(party.player,other);assert.equal(party.damage,1000);assert.equal(party.dps,100);
});
test('individual mode never substitutes another player or an old fight when self has no current damage',()=>{
 const state={current:{...fight,players:[other]},last:fight};
 const view=combatView(state,'individual',9);
 assert.equal(view.player,undefined);assert.equal(view.damage,0);assert.equal(view.dps,0);assert.equal(view.previous,false);
 assert.equal(combatView({},'individual',null).damage,0);
});
test('completed individual encounters retain self skill detail, and the next fight replaces it',()=>{
 const state={current:{damage:0,players:[],seconds:0},last:fight};
 const previous=combatView(state,'individual',null);
 assert.equal(previous.previous,true);assert.equal(previous.player,self);assert.equal(previous.damage,200);
 state.current={damage:15,dps:15,seconds:1,players:[{...self,damage:15,dps:15,skills:[]}]};
 assert.equal(combatView(state,'individual',null).damage,15);
 assert.equal(combatView(state,'individual',null).previous,false);
});
test('healing view selects healers and their skill totals using encounter duration in both modes',()=>{
 const healer={entity:7,self:true,name:'Healer',healing:500,hps:50,skills:[{healing:500,hps:50}]};
 const current={...fight,healing:1000,hps:100,healingSeconds:10,healers:[healer,{entity:10,healing:500,hps:50,skills:[]}]};
 const solo=combatView({current},'individual',10,'healing');
 assert.equal(solo.player,healer);assert.equal(solo.amount,500);assert.equal(solo.rate,50);assert.equal(solo.seconds,10);
 const party=combatView({current},'party',10,'healing');
 assert.equal(party.player.entity,10);assert.equal(party.amount,1000);assert.equal(party.rate,100);
 assert.equal(combatView({current},'party',null,'damage').rate,100);
 const pure={current:{...current,damage:0,players:[],seconds:0},last:fight};
 assert.equal(combatView(pure,'individual',null,'healing').player,healer);
 assert.equal(combatView(pure,'individual',null,'healing').previous,false);
});

test('incoming-only current PvP replaces the previous fight even when outgoing damage and healing are zero',()=>{
 const current={kind:'pvp',damage:0,dps:0,healing:0,seconds:3.5,players:[],details:{pvp:{taken:400,dealt:0,kills:0,deaths:1}}};
 for(const mode of ['party','individual']){
  const view=combatView({current,last:fight},mode,null);
  assert.equal(view.fight,current);assert.equal(view.previous,false);assert.equal(view.damage,0);assert.equal(view.seconds,3.5);
 }
});
