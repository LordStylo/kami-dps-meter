import test from 'node:test';
import assert from 'node:assert/strict';
import {readSelfPosition,decodePacket} from '../src/protocol/packets.mjs';
import {frameHeader} from '../src/protocol/framing.mjs';
import {readPositionObservation,POSITION_OPCODES} from '../src/protocol/position.mjs';
import {PlayerPositionTracker} from '../src/player-position.mjs';
import * as f from './wire-fixtures.mjs';
function payload(frame){return frame.subarray(frameHeader(frame).payloadOffset);}

test('self appearance exposes its XYZ to research without changing DPS identity events',()=>{
 const position={x:15095.25,y:-8380.25,z:25031},body=payload(f.self(position));
 assert.deepEqual(readSelfPosition(body),{entity:7,position});
 const original=decodePacket(0x3633,body).events;
 assert.equal(original.length,1);assert.equal(original[0].self,true);
 assert.equal('position' in original[0],false);
});

test('position prefix rejects missing spatial state, invalid entity and non-finite coordinates',()=>{
 const good=payload(f.self());
 assert.throws(()=>readSelfPosition(good.subarray(0,30)));
 const invalid=Buffer.from(good);invalid[0]=0;assert.throws(()=>readSelfPosition(invalid));
 assert.throws(()=>readSelfPosition(payload(f.self({x:NaN,y:0,z:0}))));
 assert.throws(()=>readSelfPosition(payload(f.self({x:0,y:Infinity,z:0}))));
});

const xyz=position=>{const bytes=Buffer.alloc(12);['x','y','z'].forEach((name,index)=>bytes.writeFloatLE(position[name],index*4));return bytes;};
const float=value=>{const bytes=Buffer.alloc(4);bytes.writeFloatLE(value);return bytes;};
const point={x:3000,y:5000,z:100};
function warp({entity=7,position=point,flags=3}={}){
 return f.cat(f.vu(entity),f.u8(flags),xyz(position),float(1.25),f.u8(1),f.u8(0),f.u8(9),
  ...(flags&1?[f.i32(11010130)]:[]),...(flags&2?[f.i32(1234)]:[]),f.vu(250));
}
function buffAnchor(opcode,{entity=7,caster=7,position=point,flags=17}={}){
 const abnormal=f.cat(f.u8(flags),f.vu(9),f.i32(123456),f.i64(1000),f.i64(2000),
  ...(flags&1?[f.vu(caster)]:[]),f.u8(1),...(flags&2?[f.i32(11010130)]:[]),f.u8(opcode===0x382b?2:0),
  ...(flags&4?[f.vu(7)]:[]),...(flags&8?[f.i32(1)]:[]),...(flags&16?[xyz(position)]:[]));
 return f.cat(f.vu(entity),...(opcode===0x382a?[f.vu(1)]:[]),abnormal);
}
const movement=(entity,position)=>f.cat(f.vu(entity),f.u8(1),f.u8(0),xyz(position),Buffer.alloc(4));
function send(tracker,opcode,bytes,at,stream='a'){tracker.message({opcode,payload:bytes,at},stream);}

test('warp reader validates the complete schema and both optional IDs',()=>{
 for(const flags of [0,1,2,3]){
  const observation=readPositionObservation(0x373c,warp({flags}));
  assert.equal(observation.kind,'warp');assert.equal(observation.entity,7);assert.deepEqual(observation.position,point);
  assert.equal(observation.skill,flags&1?11010130:undefined);assert.equal(observation.effect,flags&2?1234:undefined);
  assert.equal(observation.durationMs,250);
 }
 assert.ok(POSITION_OPCODES.has(0x373c));
 assert.throws(()=>readPositionObservation(0x373c,warp().subarray(0,-1)));
 assert.throws(()=>readPositionObservation(0x373c,f.cat(warp(),f.u8(0))));
 assert.throws(()=>readPositionObservation(0x373c,warp({flags:4})));
 assert.throws(()=>readPositionObservation(0x373c,warp({entity:0})));
 assert.throws(()=>readPositionObservation(0x373c,warp({position:{...point,x:NaN}})));
});

test('only the known own entity can warp the player; warp resets continuity and visibility references',()=>{
 const tracker=new PlayerPositionTracker();send(tracker,0x3633,payload(f.self(point)),1000);
 tracker.observe({kind:'npc',entity:80,position:point,reason:1},'a',1100);
 const before=tracker.status('a',1100);
 send(tracker,0x373c,warp({entity:8}),1200);
 assert.equal(tracker.status('a',1200).revision,before.revision);
 const destination={x:20000,y:5000,z:100};send(tracker,0x373c,warp({position:destination}),1300);
 const after=tracker.status('a',1300);
 assert.equal(after.source,'warp');assert.equal(after.quality,'observed');assert.equal(after.usableForTrend,true);
 assert.ok(after.generation>before.generation);assert.ok(after.revision>before.revision);
 assert.deepEqual(tracker.streams.get('a').position,destination);
 assert.equal(tracker.streams.get('a').nodes.size,0);assert.equal(tracker.streams.get('a').edges.size,0);
 assert.equal(tracker.status('a',4301).fresh,false);
 const unidentified=new PlayerPositionTracker();send(unidentified,0x373c,warp(),1000);
 assert.equal(unidentified.status('a',1000).at,null,'A foreign warp cannot establish self identity');
});

test('generation and revision distinguish same-time updates, source changes, long gaps and large jumps',()=>{
 const tracker=new PlayerPositionTracker();send(tracker,0x3633,payload(f.self(point)),1000);
 const seed=tracker.status('a',1000);
 send(tracker,0x371b,movement(7,point),1100);const moving=tracker.status('a',1100);
 assert.ok(moving.generation>seed.generation);
 send(tracker,0x371b,movement(7,{...point,x:3100}),1200);const next=tracker.status('a',1200);
 assert.equal(next.generation,moving.generation);assert.ok(next.revision>moving.revision);
 send(tracker,0x371b,movement(7,{...point,x:3200}),1200);const sameTime=tracker.status('a',1200);
 assert.equal(sameTime.at,next.at);assert.ok(sameTime.revision>next.revision);
 send(tracker,0x371b,movement(7,{...point,x:3300}),1150);
 assert.equal(tracker.status('a',1200).revision,sameTime.revision,'An older observation cannot rewind the position');
 send(tracker,0x371b,movement(7,{...point,x:3400}),5000);const gap=tracker.status('a',5000);
 assert.ok(gap.generation>sameTime.generation);
 send(tracker,0x371b,movement(7,{...point,x:24000}),5100);
 assert.ok(tracker.status('a',5100).generation>gap.generation);
 const oldGeneration=tracker.status('a',5100).generation;tracker.invalidate('a');
 assert.equal(tracker.status('a',5200).generation,null);assert.equal(tracker.status('a',5200).usableForTrend,false);
 send(tracker,0x3633,payload(f.self(point)),5300);assert.ok(tracker.status('a',5300).generation>oldGeneration);
});

test('self-target self-cast buff range origins are anchors, never an independent movement sample',()=>{
 const tracker=new PlayerPositionTracker();send(tracker,0x3633,payload(f.self(point)),1000);
 const baseline=tracker.status('a',1000);
 for(const opcode of [0x382a,0x382b]){
  const packet=buffAnchor(opcode,{position:{...point,x:3050}}),observation=readPositionObservation(opcode,packet);
  assert.equal(observation.kind,'buff-anchor');assert.equal(observation.entity,7);assert.equal(observation.caster,7);
  send(tracker,opcode,packet,1100);
  const status=tracker.status('a',1100);
  assert.equal(status.anchor.corroborated,true);assert.equal(status.anchor.quality,'anchor');
  assert.equal(status.at,baseline.at);assert.equal(status.revision,baseline.revision);assert.equal(status.generation,baseline.generation);
  assert.deepEqual(tracker.streams.get('a').position,point);
  assert.equal('rangeBase' in decodePacket(opcode,packet,1100).events[0],false,'Normal combat events must not export area coordinates');
 }
 send(tracker,0x382a,buffAnchor(0x382a,{position:{...point,x:30000}}),4000);
 const stale=tracker.status('a',4001);
 assert.equal(stale.anchor.corroborated,false);assert.equal(stale.fresh,false);assert.equal(stale.usableForTrend,false);
 assert.equal(stale.at,1000,'A fresh but ambiguous buff anchor cannot revive an expired player coordinate');
 stale.anchor.corroborated=true;assert.equal(tracker.status('a',4001).anchor.corroborated,false);
});

test('foreign, zero and malformed buff anchors cannot move or refresh the known player',()=>{
 const tracker=new PlayerPositionTracker();send(tracker,0x3633,payload(f.self(point)),1000);
 assert.equal(readPositionObservation(0x382a,buffAnchor(0x382a,{entity:7,caster:8})),null);
 assert.equal(readPositionObservation(0x382a,buffAnchor(0x382a,{position:{x:0,y:0,z:100}})),null);
 assert.equal(readPositionObservation(0x382a,buffAnchor(0x382a,{flags:1})),null);
 send(tracker,0x382a,buffAnchor(0x382a,{entity:8,caster:8}),1100);
 assert.equal(tracker.status('a',1100).anchor,null);
 assert.throws(()=>readPositionObservation(0x382a,buffAnchor(0x382a).subarray(0,-1)));
 assert.throws(()=>readPositionObservation(0x382b,f.cat(buffAnchor(0x382b),f.u8(0))));
 assert.throws(()=>readPositionObservation(0x382a,buffAnchor(0x382a,{flags:49})));
 assert.throws(()=>readPositionObservation(0x382a,buffAnchor(0x382a,{position:{...point,y:NaN}})));
 send(tracker,0x373c,warp().subarray(0,-1),1200);
 assert.equal(tracker.status('a',1200).at,null);assert.equal(tracker.status('a',1200).usableForTrend,false);
 assert.equal(tracker.errors,1);
});
