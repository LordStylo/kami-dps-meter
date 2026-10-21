import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {HistoryStore} from '../src/history-store.mjs';

test('isolated idle archive endpoints preserve live state, provide JSON/chat exports, and never initiate capture',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kami-history-http-'));
  const store=new HistoryStore(directory),record=store.save({id:1,map:77,startedAt:1000,endedAt:2000,seconds:1,damage:100,dps:100,reason:'kill',
    selfCharacter:{id:'1',name:'Kami'},players:[{self:true,damage:100,dps:100}],targets:[{npc:2300471,boss:true}]});
  store.closeRun('zone',3000);
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const cwd=fileURLToPath(new URL('..',import.meta.url)),child=spawn(process.execPath,['src/server.mjs','--idle'],{cwd,env:{...process.env,AION_METER_PORT:String(port),AION_HISTORY_DIR:directory},stdio:['ignore','pipe','pipe']});
  const origin=`http://127.0.0.1:${port}`;let stderr='';child.stderr.on('data',data=>stderr+=data);
  t.after(async()=>{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.rmSync(directory,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Isolated server timed out: ${stderr}`)),10000);
    child.stdout.on('data',data=>{if(String(data).includes('Aion DPS Lab:')){clearTimeout(timer);resolve();}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Isolated server exited ${code}: ${stderr}`));});
  });
  const get=async uri=>{const response=await fetch(origin+uri);assert.equal(response.status,200,uri);return response.json();};
  const before=await get('/api/state');assert.equal(before.mode,'idle');
  assert.equal((await get('/api/history')).items[0].id,record.id);
  assert.equal((await get(`/api/history/${record.id}`)).snapshot.damage,100);
  assert.match((await get(`/api/history/${record.id}/summary`)).text,/Kami/);
  const exported=await fetch(origin+`/api/history/${record.id}/export`);assert.match(exported.headers.get('content-disposition'),/attachment/);assert.equal((await exported.json()).id,record.id);
  assert.equal((await get('/api/runs')).items[0].bossKills,1);
  assert.equal((await get(`/api/runs/${record.run.id}/export`)).encounters.length,1);
  assert.equal((await get('/api/records')).items[0].bestDps,100);
  const after=await get('/api/state');assert.deepEqual(after,before);
  const start=await fetch(origin+'/api/runs/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(start.status,409);
  assert.equal((await get('/api/state')).capture.state,'stopped');
  assert.equal((await fetch(origin+'/api/history/not-a-uuid')).status,400);
});
