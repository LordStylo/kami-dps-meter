import test from 'node:test';
import assert from 'node:assert/strict';
import {CubeProximityTracker} from '../src/cube-proximity.mjs';
import {CubeDetector,CUBE_TEMPLATE} from '../src/cube-detector.mjs';
import {cubeRepeatDue} from '../public/cube-alerts.js';
import {frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';

const cube={x:10000,y:0};
function fixture(quality='observed'){
  const tracker=new CubeProximityTracker();let status;
  const sample=(at,x,overrides={})=>{
    status={fresh:true,usableForTrend:true,quality,source:quality==='observed'?'move':'visibility',generation:1,revision:at,at,...overrides};
    tracker.observe('cube','a',cube,status,{x:x*100,y:0},at);return read(at);
  };
  const read=now=>tracker.snapshot('cube',{...status,distance:50,horizontal:true},now);
  return {tracker,sample,read};
}

test('distinct fresh own updates produce approaching/receding while polling and duplicate revisions cannot create samples',()=>{
  const x=fixture();assert.equal(x.sample(1000,0).trend,'unknown');
  assert.equal(x.sample(1500,2).trend,'approaching');assert.equal(x.read(1500).changeMeters,-2);
  const count=x.read(1500).sampleCount;
  for(let at=1501;at<1800;at++)assert.equal(x.read(at).sampleCount,count);
  x.tracker.observe('cube','a',cube,{fresh:true,usableForTrend:true,quality:'observed',source:'move',generation:1,revision:1500,at:1500},{x:200,y:0},1800);
  assert.equal(x.read(1800).sampleCount,count);
  assert.equal(x.sample(2000,0).trend,'receding');
});

test('500ms minimum samples, displacement deadband and wider estimated thresholds suppress jitter',()=>{
  const x=fixture();x.sample(1000,0);
  assert.equal(x.sample(1200,2).trend,'unknown');assert.equal(x.sample(1499,2).sampleCount,1);
  assert.equal(x.sample(1500,2).trend,'approaching');
  assert.equal(x.sample(2000,2.4).trend,'steady');
  const estimate=fixture('estimated');estimate.sample(1000,0);
  assert.equal(estimate.sample(1500,2).trend,'steady');
  assert.equal(estimate.sample(2000,7).trend,'approaching');
});

test('slow walking accumulates distinct subthreshold steps within a bounded three-second window',()=>{
  const x=fixture();x.sample(1000,0);
  assert.equal(x.sample(1500,.6).trend,'steady');assert.equal(x.sample(2000,1.2).trend,'steady');
  assert.equal(x.sample(2500,1.8).trend,'approaching');assert.equal(x.read(2500).changeMeters,-1.8);
  const jitter=fixture();jitter.sample(1000,0);
  for(let n=1;n<=12;n++)assert.equal(jitter.sample(1000+n*500,n%2?.4:0).trend,'steady');
  assert.equal(jitter.sample(11001,2).trend,'unknown');assert.equal(jitter.read(11001).trendReason,'position-gap');
});

test('hysteresis can retain a direction for smaller radial changes but never reverses on jitter',()=>{
  const t=new CubeProximityTracker(),sample=(at,p)=>{
    const s={fresh:true,usableForTrend:true,quality:'observed',source:'move',generation:1,revision:at,at};
    t.observe('x','a',{x:10000,y:0},s,p,at);return t.snapshot('x',{...s,distance:1},at);
  };
  sample(1000,{x:0,y:0});assert.equal(sample(1500,{x:200,y:0}).trend,'approaching');
  // Two metres lateral + one metre closer: radial change is below enter=1.5.
  assert.equal(sample(2000,{x:300,y:200}).trend,'approaching');
  assert.equal(sample(2500,{x:250,y:200}).trend,'steady');
});

test('gaps, stale data, source/quality changes, generations, jumps, backwards times and unusable anchors reset comparison',()=>{
  for(const [label,overrides]of [
    ['generation',{generation:2}],['source',{source:'arrival'}],['quality',{quality:'estimated'}],
  ]){
    const x=fixture();x.sample(1000,0);x.sample(1500,2);
    assert.equal(x.sample(2000,4,overrides).trend,'unknown',label);
    assert.equal(x.read(2000).trendReason,'position-reset');
  }
  const gap=fixture();gap.sample(1000,0);assert.equal(gap.sample(4001,10).trendReason,'position-gap');
  const jump=fixture();jump.sample(1000,0);assert.equal(jump.sample(1500,50).trendReason,'position-jump');
  const reverse=fixture();reverse.sample(1000,0);assert.equal(reverse.sample(1500,2,{at:900}).trendReason,'time-not-increasing');
  const stale=fixture();stale.sample(1000,0);stale.sample(1500,2);
  const staleView=stale.tracker.snapshot('cube',{fresh:false,at:1500,distance:null},5000);
  assert.equal(staleView.trend,'unknown');assert.equal(staleView.trendReason,'position-stale');
  assert.equal(stale.sample(5500,4).trend,'unknown');
  const unusable=fixture();unusable.sample(1000,0);assert.equal(unusable.sample(1500,2,{usableForTrend:false}).trend,'unknown');
  const orphan=fixture();orphan.sample(1000,0);orphan.sample(1500,2);
  assert.equal(orphan.tracker.snapshot('cube',{fresh:true,at:5001,distance:20,quality:'observed',source:'move',generation:1},5001).trendReason,'trend-stale');
});

test('cube identity/stream boundaries and disappearance keep samples independent',()=>{
  const x=fixture();x.sample(1000,0);x.sample(1500,2);
  const status={fresh:true,quality:'observed',source:'move',generation:1,revision:2000,at:2000};
  x.tracker.observe('other','a',cube,status,{x:400,y:0},2000);
  assert.equal(x.tracker.snapshot('other',{...status,distance:96},2000).trend,'unknown');
  x.tracker.observe('cube','b',cube,status,{x:400,y:0},2000);
  assert.equal(x.tracker.snapshot('cube',{...status,distance:96},2000).trendReason,'stream-changed');
  x.tracker.remove('cube');assert.equal(x.tracker.states.has('cube'),false);
});

test('detector exposes trend only on actual position updates and preserves cube presence/sound when location goes stale',()=>{
  let now=1000;const detector=new CubeDetector({clock:()=>now}),body=frame=>frame.subarray(frameHeader(frame).payloadOffset);
  const send=(opcode,payload)=>detector.message({opcode,payload,at:now},'a');
  send(0x3633,body(f.self({x:0,y:0,z:0})));
  const xyz=Buffer.alloc(12);xyz.writeFloatLE(10000,0);
  const appear=entity=>f.cat(f.vu(entity),f.u16(4),f.i32(CUBE_TEMPLATE),xyz,Buffer.alloc(34));
  send(0x3634,appear(40));
  const position=(at,x)=>{
    now=at;send(0x371a,f.cat(f.vu(7),f.u8(0),f.u8(0),f.state({x,y:0,z:0}).subarray(2,14),Buffer.alloc(2)));
  };
  position(1500,100);position(2000,300);
  let state=detector.snapshot();assert.equal(state.active[0].proximity.trend,'approaching');
  const count=state.active[0].proximity.sampleCount;
  for(let n=0;n<10;n++)assert.equal(detector.snapshot().active[0].proximity.sampleCount,count);
  now=2100;send(0x3634,appear(41));
  state=detector.snapshot();assert.deepEqual(state.active.map(c=>c.sequence),[1,2]);
  assert.equal(state.active[1].proximity.trend,'unknown');
  now=5001;state=detector.snapshot();assert.equal(state.active.length,2);assert.equal(state.active[0].proximity.distance,null);
  assert.equal(state.active[0].proximity.trend,'unknown');
  assert.equal(cubeRepeatDue({mode:'live',capture:{state:'capturing'},cubes:state},5001,0),true);
  send(0x3635,f.cat(f.vu(40),f.u8(4),f.u8(3),f.u8(0)));
  assert.equal(detector.proximity.states.size,1);
  detector.invalidate('a','stream-gap');assert.equal(detector.proximity.states.size,0);
});

test('finite but out-of-range cube coordinates suppress spatial hints while presence reminders remain valid',()=>{
  let now=1000;const detector=new CubeDetector({clock:()=>now}),body=frame=>frame.subarray(frameHeader(frame).payloadOffset);
  detector.message({opcode:0x3633,payload:body(f.self({x:0,y:0,z:0})),at:now},'a');
  const xyz=Buffer.alloc(12);xyz.writeFloatLE(1e20,0);
  detector.message({opcode:0x3634,payload:f.cat(f.vu(40),f.u16(4),f.i32(CUBE_TEMPLATE),xyz,Buffer.alloc(34)),at:now},'a');
  const state=detector.snapshot();assert.equal(state.active.length,1);assert.equal(state.active[0].proximity.distance,null);
  assert.equal(state.active[0].proximity.trend,'unknown');assert.equal(cubeRepeatDue({mode:'live',capture:{state:'capturing'},cubes:state},4000,0),true);
});
