// Local, read-only reference validation. No reference executable code is run.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {Meter} from '../src/meter.mjs';
import {listEncounters} from '../src/replay.mjs';
const root=path.join(process.env.APPDATA||'','Questlog/aion-2');
const records=listEncounters(2000);
const logIds=[...new Set(records.map(r=>r.log))].filter(id=>fs.statSync(path.join(root,'combat-logs',id+'.ndjson')).size<=128*1024*1024).slice(0,6);
const results=[];
for(const log of logIds){
 const expected=records.filter(r=>r.log===log).map(r=>JSON.parse(fs.readFileSync(path.join(root,'encounters',r.id+'.json'),'utf8')));
 const meter=new Meter(),completed=[];
 const finish=meter.finish.bind(meter);
 meter.finish=(...args)=>{const hasHits=meter.hits.length>0;finish(...args);if(hasHits)completed.push(meter.lastFight);};
 const reader=readline.createInterface({input:fs.createReadStream(path.join(root,'combat-logs',log+'.ndjson')),crlfDelay:Infinity});
 let clock;
 for await(const line of reader){
  if(!line.trim())continue;const e=JSON.parse(line);
  if(!Number.isFinite(e.at))continue;
  // Simulate regular timer checks as well as event-driven boundaries.
  clock??=e.at;
  while(clock+1000<e.at){clock+=1000;meter.tick(clock);}
  meter.ingest(e);
 }
 if(clock!==undefined)meter.tick(clock+90001);
 for(const record of expected){
  const s=record.summary,targets=new Set(s.targets.filter(t=>t.inScope).map(t=>t.entity));
  const candidates=[];
  for(const completedMeter of completed){
   if(!completedMeter.hits.some(h=>h.at>=s.startedAt&&h.at<=s.endedAt&&targets.has(h.target)))continue;
   // Target scope is a saved user filter, never a time-window trim. Automatic
   // boundaries must produce the right first/last hit without help from us.
   const filtered=Object.assign(Object.create(Meter.prototype),completedMeter,{hits:completedMeter.hits.filter(h=>targets.has(h.target))});
   for(const scope of ['party','all','self']){
    const snapshot=filtered.snapshot({scope});
    const playerDeltas=s.participants.map(p=>({entity:p.entity,delta:(snapshot.players.find(x=>x.entity===p.entity)?.damage||0)-p.damage})).filter(p=>p.delta!==0);
    candidates.push({scope,damageDelta:snapshot.damage-s.damage,startDelta:snapshot.startedAt-s.startedAt,endDelta:snapshot.endedAt-s.endedAt,secondsDelta:snapshot.seconds-s.durationSeconds,expectedReason:s.end,reason:snapshot.reason,playerDeltas});
   }
  }
  candidates.sort((a,b)=>(Math.abs(a.startDelta)+Math.abs(a.endDelta)+Math.abs(a.damageDelta))-(Math.abs(b.startDelta)+Math.abs(b.endDelta)+Math.abs(b.damageDelta)));
  const match=candidates[0];
  results.push({id:record.id,log,...match,exact:!!match&&match.damageDelta===0&&match.startDelta===0&&match.endDelta===0&&match.reason===match.expectedReason&&match.playerDeltas.length===0});
 }
 console.log(JSON.stringify({log,events:meter.totalEvents,segments:completed.length,records:expected.length}));
}
fs.mkdirSync('tmp',{recursive:true});fs.writeFileSync('tmp/encounter-validation.json',JSON.stringify({source:'Parsed local Questlog events, full sessions; simulated one-second timer',results},null,2));
console.log(JSON.stringify({logs:logIds.length,tested:results.length,exact:results.filter(r=>r.exact).length,mismatches:results.filter(r=>!r.exact)},null,2));
if(!results.length||results.some(r=>!r.exact))process.exitCode=1;
