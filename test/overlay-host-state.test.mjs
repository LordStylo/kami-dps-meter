import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readHostState} from '../overlay/host-state.cjs';
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kami-host-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const file=path.join(directory,'host.json');fs.writeFileSync(file,JSON.stringify({pid:123,elevated:true}));return file;}
test('a confirmed dead process clears its stale marker for normal restart',t=>{
 const file=fixture(t);assert.deepEqual(readHostState(file,{probe:()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});}}),{running:null,alive:false});assert.equal(fs.existsSync(file),false);
});
test('a live or access-denied elevated overlay keeps its marker',t=>{
 const file=fixture(t);for(const probe of [()=>{},()=>{throw Object.assign(Error('denied'),{code:'EPERM'});}]){
  assert.equal(readHostState(file,{probe}).alive,true);assert.equal(fs.existsSync(file),true);
 }
});
test('a different instance replacing the marker during the probe is never removed',t=>{
 const file=fixture(t);readHostState(file,{probe:()=>{fs.writeFileSync(file,JSON.stringify({pid:456}));throw Object.assign(Error('gone'),{code:'ESRCH'});}});
 assert.equal(JSON.parse(fs.readFileSync(file)).pid,456);
});
test('invalid metadata is never passed to process control',t=>{
 const file=fixture(t);fs.writeFileSync(file,JSON.stringify({pid:-1}));assert.equal(readHostState(file,{probe:()=>assert.fail('invalid PID probed')}).alive,false);
 assert.equal(fs.existsSync(file),true);
});
