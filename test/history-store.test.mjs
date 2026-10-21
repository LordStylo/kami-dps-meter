import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {HistoryStore} from '../src/history-store.mjs';
import {Meter} from '../src/meter.mjs';

function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kami-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function snapshot(overrides={}) {
  return {id:1,scope:'party',map:77,startedAt:1000,endedAt:11000,finishedAt:12000,seconds:10,reason:'kill',damage:2000,dps:200,
    healing:500,hps:50,selfCharacter:{id:'123',name:'Kami',server:1001,class:'Ranger'},
    players:[{entity:1,self:true,name:'Kami',damage:1000,dps:100,healing:500,hps:50,skills:[{id:11010000,damage:1000,dps:100}]}],
    targets:[{entity:99,npc:2300471,name:'Boss',boss:true,damage:2000}],chart:[{second:0,dps:100}],
    details:{players:[{entity:1,events:[{at:1000,damage:1000}]}]},issues:{gaps:0,truncated:false},...overrides};
}

test('full encounter archive survives restart beyond the 30 fight memory window and preserves graphs/details',t=>{
  const dir=fixture(t),store=new HistoryStore(dir);let last;
  for(let n=0;n<35;n++)last=store.save(snapshot({id:n,startedAt:1000+n*20000,endedAt:11000+n*20000,finishedAt:12000+n*20000}));
  const reopened=new HistoryStore(dir);
  assert.equal(reopened.list({limit:200}).total,35);assert.equal(reopened.list({limit:200}).items.length,35);
  assert.deepEqual(reopened.detail(last.id).snapshot.details,last.snapshot.details);assert.deepEqual(reopened.detail(last.id).snapshot.chart,last.snapshot.chart);
  assert.equal(reopened.listRuns().items[0].status,'interrupted');assert.equal(reopened.listRuns().items[0].clearSeconds,null);
  assert.equal(fs.readdirSync(path.join(dir,'encounters')).filter(f=>f.endsWith('.tmp')).length,0);
});

test('archive clones input, guards paths and bounds individual payloads without corrupting good records',t=>{
  const store=new HistoryStore(fixture(t)),source=snapshot(),record=store.save(source);
  source.players[0].damage=99999;assert.equal(store.detail(record.id).snapshot.players[0].damage,1000);
  assert.throws(()=>store.detail('../private'),/kimliği/);
  assert.throws(()=>store.save(snapshot({damage:Infinity})),/geçersiz sayı/);
  assert.throws(()=>store.save(snapshot({details:{payload:'x'.repeat(33*1024*1024)}})),/32 MiB/);
  assert.equal(store.list().total,1);assert.equal(store.list({limit:10000}).limit,200);
});

test('personal bests separate stable characters and boss kills, ignore wipes/gaps and multi-boss aggregate',t=>{
  const store=new HistoryStore(fixture(t));
  const first=store.save(snapshot());
  const best=store.save(snapshot({players:[{self:true,damage:2000,dps:200}],seconds:20}));
  const fastest=store.save(snapshot({players:[{self:true,damage:500,dps:50}],seconds:5}));
  store.save(snapshot({reason:'wipe',players:[{self:true,damage:9000,dps:900}]}));
  store.save(snapshot({issues:{gaps:1},players:[{self:true,damage:9000,dps:900}]}));
  store.save(snapshot({targets:[...snapshot().targets,{npc:2300472,boss:true}],players:[{self:true,damage:9000,dps:900}]}));
  store.save(snapshot({selfCharacter:{id:'456',name:'Other',server:1001,class:'Ranger'},players:[{self:true,damage:1500,dps:150}]}));
  store.save(snapshot({selfCharacter:{name:'Unknown'},players:[{self:true,damage:99000,dps:9900}]}));
  const records=store.records().items;assert.equal(records.length,2);
  const me=records.find(r=>r.character.id==='123');assert.equal(me.bestDps,200);assert.equal(me.encounterId,best.id);
  assert.equal(me.fastestSeconds,5);assert.equal(me.fastestEncounterId,fastest.id);assert.equal(me.attempts,4);assert.equal(me.kills,3);
  assert.equal(store.list({character:'id:456'}).total,1);assert.equal(store.list({q:'Boss'}).total,8);
  assert.match(store.detail(first.id).chatSummary,/100 DPS/);
});

test('same map encounters form observed sessions and explicit map boundaries never invent dungeon completion',t=>{
  const store=new HistoryStore(fixture(t));const first=store.save(snapshot());store.save(snapshot({id:2,reason:'wipe'}));
  assert.equal(store.listRuns().items[0].encounterCount,2);assert.equal(store.listRuns().items[0].bossKills,1);
  store.observe({type:'map',at:15000,map:88});
  const old=store.runDetail(first.run.id);assert.equal(old.type,'zone');assert.equal(old.reason,'zone');assert.equal(old.clearSeconds,null);
  store.save(snapshot({map:88,startedAt:20000,endedAt:21000}));assert.equal(store.listRuns().total,2);
});

test('manual dungeon start and explicit completion persist clear timer including gaps between bosses',t=>{
  let now=1000;const store=new HistoryStore(fixture(t),{clock:()=>now});
  const run=store.startRun({title:'Benim dungeon turum',map:77});
  store.save(snapshot({startedAt:2000,endedAt:12000,finishedAt:12000}));
  store.save(snapshot({id:2,startedAt:50000,endedAt:60000,finishedAt:60000}));
  const completed=store.closeRun('user-complete',71000,{complete:true,completedBy:'user'});
  assert.equal(completed.id,run.id);assert.equal(completed.encounterCount,2);assert.equal(completed.clearSeconds,70);
  assert.equal(completed.timingSource,'manual');assert.equal(completed.completedBy,'user');assert.equal(completed.status,'complete');
  assert.equal(new HistoryStore(store.directory).runDetail(run.id).clearSeconds,70);
});

test('run recovery reconstructs missing metadata from immutable encounters and closes prior active timers',t=>{
  const dir=fixture(t),store=new HistoryStore(dir);const encounter=store.save(snapshot());
  fs.unlinkSync(path.join(dir,'runs',encounter.run.id+'.json'));
  fs.writeFileSync(path.join(dir,'encounters','00000000-0000-0000-0000-000000000000.json'),'{broken');
  const reopened=new HistoryStore(dir),run=reopened.runDetail(encounter.run.id);
  assert.equal(reopened.list().total,1);assert.deepEqual(run.encounterIds,[encounter.id]);assert.equal(run.status,'interrupted');
  assert.equal(reopened.status().errors.length,1);assert.equal(reopened.status().ready,true);
});

test('PvP sessions are archived separately without boss records or inferred victory',t=>{
  const store=new HistoryStore(fixture(t));store.save(snapshot({kind:'pvp',targets:[],pvp:{kills:2,deaths:1},reason:'idle'}));
  assert.equal(store.list({kind:'pvp'}).total,1);assert.equal(store.listRuns().items[0].type,'pvp');assert.equal(store.records().total,0);
  assert.match(store.list().items[0].title,/PvP/);assert.equal(store.list().items[0].kills,2);
});

test('incoming-only PvP preserves zero outgoing damage, its observed duration and analytics kill/death facts',t=>{
  const store=new HistoryStore(fixture(t));store.save(snapshot({kind:'pvp',damage:0,dps:0,seconds:0,targets:[],players:[],
    details:{pvp:{kills:0,deaths:2,dealt:0,taken:9000}},reason:'idle'}));
  const summary=store.list().items[0];assert.equal(summary.damage,0);assert.equal(summary.seconds,10);assert.equal(summary.deaths,2);
  assert.equal(store.list().total,1);assert.equal(store.records().total,0);
});

test('real meter completion callback archives party scope with identity and boss facts without nearby strangers',t=>{
  const store=new HistoryStore(fixture(t)),meter=new Meter({onEncounter:s=>store.save(s)});
  const event=(type,data,at)=>meter.ingest({type,...data,at});
  event('map',{map:77},0);event('player',{entity:1,self:true,id:'123',name:'Kami',server:1001,class:'Ranger'},0);
  event('player',{entity:2,id:'other',name:'Nearby',server:1001},0);
  event('spawn',{entity:99,npc:2300471,hp:10000,maxHp:10000},0);
  event('damage',{actor:1,target:99,damage:100,skill:11010000},1000);
  event('damage',{actor:2,target:99,damage:9000,skill:11010000},1500);
  event('damage',{actor:1,target:99,damage:200,skill:11010000},2000);
  event('death',{entity:99},2500);
  const summary=store.list().items[0],record=store.detail(summary.id);
  assert.equal(summary.damage,300);assert.equal(summary.character.id,'123');assert.equal(summary.kind,'boss');assert.equal(summary.reason,'kill');
  assert.equal(record.snapshot.players.length,1);assert.equal(record.snapshot.targets[0].npc,2300471);
  assert.equal(store.records().items[0].bestDps,300);
});

test('same-map boss respawn continuity keeps the manual dungeon timer and one complete archived fight',t=>{
  const store=new HistoryStore(fixture(t)),meter=new Meter({onEncounter:s=>store.save(s)});
  const event=(type,data,at)=>{
    const fightId=meter.fightId,e={type,...data,at};meter.ingest(e);
    if(type!=='map'||meter.fightId!==fightId)store.observe(e);
  };
  event('map',{map:77},0);event('player',{entity:1,self:true,id:'123',name:'Kami',server:1001,hp:100},0);
  event('spawn',{entity:99,npc:2300471,hp:10000,maxHp:10000},0);
  const run=store.startRun({map:77,at:500});
  event('damage',{actor:1,target:99,damage:100,skill:11010000},1000);
  event('death',{entity:1},1500);event('map',{map:77},2000);
  assert.equal(store.activeRun().id,run.id);
  event('player',{entity:101,self:true,id:'123',name:'Kami',server:1001,hp:100},2500);
  event('damage',{actor:101,target:99,damage:200,skill:11010000},3000);event('death',{entity:99},3500);
  assert.equal(store.list().total,1);assert.equal(store.list().items[0].damage,300);assert.equal(store.list().items[0].runId,run.id);
  assert.equal(store.activeRun().id,run.id);assert.equal(store.runDetail(run.id).encounterCount,1);
});
