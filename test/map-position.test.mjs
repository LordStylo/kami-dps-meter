import test from 'node:test';
import assert from 'node:assert/strict';
import {MapPositionTracker,MAP_POSITION_FRESH_MS} from '../src/map-position.mjs';
import {CubeDetector} from '../src/cube-detector.mjs';
import {frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';

const seed={x:3000,y:5000,z:100};
const body=frame=>frame.subarray(frameHeader(frame).payloadOffset);
const xyz=position=>{const bytes=Buffer.alloc(12);['x','y','z'].forEach((name,index)=>bytes.writeFloatLE(position[name],index*4));return bytes;};
const move=(entity,position)=>f.cat(f.vu(entity),f.u8(0),xyz(position),f.u16(0),f.u16(0));
const warp=(entity,position)=>f.cat(f.vu(entity),f.u8(0),xyz(position),Buffer.alloc(4),f.u8(1),f.u8(0),f.u8(9),f.vu(250));
function abnormal({caster=7,position=seed}={},opcode=0x382a,includeBool=true){
  return f.cat(f.u8(17),f.vu(9),f.i32(123456),f.i64(1000),f.i64(2000),f.vu(caster),f.u8(1),...(includeBool?[f.u8(opcode===0x382b?2:0)]:[]),xyz(position));
}
function buff(opcode,{entity=7,entries=[{}]}={}){
  return f.cat(f.vu(entity),...(opcode===0x382a?[f.vu(entries.length)]:[]),...entries.map((entry,index)=>abnormal(entry,opcode,index%8===0)));
}
const send=(tracker,opcode,payload,at,stream='a')=>tracker.message({opcode,payload,at},stream);

test('map coordinates follow own self, complete movement and warp with Quest-rounded XYZ and observed source',()=>{
  const tracker=new MapPositionTracker();send(tracker,0x3633,body(f.self(seed)),1000);
  assert.deepEqual([tracker.coordinates('a',1000).x,tracker.coordinates('a',1000).z,tracker.coordinates('a',1000).source],[3000,100,'self']);
  send(tracker,0x371b,move(8,{x:10,y:20,z:30}),1100);assert.equal(tracker.coordinates('a',1100).at,1000);
  send(tracker,0x371b,move(7,{x:100,y:200,z:300}),1200);assert.equal(tracker.coordinates('a',1200).source,'move');
  send(tracker,0x373c,warp(7,{x:900.6,y:-800.6,z:700.4}),1300);
  const point=tracker.coordinates('a',1300);assert.equal(point.source,'warp');assert.equal(point.quality,'observed');assert.deepEqual([point.x,point.y,point.z],[901,-801,700]);
  assert.equal('self' in point,false);assert.equal('entity' in point,false);
});

test('map rangeBase accepts exactly the last self-target self-cast nonzero XY without proximity corroboration',()=>{
  for(const opcode of [0x382a,0x382b]){
    const tracker=new MapPositionTracker();send(tracker,0x3633,body(f.self(seed)),1000);
    const position={x:800000,y:-900000,z:12345};
    send(tracker,opcode,buff(opcode,{entries:[{position}]}),15000);
    const point=tracker.coordinates('a',15000);assert.deepEqual([point.x,point.y,point.z],[800000,-900000,12345]);
    assert.equal(point.at,15000);assert.equal(point.ageMs,0);assert.equal(point.source,'self-buff-range');assert.equal(point.quality,'estimated');
    send(tracker,opcode,buff(opcode,{entity:8,entries:[{caster:8,position:seed}]}),16000);assert.equal(tracker.coordinates('a',16000).at,15000);
    send(tracker,opcode,buff(opcode,{entries:[{caster:8,position:seed}]}),17000);assert.equal(tracker.coordinates('a',17000).at,15000);
  }
  const tracker=new MapPositionTracker();send(tracker,0x3633,body(f.self(seed)),1000);
  send(tracker,0x382a,buff(0x382a,{entries:[{position:{x:10,y:20,z:30}},{caster:8,position:seed},{position:{x:40,y:50,z:60}},{position:{x:0,y:0,z:99}}]}),2000);
  assert.deepEqual([tracker.coordinates('a',2000).x,tracker.coordinates('a',2000).y],[40,50]);
});

test('map rejects zero XY for every source, needs a known own entity and ignores arrival and NPC positions',()=>{
  const tracker=new MapPositionTracker();
  send(tracker,0x382a,buff(0x382a),500);send(tracker,0x371b,move(7,seed),600);assert.equal(tracker.coordinates('a',600),null);
  send(tracker,0x3633,body(f.self({x:0,y:0,z:500})),1000);assert.equal(tracker.coordinates('a',1000),null);
  send(tracker,0x371b,move(7,seed),1100);assert.equal(tracker.coordinates('a',1100).at,1100,'Zero-XY self still establishes the own entity');
  for(const [opcode,payload] of [[0x371b,move(7,{x:0,y:0,z:700})],[0x373c,warp(7,{x:0,y:0,z:700})],[0x382a,buff(0x382a,{entries:[{position:{x:0,y:0,z:700}}]})],[0x3623,f.cat(Buffer.alloc(6),xyz({x:9,y:8,z:7}),Buffer.alloc(6))]]){
    send(tracker,opcode,payload,2000);assert.equal(tracker.coordinates('a',2000).at,1100);
  }
  tracker.observe({kind:'npc',entity:7,position:{x:999,y:999,z:999},reason:1},'a',3000);assert.equal(tracker.coordinates('a',3000).at,1100);
});

test('map uses strict 60 second freshness; malformed, polled and older packets cannot refresh the last point',()=>{
  const tracker=new MapPositionTracker();send(tracker,0x3633,body(f.self(seed)),1000);
  assert.equal(MAP_POSITION_FRESH_MS,60000);assert.equal(tracker.coordinates('a',60999).fresh,true);assert.equal(tracker.coordinates('a',61000).fresh,false);
  send(tracker,0x371b,Buffer.from([7]),2000);assert.equal(tracker.errors,1);assert.equal(tracker.coordinates('a',2000).at,1000);
  send(tracker,0x371b,move(7,{x:10,y:20,z:30}),900);assert.equal(tracker.coordinates('a',2000).x,seed.x);
  const revision=tracker.coordinates('a',2000).revision;tracker.coordinates('a',3000);assert.equal(tracker.coordinates('a',3000).revision,revision);
});

test('map soft recovery retains raw point and original age; hard reset and a different flow cannot borrow identity',()=>{
  const tracker=new MapPositionTracker();send(tracker,0x3633,body(f.self(seed)),1000);tracker.retain('a');
  assert.equal(tracker.coordinates('a',10000).at,1000);assert.equal(tracker.coordinates('a',10000).ageMs,9000);
  send(tracker,0x371b,move(7,{x:1,y:2,z:3}),11000,'b');assert.equal(tracker.coordinates('b',11000),null);
  tracker.invalidate('a');send(tracker,0x371b,move(7,seed),12000);assert.equal(tracker.coordinates('a',12000),null);
});

test('detector map uses accepted buff origin and never consumes visibility fitting; near/far remains conservative',()=>{
  let now=1000;const detector=new CubeDetector({clock:()=>now}),deliver=(opcode,payload,at)=>{now=at;send(detector,opcode,payload,at);};
  deliver(0x3621,f.cat(f.i32(1),f.i32(77)),1000);deliver(0x3633,body(f.self({x:2900,y:4800,z:100})),1000);
  const points=[{x:8500,y:5000},{x:3000,y:10500},{x:-2500,y:5000},{x:3000,y:-500}];
  points.forEach((position,index)=>deliver(0x3641,f.cat(f.vu(10+index),f.u16(4),f.u8(0),f.i32(10001),f.state({...position,z:100}),f.vu(0),f.u8(1)),4000+index*300));
  assert.equal(detector.snapshot().position.source,'visibility');assert.equal(detector.snapshot().map.contexts[0].player.source,'self');assert.equal(detector.snapshot().map.contexts[0].player.x,2900);
  deliver(0x382a,buff(0x382a,{entries:[{position:{x:100000,y:200000,z:300000}}]}),6000);
  const map=detector.snapshot().map.contexts[0].player;assert.equal(map.source,'self-buff-range');assert.equal(map.x,100000);assert.equal(map.at,6000);
  assert.equal(detector.snapshot().position.source,'visibility');assert.equal(detector.snapshot().position.at,4900);
  now=22000;detector.tick();assert.equal(detector.snapshot().map.contexts[0].player.x,100000);assert.equal(detector.snapshot().map.contexts[0].mapState,'retained');
  detector.invalidate('a','capture-error',23000);assert.equal(detector.snapshot().map.contexts[0].player,null);
});
