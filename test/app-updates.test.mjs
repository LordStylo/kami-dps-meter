import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createAppUpdates,stableVersion,compareVersions,UPDATE_API} from '../src/app-updates.mjs';

const pe=Buffer.alloc(256);pe.write('MZ');pe.writeUInt32LE(128,0x3c);pe.write('PE\0\0',128,'binary');
const sha=value=>createHash('sha256').update(value).digest('hex');
const release=(version='0.8.0',changes={})=>({tag_name:'v'+version,draft:false,prerelease:false,html_url:`https://github.com/LordStylo/kami-dps-meter/releases/tag/v${version}`,assets:[{id:10,name:`Kami-DPS-Meter-Setup-${version}.exe`,state:'uploaded',size:pe.length,digest:'sha256:'+sha(pe),browser_download_url:`https://github.com/LordStylo/kami-dps-meter/releases/download/v${version}/Kami-DPS-Meter-Setup-${version}.exe`}],...changes});
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
async function fixture(t,fetch,extra={}){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'kami-updates-test-'));
 t.after(async()=>{assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep+'kami-updates-test-'));await fs.rm(dataDir,{recursive:true,force:true});});
 const manager=createAppUpdates({version:'0.7.0',dataDir,platform:'win32',fetch,...extra});t.after(()=>manager.dispose());return {manager,dataDir};
}

test('stable versions compare numerically and reject prereleases, build tags and malformed numbers',()=>{
 assert.equal(stableVersion('v0.10.2'),'0.10.2');assert.equal(compareVersions('0.10.0','0.9.99'),1);assert.equal(compareVersions('v0.7.0','0.7.0'),0);
 for(const value of ['v0.8.0-beta','0.8.0+local','01.2.3','0.8',' 0.8.0','0.8.0.exe',null,'9007199254740992.0.0'])assert.equal(stableVersion(value),null);
});

test('only the highest stable release with an exact validated setup asset becomes available',async t=>{
 const calls=[],latest=release('0.10.0');const {manager}=await fixture(t,async(url,options)=>{calls.push({url,options});return json([release('9.0.0',{prerelease:true}),release('8.0.0',{draft:true}),release('7.0.0-beta'),release('0.9.9'),latest]);},{onInstall(){}});
 const state=await manager.check();assert.equal(state.status,'available');assert.equal(state.latestVersion,'0.10.0');assert.equal(state.canInstall,true);assert.equal(calls.length,1);assert.equal(calls[0].url,UPDATE_API);assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.headers.Authorization,undefined);
});

test('equal or older published versions are up to date without treating absent releases as current',async t=>{
 for(const value of [release('0.7.0'),release('0.6.9')]){const {manager}=await fixture(t,async()=>json([value]));assert.equal((await manager.check()).status,'up-to-date');}
 for(const response of [()=>json([]),()=>json([release('0.8.0',{prerelease:true})]),()=>json({},404)]){const {manager}=await fixture(t,async()=>response());assert.equal((await manager.check()).status,'unavailable');}
});

test('missing digest, wrong names, duplicate assets and excessive sizes never enable installation',async t=>{
 for(const change of [{digest:null},{digest:'md5:'+sha(pe)},{name:'Kami-DPS-Meter-Setup-0.9.0.exe'},{size:512*1024*1024+1},{state:'new'}]){
  const value=release();Object.assign(value.assets[0],change);const {manager}=await fixture(t,async()=>json([value]),{onInstall(){assert.fail('Invalid assets cannot install');}});const state=await manager.check();assert.equal(state.status,'unavailable');assert.equal(state.canInstall,false);
 }
 const value=release();value.assets.push({...value.assets[0]});const {manager}=await fixture(t,async()=>json([value]));assert.equal((await manager.check()).status,'unavailable');
});

test('installer metadata cannot redirect to another repository, credentials, plaintext or an arbitrary host',async t=>{
 for(const url of ['http://github.com/LordStylo/kami-dps-meter/releases/download/v0.8.0/Kami-DPS-Meter-Setup-0.8.0.exe','https://github.com/other/repo/releases/download/v0.8.0/Kami-DPS-Meter-Setup-0.8.0.exe','https://github.com.evil.example/setup.exe','https://user:pass@github.com/LordStylo/kami-dps-meter/releases/download/v0.8.0/Kami-DPS-Meter-Setup-0.8.0.exe']){
  const value=release();value.assets[0].browser_download_url=url;const {manager}=await fixture(t,async()=>json([value]),{onInstall(){assert.fail();}});assert.equal((await manager.check()).status,'error');assert.equal(manager.snapshot().canInstall,false);
 }
});

test('rate limits, invalid metadata and network errors remain errors instead of false up-to-date results',async t=>{
 for(const response of [()=>json({},403,{'retry-after':'30'}),()=>json({},429),()=>new Response('{invalid'),()=>new Response('x'.repeat(1024*1024+1)),()=>{throw Error('offline');}]){
  const {manager}=await fixture(t,async()=>response(),{clock:()=>1000});const state=await manager.check();assert.equal(state.status,'error');assert.equal(state.canInstall,false);assert.ok(state.error);
  if(state.error.includes('istek sınırı')&&state.retryAt)assert.equal(state.retryAt,31000);
 }
});

test('a timed-out background check does not throw or start an installer',async t=>{
 const {manager}=await fixture(t,(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true})),{checkTimeoutMs:5});
 const keepAlive=setTimeout(()=>{},100);try{assert.equal((await manager.check()).status,'error');assert.match(manager.snapshot().error,/zamanında/);}finally{clearTimeout(keepAlive);}
});

test('valid downloads are size, PE and SHA-256 checked before the trusted install callback',async t=>{
 const installed=[],requests=[];const {manager}=await fixture(t,async(url,options)=>{requests.push({url,options});return url===UPDATE_API?json([release()]):new Response(pe,{headers:{'content-length':String(pe.length)}});},{onInstall:async value=>installed.push(value)});
 const state=await manager.install();assert.equal(state.status,'installing');assert.equal(state.downloadBytes,pe.length);assert.equal(installed.length,1);assert.equal(sha(await fs.readFile(installed[0].installerPath)),installed[0].sha256);assert.equal(installed[0].version,'0.8.0');assert.equal(path.basename(installed[0].installerPath),'Kami-DPS-Meter-Setup-0.8.0.exe');
 assert.equal('installerPath' in state,false);assert.equal('sha256' in state,false);assert.equal(requests.length,2);await assert.rejects(manager.install(),error=>error.statusCode===409);assert.equal(installed.length,1);
});

test('short filesystem writes are retried until every verified installer byte reaches disk',async t=>{
 const originalOpen=fs.open;let writes=0,installed;
 fs.open=async(...args)=>{const file=await originalOpen(...args);if(args[1]==='wx'){const write=file.write.bind(file);file.write=(buffer,offset,length,position)=>{writes++;return write(buffer,offset,Math.min(7,length),position);};}return file;};
 try{
  const {manager}=await fixture(t,async url=>url===UPDATE_API?json([release()]):new Response(pe),{onInstall(value){installed=value;}});await manager.install();assert.ok(writes>1);assert.equal(sha(await fs.readFile(installed.installerPath)),sha(pe));
 }finally{fs.open=originalOpen;}
});

test('wrong bytes, missing bytes, wrong digests and non-PE payloads are never applied and leave no temporary file',async t=>{
 for(const mode of ['hash','short','large','pe']){
  const value=release(),payload=mode==='short'?pe.subarray(0,100):mode==='large'?Buffer.concat([pe,Buffer.from('extra')]):mode==='pe'?Buffer.alloc(256):Buffer.from(pe);
  if(mode==='hash')value.assets[0].digest='sha256:'+'a'.repeat(64);if(mode==='pe')value.assets[0].digest='sha256:'+sha(payload);
  let applied=false;const {manager,dataDir}=await fixture(t,async url=>url===UPDATE_API?json([value]):new Response(payload),{onInstall(){applied=true;}});await assert.rejects(manager.install());assert.equal(applied,false);assert.equal(manager.snapshot().status,'error');assert.deepEqual(await fs.readdir(path.join(dataDir,'updates','0.8.0')),[]);
 }
});

test('GitHub asset redirects may reach its exact CDN hosts while other redirects are stopped before fetching',async t=>{
 for(const host of ['release-assets.githubusercontent.com','objects.githubusercontent.com','evil.example']){
  const calls=[];let applied=false;const {manager}=await fixture(t,async(url,options)=>{calls.push({url,options});if(url===UPDATE_API)return json([release()]);if(url.startsWith('https://github.com/'))return new Response(null,{status:302,headers:{location:'https://'+host+'/github-production-release-asset/file?signature=abc'}});return new Response(pe);},{onInstall(){applied=true;}});
  if(host==='evil.example'){await assert.rejects(manager.install());assert.equal(calls.length,2);assert.equal(applied,false);}else{await manager.install();assert.equal(applied,true);assert.equal(calls.length,3);}
 }
});

test('a verified cached installer is hashed again and reused by a fresh manager without another download',async t=>{
 let downloads=0;const fetch=async url=>url===UPDATE_API?json([release()]):(downloads++,new Response(pe));const {manager,dataDir}=await fixture(t,fetch,{onInstall(){}});await manager.install();assert.equal(downloads,1);
 const next=createAppUpdates({version:'0.7.0',dataDir,platform:'win32',fetch,onInstall(){}});t.after(()=>next.dispose());await next.install();assert.equal(downloads,1);
});

test('concurrent manual checks share one request and reject overlapping installation',async t=>{
 let resolve,calls=0;const {manager}=await fixture(t,async()=>{calls++;return new Promise(done=>{resolve=done;});},{onInstall(){}});const first=manager.check(),second=manager.check();assert.equal(calls,1);await assert.rejects(manager.install(),error=>error.statusCode===409);resolve(json([release()]));await Promise.all([first,second]);assert.equal(manager.snapshot().status,'available');
});

test('startup performs at most one delayed check, and explicit earlier checks suppress it',async t=>{
 let calls=0;const {manager}=await fixture(t,async()=>{calls++;return json([]);},{startupDelayMs:2});assert.equal(calls,0);manager.start();manager.start();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(calls,1);
 const {manager:manual}=await fixture(t,async()=>{calls++;return json([]);},{startupDelayMs:2});await manual.check();manual.start();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(calls,2);
});

test('unsupported platforms cannot install and a failing lifecycle callback preserves a verified download',async t=>{
 const {manager}=await fixture(t,async()=>json([release()]),{platform:'linux',onInstall(){assert.fail();}});await manager.check();assert.equal(manager.snapshot().canInstall,false);await assert.rejects(manager.install());
 const {manager:blocked,dataDir}=await fixture(t,async url=>url===UPDATE_API?json([release()]):new Response(pe),{onInstall(){throw Object.assign(Error('Savaş bitince yeniden dene.'),{statusCode:409});}});await assert.rejects(blocked.install(),error=>error.statusCode===409);assert.equal(blocked.snapshot().status,'error');assert.equal((await fs.stat(path.join(dataDir,'updates','0.8.0','Kami-DPS-Meter-Setup-0.8.0.exe'))).size,pe.length);
});

test('a helper that exits after acknowledging handoff can report failure without locking the update screen',async t=>{
 const {manager}=await fixture(t,async url=>url===UPDATE_API?json([release()]):new Response(pe),{onInstall(){}});
 manager.handoffFailed('early');assert.equal(manager.snapshot().status,'idle');
 await manager.install();assert.equal(manager.snapshot().status,'installing');
 const failed=manager.handoffFailed('Kurulum yardımcısı kapandı. Yeniden dene.');assert.equal(failed.status,'error');assert.match(failed.error,/Yeniden dene/);assert.equal(failed.canInstall,false);
 await manager.check();assert.equal(manager.snapshot().status,'available');manager.handoffFailed('late event');assert.equal(manager.snapshot().status,'available');assert.equal(manager.snapshot().error,null);
});
