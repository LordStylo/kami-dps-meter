import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {shutdownBackend} from '../overlay/shutdown.cjs';

const identity={app:'aion-dps-lab'};
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
async function service(t,handle){
 const server=http.createServer(handle);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(()=>resolve());server.closeAllConnections();}));
 return {server,origin:`http://127.0.0.1:${server.address().port}`};
}

test('full shutdown waits for backend exit after the acknowledgement',async t=>{
 let requests=0,stopped=false;
 const {server,origin}=await service(t,async(req,res)=>{
  if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   assert.equal(req.url,'/api/control');assert.deepEqual(JSON.parse(body),{action:'shutdown'});requests++;
   json(res,identity);setTimeout(()=>server.close(()=>{stopped=true;}),150);
  }else json(res,identity);
 });
 await shutdownBackend(origin);
 assert.equal(requests,1);assert.equal(stopped,true);assert.equal(server.listening,false);
});

test('an already stopped backend permits closing the overlay',async t=>{
 const {server,origin}=await service(t,(_req,res)=>json(res,identity));
 await new Promise(resolve=>server.close(resolve));
 await shutdownBackend(origin);
});

test('a different service never receives a shutdown command',async t=>{
 let posts=0;
 const {origin}=await service(t,(req,res)=>{if(req.method==='POST')posts++;json(res,{app:'another-app'});});
 await assert.rejects(shutdownBackend(origin),/farklı bir uygulama/);assert.equal(posts,0);
});

test('shutdown waits for an in-progress backend command',async t=>{
 let posts=0;
 const {server,origin}=await service(t,(req,res)=>{
  if(req.method==='POST'&&++posts===1)return json(res,{error:'Busy'},409);
  json(res,identity);if(req.method==='POST')setTimeout(()=>server.close(),50);
 });
 await shutdownBackend(origin);assert.equal(posts,2);
});

test('a rejected shutdown is reported instead of claiming everything closed',async t=>{
 const {server,origin}=await service(t,(req,res)=>req.method==='POST'?json(res,{error:'Stop failed'},500):json(res,identity));
 await assert.rejects(shutdownBackend(origin),/Stop failed/);assert.equal(server.listening,true);
});

test('an acknowledgement without backend exit is not a successful shutdown',async t=>{
 const {server,origin}=await service(t,(_req,res)=>json(res,identity));
 await assert.rejects(shutdownBackend(origin,{timeoutMs:350}));assert.equal(server.listening,true);
});
test('a connection reset after shutdown acknowledgement is retried until exit is confirmed',async t=>{
 let acknowledged=false,resets=0,checks=0;
 const {server,origin}=await service(t,(req,res)=>{
  if(req.method==='POST'){acknowledged=true;return json(res,identity);}
  if(acknowledged&&checks++===0){resets++;req.socket.destroy();return;}
  json(res,identity);if(acknowledged)setTimeout(()=>server.close(),50);
 });
 await shutdownBackend(origin);assert.equal(resets,1);assert.ok(checks>=2);assert.equal(server.listening,false);
});
test('a reset before service identity is verified never sends a shutdown command',async t=>{
 let posts=0;
 const {origin}=await service(t,(req,res)=>{if(req.method==='POST')posts++;req.socket.destroy();});
 await assert.rejects(shutdownBackend(origin));assert.equal(posts,0);
});

test('full shutdown exits the real idle server process on an isolated port',async t=>{
 const {server,origin}=await service(t,(_req,res)=>json(res,identity));
 const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const child=spawn(process.execPath,['src/server.mjs','--idle'],{cwd:new URL('..',import.meta.url),env:{...process.env,AION_METER_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 const exited=once(child,'exit');
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Isolated server did not start')),5000);
  let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Aion DPS Lab:')){clearTimeout(timer);resolve();}});
  child.once('error',error=>{clearTimeout(timer);reject(error);});
 });
 await shutdownBackend(origin);
 assert.equal((await exited)[0],0);
});
