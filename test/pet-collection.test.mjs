import test from 'node:test';
import assert from 'node:assert/strict';
import {PET_OPCODES,readPetObservation} from '../src/protocol/pets.mjs';
import {PetCollectionTracker,PET_LEVEL_COSTS,effectivePetProgress,petSoulsToTarget,parseQuestPetSnapshot} from '../src/pet-collection.mjs';
import * as f from './wire-fixtures.mjs';

// Wire facts encoded independently; boolean bits span ordinary fields and
// nested list boundaries, rather than restarting for every slot.
class Writer {
  constructor(){this.parts=[];this.bit=8;this.byte=null;}
  add(bytes){this.parts.push(bytes);return this;}
  u8(n){return this.add(f.u8(n));}u16(n){return this.add(f.u16(n));}
  i32(n){return this.add(f.i32(n));}i64(n){return this.add(f.i64(n));}vu(n){return this.add(f.vu(n));}
  bool(value){if(this.bit===8){this.byte=Buffer.alloc(1);this.add(this.byte);this.bit=0;}if(value)this.byte[0]|=1<<this.bit;this.bit++;return this;}
  finish(){return f.cat(...this.parts);}
}
function initial({levels=[[101,1],[102,2]],souls=[[101,35],[102,80]],mapKeys=levels.map(([id])=>id),slots=10,genera=[[2,9]],boardTypes=genera.map(([type])=>type)}={}){
  const w=new Writer();w.i32(101).vu(levels.length);
  levels.forEach(([id,level],i)=>w.i32(mapKeys[i]).i32(id).i32(level));
  w.vu(souls.length);souls.forEach(([id,points])=>w.i32(id).i32(points));
  w.vu(1).u8(2).i32(17).vu(2).i32(1).i32(2);
  w.vu(genera.length);
  for(let genus=0;genus<genera.length;genus++){
    const [type,level]=genera[genus];w.u8(type).u8(boardTypes[genus]).i32(level).i64(12345).vu(2);
    for(let panel=0;panel<2;panel++){
      w.u8(panel).vu(slots);
      for(let slot=0;slot<slots;slot++)w.u8(slot).u8(1).u16(11).i64(-12).bool(slot%2===0).bool(slot%3===0);
    }
  }
  return w.u8(1).finish();
}
const acquired=(entity=7,id=101,level=1,type=2,genusLevel=9)=>f.cat(f.vu(entity),f.i32(id),f.i32(level),f.u8(type),f.i32(genusLevel),f.i64(12345));
const delta=(items=[[101,1]])=>f.cat(f.vu(items.length),...items.flatMap(([id,points])=>[f.i32(id),f.i32(points)]));
const alice={entity:7,name:'Alice',server:1},bob={entity:8,name:'Bob',server:2};
const send=(tracker,opcode,payload,at=1000,stream='a')=>tracker.message({opcode,payload,at},stream);
function seeded(options){const tracker=new PetCollectionTracker();tracker.identify('a',alice,900);send(tracker,0x9000,initial(options));return tracker;}

test('full pet initialization consumes nested panels and shared boolean bytes without exposing unused data',()=>{
  assert.deepEqual([...PET_OPCODES],[0x9000,0x9009,0x900d,0x900e]);
  assert.deepEqual(readPetObservation(0x9000,initial()),{kind:'init',levels:{101:1,102:2},souls:{101:35,102:80},genera:{intellect:{level:9}}});
  assert.deepEqual(readPetObservation(0x9009,acquired()),{kind:'acquired',entity:7,petId:101,level:1,genus:{key:'intellect',level:9}});
  assert.deepEqual(readPetObservation(0x900d,delta()),{kind:'souls-increase',items:[{petId:101,points:1}]});
  assert.deepEqual(readPetObservation(0x900e,delta()),{kind:'souls-decrease',items:[{petId:101,points:1}]});
  assert.equal(readPetObservation(0x9001,Buffer.alloc(0)),null);
});

test('pet wire readers reject duplicate IDs, excessive counts, invalid values and unknown trailers atomically',()=>{
  for(const [opcode,bytes]of[[0x9000,initial()],[0x9009,acquired()],[0x900d,delta()],[0x900e,delta()]]){
    assert.throws(()=>readPetObservation(opcode,bytes.subarray(0,-1)));
    assert.throws(()=>readPetObservation(opcode,f.cat(bytes,f.u8(0))));
  }
  assert.throws(()=>readPetObservation(0x9000,initial({levels:[[101,1],[102,2]],mapKeys:[1,1]})));
  assert.throws(()=>readPetObservation(0x9000,initial({levels:[[101,1],[101,2]],mapKeys:[1,2]})));
  assert.throws(()=>readPetObservation(0x9000,initial({souls:[[101,1],[101,2]]})));
  assert.throws(()=>readPetObservation(0x9000,initial({levels:[[101,4]]})));
  assert.throws(()=>readPetObservation(0x9000,initial({souls:[[101,-1]]})));
  for(const opcode of[0x900d,0x900e]){
    assert.throws(()=>readPetObservation(opcode,delta([[101,1],[101,2]])));
    assert.throws(()=>readPetObservation(opcode,delta([[0,1]])));
    assert.throws(()=>readPetObservation(opcode,f.vu(0xffffffff)));
  }
  assert.throws(()=>readPetObservation(0x9009,acquired(0)));
  assert.throws(()=>readPetObservation(0x9009,acquired(7,101,-1)));
  assert.throws(()=>readPetObservation(0x9000,Buffer.alloc(65537)));
});

test('pet progress preserves unknown values and applies only the verified 5/25/75 costs',()=>{
  assert.deepEqual(PET_LEVEL_COSTS,[5,25,75]);
  assert.equal(effectivePetProgress(undefined,0),null);assert.equal(petSoulsToTarget(0,undefined),null);
  assert.deepEqual(effectivePetProgress(0,30),{level:2,souls:0,need:75,estimated:true});
  assert.deepEqual(effectivePetProgress(1,24),{level:1,souls:24,need:25,estimated:false});
  assert.deepEqual(effectivePetProgress(3,10),{level:3,souls:10,need:0,estimated:false});
  assert.equal(petSoulsToTarget(0,4,3),101);assert.equal(petSoulsToTarget(2,80,3),0);
  assert.deepEqual(effectivePetProgress(1,-3),{level:1,souls:0,need:25,estimated:false});assert.equal(petSoulsToTarget(1,-3,2),25);
  assert.throws(()=>effectivePetProgress(4,1));assert.throws(()=>petSoulsToTarget(1,-2147483649));
});

test('unknown identity and partial observations never invent a complete zero-based collection',()=>{
  const tracker=new PetCollectionTracker();send(tracker,0x900d,delta([[101,5]]));
  assert.deepEqual(tracker.snapshot(),{character:null,status:'unknown',complete:false,at:null,levels:{},souls:{},genera:{},revision:0,errors:0});
  tracker.identify('a',alice,1100);send(tracker,0x900d,delta([[101,5]]),1200);
  assert.deepEqual(tracker.snapshot().souls,{});assert.equal(tracker.snapshot().complete,false);
  send(tracker,0x9009,acquired(),1300);assert.equal(tracker.snapshot().levels[101],1);assert.equal(tracker.snapshot().complete,false);
  assert.equal(tracker.snapshot().status,'unknown');
});

test('pre-identity init and its bounded subsequent events bind only to the next self on that same stream',()=>{
  const tracker=new PetCollectionTracker();send(tracker,0x9000,initial(),1000);send(tracker,0x900d,delta([[101,4]]),1100);
  tracker.identify('b',bob,1150);assert.equal(tracker.snapshot().complete,false);
  tracker.invalidate('a','self-appearance');tracker.identify('a',alice,1200);
  assert.equal(tracker.snapshot().status,'live');assert.equal(tracker.snapshot().souls[101],39);
  assert.deepEqual(tracker.snapshot().character,{name:'Alice',server:1});
  tracker.identify('b',bob,1300);assert.deepEqual(tracker.snapshot().souls,{});
  assert.equal(tracker.snapshot().complete,false);
});

test('acquisition is restricted to the identified own entity and cannot double-count the first five-soul cost',()=>{
  const tracker=seeded({levels:[],souls:[[101,105]]});
  send(tracker,0x9009,acquired(8),1100);assert.equal(tracker.snapshot().levels[101],undefined);
  send(tracker,0x9009,acquired(),1200);send(tracker,0x900e,delta([[101,5]]),1300);
  assert.equal(tracker.snapshot().levels[101],1);assert.equal(tracker.snapshot().souls[101],100);
  send(tracker,0x900e,delta([[101,25]]),1400);assert.equal(tracker.snapshot().levels[101],2);
  send(tracker,0x900e,delta([[101,75]]),1500);assert.equal(tracker.snapshot().levels[101],3);assert.equal(tracker.snapshot().souls[101],0);
  send(tracker,0x9009,acquired(7,101,2),1600);assert.equal(tracker.snapshot().levels[101],3,'Older/lower acquisition levels cannot regress the known collection');
});

test('fragmented decrease costs reconcile and a full snapshot resets spending/acquisition evidence',()=>{
  const tracker=seeded({levels:[[101,1]],souls:[[101,25]]});
  send(tracker,0x900e,delta([[101,10]]),1100);assert.equal(tracker.snapshot().levels[101],1);
  send(tracker,0x900e,delta([[101,15]]),1200);assert.equal(tracker.snapshot().levels[101],2);
  send(tracker,0x9000,initial({levels:[[101,1]],souls:[[101,25]]}),1300);
  send(tracker,0x900e,delta([[101,25]]),1400);assert.equal(tracker.snapshot().levels[101],2);assert.equal(tracker.snapshot().souls[101],0);
  const early=seeded({levels:[],souls:[[101,5]]});send(early,0x900e,delta([[101,5]]),1100);send(early,0x9009,acquired(),1200);
  assert.equal(early.snapshot().levels[101],1);assert.equal(early.snapshot().souls[101],0);
});

test('map transitions preserve scoped collections but cannot attach a new character to old data',()=>{
  const tracker=seeded();tracker.invalidate('a','map-change');assert.equal(tracker.snapshot().status,'unknown');
  assert.equal(tracker.snapshot().levels[101],1);
  send(tracker,0x9000,initial({levels:[[999,3]],souls:[]}),2000);tracker.identify('a',bob,2100);
  assert.deepEqual(tracker.snapshot().levels,{999:3});assert.deepEqual(tracker.snapshot().character,{name:'Bob',server:2});
  tracker.invalidate('a','map-change');tracker.identify('a',alice,2200);assert.equal(tracker.snapshot().levels[101],1);
  tracker.invalidate('a','connection-closed');send(tracker,0x900d,delta([[101,10]]),2300);assert.equal(tracker.snapshot().souls[101],35);
  tracker.identify('new-flow',{...alice,server:2},2400);assert.deepEqual(tracker.snapshot().levels,{},'Same names on different servers do not share a collection');
});

test('same-stream framing gaps keep ownership and old data stale until new identity or a full initialization',()=>{
  const tracker=seeded();tracker.invalidate('a','stream-gap');assert.equal(tracker.snapshot().status,'unknown');
  send(tracker,0x900d,delta([[101,1]]),1100);assert.equal(tracker.snapshot().souls[101],36);assert.equal(tracker.snapshot().status,'unknown');
  tracker.identify('a',alice,1200);assert.equal(tracker.snapshot().status,'live');
  tracker.invalidate('a','bad-frame');send(tracker,0x9000,initial(),1300);assert.equal(tracker.snapshot().status,'live');
});

test('malformed/out-of-order/overflow updates cannot partly overwrite confirmed data and snapshots are copies',()=>{
  const tracker=seeded({souls:[[101,35],[102,2147483640]]});const before=tracker.snapshot();
  send(tracker,0x900d,delta([[101,1],[102,20]]),1100);
  assert.deepEqual(tracker.snapshot().souls,before.souls);assert.deepEqual(tracker.snapshot().levels,before.levels);
  assert.equal(tracker.snapshot().at,before.at);assert.equal(tracker.snapshot().errors,1);assert.equal(tracker.snapshot().status,'unknown');
  send(tracker,0x9000,initial(),1200);send(tracker,0x900d,delta([[101,100]]),1100);
  assert.equal(tracker.snapshot().souls[101],35);
  const copy=tracker.snapshot();copy.levels[101]=3;copy.souls[101]=0;copy.character.name='Changed';assert.equal(tracker.snapshot().levels[101],1);assert.equal(tracker.snapshot().character.name,'Alice');
  send(tracker,0x9000,initial().subarray(0,-1),1400);assert.equal(tracker.snapshot().errors,2);assert.equal(tracker.snapshot().at,1200);
});

test('unbound buffering is bounded and invalid owner metadata cannot reuse a previous binding',()=>{
  const tracker=new PetCollectionTracker();send(tracker,0x9000,initial());
  for(let i=0;i<257;i++)send(tracker,0x900d,delta([[101,0]]),1100+i);
  assert.equal(tracker.errors,1);tracker.identify('a',alice,2000);assert.equal(tracker.snapshot().complete,false);
  const known=seeded();assert.equal(known.identify('a',{...bob,server:0},2000),false);
  send(known,0x900d,delta([[101,10]]),2100);assert.equal(known.snapshot().souls[101],35);assert.equal(known.snapshot().status,'unknown');
});

test('Questlog snapshot parsing is pure, strict and never imports a saved snapshot as live',()=>{
  const value={character:{name:'Alice',server:1,confirmedAt:1000,levels:{101:1},souls:{101:4},achievements:[123]},kills:{9:1}};
  const snapshot=parseQuestPetSnapshot({value});assert.deepEqual(snapshot,{character:{name:'Alice',server:1},status:'unknown',complete:true,at:1000,levels:{101:1},souls:{101:4},genera:{}});
  snapshot.levels[101]=3;assert.equal(value.character.levels[101],1);assert.equal('kills' in snapshot,false);
  for(const change of[{levels:undefined},{souls:[]},{name:''},{server:0},{confirmedAt:NaN},{levels:{101:4}},{souls:{101:-2147483649}},{levels:{'01':1}}])assert.throws(()=>parseQuestPetSnapshot({value:{character:{...value.character,...change}}}));
  const signed=parseQuestPetSnapshot({value:{character:{...value.character,souls:{101:-3}}}});assert.equal(signed.souls[101],-3);
});

test('matching saved seeds accept live deltas and acquisitions without claiming a live full initialization',()=>{
  const seed={character:{name:'Alice',server:1},complete:true,at:500,levels:{101:1},souls:{101:25}};
  const tracker=new PetCollectionTracker({seeds:[seed]});assert.equal(tracker.snapshot().character,null);
  tracker.identify('a',alice,900);assert.equal(tracker.snapshot().status,'saved');assert.equal(tracker.snapshot().complete,true);
  seed.levels[101]=3;assert.equal(tracker.snapshot().levels[101],1,'Seed objects are copied');
  send(tracker,0x900d,delta([[101,5]]),1000);assert.equal(tracker.snapshot().souls[101],30);
  send(tracker,0x900e,delta([[101,25]]),1100);assert.equal(tracker.snapshot().levels[101],2);assert.equal(tracker.snapshot().souls[101],5);
  send(tracker,0x9009,acquired(7,999,1),1200);assert.equal(tracker.snapshot().levels[999],1);assert.equal(tracker.snapshot().status,'saved');
  tracker.invalidate('a','stream-gap');tracker.identify('a',alice,1300);assert.equal(tracker.snapshot().status,'saved');
  send(tracker,0x9000,initial({levels:[[101,2],[999,1]],souls:[[101,5]]}),1400);
  assert.equal(tracker.snapshot().status,'live');assert.equal(tracker.snapshot().at,1400);
});

test('saved seeds never leak to another name/server or fabricate a baseline from invalid seed data',()=>{
  const seed={character:{name:'Alice',server:1},complete:true,at:500,levels:{101:1},souls:{101:25}};
  const tracker=new PetCollectionTracker({seeds:[seed,{...seed,character:{name:'Bad',server:3},levels:{101:4}}]});
  assert.equal(tracker.errors,1);tracker.identify('a',{...alice,server:2},900);
  assert.equal(tracker.snapshot().status,'unknown');assert.equal(tracker.snapshot().complete,false);assert.deepEqual(tracker.snapshot().levels,{});
  send(tracker,0x900d,delta([[101,10]]));assert.deepEqual(tracker.snapshot().souls,{});
  tracker.identify('a',bob,1100);assert.deepEqual(tracker.snapshot().levels,{});
  tracker.identify('a',alice,1200);assert.equal(tracker.snapshot().status,'saved');assert.equal(tracker.snapshot().souls[101],25);
  assert.throws(()=>new PetCollectionTracker({seeds:Array(129).fill(seed)}));
});

test('signed saved balances remain factual while display clamps and positive wire increases repair them',()=>{
  const seed={character:{name:'Alice',server:1},complete:true,at:500,levels:{101:1},souls:{101:-3}};
  const tracker=new PetCollectionTracker({seeds:[seed]});tracker.identify('a',alice,900);
  assert.equal(tracker.snapshot().souls[101],-3);assert.equal(tracker.snapshot().status,'saved');
  assert.deepEqual(effectivePetProgress(1,tracker.snapshot().souls[101]),{level:1,souls:0,need:25,estimated:false});
  send(tracker,0x900d,delta([[101,2]]),1000);assert.equal(tracker.snapshot().souls[101],-1);
  send(tracker,0x900d,delta([[101,1]]),1100);assert.equal(tracker.snapshot().souls[101],0);
  send(tracker,0x900e,delta([[101,1]]),1200);assert.equal(tracker.snapshot().souls[101],-1);
  assert.equal(tracker.errors,0);assert.throws(()=>readPetObservation(0x900d,delta([[101,-1]])));
});

test('genus initialization uses the five known map keys and preserves observed zero without inventing missing genera',()=>{
  const genera=[[2,0],[3,12],[4,34],[5,56],[6,2147483647],[1,99]];
  const event=readPetObservation(0x9000,initial({genera,boardTypes:[3,4,5,6,2,1]}));
  assert.deepEqual(event.genera,{intellect:{level:0},feral:{level:12},nature:{level:34},trans:{level:56},special:{level:2147483647}});
  assert.equal('exp' in event.genera.intellect,false);
  assert.throws(()=>readPetObservation(0x9000,initial({genera:[[2,-1]]})));
  assert.throws(()=>readPetObservation(0x9000,initial({genera:[[2,1],[2,2]]})));
  assert.throws(()=>readPetObservation(0x9009,acquired(7,101,1,2,-1)));
  const tracker=seeded({genera:[[2,9],[3,8]]});
  send(tracker,0x9000,initial({genera:[[4,0]]}),1100);
  assert.deepEqual(tracker.snapshot().genera,{nature:{level:0}},'A complete initialization replaces stale genera');
  const copy=tracker.snapshot();copy.genera.nature.level=999;
  assert.equal(tracker.snapshot().genera.nature.level,0,'Nested genus records cannot mutate tracker state');
});

test('only an identified own acquisition can update actual genus levels, including a previously unknown genus',()=>{
  const tracker=seeded({genera:[]});
  send(tracker,0x9009,acquired(8,101,1,3,17),1100);
  assert.deepEqual(tracker.snapshot().genera,{},'Another entity cannot change the selected character');
  send(tracker,0x9009,acquired(7,101,1,3,17),1200);
  assert.deepEqual(tracker.snapshot().genera,{feral:{level:17}});
  send(tracker,0x9009,acquired(7,102,2,3,18),1300);
  assert.equal(tracker.snapshot().genera.feral.level,18);
  send(tracker,0x9009,acquired(7,103,1,1,99),1400);
  assert.deepEqual(tracker.snapshot().genera,{feral:{level:18}},'Unknown creature types are consumed without misattribution');
  tracker.identify('b',bob,1500);assert.deepEqual(tracker.snapshot().genera,{});
  tracker.identify('a',alice,1600);assert.equal(tracker.snapshot().genera.feral.level,18);
});

test('saved genus records remain optional, validated, scoped and distinct from a live observation',()=>{
  const base={character:{name:'Alice',server:1},complete:true,at:500,levels:{101:1},souls:{101:25}};
  const legacy=new PetCollectionTracker({seeds:[base]});legacy.identify('a',alice,900);
  assert.deepEqual(legacy.snapshot().genera,{});
  const seed={...base,genera:{intellect:{level:0},nature:{level:12}}};
  const tracker=new PetCollectionTracker({seeds:[seed]});tracker.identify('a',alice,900);
  assert.equal(tracker.snapshot().status,'saved');assert.deepEqual(tracker.snapshot().genera,seed.genera);
  seed.genera.nature.level=999;assert.equal(tracker.snapshot().genera.nature.level,12);
  send(tracker,0x9009,acquired(7,101,1,4,13),1000);
  assert.equal(tracker.snapshot().genera.nature.level,13);assert.equal(tracker.snapshot().status,'saved');
  tracker.identify('b',bob,1100);assert.deepEqual(tracker.snapshot().genera,{});
  for(const genera of[{unknown:{level:1}},{nature:{level:-1}},{nature:{level:2147483648}},{nature:{level:1.5}},{nature:3},null]){
    const invalid=new PetCollectionTracker({seeds:[{...base,genera}]});
    assert.equal(invalid.errors,1);invalid.identify('a',alice,900);assert.deepEqual(invalid.snapshot().genera,{});
  }
  const imported=parseQuestPetSnapshot({value:{character:{...base.character,confirmedAt:500,levels:base.levels,souls:base.souls,genera:{nature:{level:99}}}}});
  assert.deepEqual(imported.genera,{},'Questlog map-tracker does not establish actual genus levels');
});
