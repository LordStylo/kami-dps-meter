import test from 'node:test';
import assert from 'node:assert/strict';
import {readPositionObservation} from '../src/protocol/position.mjs';
import {decodePacket} from '../src/protocol/packets.mjs';
import {PlayerPositionTracker} from '../src/player-position.mjs';
import * as f from './wire-fixtures.mjs';

const point = {x:12345.5,y:-67890.25,z:1500};
const localPoint = {x:8,y:-9,z:10};
const xyz = value => {
  const bytes=Buffer.alloc(12);
  ['x','y','z'].forEach((name,index)=>bytes.writeFloatLE(value[name],index*4));
  return bytes;
};

// Independent synthetic fixtures for the complete server layouts. Bit-bools
// share their first allocated byte even when ordinary fields lie between them.
function moving(flags,{entity=7,position=point,local=localPoint}={}) {
  return f.cat(f.vu(entity),f.u8(flags),
    ...(flags&1?[f.u8(flags&4?3:1)]:[]),xyz(position),f.u16(123),f.u16(456),
    ...(flags&2?[f.i32(9001),xyz(local),f.vu(0xffffffff),f.vu(70000)]:[]),
    ...(!(flags&1)&&(flags&4)?[f.u8(1)]:[]));
}
function stopped(flags,{entity=7,position=point,local=localPoint}={}) {
  return f.cat(f.vu(entity),f.u8(flags),f.u8(2),...(flags&1?[f.u8(3)]:[]),
    xyz(position),f.u16(456),
    ...(flags&2?[f.i32(9001),xyz(local),f.vu(70000)]:[]),
    ...(flags&4?[f.u8(1)]:[]),...(flags&8?[f.i64(123456789)]:[]));
}

test('start and snapshot accept all verified movement flags including ordinary flag zero',()=>{
  for(const opcode of [0x371b,0x371c]) for(let flags=0;flags<8;flags++) {
    assert.deepEqual(readPositionObservation(opcode,moving(flags)),{kind:'move',entity:7,position:point});
  }
  assert.equal(moving(5).length,moving(1).length,'The two movement booleans share one byte');
});

test('stop accepts optional substate, vessel coordinate and penalty combinations',()=>{
  for(let flags=0;flags<16;flags++) {
    assert.deepEqual(readPositionObservation(0x371a,stopped(flags)),{kind:'move',entity:7,position:point});
  }
});

test('global XYZ remains authoritative when vessel-local coordinates and directions differ',()=>{
  for(const [opcode,bytes] of [[0x371b,moving(7)],[0x371c,moving(2)],[0x371a,stopped(15)]]) {
    const observation=readPositionObservation(opcode,bytes);
    assert.deepEqual(observation.position,point);
    assert.notDeepEqual(observation.position,localPoint);
    assert.equal('direction' in observation,false);
  }
});

test('complete movement readers reject truncation, trailing bytes and unknown flags',()=>{
  for(const [opcode,build,flags] of [[0x371b,moving,7],[0x371c,moving,0],[0x371a,stopped,15]]) {
    const bytes=build(flags);
    for(let length=0;length<bytes.length;length++) {
      assert.throws(()=>readPositionObservation(opcode,bytes.subarray(0,length)),`opcode ${opcode} length ${length}`);
    }
    assert.throws(()=>readPositionObservation(opcode,f.cat(bytes,f.u8(0))));
  }
  assert.throws(()=>readPositionObservation(0x371b,moving(8)));
  assert.throws(()=>readPositionObservation(0x371c,moving(128)));
  assert.throws(()=>readPositionObservation(0x371a,stopped(16)));
});

test('invalid global/local positions, entities and malformed local varints are rejected',()=>{
  for(const [opcode,build] of [[0x371b,moving],[0x371c,moving],[0x371a,stopped]]) {
    for(const x of [NaN,Infinity,1e8]) {
      assert.throws(()=>readPositionObservation(opcode,build(2,{position:{...point,x}})));
      assert.throws(()=>readPositionObservation(opcode,build(2,{local:{...localPoint,x}})));
    }
    for(const entity of [0,10000000]) assert.throws(()=>readPositionObservation(opcode,build(0,{entity})));
    const malformed=Buffer.from(build(2));
    malformed.set([255,255,255,255,255],malformed.length-5);
    assert.throws(()=>readPositionObservation(opcode,malformed));
  }
});

test('complete movement forms update only the established own entity and preserve fresh timestamps',()=>{
  const tracker=new PlayerPositionTracker();
  tracker.observe({kind:'self',entity:7,position:{x:12000,y:-67000,z:1500}},'stream',1000);
  const seed=tracker.status('stream',1000);
  tracker.message({opcode:0x371c,payload:moving(0,{entity:8}),at:1100},'stream');
  assert.equal(tracker.status('stream',1100).revision,seed.revision);
  for(const [opcode,bytes,at] of [[0x371b,moving(0),1200],[0x371c,moving(7),1300],[0x371a,stopped(15),1400]]) {
    tracker.message({opcode,payload:bytes,at},'stream');
    const status=tracker.status('stream',at);
    assert.equal(status.source,'move');assert.equal(status.at,at);assert.equal(status.fresh,true);
    assert.deepEqual(tracker.streams.get('stream').position,point);
  }
  const unknown=new PlayerPositionTracker();
  unknown.message({opcode:0x371b,payload:moving(0),at:1000},'stream');
  assert.equal(unknown.status('stream',1000).at,null,'Movement cannot infer a missing self identity');
  tracker.message({opcode:0x371b,payload:f.cat(moving(0),f.u8(0)),at:1500},'stream');
  assert.equal(tracker.status('stream',1500).at,null);assert.equal(tracker.errors,1);
});

test('spatial movement parsing creates no combat or DPS events',()=>{
  for(const [opcode,bytes] of [[0x371a,stopped(15)],[0x371b,moving(0)],[0x371c,moving(7)]]) {
    assert.deepEqual(decodePacket(opcode,bytes,1234),{opcode,known:false,complete:false,events:[]});
  }
});
