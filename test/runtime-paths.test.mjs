import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import tools from '../overlay/runtime-paths.cjs';
const {runtimePaths,seedPortableData}=tools;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kami-runtime-paths-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function put(filename,value){fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,value);}
const dead=()=>{const error=Error('No such process');error.code='ESRCH';throw error;};
function tree(root,prefix=''){const out={};for(const item of fs.readdirSync(path.join(root,prefix),{withFileTypes:true})){const name=path.join(prefix,item.name);if(item.isDirectory())Object.assign(out,tree(root,name));else out[name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');}return out;}

test('portable runtime paths preserve the original data layout and path resolution writes nothing',t=>{
  const root=fixture(t),p=runtimePaths({root,env:{}});
  assert.equal(p.installed,false);assert.equal(p.dataDir,root);assert.equal(p.archive,path.join(root,'settings','archive'));assert.equal(p.pets,path.join(root,'settings','pets'));assert.equal(p.profile,path.join(root,'settings','overlay-4317'));assert.equal(p.captures,path.join(root,'captures'));assert.equal(p.research,path.join(root,'captures','cube-research'));assert.equal(p.tmp,path.join(root,'tmp'));assert.deepEqual(fs.readdirSync(root),[]);
});
test('installed runtime paths place every writable default under the explicit data directory',t=>{
  const root=fixture(t),dataDir=path.join(root,'user-data'),p=runtimePaths({root,port:4328,env:{AION_DATA_DIR:dataDir}});
  assert.equal(p.installed,true);for(const key of['archive','pets','captures','tmp'])assert.equal(p[key],path.join(dataDir,key));assert.equal(p.profile,path.join(dataDir,'overlay-4328'));assert.equal(p.research,path.join(dataDir,'captures','cube-research'));assert.deepEqual(fs.readdirSync(root),[]);
});
test('the installed marker supports direct launchers without changing unmarked portable packages',t=>{
  const root=fixture(t),local=path.join(root,'local');put(path.join(root,'installed.json'),JSON.stringify({format:'kami-installed/1'}));
  const p=runtimePaths({root,env:{LOCALAPPDATA:local}});assert.equal(p.installed,true);assert.equal(p.dataDir,path.join(local,'Kami DPS Meter','data'));assert.equal(fs.existsSync(local),false);
  assert.throws(()=>runtimePaths({root,env:{}}),/LOCALAPPDATA/);put(path.join(root,'installed.json'),'{}');assert.throws(()=>runtimePaths({root,env:{LOCALAPPDATA:local}}),/marker/);
});
test('explicit history, pets and profile overrides retain their existing precedence and fallback',t=>{
  const root=fixture(t),env={AION_DATA_DIR:path.join(root,'data'),AION_HISTORY_DIR:path.join(root,'history'),AION_OVERLAY_PROFILE_DIR:path.join(root,'host')};
  const p=runtimePaths({root,env});assert.equal(p.archive,env.AION_HISTORY_DIR);assert.equal(p.pets,path.join(env.AION_HISTORY_DIR,'pets'));assert.equal(p.profile,env.AION_OVERLAY_PROFILE_DIR);
  env.AION_PETS_DIR=path.join(root,'own-pets');assert.equal(runtimePaths({root,env}).pets,env.AION_PETS_DIR);assert.equal(runtimePaths({root,env,profile:path.join(root,'cli-host')}).profile,path.join(root,'cli-host'));
  assert.throws(()=>runtimePaths({root,env,port:0}));
});
test('instance identities distinguish different application roots and data/profile selections',t=>{
  const root=fixture(t),p=runtimePaths({root,env:{}});assert.equal(p.instanceId,runtimePaths({root,env:{}}).instanceId);assert.match(p.instanceId,/^[a-f\d]{64}$/);
  assert.notEqual(p.instanceId,runtimePaths({root:path.join(root,'other'),env:{}}).instanceId);assert.notEqual(p.instanceId,runtimePaths({root,env:{AION_DATA_DIR:path.join(root,'data')}}).instanceId);assert.notEqual(p.instanceId,runtimePaths({root,env:{},port:4328}).instanceId);
});
test('explicit portable migration copies only persistent user data, never overwrites it and leaves its source byte-for-byte unchanged',t=>{
  const dir=fixture(t),source=path.join(dir,'portable'),target=path.join(dir,'installed');
  const files={'settings/archive/index.json':'{}','settings/pets/collections.json':'old pets','settings/overlay-4317/layout.json':'{}','settings/overlay-4317/browser/Local Storage/leveldb/000001.log':'preferences','settings/overlay-4317/browser/Cache/cache.dat':'cache','settings/overlay-4317/host.json':'{"pid":123}','settings/overlay-4317/quit.request':'quit','captures/cube-research/test.ndjson':'record','tmp/server.pid':'123','tmp/server.log':'log','src/server.mjs':'code'};
  for(const [name,value]of Object.entries(files))put(path.join(source,name),value);put(path.join(target,'pets','collections.json'),'new pets');const before=tree(source);
  assert.deepEqual(seedPortableData({sourceRoot:source,dataDir:target,probe:dead}),{copied:4,skipped:1,bytes:21});
  assert.equal(fs.readFileSync(path.join(target,'pets','collections.json'),'utf8'),'new pets');assert.equal(fs.readFileSync(path.join(target,'overlay-4317','browser','Local Storage','leveldb','000001.log'),'utf8'),'preferences');assert.equal(fs.existsSync(path.join(target,'overlay-4317','host.json')),false);assert.equal(fs.existsSync(path.join(target,'overlay-4317','browser','Cache')),false);assert.equal(fs.existsSync(path.join(target,'tmp')),false);assert.deepEqual(tree(source),before);
});
test('migration refuses a live source backend or overlay before creating destination files',t=>{
  for(const marker of['tmp/server.pid','settings/overlay-4317/host.json']){
    const dir=fixture(t),source=path.join(dir,'portable'),target=path.join(dir,'installed');put(path.join(source,'settings/archive/index.json'),'{}');put(path.join(source,marker),marker.endsWith('.json')?'{"pid":123}':'123');const before=tree(source);
    assert.throws(()=>seedPortableData({sourceRoot:source,dataDir:target,probe:()=>{}}),/running/);assert.equal(fs.existsSync(target),false);assert.deepEqual(tree(source),before);
  }
});
test('migration refuses overlapping folders and linked data instead of following it',t=>{
  const dir=fixture(t),source=path.join(dir,'portable'),target=path.join(dir,'installed');put(path.join(source,'settings/archive/index.json'),'{}');
  assert.throws(()=>seedPortableData({sourceRoot:source,dataDir:source}));assert.throws(()=>seedPortableData({sourceRoot:source,dataDir:path.join(source,'nested')}));assert.throws(()=>seedPortableData({sourceRoot:source,dataDir:dir}));
  const outside=path.join(dir,'outside');fs.mkdirSync(outside);assert.equal(path.dirname(source),dir);fs.rmSync(path.join(source,'settings'),{recursive:true});
  try{fs.symlinkSync(outside,path.join(source,'settings'),process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.diagnostic('Symlink creation unavailable; overlap guards were verified');return;}throw error;}
  assert.throws(()=>seedPortableData({sourceRoot:source,dataDir:target}),/Linked/);assert.equal(fs.existsSync(target),false);
});
test('the migration CLI imports only an explicitly selected fixture into installed data',t=>{
  const dir=fixture(t),root=path.join(dir,'app'),source=path.join(dir,'portable'),target=path.join(dir,'data');fs.mkdirSync(root);put(path.join(source,'settings/pets/collections.json'),'{}');const before=tree(source);
  const helper=fileURLToPath(new URL('../overlay/runtime-paths.cjs',import.meta.url)),env={...process.env,AION_DATA_DIR:target,AION_HISTORY_DIR:'',AION_PETS_DIR:'',AION_OVERLAY_PROFILE_DIR:''};
  const report=JSON.parse(execFileSync(process.execPath,[helper,'--root='+root,'--seed-portable='+source],{env,encoding:'utf8',windowsHide:true}));assert.deepEqual(report,{copied:1,skipped:0,bytes:2});assert.deepEqual(tree(source),before);assert.equal(fs.readFileSync(path.join(target,'pets','collections.json'),'utf8'),'{}');
});
