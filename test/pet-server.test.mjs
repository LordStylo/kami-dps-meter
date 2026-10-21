import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('pet catalog/map reads preserve capture and never import personal data in an isolated profile',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kami-pet-http-'));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const cwd=fileURLToPath(new URL('..',import.meta.url)),child=spawn(process.execPath,['src/server.mjs','--idle'],{cwd,windowsHide:true,env:{...process.env,AION_METER_PORT:String(port),AION_HISTORY_DIR:directory,AION_PETS_DIR:path.join(directory,'pets')},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
 t.after(async()=>{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr||'Pet test server timeout')),10000);child.stdout.on('data',b=>{if(String(b).includes('Aion DPS Lab:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Pet server exit ${code}: ${stderr}`));});});
 const origin=`http://127.0.0.1:${port}`,get=async pathname=>await(await fetch(origin+pathname)).json(),before=await get('/api/state');
 const catalog=await get('/api/pets/catalog');assert.equal(catalog.version,1);assert.equal(catalog.language,'en');assert.ok(catalog.pets.length>=100);
 const pet=catalog.pets.find(p=>p.id===1002),spawns=await get('/api/pets/1002/spawns');assert.equal(spawns.petId,1002);assert.ok(spawns.spawns.length>0);assert.ok(spawns.spawns.every(s=>pet.monsters.some(n=>n.id===s.npcId)));
 const maps=await get('/api/pets/maps'),altgard=maps.maps.find(m=>m.id===1110),middle=maps.maps.find(m=>m.id===22);assert.equal(altgard.name,'Altgard');assert.equal(middle.tiles.length,4);
 const tile=middle.tiles[0],response=await fetch(origin+tile.image),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),tile.sha256);
 const icon=await fetch(origin+pet.icon);assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/webp');assert.equal((await fetch(origin+tile.image,{headers:{'If-None-Match':response.headers.get('etag')}})).status,304);
 for(const url of ['/api/pets/999999/spawns','/api/pets/0/spawns','/data/pets.json','/pet-maps/unknown.webp','/icons/pets/unknown.webp','/pet-maps/%2e%2e%2fsettings/pets/collections.json'])assert.equal((await fetch(origin+url)).status,404,url);
 for(const file of ['/pets.js','/pets-map.js'])assert.match((await fetch(origin+file)).headers.get('content-type'),/javascript/);
 const after=await get('/api/state');assert.deepEqual(after,before);assert.equal(after.pets.collection.status,'unknown');assert.equal(after.pets.collection.complete,false);assert.deepEqual(after.pets.collection.levels,{});assert.equal(after.mode,'idle');assert.equal(after.archive.count,0);
});
