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

const port = Number(process.env.AION_METER_PORT || 4317);
const base = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let meter = new Meter(), mode = 'idle', capture = { state: 'stopped' }, worker, demoTimer;
let comparison = null, source = null, scope = 'party', target = null, busy = false;
let research = { active: false, id: null, messages: 0, markers: [] };
let workerStatusAt = null;
let cubes = {experimental:true,templates:[1200039],epoch:null,total:0,active:[],recent:[]};
const invalidateCubes = () => { cubes={...cubes,active:[],recent:cubes.recent.map(c=>c.status==='present'?{...c,status:'uncertain',reason:'capture-stopped'}:c)}; };
const clients = new Set();

function view() {
  const live = meter.snapshot({ scope, target });
  const displayMeter = !meter.hits.length && meter.lastFight ? meter.lastFight : meter;
  return { app: 'aion-dps-lab', mode, scope, target, capture: captureHealth(capture,workerStatusAt), source, comparison, research, cubes, current: live,
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
  await stop(); meter = new Meter(); mode = 'live'; comparison = null; source = null; scope = 'party'; target = null;
  capture = { state:'starting' };
  workerStatusAt = Date.now();
  cubes={experimental:true,templates:[1200039],epoch:null,total:0,active:[],recent:[]};
  const current = new Worker(new URL('./capture/worker.mjs', import.meta.url)); worker = current;
  current.on('message', message => {
    if (worker !== current) return;
    if (message.type === 'status') { workerStatusAt=Date.now();capture = message; research = message.research || research; cubes=message.cubes||cubes; }
    else if (message.type === 'cube-status') { cubes=message.cubes;send(); }
    else if (message.type === 'events') for (const e of message.events) meter.ingest(e);
  });
  current.on('error', error => { if (worker === current) {capture = { state:'error',error:error.message };invalidateCubes();} });
  current.on('exit', code => { if (worker === current) { worker = null;invalidateCubes(); if(research.active||research.armed)research={...research,active:false,armed:false,reason:'worker-exit',error:'Test kaydı eksik olabilir.'}; capture = { state:'error', error:`Yakalama işlemi kapandı (${code}). Canlı başlat ile tekrar deneyin.` }; } });
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
async function body(req) {
  let data=''; for await(const chunk of req) { data+=chunk; if(data.length>8192) throw Error('İstek çok büyük'); } return JSON.parse(data||'{}');
}
const server = http.createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(req.headers.host) || (req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)) || req.headers['sec-fetch-site']==='cross-site') { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if(req.method==='GET' && url.pathname==='/api/state') return json(res,view());
    if(req.method==='GET' && url.pathname==='/api/encounters') return json(res,listEncounters());
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
        else if(data.action==='shutdown') { setTimeout(shutdown,100); }
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
      if (/^\/icons\/skills\/[A-Za-z0-9_]+\.webp$/.test(url.pathname)) {
        const file = path.join(base, 'public', url.pathname.slice(1));
        if (!fs.existsSync(file)) return json(res, {error:'İkon bulunamadı'}, 404);
        res.writeHead(200, {'Content-Type':'image/webp','Cache-Control':'public, max-age=86400'});
        fs.createReadStream(file).pipe(res); return;
      }
      const files={'/':'index.html','/app.js':'app.js','/cube-alerts.js':'cube-alerts.js','/style.css':'style.css'};
      const file=files[url.pathname];
      if(file) {
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'");
        res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});
        fs.createReadStream(path.join(base,'public',file)).pipe(res); return;
      }
    }
    json(res,{error:'Bulunamadı'},404);
  } catch(error) { json(res,{error:error.message},400); }
});
const timer=setInterval(()=>{if(mode==='live')meter.tick(Date.now());send();},500);
server.listen(port,'127.0.0.1',()=>{ console.log(`Aion DPS Lab: http://127.0.0.1:${port}`); if(!process.argv.includes('--idle'))live().catch(error=>{capture={state:'error',error:error.message};}); });
server.on('error',error=>{console.error(error.message);process.exit(1);});
async function shutdown(){clearInterval(timer);await stop();for(const c of clients)c.end();server.close(()=>process.exit());}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
