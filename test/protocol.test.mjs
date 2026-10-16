import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../src/protocol/reader.mjs';
import { decodePacket } from '../src/protocol/packets.mjs';
import { frameHeader, FrameStream, decompressLz4 } from '../src/protocol/framing.mjs';
import { parseTcpFrame, TcpStream } from '../src/capture/tcp.mjs';
import { Meter } from '../src/meter.mjs';
import * as f from './wire-fixtures.mjs';
const decode = frame => { const h = frameHeader(frame); return decodePacket(h.opcode, frame.subarray(h.width + 2), 1000); };

test('wire length counts original four-byte header, including varint threshold', () => {
  assert.equal(frameHeader(Buffer.from('0e00360000000000000000','hex')).size, 11);
  const large = f.frame(0x3600, Buffer.alloc(128)); assert.equal(frameHeader(large).size, 132);
  assert.equal(frameHeader(Buffer.from([0x80])), null);
  assert.throws(() => frameHeader(Buffer.from([0xff,0xff,0xff,0xff,0])));
});
test('signed varints are not ZigZag; numeric limits are enforced', () => {
  assert.equal(new Reader(f.vu(0xffffffff)).vi32(), -1);
  assert.equal(new Reader(f.vu(0xffffffffffffffffn)).vi64(), -1n);
  assert.equal(new Reader(f.vu(3)).vi32(), 3);
  assert.throws(() => new Reader(Buffer.alloc(10, 0xff)).vi64());
});
test('boolean bits survive intervening fields and roll into a new byte', () => {
  const r = new Reader(Buffer.from([0b10100101, 42, 1]));
  assert.equal(r.bool(), true); assert.equal(r.u8(), 42);
  assert.deepEqual(Array.from({length:7},()=>r.bool()), [false,true,false,false,true,false,true]);
  assert.equal(r.bool(), true); r.done();
});
test('direct total already includes additional hits; critical and plotter fields', () => {
  const {events} = decode(f.direct({extra:[4000,2000],plotter:true}));
  assert.equal(events[0].damage, 10000); assert.equal(events[0].hits, 3);
  assert.equal(events[0].critical, true); assert.equal(events[0].back, true);
});
test('heals, ignored effects and barriers do not produce DPS', () => {
  assert.equal(decode(f.direct({effect:41})).events[0].type, 'heal');
  assert.deepEqual(decode(f.direct({effect:51})).events, []);
  assert.equal(decode(f.dot({effect:2941})).events[0].type, 'heal');
  assert.equal(decode(f.dot({effect:4461})).events[0].type, 'barrier');
  assert.equal(decode(f.dot()).events[0].damage, 3000);
});
test('identity prefixes provide names and pet owners without claiming full validation', () => {
  const a = decode(f.player()); assert.equal(a.complete,false); assert.equal(a.events[0].name,'Test');
  assert.equal(decode(f.npc()).events[0].owner,7);
});
test('self and complete party roster link identities without exposing account fields',()=>{
  const self=decode(f.self());assert.equal(self.events[0].name,'Ben');assert.equal(self.events[0].self,true);
  const party=decode(f.party());assert.equal(party.complete,true);assert.equal(party.events[0].members.length,1);
  assert.equal(party.events[0].members[0].entity,7);assert.equal(party.events[0].members[0].name,'Test');
  assert.equal(JSON.stringify(party).includes('discard-me'),false);
});
test('payload drift and malformed lists are rejected', () => {
  const h = frameHeader(f.direct());
  assert.throws(() => decodePacket(0x3804, f.direct().subarray(h.width+2,-1)));
  assert.throws(() => decodePacket(0x3804, Buffer.concat([f.direct().subarray(h.width+2),Buffer.from([0])])));
  assert.throws(() => new Reader(f.vu(10001)).list(r=>r.u8()));
});
test('LZ4 overlapping matches, size mismatch and zero offsets', () => {
  const raw = Buffer.from([0x33,97,98,99,3,0,0x50,49,50,51,52,53]);
  assert.equal(decompressLz4(raw,15).toString(),'abcabcabca12345');
  assert.throws(()=>decompressLz4(raw,14));
  assert.throws(()=>decompressLz4(Buffer.from([0x10,97,0,0]),5));
});
test('fragmented compressed frames decode once after strict synchronization', () => {
  const packets=[], issues=[], stream = new FrameStream(p=>packets.push(p),s=>issues.push(s));
  const raw = f.cat(f.heartbeat(), f.heartbeat(), f.bundle(f.direct(),f.dot()));
  for(let i=0;i<raw.length;i+=3) stream.push(raw.subarray(i,i+3),1000+i);
  assert.equal(packets.flatMap(p=>p.events).filter(e=>e.type.startsWith('damage')).length,2);
  assert.deepEqual(issues,[]);
});
test('synchronization preserves an identity prefix before heartbeats', () => {
  const packets=[], stream=new FrameStream(p=>packets.push(p));
  stream.push(f.cat(f.player(),f.heartbeat(),f.heartbeat(),f.direct()),1000);
  assert.equal(packets[0].events[0].name,'Test');
});
test('random leading bytes do not manufacture hits', () => {
  const packets=[], stream=new FrameStream(p=>packets.push(p));
  stream.push(f.cat(Buffer.from([255,255,255,255,255]),f.heartbeat(),f.heartbeat(),f.direct()),1000);
  assert.equal(packets.flatMap(p=>p.events).length,1);
});
test('unsynchronized traffic scans each rejected offset once without starving game frames',()=>{
  const packets=[],stream=new FrameStream(p=>packets.push(p));
  let attempts=0;const probe=stream.probe.bind(stream);
  stream.probe=(...args)=>{attempts++;return probe(...args);};
  const noise=Buffer.alloc(280000,0x80);
  for(let i=0;i<noise.length;i+=1000)stream.push(noise.subarray(i,i+1000),1000);
  assert.ok(attempts<noise.length*1.02,`Repeated scanning: ${attempts}`);
  assert.equal(packets.length,0);assert.ok(stream.buffer.length<=131072);
  stream.push(f.cat(f.heartbeat(),f.heartbeat(),f.direct()),2000);
  assert.equal(packets.flatMap(p=>p.events).filter(e=>e.type==='damage').length,1);
});
test('incremental synchronization retains split headers and split second anchors',()=>{
  const raw=f.cat(Buffer.from([255,255,255,255,255]),f.heartbeat(),f.heartbeat(),f.direct());
  for(let split=1;split<raw.length;split++){
    const packets=[],stream=new FrameStream(p=>packets.push(p));
    stream.push(raw.subarray(0,split),1000);stream.push(raw.subarray(split),1001);
    assert.equal(packets.flatMap(p=>p.events).filter(e=>e.type==='damage').length,1,`split ${split}`);
  }
  const tiny=f.frame(0x961a,Buffer.alloc(0)),packets=[],stream=new FrameStream(p=>packets.push(p));
  for(const byte of f.cat(tiny,tiny))stream.push(Buffer.from([byte]),2000);
  assert.equal(packets.length,2,'A three-byte second anchor must not need a third frame');
});
test('an inexact message inside a valid bundle does not discard neighboring damage',()=>{
  const packets=[],issues=[],stream=new FrameStream(p=>packets.push(p),s=>issues.push(s));
  stream.push(f.cat(f.heartbeat(),f.heartbeat(),f.bundle(f.frame(0x3804,Buffer.from([1])),f.direct())),1000);
  assert.equal(packets.flatMap(p=>p.events).length,1);assert.equal(issues.length,1);
});
test('broken compressed output emits no partial events',()=>{
  const packets=[],stream=new FrameStream(p=>packets.push(p));
  const bad=f.bundle(f.direct());bad[bad.length-1]=255;
  const h=frameHeader(bad);bad.writeUInt32LE(123456,h.width+2);
  stream.push(f.cat(f.heartbeat(),f.heartbeat(),bad),1000);
  assert.equal(packets.flatMap(p=>p.events).length,0);
});
test('TCP deduplicates overlaps and reorders segments', () => {
  const outputs=[], gaps=[], s=new TcpStream(b=>outputs.push(b.toString()),t=>gaps.push(t));
  s.push(99,Buffer.alloc(0),true,0);
  s.push(103,Buffer.from('def'),false,10); s.push(100,Buffer.from('abc'),false,20);
  s.push(102,Buffer.from('cdefg'),false,30); s.push(100,Buffer.from('abcdefg'),false,40);
  assert.equal(outputs.join(''),'abcdefg'); assert.deepEqual(gaps,[]); assert.equal(s.duplicates,1);
});
test('TCP wraps sequence numbers and exposes real gaps', () => {
  const outputs=[], gaps=[], s=new TcpStream(b=>outputs.push(b.toString()),t=>gaps.push(t));
  s.push(0xfffffffe,Buffer.from('abcd'),false,0); s.push(2,Buffer.from('e'),false,1);
  s.push(5,Buffer.from('h'),false,2); s.tick(1100);
  assert.equal(outputs.join(''),'abcdeh'); assert.equal(gaps.length,1);
});
test('Ethernet parser rejects IP fragments and truncated TCP headers', () => {
  const bytes=f.tcpPacket(Buffer.from('hello'));
  assert.equal(parseTcpFrame(bytes,1).payload.toString(),'hello');
  assert.equal(parseTcpFrame(bytes.subarray(0,40),1),null);
  bytes.writeUInt16BE(0x2000,20); assert.equal(parseTcpFrame(bytes,1),null);
});
test('raw TCP to meter end-to-end with retransmission', () => {
  const meter=new Meter(); const frames=new FrameStream(p=>p.events.forEach(e=>meter.ingest(e)));
  const tcp=new TcpStream((b,at)=>frames.push(b,at),()=>frames.gap());
  const chunks=[f.cat(f.player(),f.heartbeat(),f.heartbeat(),f.direct()),f.direct({damage:20000})];
  let seq=100;
  for(const [i,chunk] of chunks.entries()) {
    const raw=f.tcpPacket(chunk,seq), p=parseTcpFrame(raw,1);
    tcp.push(p.sequence,p.payload,false,1000+i*1000); tcp.push(p.sequence,p.payload,false,1000+i*1000);
    seq+=chunk.length;
  }
  const result=meter.snapshot({scope:'all'}); assert.equal(result.damage,30000); assert.equal(result.dps,30000); assert.equal(result.players.length,1);
});
