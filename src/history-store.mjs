import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {bossInfo} from './bosses.mjs';

const FORMAT='kami-encounter/1', RUN_FORMAT='kami-run/1';
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES=32*1024*1024;
const number=value=>Number.isFinite(value)?value:0;
const label=value=>typeof value==='string'?value.slice(0,300):'';
const clone=value=>JSON.parse(JSON.stringify(value));
const duration=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;

function validateTree(value,depth=0,budget={nodes:0}) {
  if(depth>40||++budget.nodes>1500000)throw Error('Kayıt yapısı sınırı aşıldı.');
  if(typeof value==='number'&&!Number.isFinite(value))throw Error('Kayıtta geçersiz sayı var.');
  if(value&&typeof value==='object'){
    if(Array.isArray(value)&&value.length>500000)throw Error('Kayıt dizisi sınırı aşıldı.');
    for(const item of Object.values(value))validateTree(item,depth+1,budget);
  }
}
function serialize(value) {
  validateTree(value);
  const text=JSON.stringify(value)+'\n';
  if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Tek karşılaşma 32 MiB kayıt sınırını aşıyor; veri kesilmedi.');
  return text;
}
function readJSON(filename) {
  if(fs.statSync(filename).size>MAX_BYTES)throw Error('Yerel kayıt boyut sınırını aşıyor.');
  const value=JSON.parse(fs.readFileSync(filename,'utf8'));validateTree(value);return value;
}
function atomicJSON(filename,value) {
  const text=serialize(value),temporary=filename+'.'+randomUUID()+'.tmp';let fd;
  try{
    fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,filename);
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
    try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
function identity(snapshot) {
  const self=snapshot.selfCharacter||snapshot.players?.find(p=>p.self)||snapshot.healers?.find(p=>p.self);
  if(!self)return null;
  const character={id:self.id&&self.id!=='0'?String(self.id):null,name:label(self.name),server:self.server??null,class:label(self.class)};
  character.key=character.id?`id:${character.id}`:character.name&&character.server?`name:${character.server}:${character.name}`:null;
  return character;
}
function bossesOf(snapshot) {
  const found=new Map();
  for(const target of snapshot.bosses||snapshot.targets||[]){
    const npc=Number(target.npc??target.template),info=bossInfo(npc);
    if(!Number.isSafeInteger(npc)||npc<=0||!(target.boss||info||snapshot.bosses))continue;
    found.set(npc,{npc,name:label(target.name||info?.name)||`NPC #${npc}`});
  }return [...found.values()];
}
function summaryOf(snapshot,id,savedAt) {
  const bosses=bossesOf(snapshot),character=identity(snapshot),self=snapshot.players?.find(p=>p.self),healer=snapshot.healers?.find(p=>p.self);
  const pvp=snapshot.details?.pvp||snapshot.pvp;
  const kind=snapshot.kind==='pvp'?'pvp':bosses.length?'boss':'pve';
  const seconds=number(snapshot.seconds)||(kind==='pvp'?Math.max(1,(snapshot.endedAt-snapshot.startedAt)/1000):0);
  return {id,savedAt,sourceId:snapshot.id??null,startedAt:snapshot.startedAt,endedAt:snapshot.finishedAt??snapshot.endedAt,
    seconds,elapsedSeconds:Math.max(0,((snapshot.finishedAt??snapshot.endedAt)-snapshot.startedAt)/1000),
    damage:number(snapshot.damage),dps:number(snapshot.dps),healing:number(snapshot.healing),hps:number(snapshot.hps),
    reason:label(snapshot.reason)||'unknown',kind,title:bosses.map(b=>b.name).join(' + ')||(kind==='pvp'?'PvP oturumu':'PvE karşılaşması'),
    map:snapshot.map??null,character,characterKey:character?.key??null,bosses,players:snapshot.players?.length||0,
    selfDps:number(self?.dps),selfDamage:number(self?.damage),selfHps:number(self?.hps??healer?.hps),selfHealing:number(self?.healing??healer?.healing),
    kills:number(pvp?.kills??snapshot.kills),deaths:number(pvp?.deaths??(Array.isArray(snapshot.deaths)?snapshot.deaths.filter(d=>d.entity===self?.entity).length:snapshot.deaths)),
    issues:clone(snapshot.issues||{}),runId:null};
}
export function encounterChatSummary(summary) {
  const who=summary.character?.name||'Karakter bilinmiyor';
  return `[Kami] ${summary.title} · ${who} · ${duration(summary.seconds)} · ${summary.reason}\n`+
    `${Math.round(summary.selfDps).toLocaleString('tr-TR')} DPS · ${Math.round(summary.selfDamage).toLocaleString('tr-TR')} hasar`+
    (summary.selfHealing?` · ${Math.round(summary.selfHps).toLocaleString('tr-TR')} HPS`:'')+
    (summary.kind==='pvp'?` · ${summary.kills} öldürme / ${summary.deaths} ölüm`:'');
}

// Encounter files are immutable and authoritative. Run metadata can always be
// rebuilt from those files after an interrupted write; no retention deletion.
export class HistoryStore {
  constructor(directory,{clock=Date.now}={}) {
    this.directory=path.resolve(directory);this.clock=clock;this.entries=new Map();this.runs=new Map();this.current=null;this.errors=[];
    this.ready=false;
    try{
      fs.mkdirSync(path.join(this.directory,'encounters'),{recursive:true});fs.mkdirSync(path.join(this.directory,'runs'),{recursive:true});
      this.load();this.ready=true;
    }catch(error){this.recordError(error);}
  }
  recordError(error){this.errors.unshift({at:this.clock(),message:label(error?.message||String(error))});this.errors.length=Math.min(20,this.errors.length);}
  status(){return {ready:this.ready,count:this.entries.size,runs:this.runs.size,errors:clone(this.errors),localOnly:true};}
  filename(type,id){if(!ID.test(id))throw Error('Geçersiz kayıt kimliği.');return path.join(this.directory,type,id+'.json');}
  load() {
    for(const filename of fs.readdirSync(path.join(this.directory,'encounters'))){
      if(!filename.endsWith('.json')||!ID.test(filename.slice(0,-5)))continue;
      try{
        const record=readJSON(path.join(this.directory,'encounters',filename));
        if(record.format!==FORMAT||record.id!==filename.slice(0,-5)||!record.snapshot||!Number.isFinite(record.snapshot.startedAt))throw Error('Karşılaşma kayıt şeması geçersiz.');
        const summary=summaryOf(record.snapshot,record.id,record.savedAt);summary.runId=record.run?.id||null;
        this.entries.set(record.id,{summary,run:record.run||null});
      }catch(error){this.recordError(new Error(`${filename}: ${error.message}`));}
    }
    for(const filename of fs.readdirSync(path.join(this.directory,'runs'))){
      if(!filename.endsWith('.json')||!ID.test(filename.slice(0,-5)))continue;
      try{
        const run=readJSON(path.join(this.directory,'runs',filename));
        if(run.format!==RUN_FORMAT||run.id!==filename.slice(0,-5)||!Number.isFinite(run.startedAt)||
          !['zone','dungeon','pvp'].includes(run.type)||!['active','complete','closed','interrupted'].includes(run.status)||
          !Array.isArray(run.encounterIds)||!run.encounterIds.every(id=>typeof id==='string'&&ID.test(id))||
          !Array.isArray(run.bosses)||!Number.isFinite(run.damage)||!Number.isFinite(run.healing))throw Error('Oturum kayıt şeması geçersiz.');
        this.runs.set(run.id,run);
      }catch(error){this.recordError(new Error(`${filename}: ${error.message}`));}
    }
    const dirty=new Set();
    for(const {summary,run:metadata} of [...this.entries.values()].sort((a,b)=>a.summary.startedAt-b.summary.startedAt)){
      if(!metadata||!ID.test(metadata.id))continue;
      let run=this.runs.get(metadata.id);
      if(!run){run=this.makeRun(summary,metadata);this.runs.set(run.id,run);dirty.add(run.id);}
      if(!run.encounterIds.includes(summary.id)){this.addToRun(run,summary);dirty.add(run.id);}
    }
    for(const run of this.runs.values()){
      if(run.status==='active'){
        run.status='interrupted';run.reason='app-restarted';run.endedAt=run.lastEncounterAt??run.startedAt;run.clearSeconds=null;dirty.add(run.id);
      }
    }
    for(const id of dirty)atomicJSON(this.filename('runs',id),this.runs.get(id));
  }
  makeRun(summary,metadata={}) {
    const type=metadata.type||(summary.kind==='pvp'?'pvp':summary.dungeon?'dungeon':'zone');
    return {format:RUN_FORMAT,id:metadata.id||randomUUID(),title:metadata.title||(type==='pvp'?'PvP oturumu':`Bölge ${summary.map??'?'} oturumu`),
      type,map:summary.map,character:summary.character,startedAt:metadata.startedAt??summary.startedAt,endedAt:null,lastEncounterAt:null,
      observedSeconds:0,clearSeconds:null,status:'active',reason:null,timingSource:metadata.timingSource||'observed',completedBy:null,
      encounterCount:0,bossKills:0,bosses:[],encounterIds:[],damage:0,healing:0};
  }
  addToRun(run,summary) {
    if(run.encounterIds.includes(summary.id))return;
    run.encounterIds.push(summary.id);run.encounterCount=run.encounterIds.length;run.damage+=summary.damage;run.healing+=summary.healing;
    run.lastEncounterAt=Math.max(run.lastEncounterAt??run.startedAt,summary.endedAt??summary.startedAt);
    run.observedSeconds=Math.max(0,(run.lastEncounterAt-run.startedAt)/1000);
    for(const boss of summary.bosses){
      let row=run.bosses.find(b=>b.npc===boss.npc);if(!row){row={...boss,kills:0,wipes:0,attempts:0};run.bosses.push(row);}
      row.attempts++;if(summary.reason==='kill'){row.kills++;run.bossKills++;}else if(summary.reason==='wipe')row.wipes++;
    }
  }
  save(snapshot) {
    if(!this.ready)throw Error('Yerel arşiv açılamadı; kayıt durumu kontrol edilmeli.');
    if(!snapshot||!Number.isFinite(snapshot.startedAt)||!Number.isFinite(snapshot.endedAt)||!(snapshot.damage>0||snapshot.kind==='pvp'))return null;
    // Serialize first: invalid/oversized encounters must never make a half run.
    const frozen=JSON.parse(serialize(snapshot)),id=randomUUID(),savedAt=this.clock(),summary=summaryOf(frozen,id,savedAt);
    const runType=summary.kind==='pvp'?'pvp':snapshot.dungeon===true||snapshot.mapInfo?.type==='dungeon'?'dungeon':'zone';
    const key=`${JSON.stringify(summary.map)}:${summary.characterKey??'unknown'}:${runType}`;
    if(this.current){
      const current=this.runs.get(this.current.id);
      const changed=this.current.manual?(current.map!==null&&current.map!==summary.map||current.character?.key&&current.character.key!==summary.characterKey):this.current.key!==key;
      if(changed)this.closeRun('scope-change',summary.startedAt);
    }
    // Without a map, a PvE encounter is archived independently rather than
    // implying unrelated encounters share a dungeon or clear timer.
    let run=null;
    if(this.current||summary.map!==null||summary.kind==='pvp'){
      run=this.current?this.runs.get(this.current.id):this.makeRun(summary,{type:runType,title:snapshot.mapInfo?.name?`${label(snapshot.mapInfo.name)} oturumu`:undefined});
      if(!this.current){this.runs.set(run.id,run);this.current={id:run.id,key};}
      if(!run.character)run.character=summary.character;
      if(run.map===null)run.map=summary.map;
      summary.runId=run.id;
    }
    const metadata=run?{id:run.id,type:run.type,title:run.title,startedAt:run.startedAt,timingSource:run.timingSource}:null;
    const record={format:FORMAT,id,savedAt,summary,snapshot:frozen,run:metadata,chatSummary:encounterChatSummary(summary)};
    atomicJSON(this.filename('encounters',id),record);this.entries.set(id,{summary,run:metadata});
    if(run){
      this.addToRun(run,summary);
      try{atomicJSON(this.filename('runs',run.id),run);}catch(error){this.recordError(error);}
    }
    return clone(record);
  }
  startRun({title='Dungeon turu',map=null,at=this.clock()}={}) {
    if(!this.ready)throw Error('Yerel arşiv açılamadı.');
    this.closeRun('new-run',at);
    const run=this.makeRun({map,character:null,startedAt:at},{type:'dungeon',title:label(title).trim()||'Dungeon turu',startedAt:at,timingSource:'manual'});
    atomicJSON(this.filename('runs',run.id),run);this.runs.set(run.id,run);this.current={id:run.id,key:null,manual:true};
    return clone(run);
  }
  activeRun(){return this.current?this.runDetail(this.current.id):null;}
  closeRun(reason='capture-stopped',at=this.clock(),{complete=false,completedBy=null}={}) {
    if(!this.current)return;
    const run=this.runs.get(this.current.id);this.current=null;
    run.status=complete?'complete':reason==='app-restarted'?'interrupted':'closed';run.reason=reason;
    run.endedAt=Math.max(run.lastEncounterAt??run.startedAt,Number.isFinite(at)?at:run.startedAt);
    run.observedSeconds=Math.max(0,(run.endedAt-run.startedAt)/1000);
    run.clearSeconds=complete?run.observedSeconds:null;
    run.completedBy=complete?completedBy||'packet':null;
    try{atomicJSON(this.filename('runs',run.id),run);}catch(error){this.recordError(error);}
    return clone(run);
  }
  observe(event) {
    if(event?.type==='map')this.closeRun('zone',event.at);
    // Never infer a dungeon clear from a boss kill or leaving a map.
    if(event?.type==='dungeon-complete'&&event.confirmed===true)this.closeRun('dungeon-complete',event.at,{complete:true});
  }
  queryEntries(options={}) {
    const {kind='all',character,boss,q,from,to}=options;
    const term=String(q||'').toLocaleLowerCase('tr-TR').slice(0,200);
    return [...this.entries.values()].map(v=>v.summary).filter(s=>
      (kind==='all'||s.kind===kind)&&(character===undefined||character===''||s.characterKey===character)&&
      (!boss||s.bosses.some(b=>String(b.npc)===String(boss)))&&
      (!Number.isFinite(Number(from))||from===null||from===''||s.startedAt>=Number(from))&&
      (!Number.isFinite(Number(to))||to===null||to===''||s.startedAt<=Number(to))&&
      (!term||`${s.title} ${s.character?.name||''} ${s.character?.class||''}`.toLocaleLowerCase('tr-TR').includes(term)))
      .sort((a,b)=>b.startedAt-a.startedAt||b.savedAt-a.savedAt);
  }
  page(items,{limit=50,offset=0}={}) {
    limit=Math.max(1,Math.min(200,Number.isFinite(Number(limit))?Math.floor(Number(limit)):50));
    offset=Math.max(0,Number.isFinite(Number(offset))?Math.floor(Number(offset)):0);
    return {items:clone(items.slice(offset,offset+limit)),total:items.length,limit,offset};
  }
  list(options={}){return {...this.page(this.queryEntries(options),options),status:this.status()};}
  detail(id) {
    const filename=this.filename('encounters',id);if(!this.entries.has(id))return null;
    const record=readJSON(filename);return {...record,summary:clone(this.entries.get(id).summary),chatSummary:encounterChatSummary(this.entries.get(id).summary)};
  }
  listRuns(options={}) {
    const runs=[...this.runs.values()].filter(r=>(!options.type||options.type==='all'||r.type===options.type)&&(!options.character||r.character?.key===options.character)).sort((a,b)=>b.startedAt-a.startedAt);
    return this.page(runs,options);
  }
  runDetail(id){this.filename('runs',id);return this.runs.has(id)?clone(this.runs.get(id)):null;}
  records(options={}) {
    const records=new Map();
    for(const summary of this.queryEntries({...options,kind:'boss'})){
      // Multi-boss aggregate DPS is not a per-boss personal best.
      if(!summary.characterKey||summary.bosses.length!==1||!(summary.selfDamage>0)||summary.issues.truncated||summary.issues.gaps)continue;
      const boss=summary.bosses[0],key=summary.characterKey+':'+boss.npc;
      let record=records.get(key);
      if(!record){record={character:summary.character,boss,bestDps:0,bestDamage:0,bestSeconds:null,encounterId:null,at:null,fastestSeconds:null,fastestEncounterId:null,attempts:0,kills:0};records.set(key,record);}
      record.attempts++;if(summary.reason!=='kill')continue;
      record.kills++;
      if(record.fastestSeconds===null||summary.seconds<record.fastestSeconds){record.fastestSeconds=summary.seconds;record.fastestEncounterId=summary.id;}
      if(record.encounterId===null||summary.selfDps>record.bestDps){Object.assign(record,{bestDps:summary.selfDps,bestDamage:summary.selfDamage,bestSeconds:summary.seconds,encounterId:summary.id,at:summary.startedAt});}
    }
    return {...this.page([...records.values()].filter(r=>r.kills>0).sort((a,b)=>b.bestDps-a.bestDps),options),localOnly:true};
  }
}
