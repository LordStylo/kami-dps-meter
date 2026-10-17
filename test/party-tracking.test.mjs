import test from 'node:test';
import assert from 'node:assert/strict';
import {Meter} from '../src/meter.mjs';
import {decodePacket} from '../src/protocol/packets.mjs';
import {frameHeader,FrameStream} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';
const ingest=(meter,type,data,at=0)=>meter.ingest({type,at,...data});
const hit=(meter,actor,damage=1000,at=1000)=>ingest(meter,'damage',{actor,target:99,skill:11010000,damage},at);
const decode=frame=>{const h=frameHeader(frame);return decodePacket(h.opcode,frame.subarray(h.payloadOffset),1000);};
const member={entity:2,id:'123',name:'Friend',server:1,class:'Ranger'};

test('party and force HP messages retain membership evidence after full wire validation',()=>{
 for(const opcode of [0x921b,0x962b]){
  const frame=f.partyHp({opcode,entity:8});
  assert.deepEqual(decode(frame).events,[{type:'party-member',entity:8,hp:10000,maxHp:20000,at:1000}]);
  assert.equal(decode(frame).complete,true);
  const h=frameHeader(frame),payload=frame.subarray(h.payloadOffset);
  assert.throws(()=>decodePacket(opcode,payload.subarray(0,-1)));
  assert.throws(()=>decodePacket(opcode,Buffer.concat([payload,Buffer.from([0])])));
  assert.throws(()=>decode(f.partyHp({opcode,entity:0})));
 }
});

test('late membership restores already captured friend damage, without nearby strangers',()=>{
 const m=new Meter();
 ingest(m,'player',{entity:1,name:'Me',self:true});
 ingest(m,'player',member);ingest(m,'player',{entity:3,name:'Stranger',server:1});
 hit(m,1);hit(m,2,2000);hit(m,3,9000);
 assert.equal(m.snapshot().damage,1000);
 ingest(m,'party-member',{entity:2,hp:100,maxHp:200},1100);
 assert.equal(m.snapshot().damage,3000);
 assert.deepEqual(m.snapshot().players.map(p=>p.name),['Friend','Me']);
 assert.equal(m.snapshot({scope:'all'}).damage,12000);
 ingest(m,'party-left',{},1200);
 assert.equal(m.snapshot().damage,3000,'recovered damage retains its encounter membership after departure');
});

test('map changes discard entity IDs while retaining stable party identities',()=>{
 const m=new Meter();ingest(m,'roster',{members:[member]});
 ingest(m,'map',{map:101},100);
 assert.equal(m.party.size,0);assert.equal(m.entities.size,0);
 ingest(m,'player',{entity:2,name:'Stranger',server:1});hit(m,2,9000);
 ingest(m,'player',{entity:5,name:'Friend',server:2});hit(m,5,8000);
 ingest(m,'player',{entity:7,name:'Friend',server:1});hit(m,7,2000);
 assert.deepEqual(m.snapshot().players.map(p=>p.entity),[7]);
 assert.equal(m.snapshot().damage,2000);
});

test('membership learned from HP can bind a new entity after a zone change',()=>{
 const m=new Meter();ingest(m,'player',member);ingest(m,'party-member',{entity:2,hp:100,maxHp:200});
 ingest(m,'map',{map:101});ingest(m,'player',{entity:8,name:'Friend',server:1});hit(m,8);
 assert.equal(m.snapshot().damage,1000);
 // An omitted server field must not erase the verified identity.
 ingest(m,'player',{entity:8,name:'Friend',server:0});
 assert.equal(m.entities.get(8).server,1);
});

test('ordinary HP updates do not turn other players into party members',()=>{
 const m=new Meter();ingest(m,'player',member);ingest(m,'hp',{entity:2,hp:100,maxHp:200});hit(m,2);
 assert.equal(m.snapshot().damage,0);assert.equal(m.snapshot({scope:'all'}).damage,1000);
});

test('party HP can identify a player before their appearance and attributes pet damage',()=>{
 const m=new Meter();ingest(m,'party-member',{entity:2,hp:100,maxHp:200});hit(m,2);
 ingest(m,'spawn',{entity:3,owner:2});hit(m,3,2000);
 assert.equal(m.snapshot().damage,3000);
 ingest(m,'player',member);
 assert.equal(m.snapshot().players[0].name,'Friend');assert.equal(m.snapshot().players[0].petDamage,2000);
});

test('leaving, removing and replacing rosters prevents future cross-zone membership',()=>{
 for(const event of [{type:'party-left'},{type:'roster-remove',id:'123'},{type:'roster',members:[]}]){
  const m=new Meter();ingest(m,'roster',{members:[member]});m.ingest({...event,at:100});
  ingest(m,'map',{map:101});ingest(m,'player',{...member,entity:8});hit(m,8);
  assert.equal(m.snapshot().damage,0);assert.equal(m.roster.size,0);
 }
});

test('NPC and different-player reuse cannot inherit a party entity',()=>{
 for(const event of [{type:'spawn',entity:2,npc:999},{type:'player',entity:2,name:'Other',server:1},{type:'player',entity:2,name:'Friend',server:2}]){
  const m=new Meter();ingest(m,'roster',{members:[member]});m.ingest({...event,at:100});hit(m,2);
  assert.equal(m.snapshot().damage,0);assert.equal(m.party.has(2),false);
 }
});

test('completed party fights are immutable after party departure and zone changes',()=>{
 const m=new Meter();ingest(m,'roster',{members:[member]});hit(m,2);m.finish();
 ingest(m,'party-left',{});ingest(m,'map',{map:101});
 assert.equal(m.lastFight.snapshot().damage,1000);assert.equal(m.lastFight.roster.size,1);
});

test('framed combat with a missed roster recovers all five party players and excludes a sixth',()=>{
 const m=new Meter(),issues=[],stream=new FrameStream(p=>p.events.forEach(e=>m.ingest(e)),s=>issues.push(s));
 const frames=[f.heartbeat(),f.heartbeat(),...Array.from({length:6},(_,i)=>f.player(i+1,'Player'+(i+1))),...Array.from({length:6},(_,i)=>f.direct({actor:i+1,damage:(i+1)*1000})),...Array.from({length:5},(_,i)=>f.partyHp({entity:i+1}))];
 stream.push(f.cat(...frames),1000);
 const result=m.snapshot();assert.equal(result.players.length,5);assert.equal(result.damage,15000);assert.deepEqual(issues,[]);
 assert.equal(m.snapshot({scope:'all'}).damage,21000);
});
