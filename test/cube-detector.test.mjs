import test from 'node:test';
import assert from 'node:assert/strict';
import {CubeDetector,CUBE_TEMPLATE} from '../src/cube-detector.mjs';
import {FrameStream} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';
const appear=(entity=40,template=CUBE_TEMPLATE)=>f.cat(f.vu(entity),f.u16(4),f.i32(template),Buffer.alloc(12),Buffer.alloc(34));
const remove=entity=>f.cat(f.vu(entity),f.u8(4),f.u8(3),f.u8(0));
const packet=(opcode,payload,at=1000)=>({opcode,payload,at});
test('experimental cube alert triggers once per appearance and never from other templates or partial prefixes',()=>{
  const changes=[],d=new CubeDetector({onChange:e=>changes.push(e),clock:()=>1000});
  d.message(packet(0x3634,appear(1,1111111)),'a');d.message(packet(0x3634,appear(2).subarray(0,-1)),'a');
  assert.equal(d.snapshot().total,0);
  d.message(packet(0x3634,appear(40)),'a');d.message(packet(0x3634,appear(40)),'a');
  assert.equal(d.snapshot().total,1);assert.equal(d.snapshot().active.length,1);assert.equal(changes.length,1);
  assert.equal('position' in d.snapshot().active[0],false);
  d.message(packet(0x3635,remove(40),2000),'a');assert.equal(d.snapshot().active.length,0);
  assert.equal(d.snapshot().recent[0].status,'disappeared');
  d.message(packet(0x3634,appear(40),3000),'a');assert.equal(d.snapshot().total,2);
});
test('stream identity, map changes, capture gaps, and entity reuse prevent stale nearby claims',()=>{
  const d=new CubeDetector();d.message(packet(0x3634,appear(40)),'a');d.message(packet(0x3634,appear(40)),'b');
  d.message(packet(0x3635,remove(40)),'b');assert.equal(d.snapshot().active.length,1);
  d.invalidate('b','stream-gap');assert.equal(d.snapshot().active.length,1);
  d.message(packet(0x3621,Buffer.alloc(8)),'a');assert.equal(d.snapshot().active.length,0);
  assert.equal(d.snapshot().recent.find(c=>c.stream==='a').status,'uncertain');
  d.message(packet(0x3634,appear(50)),'a');d.message(packet(0x3634,appear(50,3333333)),'a');
  assert.equal(d.snapshot().active.length,0);
  d.message(packet(0x3634,appear(51)),'a');d.invalidate(null,'capture-stopped');assert.equal(d.snapshot().active.length,0);
});
test('silent or malformed streams clear presence; game traffic keeps a stationary cube valid',()=>{
  let now=1000;const d=new CubeDetector({clock:()=>now});d.message(packet(0x3634,appear(40)),'a');
  now=15000;d.message(packet(0x3600,Buffer.alloc(8)),'a');now=20000;d.tick();assert.equal(d.snapshot().active.length,1);
  now=30001;d.tick();assert.equal(d.snapshot().active.length,0);assert.equal(d.snapshot().recent[0].reason,'stream-silent');
  d.message(packet(0x3634,appear(40)),'a');d.message(packet(0x3635,Buffer.alloc(0)),'a');
  assert.equal(d.snapshot().active.length,0);assert.equal(d.snapshot().parseErrors,1);
});
test('real framing and compressed bundles feed alerts only after synchronization',()=>{
  const d=new CubeDetector(),s=new FrameStream(()=>{},e=>d.invalidate('a',e),p=>d.message(p,'a'));
  s.push(f.frame(0x3634,appear()),1000);assert.equal(d.snapshot().total,0);
  s.gap();s.push(f.cat(f.heartbeat(),f.heartbeat(),f.bundle(f.frame(0x3634,appear()))),2000);
  assert.equal(d.snapshot().total,1);s.gap();assert.equal(d.snapshot().active.length,0);
});
