import test from 'node:test';
import assert from 'node:assert/strict';
import {CubeAlarm} from '../overlay/cube-alarm.cjs';
const state=(sequence=1,epoch='a')=>({mode:'live',capture:{state:'capturing'},cubes:{epoch,active:[{id:'cube'+sequence,sequence,status:'present'}]}});
test('only Start activates alerts, including a cube already present; polling never duplicates it',()=>{
 const a=new CubeAlarm();assert.equal(a.update(state(),true),false);assert.equal(a.snapshot().running,false);
 a.command('start');assert.equal(a.update(state(),true),true);
 for(let i=0;i<100;i++)assert.equal(a.update(state(),true),false);
 assert.equal(a.snapshot().alertVersion,1);
 a.command('stop');assert.equal(a.update(state(2),true),false);
 a.command('start');assert.equal(a.update(state(2),true),true);
});
test('muted detection still opens a new cube; hide is a layout action and does not stop monitoring',()=>{
 const a=new CubeAlarm();a.command('start');a.command('mute');
 assert.equal(a.update(state(),true),true);assert.equal(a.snapshot().muted,true);
 // Hiding the window sends no stop command. Same cube stays hidden; a new one opens.
 assert.equal(a.update(state(),true),false);assert.equal(a.update(state(2),true),true);
 assert.equal(a.snapshot().running,true);a.command('mute');assert.equal(a.snapshot().muted,false);
});
test('unhealthy traffic cannot open a panel; reconnect is deduplicated and new epochs are fresh',()=>{
 const a=new CubeAlarm();a.command('start');
 assert.equal(a.update(state(),false),false);assert.equal(a.update({...state(),mode:'demo'},true),false);
 assert.equal(a.update({...state(),capture:{state:'stalled'}},true),false);
 assert.equal(a.update(state(),true),true);assert.equal(a.update(state(),false),false);assert.equal(a.update(state(),true),false);
 assert.equal(a.update(state(1,'b'),true),true);assert.equal(a.command('unknown'),false);
});
