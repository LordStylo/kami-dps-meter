import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {PetOverlayBridge} from '../src/pet-overlay-bridge.mjs';

const pets=[{id:1002,mapIds:[1010,600001]},{id:1046,mapIds:[1110]}],maps=[{id:1010},{id:1110}];
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
async function fixture(t,{host=true,features=['pet-map-overlay'],...options}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kami-pet-bridge-'));
  t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
  if(host)await fs.writeFile(path.join(directory,'host.json'),JSON.stringify({pid:process.pid,features}));
  return {directory,bridge:new PetOverlayBridge({directory,pets,maps,...options})};
}
async function requestAt(directory){
  const deadline=Date.now()+1800;
  while(Date.now()<deadline){try{return JSON.parse(await fs.readFile(path.join(directory,'pet-map.request'),'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}await delay(5);}
  throw Error('Test request did not arrive');
}
async function ack(directory,value){
  const filename=path.join(directory,'pet-map.response');await fs.writeFile(filename+'.tmp',JSON.stringify(value));await fs.rename(filename+'.tmp',filename);
}
const isStatus=status=>error=>error.status===status;

test('pet overlay bridge writes only a bounded fixed request and succeeds only after the matching host acknowledgement',async t=>{
  const {directory,bridge}=await fixture(t),result=bridge.select({petId:1002,mapId:1010});
  const request=await requestAt(directory);
  assert.deepEqual(Object.keys(request).sort(),['at','mapId','petId','requestId']);assert.match(request.requestId,uuid);assert.equal(request.petId,1002);assert.equal(request.mapId,1010);assert.ok(Math.abs(Date.now()-request.at)<10000);
  await ack(directory,{requestId:request.requestId,ok:true,petId:1002,mapId:1010});
  assert.deepEqual(await result,{requestId:request.requestId,ok:true,petId:1002,mapId:1010});
  assert.deepEqual(await fs.readdir(directory),['host.json']);
});

test('pet and map inputs accept only catalogue numeric IDs and never provide file paths',async t=>{
  const {directory,bridge}=await fixture(t);
  for(const value of[null,[],{},1002,{petId:'1002'},{petId:0},{petId:999999},{petId:1002,mapId:'1010'},{petId:1002,mapId:null},{petId:1002,mapId:999},{petId:1002,path:'../outside'},{petId:1002,requestId:randomUUID()}])await assert.rejects(bridge.select(value),isStatus(400));
  assert.deepEqual(bridge.validate({petId:1002,mapId:600001}),{petId:1002,mapId:600001},'A pet spawn map without a local image is still a known map');
  assert.deepEqual(bridge.validate({petId:1046,mapId:1010}),{petId:1046,mapId:1010},'A known current world can be selected even without static spawns for that pet');
  assert.deepEqual(await fs.readdir(directory),['host.json']);
});

test('a missing or older overlay returns a clear failure without queueing a fake success',async t=>{
  for(const options of[{host:false},{features:[]}]){
    const {directory,bridge}=await fixture(t,options);
    await assert.rejects(bridge.select({petId:1002}),error=>error.status===503&&/overlay/i.test(error.message));
    assert.equal((await fs.readdir(directory)).includes('pet-map.request'),false);
  }
});

test('requests are serialized and a stale response cannot acknowledge a newer pet selection',async t=>{
  const {directory,bridge}=await fixture(t),pending=bridge.select({petId:1002});
  const request=await requestAt(directory);await assert.rejects(bridge.select({petId:1046}),isStatus(409));
  let settled=false;pending.then(()=>{settled=true;},()=>{settled=true;});
  await ack(directory,{requestId:randomUUID(),ok:true,petId:1002,mapId:null});await delay(60);assert.equal(settled,false);
  await ack(directory,{requestId:request.requestId,ok:true,petId:1002,mapId:null});assert.equal((await pending).mapId,null);
  const next=bridge.select({petId:1046}),nextRequest=await requestAt(directory);assert.notEqual(nextRequest.requestId,request.requestId);
  await ack(directory,{requestId:nextRequest.requestId,ok:true,petId:1046});assert.equal((await next).petId,1046);
});

test('wrong pet/map acknowledgements and host failures cannot report an opened overlay',async t=>{
  for(const fields of[{ok:true,petId:1046,mapId:1010},{ok:true,petId:1002,mapId:1110},{ok:true,petId:1002,mapId:999},{ok:'true',petId:1002,mapId:1010},{ok:false,error:'Pet seçilemedi'}]){
    const {directory,bridge}=await fixture(t),pending=bridge.select({petId:1002,mapId:1010}),request=await requestAt(directory);
    await ack(directory,{requestId:request.requestId,...fields});await assert.rejects(pending,isStatus(502));
    assert.deepEqual(await fs.readdir(directory),['host.json']);
  }
});

test('timeout cleans up only its own request and leaves unrelated request/response files untouched',async t=>{
  const {directory,bridge}=await fixture(t,{timeoutMs:180,pollMs:5}),pending=bridge.select({petId:1002});
  await requestAt(directory);
  const foreign={petId:1046,requestId:randomUUID(),at:Date.now()},response={requestId:randomUUID(),ok:true,petId:1046};
  await fs.writeFile(path.join(directory,'pet-map.request'),JSON.stringify(foreign));await ack(directory,response);
  await assert.rejects(pending,isStatus(504));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'pet-map.request'),'utf8')),foreign);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'pet-map.response'),'utf8')),response);
});

test('a fresh foreign request is preserved, while a request older than ten seconds can be replaced',async t=>{
  const {directory,bridge}=await fixture(t),filename=path.join(directory,'pet-map.request'),foreign={requestId:randomUUID(),petId:1046,at:Date.now()};
  await fs.writeFile(filename,JSON.stringify(foreign));await assert.rejects(bridge.select({petId:1002}),isStatus(409));assert.deepEqual(JSON.parse(await fs.readFile(filename,'utf8')),foreign);
  await fs.writeFile(filename,JSON.stringify({...foreign,at:Date.now()-10001}));
  const pending=bridge.select({petId:1002});let request;
  for(let i=0;i<100;i++){request=await requestAt(directory);if(request.requestId!==foreign.requestId)break;await delay(5);}
  assert.notEqual(request.requestId,foreign.requestId);await ack(directory,{requestId:request.requestId,ok:true,petId:1002});assert.equal((await pending).ok,true);
});

test('oversized or malformed host responses are bounded and time out without mutating other files',async t=>{
  const {directory,bridge}=await fixture(t,{timeoutMs:180,pollMs:5}),pending=bridge.select({petId:1002});
  await requestAt(directory);await fs.writeFile(path.join(directory,'pet-map.response'),'x'.repeat(10000));
  await assert.rejects(pending,isStatus(504));assert.equal((await fs.readFile(path.join(directory,'pet-map.response'))).length,10000);
  assert.equal((await fs.readdir(directory)).includes('pet-map.request'),false);
});

test('same-origin HTTP pet overlay route validates inputs, waits for a real host and preserves meter/archive state',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'kami-pet-bridge-http-')),profile=path.join(directory,'overlay');await fs.mkdir(profile);
  await fs.writeFile(path.join(profile,'host.json'),JSON.stringify({pid:process.pid,features:['pet-map-overlay']}));
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const cwd=fileURLToPath(new URL('..',import.meta.url)),child=spawn(process.execPath,['src/server.mjs','--idle'],{cwd,windowsHide:true,env:{...process.env,AION_METER_PORT:String(port),AION_HISTORY_DIR:path.join(directory,'archive'),AION_PETS_DIR:path.join(directory,'pets'),AION_OVERLAY_PROFILE_DIR:profile},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
  t.after(async()=>{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'Pet overlay server timeout')),10000);child.stdout.on('data',b=>{if(String(b).includes('Aion DPS Lab:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Pet overlay server exit ${code}: ${stderr}`));});});
  const origin=`http://127.0.0.1:${port}`,post=(value,headers={})=>fetch(origin+'/api/pet-overlay',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(value)}),before=await(await fetch(origin+'/api/state')).json();
  assert.equal((await post({petId:1002},{Origin:'https://example.invalid'})).status,403);
  const invalidHost=await new Promise((resolve,reject)=>{const req=http.request(origin+'/api/pet-overlay',{method:'POST',headers:{Host:'example.invalid',Origin:origin,'Content-Type':'application/json'}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.end(JSON.stringify({petId:1002}));});
  assert.equal(invalidHost,403);
  assert.equal((await post({petId:1002},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post({petId:1002},{'Content-Type':'application/jsonx'})).status,415);
  for(const value of[{petId:'1002'},{petId:999999},{petId:1002,mapId:999999},{petId:1002,path:'../outside'}])assert.equal((await post(value)).status,400);
  assert.equal((await post({petId:1002,extra:'x'.repeat(9000)})).status,400);
  assert.deepEqual(await fs.readdir(profile),['host.json']);
  const pending=post({petId:1002,mapId:1010}),request=await requestAt(profile);assert.equal((await post({petId:1046})).status,409);
  await ack(profile,{requestId:request.requestId,ok:true,petId:1002,mapId:1010});const response=await pending;assert.equal(response.status,200);assert.deepEqual(await response.json(),{requestId:request.requestId,ok:true,petId:1002,mapId:1010});
  await fs.unlink(path.join(profile,'host.json'));const missing=await post({petId:1002});assert.equal(missing.status,503);assert.match((await missing.json()).error,/overlay/i);
  const after=await(await fetch(origin+'/api/state')).json();assert.deepEqual(after,before);assert.deepEqual(await fs.readdir(profile),[]);
});
