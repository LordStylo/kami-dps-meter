import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('local map metadata and whitelisted images preserve capture state, validate image integrity, and deny other files',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kami-map-http-'));
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const cwd=fileURLToPath(new URL('..',import.meta.url)),child=spawn(process.execPath,['src/server.mjs','--idle'],{cwd,windowsHide:true,env:{...process.env,AION_METER_PORT:String(port),AION_HISTORY_DIR:directory},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  t.after(async()=>{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Isolated map server timed out: '+stderr)),10000);
    child.stdout.on('data',chunk=>{if(String(chunk).includes('Aion DPS Lab:')){clearTimeout(timer);resolve();}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Map server exited ${code}: ${stderr}`));});
  });
  const origin=`http://127.0.0.1:${port}`,before=await(await fetch(origin+'/api/state')).json();
  const metadata=await fetch(origin+'/api/maps');assert.equal(metadata.status,200);
  const catalog=await metadata.json();assert.equal(catalog.version,1);assert.equal(catalog.maps.length,7);
  const map=catalog.maps.find(map=>map.id===1010);assert.equal(map.name,'Verteron');
  const image=await fetch(origin+map.image);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');
  const bytes=Buffer.from(await image.arrayBuffer());assert.equal(bytes.length,map.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),map.sha256);
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  const cached=await fetch(origin+map.image,{headers:{'If-None-Match':image.headers.get('etag')}});assert.equal(cached.status,304);
  for(const name of ['/maps/unknown.webp','/maps/World_L_A.webp.exe','/data/world-maps.json','/maps/%2e%2e%2fsettings/layout.json'])assert.equal((await fetch(origin+name)).status,404,name);
  const module=await fetch(origin+'/cube-map.js');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
  const after=await(await fetch(origin+'/api/state')).json();assert.deepEqual(after,before);
  assert.equal(after.mode,'idle');assert.equal(after.capture.state,'stopped');assert.equal(after.archive.count,0);
});
