import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createInstallerHandoff,assertUpdateIdle,installedPackage} from '../src/installed-updater.mjs';

test('portable packages do not get an executable installer handoff',()=>{
  assert.equal(installedPackage(os.tmpdir()),false);
  assert.equal(createInstallerHandoff({root:os.tmpdir(),platform:'win32'}),undefined);
});
test('updates preserve fights, research recordings and manually timed dungeon runs',()=>{
  for(const state of [{combat:{active:true}},{combat:{encounterActive:true}},{research:{active:true}},{research:{armed:true}},{archive:{activeRun:{timingSource:'manual'}}}])assert.throws(()=>assertUpdateIdle(state),{status:409});
  assert.doesNotThrow(()=>assertUpdateIdle({archive:{activeRun:{timingSource:'observed'}}}));
});
test('only a verified staged installer launches the external helper, and never during combat',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kami-install-update-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'user data'),directory=path.join(dataDir,'updates','0.7.1');fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(root,'scripts'));
  fs.writeFileSync(path.join(root,'installed.json'),JSON.stringify({format:'kami-installed/1'}));fs.writeFileSync(path.join(root,'scripts','apply-update.ps1'),'# fixture');
  const file=path.join(directory,'Kami-DPS-Meter-Setup-0.7.1.exe'),bytes=Buffer.from('fixture, not an executable');fs.writeFileSync(file,bytes);
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');let state={},calls=[],failures=[],lastChild;
  const handoff=createInstallerHandoff({root,dataDir,port:4329,platform:'win32',getState:()=>state,onHandoffFailure:message=>failures.push(message),env:{SystemRoot:'C:\\Windows'},spawnProcess:(...args)=>{calls.push(args);const child=new EventEmitter();lastChild=child;child.unref=()=>{};const ack=args[1][args[1].indexOf('-AckFile')+1];queueMicrotask(()=>{child.emit('spawn');fs.writeFileSync(ack,'{');setTimeout(()=>fs.writeFileSync(ack,JSON.stringify({ok:true})),180);});return child;}});
  state={combat:{active:true}};await assert.rejects(handoff({installerPath:file,version:'0.7.1',sha256}),{status:409});assert.equal(calls.length,0);
  state={};await assert.rejects(handoff({installerPath:file,version:'0.7.1',sha256:'0'.repeat(64)}),{status:400});assert.equal(calls.length,0);
  const result=await handoff({installerPath:file,version:'0.7.1',sha256});assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0][2].windowsHide,true);assert.equal(calls[0][2].env.AION_DATA_DIR,dataDir);
  lastChild.emit('exit',1);assert.equal(failures.length,1);
  assert.ok(calls[0][1].includes('--port=4329')||calls[0][1].includes('4329'));
  const outside=path.join(root,'Kami-DPS-Meter-Setup-0.7.1.exe');fs.writeFileSync(outside,bytes);await assert.rejects(handoff({installerPath:outside,version:'0.7.1',sha256}),{status:400});assert.equal(calls.length,1);
});
