import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { Meter } from './meter.mjs';
import { listEncounters, replayEncounter } from './replay.mjs';
import { packetCoverage } from './protocol/packets.mjs';
import { captureHealth } from './capture/health.mjs';
import { HistoryStore } from './history-store.mjs';
import { worldMapCatalog, worldMapImage } from './world-map-catalog.mjs';
import {petCatalog,petForId,petSpawns,petIcon} from './pet-catalog.mjs';
import {petMapCatalog,petMapImage} from './pet-map-catalog.mjs';
import {PetStore} from './pet-store.mjs';
import {PetOverlayBridge} from './pet-overlay-bridge.mjs';
import runtimePathTools from '../overlay/runtime-paths.cjs';
import {createAppUpdates} from './app-updates.mjs';
import {createInstallerHandoff,assertUpdateIdle} from './installed-updater.mjs';

const port = Number(process.env.AION_METER_PORT || 4317);
const base = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const paths=runtimePathTools.runtimePaths({root:base,port});
const appVersion = JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8')).version;
const archive = new HistoryStore(paths.archive);
const petStore=new PetStore({directory:paths.pets,
 questSnapshotFile:process.env.AION_PETS_DIR||process.env.AION_HISTORY_DIR?null:process.env.APPDATA?path.join(process.env.APPDATA,'Questlog','aion-2','map-tracker.json'):null});
const petOverlay=new PetOverlayBridge({directory:paths.profile,pets:petCatalog.pets,maps:petMapCatalog.maps});
const liveMeter = () => new Meter({onEncounter:snapshot=>{
  try { archive.save(snapshot); } catch(error) { archive.recordError(error); console.error(`Karşılaşma kaydedilemedi: ${error.message}`); }
}});
let meter = new Meter(), mode = 'idle', capture = { state: 'stopped' }, worker, demoTimer;
let comparison = null, source = null, scope = 'party', target = null, busy = false;
let research = { active: false, id: null, messages: 0, markers: [] };
let workerStatusAt = null;
let cubes = {experimental:true,templates:[1200039],epoch:null,total:0,active:[],recent:[],map:{contexts:[],markers:[]}};
let pets={collection:null,map:{contexts:[],markers:[]}};
const invalidateCubes = () => { cubes={...cubes,active:[],map:{contexts:[],markers:[]},recent:cubes.recent.map(c=>c.status==='present'?{...c,status:'uncertain',reason:'capture-stopped'}:c)};pets={collection:null,map:{contexts:[],markers:[]}};petStore.observe(null); };
const clients = new Set();
const updates=createAppUpdates({version:appVersion,dataDir:paths.dataDir,onInstall:createInstallerHandoff({root:base,dataDir:paths.dataDir,port,getState:()=>view(),onHandoffFailure:message=>updates.handoffFailed(message)})});

function view({includeInstance=false}={}) {
  const live = meter.snapshot({ scope, target });
  const activeEncounter=meter.hits.length>0||meter.pvpStartedAt!==null;
  const displayMeter = !activeEncounter && meter.lastFight ? meter.lastFight : meter;
  return { app: 'aion-dps-lab', version:appVersion, ...(includeInstance?{instance:{pid:process.pid,root:paths.root,dataDir:paths.dataDir,id:paths.instanceId}}:{}), mode, scope, target, combat: meter.combatState(), party: meter.partyState(), capture: captureHealth(capture,workerStatusAt), source, comparison, research, cubes,pets:{...pets,collection:petStore.snapshot(mode==='live'?live.selfCharacter:null,{live:mode==='live'&&captureHealth(capture,workerStatusAt).state==='capturing'})}, current: live,
    archive:{...archive.status(),activeRun:archive.activeRun()},
    last: displayMeter !== meter ? displayMeter.snapshot({ scope, target }) : null,
    availableTargets: displayMeter.snapshot({ scope }).targets,
    history: meter.history.map(h => ({ id:h.id,damage:h.damage,seconds:h.seconds,reason:h.reason })),
    coverage: { full: packetCoverage().filter(p=>p.validation==='full').length, prefix: packetCoverage().filter(p=>p.validation==='prefix').length, catalog:85 } };
}
function send() {
  if (!clients.size) return;
  const data = `data: ${JSON.stringify(view())}\n\n`;
  for (const client of clients) { if (client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); } else client.write(data); }
}
async function stop() {
  clearInterval(demoTimer); demoTimer = null;
  if(mode==='live') { meter.finish('capture-stopped',Date.now()); archive.closeRun('capture-stopped',Date.now()); }
  if (worker) {
    const current = worker; worker = null;
    await new Promise(resolve => {
      const timeout = setTimeout(() => { current.terminate().then(resolve); }, 2000);
      current.on('message', message => { if (message.type === 'stopped') { research = message.research; cubes=message.cubes||cubes; } });
      current.once('exit', () => { clearTimeout(timeout); resolve(); }); current.postMessage('stop');
    });
    if (research.active || research.armed) research = { ...research, active: false, armed: false, reason: 'worker-stopped', error: 'Yakalama işlemi beklenmedik biçimde kapandı; kayıt eksik olabilir.' };
  }
  capture = { state:'stopped' };
  invalidateCubes();
}
function researchCommand(action, phase) {
  const current = worker;
  if (!current || mode !== 'live') return Promise.reject(Error('Canlı yakalama açık değil.'));
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const cleanup = () => { clearTimeout(timer); current.off('message', onMessage); current.off('exit', onExit); };
    const onExit = () => { cleanup(); reject(Error('Yakalama işlemi kapandı.')); };
    const onMessage = message => {
      if (message.type !== 'research-result' || message.requestId !== requestId) return;
      cleanup(); research = message.research;
      if (message.error) reject(Error(message.error)); else resolve(research);
    };
    const timer = setTimeout(() => { cleanup(); reject(Error('Test kaydı işlemi zaman aşımına uğradı. Veri okuma durumunu kontrol et.')); }, 5000);
    current.on('message', onMessage); current.once('exit', onExit);
    current.postMessage({ type: 'research-command', requestId, action, phase, expiresAt: Date.now()+5000 });
  });
}
async function live() {
  await stop(); meter = liveMeter(); mode = 'live'; comparison = null; source = null; scope = 'party'; target = null;
  capture = { state:'starting' };
  workerStatusAt = Date.now();
  cubes={experimental:true,templates:[1200039],epoch:null,total:0,active:[],recent:[],map:{contexts:[],markers:[]}};
  const current = new Worker(new URL('./capture/worker.mjs', import.meta.url),{workerData:{petCollections:petStore.seeds(),researchDirectory:paths.research}}); worker = current;
  current.on('message', message => {
    if (worker !== current) return;
    if (message.type === 'status') { workerStatusAt=Date.now();const {pets:petState,...captureStatus}=message;capture=captureStatus; research = message.research || research; cubes=message.cubes||cubes;if(petState){pets=petState;petStore.observe(pets.collection);} }
    else if (message.type === 'cube-status') { cubes=message.cubes;send(); }
    else if(message.type==='pet-status'){pets=message.pets;petStore.observe(pets.collection);send();}
    else if (message.type === 'events') for (const e of message.events) {
      const fightId=meter.fightId;meter.ingest(e);
      // A same-map respawn notice can deliberately preserve the boss fight.
      // It must preserve the surrounding dungeon timer as well.
      if(e.type!=='map'||meter.fightId!==fightId)archive.observe(e);
    }
  });
  current.on('error', error => { if (worker === current) {capture = { state:'error',error:error.message };invalidateCubes();} });
  current.on('exit', code => { if (worker === current) { worker = null;meter.finish('capture-stopped',Date.now());archive.closeRun('worker-exit',Date.now());invalidateCubes(); if(research.active||research.armed)research={...research,active:false,armed:false,reason:'worker-exit',error:'Test kaydı eksik olabilir.'}; capture = { state:'error', error:`Yakalama işlemi kapandı (${code}). Canlı başlat ile tekrar deneyin.` }; } });
}
function demo() {
  mode='demo'; comparison=null; source=null; scope='party'; target=null; meter=new Meter(); capture={state:'demo'};
  const now=Date.now(), names=['Sen','Nyra','Kael','Liora'], classes=['Gladiator','Sorcerer','Assassin','Cleric'];
  names.forEach((name,i)=>meter.ingest({type:'player',at:now,entity:i+1,name,class:classes[i],self:i===0}));
  meter.ingest({type:'roster',at:now,members:names.map((name,i)=>({entity:i+1,name,class:classes[i]}))});
  meter.ingest({type:'spawn',at:now,entity:99,npc:2001001,maxHp:10000000,hp:10000000});
  let step=0;
  function tick(at) {
    for(let i=0;i<4;i++) meter.ingest({type:step%6===0?'damage-over-time':'damage',at,actor:i+1,target:99,skill:11000000+i*1000000+(step%4)*10000,
      damage:Math.round((18000-i*3000)*(0.65+0.35*Math.sin(step*1.3+i)**2)),hits:1,critical:(step+i)%3===0});
    step++;
  }
  for(let n=30;n>=0;n--) tick(now-n*1000);
  demoTimer=setInterval(()=>tick(Date.now()),1000);
}

const json = (res, value, status=200) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
async function exportRun(res,run) {
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  const write=async text=>{
    if(res.destroyed)return false;
    if(!res.write(text))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});
    return !res.destroyed;
  };
  if(!await write(JSON.stringify(run).slice(0,-1)+',"encounters":['))return;
  let first=true;
  for(const id of run.encounterIds){
    const record=archive.detail(id);if(!record)continue;
    if(!await write((first?'':',')+JSON.stringify(record)))return;first=false;
  }
  res.end(']}');
}
async function body(req) {
  let data=''; for await(const chunk of req) { data+=chunk; if(data.length>8192) throw Error('İstek çok büyük'); } return JSON.parse(data||'{}');
}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(req.headers.host) || (req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) || req.headers['sec-fetch-site']==='cross-site') { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if(req.method==='GET' && url.pathname==='/api/state') return json(res,view({includeInstance:true}));
    if(req.method==='GET' && url.pathname==='/api/updates')return json(res,updates.snapshot());
    if(req.method==='POST'&&['/api/updates/check','/api/updates/install'].includes(url.pathname)){
      if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')return json(res,{error:'JSON gerekli'},415);
      const request=await body(req);
      if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).length)return json(res,{error:'Güncelleme isteği boş bir JSON nesnesi olmalı.'},400);
      try{
        if(url.pathname.endsWith('/check'))return json(res,await updates.check());
        assertUpdateIdle(view());return json(res,await updates.install());
      }catch(error){return json(res,{error:error.message},error.statusCode||error.status||400);}
    }
    if(req.method==='GET' && url.pathname==='/api/maps') return json(res,worldMapCatalog);
    if(req.method==='GET' && url.pathname==='/api/pets/catalog')return json(res,petCatalog);
    if(req.method==='GET' && url.pathname==='/api/pets/maps')return json(res,petMapCatalog);
    if(req.method==='POST'&&url.pathname==='/api/pet-overlay'){
      if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')return json(res,{error:'JSON gerekli'},415);
      try{return json(res,await petOverlay.select(await body(req)));}
      catch(error){return json(res,{error:error.message},Number.isInteger(error.status)?error.status:400);}
    }
    const petMatch=/^\/api\/pets\/([1-9]\d*)\/spawns$/.exec(url.pathname);
    if(req.method==='GET'&&petMatch){const id=Number(petMatch[1]);if(!petForId(id))return json(res,{error:'Pet bulunamadı'},404);return json(res,{petId:id,spawns:petSpawns(id),supportedMapIds:petMapCatalog.maps.map(m=>m.id)});}
    if(req.method==='GET' && url.pathname==='/api/encounters') return json(res,listEncounters());
    // Archive reads never call replay(), stop(), or change live filters.
    if(req.method==='GET' && url.pathname==='/api/history') return json(res,archive.list(Object.fromEntries(url.searchParams)));
    if(req.method==='GET' && url.pathname==='/api/runs') return json(res,{...archive.listRuns(Object.fromEntries(url.searchParams)),activeRun:archive.activeRun()});
    if(req.method==='GET' && url.pathname==='/api/records') return json(res,archive.records(Object.fromEntries(url.searchParams)));
    const historyMatch=/^\/api\/history\/([^/]+)(?:\/(export|summary))?$/.exec(url.pathname);
    if(req.method==='GET'&&historyMatch){
      const record=archive.detail(historyMatch[1]);if(!record)return json(res,{error:'Kayıt bulunamadı'},404);
      if(historyMatch[2]==='summary')return json(res,{text:record.chatSummary});
      if(historyMatch[2]==='export')res.setHeader('Content-Disposition',`attachment; filename="kami-encounter-${record.id}.json"`);
      return json(res,record);
    }
    const runMatch=/^\/api\/runs\/([^/]+)(?:\/(export))?$/.exec(url.pathname);
    if(req.method==='GET'&&runMatch){
      const run=archive.runDetail(runMatch[1]);if(!run)return json(res,{error:'Oturum bulunamadı'},404);
      if(runMatch[2]==='export'){
        res.setHeader('Content-Disposition',`attachment; filename="kami-run-${run.id}.json"`);
        return await exportRun(res,run);
      }
      return json(res,run);
    }
    if(req.method==='POST'&&['/api/runs/start','/api/runs/finish'].includes(url.pathname)){
      if(!req.headers['content-type']?.startsWith('application/json'))return json(res,{error:'JSON gerekli'},415);
      const data=await body(req);
      if(url.pathname.endsWith('/start')){
        if(mode!=='live'||!worker)return json(res,{error:'Dungeon turu için canlı yakalama açık olmalı.'},409);
        if(data.title!==undefined&&(typeof data.title!=='string'||data.title.length>150))throw Error('Tur adı 150 karakteri geçmemeli.');
        meter.finish('manual',Date.now());
        const run=archive.startRun({title:data.title,map:meter.map});send();return json(res,run,201);
      }
      if(typeof data.complete!=='boolean')throw Error('complete alanı true veya false olmalı.');
      const activeRun=archive.activeRun();if(!activeRun)return json(res,{error:'Açık tur bulunamadı'},409);
      if(data.complete&&(activeRun.type!=='dungeon'||activeRun.timingSource!=='manual'))return json(res,{error:'Doğrulanmış clear süresi için önce dungeon turunu başlat.'},409);
      // Save combat observed up to the explicit user boundary before closing.
      if(mode==='live')meter.finish('manual',Date.now());
      if(archive.activeRun()?.id!==activeRun.id)return json(res,{error:'Karakter veya bölge değişti; önceki tur clear olarak işaretlenmedi.'},409);
      const run=archive.closeRun(data.complete?'user-complete':'user-stop',Date.now(),{complete:data.complete,completedBy:'user'});send();return json(res,run);
    }
    if(req.method==='GET' && url.pathname==='/api/events') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
      clients.add(res); res.write(`data: ${JSON.stringify(view())}\n\n`); req.on('close',()=>clients.delete(res)); return;
    }
    if(req.method==='GET' && url.pathname==='/api/export') {
      res.setHeader('Content-Disposition','attachment; filename="aion-dps-report.json"');
      return json(res,{format:'aion-dps-lab/1',exportedAt:new Date().toISOString(),...view()});
    }
    if(req.method==='POST' && url.pathname==='/api/control') {
      if(!req.headers['content-type']?.startsWith('application/json')) return json(res,{error:'JSON gerekli'},415);
      if(busy) return json(res,{error:'İşlem devam ediyor'},409);
      const data=await body(req); busy=true;
      try {
        if((research.active||research.armed) && ['live','demo','replay','reset'].includes(data.action)) throw Error('Önce Hidden cube test kaydını bitir.');
        if(['cube-start','cube-arm'].includes(data.action)) { if(mode!=='live'||!worker) await live(); await researchCommand(data.action==='cube-arm'?'arm':'start'); }
        else if(data.action==='cube-found') await researchCommand('found');
        else if(data.action==='cube-opened') await researchCommand('opened');
        else if(data.action==='cube-mark') await researchCommand('mark',data.phase);
        else if(data.action==='cube-stop') await researchCommand('stop');
        else if(data.action==='live') await live();
        else if(data.action==='stop') { await stop(); mode='paused'; }
        else if(data.action==='shutdown') {
          if(data.expectedPid!==undefined&&data.expectedPid!==process.pid)return json(res,{error:'Çalışan uygulama değişti; kapatma iptal edildi.'},409);
          if(data.requireIdle===true){try{assertUpdateIdle(view());}catch(error){return json(res,{error:error.message},409);}}
          setTimeout(shutdown,100);
        }
        else if(data.action==='demo') { await stop(); demo(); }
        else if(data.action==='reset') { meter.finish('manual'); comparison=null; target=null; }
        else if(data.action==='filter') {
          if(!['party','self','all'].includes(data.scope)) throw Error('Geçersiz kapsam');
          scope=data.scope; target=data.target===null || data.target===undefined ? null : Number(data.target);
          if(target!==null&&!Number.isSafeInteger(target)) throw Error('Geçersiz hedef');
        } else if(data.action==='replay') {
          // Build a complete replacement first, so a failed import preserves the current meter.
          const result=await replayEncounter(data.id); await stop();
          meter=result.meter; source=result.source; comparison=result.comparison; mode='replay'; scope='all'; target=null; capture={state:'replay'};
        } else throw Error('Geçersiz işlem');
        send(); return json(res,view());
      } finally { busy=false; }
    }
    if(req.method==='GET') {
      const mapImage=worldMapImage(url.pathname)||petMapImage(url.pathname)||petIcon(url.pathname);
      if(mapImage){
        if(!fs.existsSync(mapImage.filename))return json(res,{error:'Harita görseli bulunamadı'},404);
        const etag=`"${mapImage.sha256}"`;
        res.setHeader('Cache-Control','public, max-age=3600');res.setHeader('ETag',etag);
        if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
        res.writeHead(200,{'Content-Type':'image/webp'});
        fs.createReadStream(mapImage.filename).on('error',()=>res.destroy()).pipe(res);return;
      }
      if (/^\/icons\/skills\/[A-Za-z0-9_]+\.webp$/.test(url.pathname)) {
        const file = path.join(base, 'public', url.pathname.slice(1));
        if (!fs.existsSync(file)) return json(res, {error:'İkon bulunamadı'}, 404);
        res.writeHead(200, {'Content-Type':'image/webp','Cache-Control':'public, max-age=86400'});
        fs.createReadStream(file).pipe(res); return;
      }
      const files={'/':'index.html','/app.js':'app.js','/workbench.js':'workbench.js','/cube-alerts.js':'cube-alerts.js','/cube-map.js':'cube-map.js','/pets.js':'pets.js','/pets-map.js':'pets-map.js','/style.css':'style.css'};
      const file=files[url.pathname];
      if(file) {
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
        res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
        fs.createReadStream(path.join(base,'public',file)).pipe(res); return;
      }
    }
    json(res,{error:'Bulunamadı'},404);
  } catch(error) { if(res.headersSent)res.destroy();else json(res,{error:error.message},400); }
});
const timer=setInterval(()=>{if(mode==='live')meter.tick(Date.now());send();},500);
server.listen(port,'127.0.0.1',()=>{ console.log(`Aion DPS Lab: http://127.0.0.1:${port}`); if(process.env.AION_DISABLE_UPDATES!=='1'&&(paths.installed||fs.existsSync(path.join(base,'BUILD.json'))))updates.start();if(!process.argv.includes('--idle'))live().catch(error=>{capture={state:'error',error:error.message};}); });
server.on('error',error=>{console.error(error.message);process.exit(1);});
async function shutdown(){clearInterval(timer);updates.dispose();await stop();for(const c of clients)c.end();server.close(()=>process.exit());}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
