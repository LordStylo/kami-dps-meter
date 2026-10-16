import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerPositionTracker,fitVisibilityPosition} from '../src/player-position.mjs';
import {readPositionObservation} from '../src/protocol/position.mjs';
import {CubeDetector,CUBE_TEMPLATE} from '../src/cube-detector.mjs';
import {cubeRepeatDue} from '../public/cube-alerts.js';
import {frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';
const center={x:3000,y:5000,z:100},seed={x:2900,y:4800,z:100};
const points=[{x:8500,y:5000},{x:3000,y:10500},{x:-2500,y:5000},{x:3000,y:-500}].map(p=>({...p,z:100}));
const body=frame=>frame.subarray(frameHeader(frame).payloadOffset);
const npc=(entity,position,reason=1)=>f.cat(f.vu(entity),f.u16(4),f.u8(0),f.i32(10001),f.state(position),f.vu(0),f.u8(reason));

test('visibility fit recovers known geometry and rejects collinear or contradictory evidence',()=>{
 const samples=points.map(position=>({position,radius:55}));
 const fit=fitVisibilityPosition(seed,samples);assert.ok(fit);assert.ok(Math.hypot(fit.position.x-center.x,fit.position.y-center.y)<1);
 assert.equal(fitVisibilityPosition(seed,samples.slice(0,3)),null);
 assert.equal(fitVisibilityPosition({x:0,y:0},[1,2,3,4].map(()=>({position:{x:5500,y:0},radius:55}))),null);
 assert.equal(fitVisibilityPosition(seed,[...samples,{position:{x:100000,y:100000},radius:55}]),null);
});

test('spatial readers reject schema drift and never treat a skill direction as a location',()=>{
 assert.deepEqual(readPositionObservation(0x3641,npc(10,center)),{kind:'npc',entity:10,template:10001,position:center,reason:1});
 const arrival=f.cat(Buffer.alloc(6),f.state(center).subarray(2,14),Buffer.alloc(6));
 assert.deepEqual(readPositionObservation(0x3623,arrival),{kind:'arrival',position:center});
 assert.equal(readPositionObservation(0x3623,arrival.subarray(1)),null);
 const changed=Buffer.from(arrival);changed[0]=1;assert.equal(readPositionObservation(0x3623,changed),null);
 assert.equal(readPositionObservation(0x3802,arrival),null);
 assert.throws(()=>readPositionObservation(0x3641,npc(10,{...center,x:NaN})));
 assert.throws(()=>readPositionObservation(0x3641,npc(10,center).subarray(0,20)));
});

test('tracker requires a seed and independent visibility references; stale, moving and respawning NPCs cannot sustain estimates',()=>{
 const t=new PlayerPositionTracker();
 points.forEach((position,i)=>t.observe({kind:'npc',entity:10+i,position,reason:1},'a',5000+i*300));
 assert.equal(t.status('a',6000).at,null);
 t.observe({kind:'self',entity:7,position:seed},'a',10000);
 points.forEach((position,i)=>t.observe({kind:'npc',entity:20+i,position,reason:6},'a',13000+i*300));
 assert.equal(t.status('a',15000).quality,'observed');assert.equal(t.status('a',15000).fresh,false);
 points.forEach((position,i)=>t.observe({kind:'npc',entity:30+i,position,reason:1},'a',16000+i*300));
 assert.equal(t.status('a',16900).quality,'estimated');assert.equal(t.status('a',19901).fresh,false);
 const at=t.status('a',16900).at;
 t.observe({kind:'move',entity:30,position:{x:0,y:0,z:0}},'a',17000);
 assert.equal(t.streams.get('a').edges.has(30),false);
 t.observe({kind:'remove',entity:30,reason:1},'a',17100);
 assert.equal(t.status('a',17100).at,at);
 t.invalidate('a');assert.equal(t.status('a',17200).at,null);
 assert.equal(t.proximity('other',center,17200).distance,null);
});

test('raw NPC and cube packets produce only fresh horizontal proximity without exporting XYZ',()=>{
 let now=1000;const d=new CubeDetector({clock:()=>now}),send=(opcode,payload)=>d.message({opcode,payload,at:now},'a');
 send(0x3633,body(f.self(seed)));
 const xyz=Buffer.alloc(12);xyz.writeFloatLE(4000);xyz.writeFloatLE(5000,4);xyz.writeFloatLE(99999,8);
 send(0x3634,f.cat(f.vu(40),f.u16(4),f.i32(CUBE_TEMPLATE),xyz,Buffer.alloc(34)));
 points.forEach((position,i)=>{now=4000+i*300;send(0x3641,npc(80+i,position));});
 const cube=d.snapshot().active[0];assert.equal(cube.proximity.quality,'estimated');assert.equal(cube.proximity.distance,10);
 assert.equal(cube.proximity.horizontal,true);assert.equal('position' in cube,false);assert.equal('x' in d.snapshot().position,false);
 now+=3001;assert.equal(d.snapshot().active[0].proximity.distance,null);
 send(0x3621,Buffer.alloc(8));assert.equal(d.snapshot().active.length,0);assert.equal(d.snapshot().position.at,null);
});

test('cube reminders repeat every three seconds without coordinates and stop for invalid presence or capture',()=>{
 const state={mode:'live',capture:{state:'capturing'},cubes:{active:[{id:'a',status:'present',proximity:null}]}};
 assert.equal(cubeRepeatDue(state,3999,1000),false);
 assert.equal(cubeRepeatDue(state,4000,1000),true);
 assert.equal(cubeRepeatDue(state,6999,4000),false);
 assert.equal(cubeRepeatDue(state,7000,4000),true);
 state.cubes.active[0].proximity={fresh:false,at:0,distance:null};
 assert.equal(cubeRepeatDue(state,7000,4000),true,'Stale position must not silence presence reminders');
 for(const capture of ['delayed','stalled','error','stopped'])assert.equal(cubeRepeatDue({...state,capture:{state:capture}},7000,4000),false);
 assert.equal(cubeRepeatDue({...state,mode:'replay'},7000,4000),false);
 for(const status of ['disappeared','uncertain']){
  state.cubes.active[0].status=status;assert.equal(cubeRepeatDue(state,7000,4000),false);
 }
 state.cubes.active=[];assert.equal(cubeRepeatDue(state,7000,4000),false);
});
