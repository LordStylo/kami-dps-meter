import test from 'node:test';
import assert from 'node:assert/strict';
import {CubeMapVisibility} from '../overlay/cube-map-visibility.cjs';

const state=(sequence=1,epoch='a')=>({mode:'live',capture:{state:'capturing'},cubes:{epoch,active:[{id:'cube'+sequence,sequence,status:'present'}]}});

test('a current present cube opens the map independently of alarm running or mute and polls never reopen it',()=>{
 const visibility=new CubeMapVisibility();
 assert.equal(visibility.update({...state(),cubeAlarm:{running:false,muted:true}},true),true);
 for(let i=0;i<100;i++)assert.equal(visibility.update(state(),true),false);
 assert.equal(visibility.update({...state(),cubes:{epoch:'a',active:[]}},true),false);
 assert.equal(visibility.update(state(),true),false,'A stale repeated cube cannot revive a manually hidden map');
 assert.equal(visibility.update(state(2),true),true);
});

test('unhealthy snapshots form a silent baseline while new detections and epochs remain eligible',()=>{
 for(const capture of ['delayed','stalled','error','stopped']){
  const visibility=new CubeMapVisibility();assert.equal(visibility.update({...state(),capture:{state:capture}},true),false);
  assert.equal(visibility.update(state(),true),false);assert.equal(visibility.update(state(2),true),true);
 }
 const visibility=new CubeMapVisibility();assert.equal(visibility.update(state(),false),false);assert.equal(visibility.update(state(),true),false);
 assert.equal(visibility.update(state(2),true),true);assert.equal(visibility.update(state(1,'b'),true),true);
 assert.equal(visibility.update(state(1,'b'),false),false);assert.equal(visibility.update(state(1,'b'),true),false);
});

test('recent, uncertain, replay and invalid detections cannot open the map',()=>{
 const visibility=new CubeMapVisibility();
 assert.equal(visibility.update({...state(),mode:'replay'},true),false);assert.equal(visibility.update(state(),true),false);
 for(const entry of [{id:'cube2',sequence:2,status:'uncertain'},{id:'cube2',sequence:2,status:'disappeared'},{id:'cube2',sequence:NaN,status:'present'},{id:'',sequence:2,status:'present'}]){
  assert.equal(visibility.update({...state(),cubes:{epoch:'a',active:[entry],recent:[{id:'cube3',sequence:3,status:'present'}]}},true),false);
 }
 assert.equal(visibility.update({mode:'live',capture:{state:'capturing'},cubes:{active:state().cubes.active}},true),false);
 assert.equal(visibility.update(state(2),true),true);
});

test('old capture status cannot open a map even when its label still says capturing',()=>{
 const visibility=new CubeMapVisibility();
 assert.equal(visibility.update({...state(),capture:{state:'capturing',statusAgeMs:2501}},true),false);
 assert.equal(visibility.update({...state(),capture:{state:'capturing',statusAgeMs:0}},true),false,'Refreshing status alone cannot replay a stale detection');
 assert.equal(visibility.update({...state(2),capture:{state:'capturing',statusAgeMs:2500}},true),true);
 const compatible=new CubeMapVisibility();assert.equal(compatible.update(state(),true),true,'Missing age remains compatible with older backends');
});

test('saved detection watermark prevents the same hidden cube reopening after a host restart',()=>{
 const first=new CubeMapVisibility();assert.equal(first.update(state(7),true),true);
 const restored=new CubeMapVisibility(first.snapshot());assert.equal(restored.update(state(7),true),false);
 assert.equal(restored.update(state(8),true),true);assert.equal(restored.update(state(1,'new-backend'),true),true);
 for(const saved of [{epoch:'a',sequence:-1},{epoch:'a',sequence:Infinity},{epoch:null,sequence:1},{epoch:'a',sequence:'7'}]){
  assert.equal(new CubeMapVisibility(saved).update(state(7),true),true,'Malformed saved metadata cannot suppress a first detection');
 }
});
