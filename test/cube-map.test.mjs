import test from 'node:test';
import assert from 'node:assert/strict';
import {CubeDetector,CUBE_TEMPLATE} from '../src/cube-detector.mjs';
import {PlayerPositionTracker} from '../src/player-position.mjs';
import {frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';

const body=frame=>frame.subarray(frameHeader(frame).payloadOffset);
const map=id=>f.cat(f.i32(123),f.i32(id));
function appear(entity,position={x:10000,y:20000,z:30000}){
  const xyz=Buffer.alloc(12);xyz.writeFloatLE(position.x);xyz.writeFloatLE(position.y,4);xyz.writeFloatLE(position.z,8);
  return f.cat(f.vu(entity),f.u16(4),f.i32(CUBE_TEMPLATE),xyz,Buffer.alloc(34));
}
function fixture(){
  let now=1000;const detector=new CubeDetector({clock:()=>now});
  return {detector,send(opcode,payload,stream='a',at=now){now=at;detector.message({opcode,payload,at},stream);},
    state(at=now){now=at;return detector.snapshot();}};
}

test('map context and literal cube/self coordinates stay bound to their own stream without identity fields',()=>{
  const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self({x:100,y:200,z:300})));
  x.send(0x3634,appear(40));
  x.send(0x3621,map(88),'b',1200);x.send(0x3633,body(f.self({x:400,y:500,z:600})),'b',1300);x.send(0x3634,appear(41,{x:700,y:800,z:900}),'b',1400);
  const state=x.state(),contexts=state.map.contexts;
  assert.deepEqual(contexts.map(c=>c.mapId),[77,88]);assert.deepEqual(contexts.map(c=>c.player.x),[100,400]);
  assert.deepEqual(contexts.map(c=>c.player.z),[300,600]);assert.equal(contexts[0].enteredAt,1000);assert.equal(contexts[1].observedAt,1300);
  assert.deepEqual(state.map.markers.map(m=>m.mapId),[77,88]);
  assert.equal(state.map.markers[0].contextId,contexts[0].id);assert.equal(state.map.markers[1].contextId,contexts[1].id);
  assert.deepEqual([state.map.markers[0].x,state.map.markers[0].y,state.map.markers[0].z],[10000,20000,30000]);
  assert.equal('entity' in contexts[0].player,false);assert.equal('name' in contexts[0].player,false);assert.equal('self' in contexts[0].player,false);
});

test('missing or unreadable map IDs remain unknown and cannot reuse a previous known region',()=>{
  const x=fixture();x.send(0x3633,body(f.self({x:1,y:0,z:0})));x.send(0x3634,appear(40));
  let state=x.state();assert.equal(state.map.contexts[0].mapId,null);assert.equal(state.map.markers[0].mapId,null);
  assert.equal(state.map.contexts[0].player.z,0);
  for(const payload of [map(0),map(-5),Buffer.alloc(4)]){
    x.send(0x3621,map(77));x.send(0x3634,appear(40));const previous=x.state().map.contexts[0].id;
    x.send(0x3621,payload);state=x.state();assert.equal(state.map.contexts[0].mapId,null);
    assert.notEqual(state.map.contexts[0].id,previous);assert.equal(state.map.markers.length,0);assert.equal(state.map.contexts[0].player,null);
  }
});

test('new map notices and self appearances clear old cube pins while self appearance preserves a confirmed map ID',()=>{
  const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self()));x.send(0x3634,appear(40));
  let state=x.state(),old=state.map.contexts[0].id;
  x.send(0x3633,body(f.self({x:20,y:30,z:40})),'a',2000);state=x.state();
  assert.equal(state.map.contexts[0].mapId,77);assert.notEqual(state.map.contexts[0].id,old);assert.equal(state.map.contexts[0].enteredAt,1000);
  assert.equal(state.map.contexts[0].observedAt,2000);assert.equal(state.map.markers.length,0);
  x.send(0x3634,appear(40));old=x.state().map.contexts[0].id;
  x.send(0x3621,map(77),'a',2500);state=x.state();assert.notEqual(state.map.contexts[0].id,old);assert.equal(state.map.markers.length,0);
  x.send(0x3634,appear(40));x.send(0x3621,map(88),'a',3000);state=x.state();assert.equal(state.map.contexts[0].mapId,88);assert.equal(state.map.markers.length,0);
});

test('same-stream resync retains last confirmed region and last map point explicitly but never old cube pins',()=>{
  const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self({x:100,y:200,z:300})));x.send(0x3634,appear(40));
  const old=x.state().map.contexts[0].id;x.detector.invalidate('a','stream-gap',2000);
  let state=x.state(2000);assert.equal(state.map.markers.length,0);assert.equal(state.map.contexts[0].mapId,77);assert.notEqual(state.map.contexts[0].id,old);
  assert.equal(state.map.contexts[0].mapState,'retained');assert.equal(state.map.contexts[0].confirmedAt,1000);assert.equal(state.map.contexts[0].player.at,1000);
  x.send(0x3633,body(f.self()),'a',2500);x.send(0x3634,appear(40));state=x.state();assert.equal(state.map.markers[0].mapId,77);
  assert.equal(state.map.contexts[0].mapState,'retained');assert.equal(state.map.contexts[0].confirmedAt,1000);
  x.send(0x3621,map(77),'a',3000);x.send(0x3634,appear(40));state=x.state();assert.equal(state.map.markers[0].mapId,77);
  assert.equal(state.map.contexts[0].mapState,'confirmed');assert.equal(state.map.contexts[0].confirmedAt,3000);
  x.detector.invalidate('a','connection-closed',3500);assert.equal(x.state(3500).map.contexts.length,0);
});

const move=(entity,point)=>f.cat(f.vu(entity),f.u8(0),f.state(point).subarray(2,14),f.u16(0),f.u16(0));

test('own flag-zero movement resumes after every supported same-stream framing failure without a fresh appearance',()=>{
  for(const reason of ['stream-gap','bad-frame','sync-discard','unrecognized-stream','WireError:0xffff:LZ4 invalid match']){
    const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self({x:100,y:200,z:300})));x.send(0x3634,appear(40));
    const before=x.state(),generation=before.map.contexts[0].player.generation;
    x.detector.player.observe({kind:'npc',entity:80,position:{x:100,y:200,z:300},reason:1},'a',1100);
    x.detector.invalidate('a',reason,1200);
    let state=x.state(1200);assert.equal(state.active.length,0,reason);assert.equal(state.map.markers.length,0);assert.equal(state.map.contexts[0].player.at,1000);
    assert.equal(x.detector.player.streams.get('a').self,7);assert.equal(x.detector.player.streams.get('a').nodes.size,0);assert.equal(x.detector.player.streams.get('a').edges.size,0);
    x.send(0x371b,move(8,{x:999,y:999,z:999}),'a',1300);assert.equal(x.state().map.contexts[0].player.at,1000,'A foreign entity cannot replace the last own map point');
    x.send(0x371b,move(7,{x:500,y:600,z:700}),'a',1500);state=x.state();
    assert.equal(state.map.contexts[0].player.x,500,reason);assert.equal(state.map.contexts[0].player.fresh,true);assert.ok(state.map.contexts[0].player.generation>generation);
    assert.equal(state.map.contexts[0].mapId,77);assert.equal(state.map.contexts[0].mapState,'retained');assert.equal(state.map.contexts[0].confirmedAt,1000);
    assert.equal(state.map.markers.length,0,'Movement cannot revive any old cube');assert.equal(state.active.length,0);
  }
});

test('hard close, a new TCP flow, capture error and true map transition cannot inherit the old own entity',()=>{
  for(const reason of ['connection-closed','capture-error']){
    const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self()));x.detector.invalidate('a',reason,1200);
    x.send(0x371b,move(7,{x:500,y:600,z:700}),'a',1500);assert.equal(x.detector.player.coordinates('a',1500),null,reason);
    assert.equal(x.state().map.contexts[0]?.mapId??null,null);
  }
  const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self()));
  x.send(0x371b,move(7,{x:500,y:600,z:700}),'b',1200);assert.equal(x.detector.player.coordinates('b',1200),null);
  x.send(0x3621,map(88),'a',1500);x.send(0x371b,move(7,{x:500,y:600,z:700}),'a',1700);
  assert.equal(x.state().map.contexts.find(c=>c.stream==='a').mapId,88);assert.equal(x.detector.player.coordinates('a',1700),null);
});

test('a malformed position suspends near/far coordinates but cannot overwrite the last accepted map point',()=>{
  const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self({x:100,y:200,z:300})));
  const generation=x.detector.player.status('a',1000).generation;
  x.send(0x371b,Buffer.from([7]),'a',1200);assert.equal(x.detector.player.errors,1);assert.equal(x.state().map.contexts[0].player.at,1000);
  assert.equal(x.detector.player.coordinates('a',1200),null);assert.equal(x.detector.player.streams.get('a').self,7);
  x.send(0x371b,move(7,{x:500,y:600,z:700}),'a',1500);
  assert.equal(x.state().map.contexts[0].player.x,500);assert.ok(x.detector.player.status('a',1500).generation>generation);
});

test('stale own coordinates retain their original time and floor while current stationary pins remain independent',()=>{
  const x=fixture();x.send(0x3621,map(77));x.send(0x3633,body(f.self({x:100,y:200,z:300})));x.send(0x3634,appear(40));
  let state=x.state(4001),player=state.map.contexts[0].player;
  assert.equal(player.at,1000);assert.equal(player.ageMs,3001);assert.equal(player.fresh,true);assert.equal(player.z,300);
  assert.equal(state.map.markers.length,1);assert.equal(state.active[0].proximity.distance,null);
  x.send(0x3635,f.cat(f.vu(40),f.u8(4),f.u8(3),f.u8(0)),'a',4100);state=x.state();
  assert.equal(state.map.markers.length,0);assert.equal(state.recent[0].status,'disappeared');assert.equal(state.map.contexts[0].player.at,1000);
  assert.equal(x.state(61000).map.contexts[0].player.fresh,false);
  x.detector.invalidate(null,'capture-stopped',4200);assert.equal(x.state(4200).map.contexts.length,0);
});

test('XY visibility estimates expose unknown Z instead of retaining the previous observed floor',()=>{
  const tracker=new PlayerPositionTracker();tracker.observe({kind:'self',entity:7,position:{x:2900,y:4800,z:12345}},'a',1000);
  assert.equal(tracker.coordinates('a',1000).z,12345);
  const points=[{x:8500,y:5000},{x:3000,y:10500},{x:-2500,y:5000},{x:3000,y:-500}];
  points.forEach((position,n)=>tracker.observe({kind:'npc',entity:10+n,position:{...position,z:800},reason:1},'a',4000+n*300));
  const position=tracker.coordinates('a',4900);assert.equal(position.quality,'estimated');assert.equal(position.z,null);assert.equal(position.fresh,true);
  assert.equal(tracker.coordinates('missing',4900),null);
});
