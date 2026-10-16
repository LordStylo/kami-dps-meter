import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CubeRecorder} from '../src/research/cube-recorder.mjs';
import {analyzeCubeFile,worldObjects} from '../src/research/cube-analysis.mjs';
import {readWorldEvidence,objectChains} from '../src/research/world-evidence.mjs';
import {FrameStream,frameHeader} from '../src/protocol/framing.mjs';
import {TcpStream} from '../src/capture/tcp.mjs';
import * as f from './wire-fixtures.mjs';

function setup(t,limits={}){
  const root=path.resolve('tmp');fs.mkdirSync(root,{recursive:true});
  const dir=fs.mkdtempSync(path.join(root,'cube-test-'));
  let now=100000;
  const r=new CubeRecorder(path.join(dir,'captures'),{clock:()=>now,...limits});
  t.after(()=>{r.stop();assert.ok(path.resolve(dir).startsWith(root+path.sep+'cube-test-'));fs.rmSync(dir,{recursive:true,force:true});});
  return {r,dir,set:n=>now=n,send:(opcode=0xabcd,payload=Buffer.from([1,2]))=>r.message({at:now,opcode,payload,known:false,complete:false},'flow-1'),
    file:()=>path.join(r.directory,r.status().id+'.ndjson'),rows:()=>fs.readFileSync(path.join(r.directory,r.status().id+'.ndjson'),'utf8').trim().split('\n').map(JSON.parse)};
}
test('research observer only emits committed frames once, including unknown and bad known leaves',()=>{
  const seen=[],issues=[],stream=new FrameStream(()=>{},e=>issues.push(e),p=>seen.push(p));
  stream.push(f.heartbeat(),1);assert.equal(seen.length,0);
  const raw=f.cat(f.heartbeat(),f.bundle(f.frame(0xabcd,Buffer.from([9])),f.frame(0x3804,Buffer.from([0])),f.direct()));
  stream.push(raw,2);assert.deepEqual(seen.map(p=>p.opcode),[0x3600,0x3600,0xabcd,0x3804,0x3804]);
  assert.equal(seen[2].payload.toString('hex'),'09');assert.ok(seen[3].error);
  const n=seen.length;
  stream.push(f.bundle(f.direct(),Buffer.from([255])),3);assert.equal(seen.length,n,'Broken bundle must emit no partial leaves');
  const unknown=[];new FrameStream(()=>{},()=>{},p=>unknown.push(p)).push(f.frame(0xabcd,Buffer.from([9])),0);
  assert.deepEqual(unknown,[],'Unsynchronized data is never recorded');
});
test('TCP retransmission does not duplicate research messages',()=>{
  const seen=[],frames=new FrameStream(()=>{},()=>{},p=>seen.push(p));
  const tcp=new TcpStream((b,at)=>frames.push(b,at),()=>frames.gap());
  const raw=f.cat(f.heartbeat(),f.heartbeat(),f.frame(0xabcd,Buffer.from([5])));
  tcp.push(100,raw,false,1);tcp.push(100,raw,false,2);assert.equal(seen.length,3);
});
test('opt-in rolling buffer never writes until found and expires old data',t=>{
  const x=setup(t);x.send();assert.equal(x.r.status().bufferMessages,0);
  x.r.arm();x.send();x.set(160001);x.send(0xabce);
  assert.equal(fs.existsSync(x.r.directory),false);assert.equal(x.r.status().bufferMessages,1);
  x.r.found({state:'capturing'});x.r.stop();
  assert.deepEqual(x.rows().filter(r=>r.kind==='message').map(r=>r.opcode),[0xabce]);
  assert.deepEqual(x.rows().filter(r=>r.kind==='marker').map(r=>r.phase),['baseline','near']);
  assert.equal(x.rows()[0].capture.state,'capturing');
});
test('memory cap clips prebuffer and known identity payloads are omitted',t=>{
  const x=setup(t,{maxBufferBytes:600});x.r.arm();
  for(let n=0;n<20;n++)x.send();
  assert.ok(x.r.status().bufferBytes<=600);assert.equal(x.r.status().bufferClipped,true);
  x.send(0x3645,Buffer.from('secret-player-name'));x.r.opened();x.r.stop();
  assert.equal(x.rows()[0].prebuffer.clipped,true);
  const identity=x.rows().find(r=>r.opcode===0x3645);assert.equal(identity.payload,undefined);assert.equal(identity.payloadOmitted,'identity');
  assert.equal(fs.readFileSync(x.file(),'utf8').includes('secret-player-name'),false);
});
test('delayed adapter packets use their timestamps and expired payloads are excluded',t=>{
  const x=setup(t);x.r.arm();x.send();x.set(120000);x.send();
  x.r.message({at:90000,opcode:0xabcd,payload:Buffer.from([1])},'flow-2');
  x.r.message({at:1,opcode:0xabcd,payload:Buffer.from([1])},'flow-2');
  x.r.found();x.r.stop();assert.equal(x.rows()[0].at,90000);
  assert.deepEqual(x.rows().filter(r=>r.kind==='message').map(r=>r.at),[100000,120000,90000]);
});
test('rushed open without found preserves prebuffer and stops automatically',t=>{
  const x=setup(t);x.r.arm();x.send();x.set(110000);x.r.opened();x.send();
  assert.equal(x.r.status().autoStopAt,140000);x.set(139999);x.r.tick();assert.equal(x.r.active,true);
  x.set(140000);x.r.tick();assert.equal(x.r.active,false);assert.equal(x.r.status().reason,'post-open-complete');
  assert.equal(x.rows().filter(r=>r.kind==='message').length,2);
  assert.equal(x.rows().at(-1).kind,'end');assert.equal(x.r.armed,false);
  assert.ok(fs.existsSync(x.file().replace('.ndjson','.summary.json')));
});
test('automatic alert annotations survive prebuffer and analysis without changing packet counts',async t=>{
  const x=setup(t);x.r.arm();x.send();x.r.annotation({kind:'cube-alert',event:'appeared',at:100000,template:1200039,entity:40});
  x.set(101000);x.r.found();x.r.opened();x.r.stop();
  const report=await analyzeCubeFile(x.file());assert.equal(report.messages,1);
  assert.equal(report.automaticAlerts.length,1);assert.equal(report.automaticAlerts[0].event,'appeared');
  assert.ok(report.automaticAlerts[0].at<report.phases.find(p=>p.phase==='near').at);
});
test('manual cancel discards memory, invalid phases fail, disk and time caps finalize files',t=>{
  const x=setup(t,{maxBytes:6000,maxDurationMs:1000});x.r.arm();x.send();x.r.stop();
  assert.equal(fs.existsSync(x.r.directory),false);assert.equal(x.r.status().bufferMessages,0);
  assert.throws(()=>x.r.found());x.r.start();assert.throws(()=>x.r.mark('__proto__'));assert.throws(()=>x.r.arm());
  x.send(0xabcd,Buffer.alloc(3000));assert.equal(x.r.status().reason,'size-limit');
  assert.ok(fs.statSync(x.file()).size<=6000);assert.equal(x.rows().at(-1).kind,'end');
  x.r.start();x.set(101000);x.r.tick();assert.equal(x.r.status().reason,'time-limit');
});
test('disk failures close recorder and retain a useful error',t=>{
  const x=setup(t);x.r.start();fs.closeSync(x.r.fd);x.send();
  assert.equal(x.r.active,false);assert.equal(x.r.status().reason,'write-error');assert.match(x.r.status().error,/yazılamadı/);
});
test('map schema validates complete payload but makes no proximity claim',()=>{
  const bytes=f.cat(f.u16(0),f.i32(11),f.vu(0),f.vu(0),f.vu(0),f.vu(1),f.vu(50),f.i32(999),Buffer.alloc(12));
  assert.deepEqual(worldObjects(bytes),{result:0,mapId:11,objects:[{entity:50,template:999}]});
  assert.throws(()=>worldObjects(bytes.subarray(0,-1)));assert.throws(()=>worldObjects(f.cat(bytes,f.u8(0))));
});
test('analysis separates repeated phases, decodes object evidence, warns on gaps',async t=>{
  const x=setup(t);x.r.arm();x.send();x.set(101000);x.r.found();
  const npc=f.npc();x.send(0x3641,npc.subarray(frameHeader(npc).payloadOffset));
  x.set(102000);x.r.mark('far');x.send();x.set(103000);x.r.mark('near');x.send();
  x.set(104000);x.r.opened();x.r.issue('stream-gap','flow-1');x.send(0x3642,f.cat(f.vu(70),f.u8(0),f.u8(1)));
  x.send(0x9101,f.cat(f.u16(0),f.i32(11),f.vu(0),f.vu(0),f.vu(0),f.vu(1),f.vu(50),f.i32(999),Buffer.alloc(12)));
  x.set(105000);x.r.stop();
  const report=await analyzeCubeFile(x.file());
  assert.deepEqual(report.phases.map(p=>p.phase),['baseline','near','far','near','opened']);
  assert.deepEqual(report.phases.map(p=>p.messages),[1,1,1,1,2]);
  assert.deepEqual(report.observations.map(o=>o.kind),['spawn','removed','map-snapshot','map-object']);
  assert.equal(report.observations[0].template,10001);assert.equal(report.observations.at(-1).template,999);
  assert.equal(report.issues['stream-gap'],1);assert.ok(report.warnings.length);assert.match(report.conclusion,/doğrulanmadı/);
  assert.equal(report.opcodes.find(p=>p.opcode==='0xabcd').rates[0].perSecond,1);
});
test('empty and interrupted research files never imply a validated detector',async t=>{
  const x=setup(t);x.r.start();x.r.stop();
  let report=await analyzeCubeFile(x.file());assert.ok(report.warnings.some(w=>w.includes('Hiç oyun mesajı')));
  const rows=x.rows().filter(r=>r.kind!=='end');fs.writeFileSync(x.file(),rows.map(r=>JSON.stringify(r)).join('\n')+'\n{"broken');
  report=await analyzeCubeFile(x.file());assert.ok(report.warnings.some(w=>w.includes('tamamlanmamış')));assert.ok(report.warnings.some(w=>w.includes('bozuk satır')));
});
test('research world prefix retains template identity without exporting coordinates or claiming full validation',()=>{
  const bytes=f.cat(f.vu(40),f.u16(4),f.i32(1234567),Buffer.alloc(12),Buffer.alloc(34));
  const [event]=readWorldEvidence(0x3634,bytes);
  assert.equal(event.entity,40);assert.equal(event.template,1234567);assert.equal(event.unparsedBytes,34);
  assert.equal(event.validation,'empirical-prefix');assert.equal('position' in event,false);
  assert.throws(()=>readWorldEvidence(0x3634,bytes.subarray(0,5)));
  assert.deepEqual(readWorldEvidence(0x3635,f.cat(f.vu(40),f.u8(4),f.u8(3),f.u8(0)))[0].tail,[4,3,0]);
  assert.throws(()=>readWorldEvidence(0x3635,f.cat(f.vu(40),Buffer.alloc(4))));
});
test('interaction and inventory readers link required item while discarding inventory identity',()=>{
  const [result]=readWorldEvidence(0x363a,f.cat(f.vu(40),f.vu(7),f.i32(1),f.i32(987654)));
  assert.equal(result.entity,40);assert.equal(result.actor,7);assert.equal(result.item,987654);
  const modification=f.cat(f.vu(1),f.u8(1),f.u8(0),f.i64(555),f.i32(987654),f.i64(3),f.u8(1),f.i32(8),f.u8(0),f.str('private-maker'),f.i64(0),f.u8(0),f.u8(54),f.u8(0));
  const [item]=readWorldEvidence(0x561b,modification);assert.equal(item.decreaseReason,54);assert.equal(item.item,987654);
  assert.equal(JSON.stringify(item).includes('private-maker'),false);assert.equal('itemKey' in item,false);
  assert.throws(()=>readWorldEvidence(0x363a,f.cat(f.vu(40),f.vu(7),f.i32(1))));
});
test('object evidence joins by instance and stream, rather than coincident loot alone',()=>{
  const context={stream:'a',entity:40};
  const events=[{...context,at:1,kind:'object-appear-prefix',template:1234567},
    {...context,at:10,kind:'object-interaction-start'},
    {...context,at:20,kind:'object-interaction-response',result:0},
    {...context,at:1010,kind:'object-interaction-result',item:987654},
    {stream:'a',at:1000,kind:'inventory-change',item:987654,decreaseReason:54},
    {...context,at:1020,kind:'drop-source-prefix'},
    {...context,at:1021,kind:'drop-source-prefix',stream:'b'},
    {...context,at:1022,kind:'drop-source-prefix',entity:99},
    {...context,at:1023,kind:'drop-source-prefix'},
    {...context,at:1200,kind:'object-disappear',tail:[4,3,0]}];
  const [chain]=objectChains(events);assert.equal(chain.template,1234567);assert.equal(chain.dropMessages,2);
  assert.equal(chain.interactionRequirementConsumed,true);assert.equal(chain.disappearAt,1200);
  const [withoutConsumption]=objectChains(events.filter(e=>e.kind!=='inventory-change'));
  assert.equal(withoutConsumption.interactionRequirementConsumed,false);
});
