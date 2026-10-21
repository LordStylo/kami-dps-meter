import fs from 'node:fs';
import path from 'node:path';
import {parseQuestPetSnapshot} from './pet-collection.mjs';
const keyOf=c=>c&&typeof c.name==='string'&&Number.isInteger(c.server)?JSON.stringify([c.server,c.name]):null;
const clone=value=>JSON.parse(JSON.stringify(value));
const MAX_BYTES=4*1024*1024;
function record(value){
 const parsed=parseQuestPetSnapshot({value:{character:{...value.character,confirmedAt:value.at,levels:value.levels,souls:value.souls}}});
 const genera={};if(value.genera!==undefined){if(!value.genera||typeof value.genera!=='object'||Array.isArray(value.genera))throw Error('Invalid genus levels');for(const [key,entry]of Object.entries(value.genera)){if(!['intellect','feral','nature','trans','special'].includes(key)||!Number.isInteger(entry?.level)||entry.level<0||entry.level>0x7fffffff)throw Error('Invalid genus level');genera[key]={level:entry.level};}}
 return {...parsed,genera,complete:value.complete===true,source:['questlog-import','live','local'].includes(value.source)?value.source:'local'};
}
export class PetStore{
 constructor({directory,questSnapshotFile=null}={}){
  this.directory=directory;this.filename=path.join(directory,'collections.json');this.records=new Map();this.errors=[];this.revision=0;this.runtime=null;this.lastSignature=null;
  try{if(fs.existsSync(this.filename)){const data=this.read(this.filename);if(data.version!==1||!Array.isArray(data.records)||data.records.length>128)throw Error('Invalid collection file');for(const value of data.records){const r=record(value);this.records.set(keyOf(r.character),r);}}}catch(error){this.error('Pet koleksiyon kaydı okunamadı: '+error.message);}
  if(questSnapshotFile){try{
   if(fs.existsSync(questSnapshotFile)){
    const parsed=parseQuestPetSnapshot({value:this.read(questSnapshotFile)});
    const imported={...parsed,source:'questlog-import'},key=keyOf(parsed.character),previous=this.records.get(key);
    // File mtime also changes for unrelated counters and copying. It is not
    // collection evidence. External saved data seeds a missing profile only.
    if(!previous){this.records.set(key,imported);this.revision++;this.persist();}
   }
  }catch(error){this.error('Questlog pet kaydı içe alınamadı: '+error.message);}}
 }
 read(filename){if(fs.statSync(filename).size>MAX_BYTES)throw Error('Collection file exceeds size limit');return JSON.parse(fs.readFileSync(filename,'utf8'));}
 error(message){if(!this.errors.includes(message))this.errors.push(message);this.errors=this.errors.slice(-8);}
 persist(){
  try{const text=JSON.stringify({version:1,records:[...this.records.values()]});if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Collection file exceeds size limit');fs.mkdirSync(this.directory,{recursive:true});const temporary=this.filename+'.tmp';fs.writeFileSync(temporary,text);fs.renameSync(temporary,this.filename);}
  catch(error){this.error('Pet koleksiyonu kaydedilemedi: '+error.message);}
 }
 seeds(){return [...this.records.values()].filter(r=>r.complete).map(r=>clone({...r,status:'saved'}));}
 observe(snapshot){
  if(!snapshot?.character||!Number.isFinite(snapshot.at)){this.runtime=null;return;}
  const signature=JSON.stringify([snapshot.character,snapshot.at,snapshot.revision,snapshot.status]);if(signature===this.lastSignature)return;this.lastSignature=signature;
  try{
   const next=record({...snapshot,source:snapshot.status==='live'?'live':'local'}),key=keyOf(next.character),previous=this.records.get(key);
   if(previous&&next.at<previous.at){this.runtime=null;return;}
   if(!previous&&this.records.size>=128)throw Error('Character collection limit reached');
   // A partial observation adds known values; only a full snapshot proves
   // absence and may replace the full collection for this exact character.
   const combined=next.complete?next:{...next,complete:previous?.complete??false,levels:{...previous?.levels,...next.levels},souls:{...previous?.souls,...next.souls},genera:{...previous?.genera,...next.genera}};
   this.records.set(key,combined);this.runtime={character:next.character,at:next.at,status:snapshot.status,complete:next.complete};this.revision++;this.persist();
  }catch(error){this.runtime=null;this.error('Pet koleksiyon verisi kabul edilmedi: '+error.message);}
 }
 snapshot(character=null,{live=false}={}){
  const requested=keyOf(character),selected=requested?this.records.get(requested):[...this.records.values()].sort((a,b)=>b.at-a.at)[0];
  const isLive=!!(live&&selected&&keyOf(this.runtime?.character)===keyOf(selected.character)&&this.runtime?.status==='live'&&this.runtime.complete&&this.runtime.at===selected.at);
  if(!selected)return {character:requested?{name:character.name,server:character.server}:null,status:'unknown',complete:false,at:null,source:null,levels:{},souls:{},genera:{},revision:this.revision,errors:[...this.errors]};
  return {...clone(selected),status:isLive?'live':'saved',source:isLive?'live':selected.source,revision:this.revision,errors:[...this.errors]};
 }
}
