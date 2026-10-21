import test from 'node:test';
import assert from 'node:assert/strict';
import {PetTracker,MAX_LIVE_PET_NPCS} from '../src/pet-tracker.mjs';
import {CubeDetector} from '../src/cube-detector.mjs';
import {decodePacket} from '../src/protocol/packets.mjs';
import {FrameStream,frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';

const npcId=2100075,point={x:10000.6,y:-20000.6,z:30000};
const payload=frame=>frame.subarray(frameHeader(frame).payloadOffset);
const xyz=position=>{const bytes=Buffer.alloc(12);['x','y','z'].forEach((key,index)=>bytes.writeFloatLE(position[key],index*4));return bytes;};
const npc=({entity=70,npc=npcId,owner=0,position=point}={})=>{
 const state=f.state(position);
 return f.cat(f.vu(entity),f.u16(4|(owner?16:0)),f.u8(0),f.i32(npc),state,f.vu(0),f.u8(1),...(owner?[f.i32(owner)]:[]));
};
const move=(entity,position=point)=>f.cat(f.vu(entity),f.u8(0),xyz(position),f.u16(0),f.u16(0));
const warp=(entity,position=point)=>f.cat(f.vu(entity),f.u8(0),xyz(position),Buffer.alloc(4),f.u8(1),f.u8(0),f.u8(9),f.vu(250));
const hp=(entity,value)=>f.cat(f.vu(entity),f.u8(1),f.vu(1),f.u8(0),f.i32(value));
const death=entity=>f.cat(f.vu(entity),f.i32(0),f.vu(7),f.u16(1),f.str(''),f.str(''),f.u16(0),f.vu(0),f.i32(0),f.u8(0),f.u8(0));
class Collection {
 constructor(){this.revision=0;this.calls=[];}
 invalidate(stream,reason){this.calls.push(['invalidate',stream,reason]);this.revision++;}
 identify(stream,identity,at){this.calls.push(['identify',stream,identity,at]);this.revision++;}
 message(packet,stream){this.calls.push(['message',stream,packet.opcode]);this.revision++;}
 snapshot(){return {status:'unknown',character:null,complete:false,revision:this.revision};}
}
function fixture(){
 let now=1000;const collection=new Collection(),detector=new CubeDetector({clock:()=>now}),tracker=new PetTracker({npcIds:new Set([npcId,2100480]),collection});
 const committed=(packet,stream='a')=>{now=packet.at;detector.message(packet,stream);tracker.message(packet,stream,detector.context(stream,packet.at));};
 const send=(opcode,bytes,at=now,stream='a')=>{let decoded;try{decoded=decodePacket(opcode,bytes,at);}catch{decoded={error:'synthetic malformed packet',events:[]};}committed({...decoded,opcode,payload:bytes,at},stream);};
 const snapshot=()=>tracker.snapshot(detector.snapshot().map.contexts);
 send(0x3621,f.cat(f.i32(1),f.i32(77)));send(0x3633,payload(f.self({x:100,y:200,z:300})));
 return {tracker,detector,collection,send,committed,snapshot};
}

test('only observed catalog NPCs without owners or player identities enter the live pet map',()=>{
 const x=fixture();assert.equal(x.snapshot().map.markers.length,0,'Catalog membership cannot fabricate a spawn');
 x.send(0x3641,npc());let marker=x.snapshot().map.markers[0];
 assert.deepEqual([marker.entity,marker.npcId,marker.x,marker.y,marker.z],[70,npcId,10001,-20001,null]);
 assert.equal(marker.mapId,77);assert.equal(marker.contextId,x.snapshot().map.contexts[0].id);assert.equal(marker.status,'present');assert.equal('petId' in marker,false);
 x.send(0x3641,npc({entity:71,npc:999999}));x.send(0x3641,npc({entity:72,owner:7}));
 x.send(0x3645,payload(f.player(73,'Foreign player')));x.send(0x3641,npc({entity:73}));
 assert.deepEqual(x.snapshot().map.markers.map(entry=>entry.entity),[70]);
 x.send(0x3641,npc({entity:70,npc:999999}));assert.equal(x.snapshot().map.markers.length,0,'A reused entity cannot keep an old pet template');
});

test('complete NPC movement and warp update only existing entities, reject zero XY and keep original timestamps',()=>{
 const x=fixture();x.send(0x3641,npc(),1100);const original=x.snapshot().map.markers[0];
 x.send(0x371b,move(71,{x:8,y:9,z:10}),1200);assert.equal(x.snapshot().map.markers.length,1);
 x.send(0x371b,move(70,{x:0,y:0,z:999}),1300);assert.equal(x.snapshot().map.markers[0].at,1100);
 x.send(0x371c,move(70,{x:400,y:500,z:600}),1400);let marker=x.snapshot().map.markers[0];assert.equal(marker.x,400);assert.equal(marker.y,500);assert.equal(marker.at,1400);assert.equal(marker.id,original.id);
 x.send(0x373c,warp(70,{x:-700,y:800,z:9999}),1500);marker=x.snapshot().map.markers[0];assert.deepEqual([marker.x,marker.y,marker.z,marker.at],[-700,800,null,1500]);
 x.send(0x371b,move(70,{x:1,y:2,z:3}),1450);assert.equal(x.snapshot().map.markers[0].at,1500);
 const revision=x.tracker.revision;x.snapshot();x.snapshot();assert.equal(x.tracker.revision,revision,'Polling cannot create movement samples');
});

test('death and HP zero hide a known NPC, positive HP restores it, and both removal opcodes delete it',()=>{
 const x=fixture();x.send(0x3641,npc(),1100);x.send(0x8d04,death(70),1200);assert.equal(x.snapshot().map.markers.length,0);
 x.send(0x8d00,hp(70,100),1300);assert.equal(x.snapshot().map.markers.length,1);
 x.send(0x8d00,hp(70,0),1400);assert.equal(x.snapshot().map.markers.length,0);
 x.send(0x3641,npc(),1500);assert.equal(x.snapshot().map.markers.length,1);
 x.send(0x3642,f.cat(f.vu(70),f.u8(0),f.u8(1)),1600);assert.equal(x.snapshot().map.markers.length,0);
 x.send(0x8d00,hp(70,100),1700);assert.equal(x.snapshot().map.markers.length,0,'Positive HP cannot invent a removed NPC');
 x.send(0x3641,npc(),1800);x.send(0x3647,f.cat(f.vu(70),f.u8(1),f.vu(0)),1900);assert.equal(x.snapshot().map.markers.length,0);
});

test('stream, map and self-appearance boundaries never project old NPCs into a new context',()=>{
 const x=fixture();x.send(0x3641,npc(),1100);
 x.send(0x3621,f.cat(f.i32(2),f.i32(88)),1200,'b');x.send(0x3641,npc({entity:70,position:{x:40,y:50,z:60}}),1300,'b');
 let markers=x.snapshot().map.markers;assert.deepEqual(markers.map(marker=>marker.mapId),[77,88]);assert.notEqual(markers[0].id,markers[1].id);
 x.send(0x3621,f.cat(f.i32(3),f.i32(99)),1400);markers=x.snapshot().map.markers;assert.deepEqual(markers.map(marker=>marker.mapId),[88]);
 x.send(0x3641,npc(),1500);x.send(0x3633,payload(f.self({x:10,y:20,z:30})),1600);assert.deepEqual(x.snapshot().map.markers.map(marker=>marker.mapId),[88]);
 x.detector.invalidate('b','stream-gap',1700);x.tracker.invalidate('b','stream-gap');assert.equal(x.snapshot().map.markers.length,0);
 x.send(0x371b,move(70),1800,'b');assert.equal(x.snapshot().map.markers.length,0,'Movement cannot revive a pre-gap entity');
 x.send(0x3641,npc(),1900,'b');assert.equal(x.snapshot().map.markers[0].mapId,88);
 x.detector.invalidate('b','connection-closed',2000);x.tracker.invalidate('b','connection-closed');assert.equal(x.snapshot().map.markers.length,0);
});

test('malformed spatial data clears only its own NPC stream and context-only invalidation also drops stale pins',()=>{
 const x=fixture();x.send(0x3641,npc(),1100);x.send(0x3621,f.cat(f.i32(2),f.i32(88)),1200,'b');x.send(0x3641,npc(),1300,'b');
 x.send(0x371b,Buffer.from([70]),1400);assert.deepEqual(x.snapshot().map.markers.map(marker=>marker.stream),['b']);assert.equal(x.tracker.errors,1);
 x.detector.invalidate('b','stream-silent',20000);assert.equal(x.snapshot().map.markers.length,0,'Detector tick/context invalidation cannot leave old NPC markers behind');
 x.tracker.invalidate(null,'capture-error');assert.equal(x.tracker.streams.size,0);
});

test('collection wiring identifies only self with decoded name/server and delegates raw pet opcodes separately',()=>{
 const x=fixture();const identification=x.collection.calls.find(call=>call[0]==='identify');
 assert.deepEqual(identification,['identify','a',{entity:7,name:'Ben',server:1},1000]);
 x.send(0x3645,payload(f.player(72,'Other')),1100);assert.equal(x.collection.calls.filter(call=>call[0]==='identify').length,1);
 x.committed({opcode:0x9000,payload:Buffer.alloc(0),events:[],at:1200});assert.ok(x.collection.calls.some(call=>call[0]==='message'&&call[2]===0x9000));
 assert.deepEqual(x.snapshot().collection,x.collection.snapshot());
 assert.ok(x.collection.calls.some(call=>call[0]==='invalidate'&&call[2]==='self-appearance'));
});

test('the committed FrameStream callback ordering binds NPCs after the detector establishes map identity',()=>{
 const x=fixture(),combat=[];const frame=new FrameStream(packet=>combat.push(...packet.events),()=>{},packet=>x.committed(packet));
 frame.push(f.cat(f.heartbeat(),f.heartbeat(),f.frame(0x3621,f.cat(f.i32(8),f.i32(99))),f.self({x:100,y:200,z:300}),f.frame(0x3641,npc()),f.frame(0x371b,move(70,{x:500,y:600,z:700}))),2000);
 const snapshot=x.snapshot();assert.equal(snapshot.map.markers.length,1);assert.equal(snapshot.map.markers[0].mapId,99);assert.equal(snapshot.map.markers[0].x,500);
 assert.equal(snapshot.map.markers[0].contextId,snapshot.map.contexts[0].id);assert.equal(combat.filter(event=>event.type==='spawn').length,1);
 assert.equal(combat.some(event=>event.type==='damage'),false,'Map observations cannot add combat damage');
});

test('real collection composition binds a pre-appearance snapshot only to the same flow and marks a framing gap stale',()=>{
 let now=1000;const detector=new CubeDetector({clock:()=>now}),tracker=new PetTracker({npcIds:new Set([npcId])});
 const send=(opcode,bytes,at)=>{now=at;const packet={...decodePacket(opcode,bytes,at),opcode,payload:bytes,at};detector.message(packet,'a');tracker.message(packet,'a',detector.context('a',at));};
 const snapshot=()=>tracker.snapshot(detector.snapshot().map.contexts).collection;
 send(0x3621,f.cat(f.i32(1),f.i32(77)),1000);
 const initial=f.cat(f.i32(0),f.vu(1),f.i32(1),f.i32(1002),f.i32(1),f.vu(1),f.i32(1002),f.i32(3),f.vu(0),f.vu(0),f.vu(0),f.u8(0));
 send(0x9000,initial,1050);assert.equal(snapshot().complete,false);assert.equal(snapshot().character,null);
 tracker.collection.identify('b',{entity:8,name:'Other',server:2},1075);assert.equal(snapshot().complete,false,'A different flow cannot consume the pending snapshot');
 send(0x3633,payload(f.self({x:100,y:200,z:300})),1100);
 assert.deepEqual(snapshot().character,{name:'Ben',server:1});assert.equal(snapshot().status,'live');assert.equal(snapshot().levels[1002],1);assert.equal(snapshot().souls[1002],3);
 detector.invalidate('a','stream-gap',1200);tracker.invalidate('a','stream-gap');assert.equal(snapshot().status,'unknown');
 send(0x900d,f.cat(f.vu(1),f.i32(1002),f.i32(2)),1250);assert.equal(snapshot().souls[1002],5);assert.equal(snapshot().status,'unknown','A retained delta is not proof of an unbroken collection stream');
 tracker.invalidate(null,'capture-stopped');assert.equal(snapshot().status,'unknown');
});

test('a dense capture is globally bounded across TCP flows and clearing one flow releases capacity',()=>{
 const x=fixture();x.send(0x3621,f.cat(f.i32(2),f.i32(88)),1100,'b');
 for(let index=0;index<=MAX_LIVE_PET_NPCS;index++)x.send(0x3641,npc({entity:10000+index}),2000+index,index%2?'b':'a');
 let markers=x.snapshot().map.markers;assert.equal(markers.length,MAX_LIVE_PET_NPCS);assert.equal(x.tracker.npcCount,MAX_LIVE_PET_NPCS);
 assert.equal(markers.some(marker=>marker.entity===10000),false,'Capacity evicts an old observation instead of growing per flow');
 x.tracker.invalidate('a','connection-closed');markers=x.snapshot().map.markers;assert.equal(x.tracker.npcCount,markers.length);assert.ok(markers.every(marker=>marker.stream==='b'));
 x.send(0x3641,npc({entity:55000}),10000);assert.equal(x.tracker.npcCount,markers.length+1);
 x.tracker.invalidate(null,'capture-stopped');assert.equal(x.tracker.npcCount,0);
});
