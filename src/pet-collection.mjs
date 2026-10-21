import {PET_OPCODES,MAX_PET_RECORDS,readPetObservation} from './protocol/pets.mjs';

export const PET_LEVEL_COSTS=Object.freeze([5,25,75]);
const MAX_POINTS=0x7fffffff,MAX_STREAMS=128,MAX_PENDING=256;
const validLevel=value=>Number.isInteger(value)&&value>=0&&value<=PET_LEVEL_COSTS.length;
const validPoints=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_POINTS;
const genusKeys=new Set(['intellect','feral','nature','trans','special']);
// Questlog preserves signed balances when a missed increase or reordered
// acquisition makes a deduction exceed the observed balance. Keep that fact;
// only the presentation helper clamps a negative remainder to zero.
export const isPetSoulBalance=value=>Number.isSafeInteger(value)&&value>=-0x80000000&&value<=MAX_POINTS;
const validName=value=>typeof value==='string'&&value.length>0&&value.length<=128&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const validServer=value=>Number.isInteger(value)&&value>0&&value<=0xffff;
const keyOf=character=>character.server+'\0'+character.name;
const copyModel=model=>({...model,levels:{...model.levels},souls:{...model.souls},genera:genusRecords(model.genera),spent:new Map(model.spent),reserved:new Map(model.reserved)});
const emptyModel=character=>({character:{name:character.name,server:character.server},complete:false,liveConfirmed:false,seeded:false,at:null,levels:{},souls:{},genera:{},spent:new Map(),reserved:new Map()});

function genusRecords(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>genusKeys.size)throw new TypeError('Invalid pet genera');
  const output={};
  for(const [key,value]of Object.entries(input)){
    if(!genusKeys.has(key)||!value||typeof value!=='object'||Array.isArray(value)||!validPoints(value.level))throw new TypeError('Invalid pet genus');
    output[key]={level:value.level};
  }
  return output;
}

function records(input,validate){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>MAX_PET_RECORDS)throw new TypeError('Invalid pet records');
  const output={};
  for(const [key,value]of Object.entries(input)){
    if(!/^[1-9]\d*$/.test(key)||!Number.isSafeInteger(Number(key))||Number(key)>MAX_POINTS||!validate(value))throw new TypeError('Invalid pet record');
    output[key]=value;
  }
  return output;
}
function collectionSeed(seed){
  if(!seed||seed.complete!==true||!validName(seed.character?.name)||!validServer(seed.character?.server)||!Number.isFinite(seed.at)||seed.at<0)throw new TypeError('Pet seed is not confirmed');
  return {...emptyModel(seed.character),complete:true,seeded:true,at:seed.at,
    levels:records(seed.levels,validLevel),souls:records(seed.souls,isPetSoulBalance),genera:genusRecords(seed.genera)};
}

// Missing observations remain unknown. Callers may supply zero for an absent
// pet only after a complete initial snapshot establishes that absence.
export function effectivePetProgress(level,souls){
  if(level===undefined||level===null||souls===undefined||souls===null)return null;
  if(!validLevel(level)||!isPetSoulBalance(souls))throw new TypeError('Invalid pet progress');
  let current=level,remaining=souls;
  while(current<PET_LEVEL_COSTS.length&&remaining>=PET_LEVEL_COSTS[current])remaining-=PET_LEVEL_COSTS[current++];
  return {level:current,souls:Math.max(0,remaining),need:PET_LEVEL_COSTS[current]??0,estimated:current!==level};
}
export function petSoulsToTarget(level,souls,target=3){
  if(level===undefined||level===null||souls===undefined||souls===null)return null;
  if(!validLevel(level)||!isPetSoulBalance(souls)||!validLevel(target))throw new TypeError('Invalid pet progress target');
  let cost=0;for(let current=level;current<target;current++)cost+=PET_LEVEL_COSTS[current];
  return Math.max(0,cost-Math.max(0,souls));
}

function consumedLevels(level,points){
  let total=0;
  for(let current=level;current<PET_LEVEL_COSTS.length;current++){
    total+=PET_LEVEL_COSTS[current];if(total===points)return current+1-level;if(total>points)break;
  }
  return 0;
}
function advance(model,petId,level){
  if(level>(model.levels[petId]??0))model.levels[petId]=level;
}
function settle(model,petId){
  const points=model.spent.get(petId)??0,level=model.levels[petId]??0,steps=points?consumedLevels(level,points):0;
  if(steps){advance(model,petId,level+steps);model.spent.delete(petId);}
}
function consume(model,petId,points){
  const reserved=Math.min(points,model.reserved.get(petId)??0);
  model.reserved.set(petId,(model.reserved.get(petId)??0)-reserved);
  const remaining=points-reserved;
  if(remaining){
    const level=model.levels[petId]??0,steps=consumedLevels(level,remaining);
    if(steps)advance(model,petId,level+steps);
    else{
      const spent=(model.spent.get(petId)??0)+remaining;if(!validPoints(spent))throw Error('Pet spending overflow');
      model.spent.set(petId,spent);
    }
  }
  settle(model,petId);
}

export class PetCollectionTracker {
  constructor({clock=Date.now,seeds=[]}={}){
    this.clock=clock;this.streams=new Map();this.collections=new Map();this.selected=null;this.revision=0;this.errors=0;
    if(!Array.isArray(seeds)||seeds.length>MAX_STREAMS)throw new TypeError('Pet seed count limit');
    for(const seed of seeds)try{
      const model=collectionSeed(seed),key=keyOf(model.character),previous=this.collections.get(key);
      if(!previous||model.at>previous.at)this.collections.set(key,model);
    }catch{this.errors++;this.revision++;}
  }
  state(stream){
    if(typeof stream!=='string'||!stream)return null;
    if(!this.streams.has(stream)){
      if(this.streams.size>=MAX_STREAMS)return null;
      this.streams.set(stream,{entity:null,key:null,trusted:false,pending:null});
    }
    return this.streams.get(stream);
  }
  identify(stream,{entity,name,server}={},at=this.clock()){
    const state=this.state(stream);if(!state)return false;
    if(!Number.isInteger(entity)||entity<=0||!validName(name)||!validServer(server)||!Number.isFinite(at)){
      if(state.key!==null){state.key=null;state.entity=null;state.trusted=false;this.revision++;}return false;
    }
    const character={name,server},key=keyOf(character);
    if(!this.collections.has(key)){
      if(this.collections.size>=MAX_STREAMS)return false;
      this.collections.set(key,emptyModel(character));
    }
    if(state.key!==key||state.entity!==entity||!state.trusted||this.selected!==key)this.revision++;
    state.key=key;state.entity=entity;state.trusted=true;this.selected=key;
    const pending=state.pending;state.pending=null;
    if(pending){
      try{
        this.apply(state,pending.init,pending.at);
        for(const {event,at:eventAt}of pending.events)this.apply(state,event,eventAt);
      }catch{this.errors++;this.revision++;state.trusted=false;}
    }
    return true;
  }
  invalidate(stream,reason='connection-closed'){
    if(!stream){if(this.streams.size){this.streams.clear();this.revision++;}return;}
    const state=this.streams.get(stream);if(!state)return;
    const soft=['stream-gap','bad-frame','sync-discard','unrecognized-stream'].includes(reason)||String(reason).includes(':0xffff:');
    if(soft){if(state.trusted){state.trusted=false;this.revision++;}return;}
    if(reason==='self-appearance'){
      state.entity=null;state.key=null;state.trusted=false;this.revision++;return;
    }
    this.streams.delete(stream);this.revision++;
  }
  apply(state,event,at){
    if(!state.key)return;
    const previous=this.collections.get(state.key);if(!previous||previous.at!==null&&at<previous.at)return;
    if(event.kind==='acquired'&&event.entity!==state.entity)return;
    if(event.kind!=='init'&&event.kind!=='acquired'&&!previous.complete)return;
    let model;
    if(event.kind==='init'){
      model={...emptyModel(previous.character),complete:true,liveConfirmed:true,at,levels:{...event.levels},souls:{...event.souls},genera:genusRecords(event.genera)};
      state.trusted=true;
    }else{
      model=copyModel(previous);model.at=at;
      if(event.kind==='acquired'){
        if(event.genus)model.genera[event.genus.key]={level:event.genus.level};
        if(!(model.levels[event.petId]??0)&&event.level>0)model.reserved.set(event.petId,PET_LEVEL_COSTS[0]);
        advance(model,event.petId,event.level);settle(model,event.petId);
      }else for(const {petId,points}of event.items){
        const next=(model.souls[petId]??0)+(event.kind==='souls-decrease'?-points:points);
        if(!isPetSoulBalance(next))throw Error('Pet soul balance outside supported range');
        if(event.kind==='souls-decrease')consume(model,petId,points);
        model.souls[petId]=next;
      }
    }
    this.collections.set(state.key,model);this.revision++;
  }
  message(packet,stream){
    if(!PET_OPCODES.has(packet.opcode))return;
    const state=this.state(stream);if(!state)return;
    try{
      const at=packet.at===undefined?this.clock():packet.at;if(!Number.isFinite(at))throw Error('Invalid pet timestamp');
      const event=readPetObservation(packet.opcode,packet.payload);
      if(state.key){this.apply(state,event,at);return;}
      if(event.kind==='init'){state.pending={init:event,at,events:[]};return;}
      if(state.pending&&at>=state.pending.at){
        if(state.pending.events.length>=MAX_PENDING)throw Error('Unbound pet event limit');
        state.pending.events.push({event,at});
      }
    }catch{
      this.errors++;this.revision++;state.pending=null;state.trusted=false;
    }
  }
  snapshot(){
    const model=this.selected?this.collections.get(this.selected):null;
    const live=!!model?.complete&&model.liveConfirmed&&[...this.streams.values()].some(state=>state.key===this.selected&&state.trusted);
    return {character:model?{...model.character}:null,status:live?'live':model?.seeded?'saved':'unknown',complete:model?.complete??false,at:model?.at??null,
      levels:{...model?.levels},souls:{...model?.souls},genera:genusRecords(model?.genera),revision:this.revision,errors:this.errors};
  }
}

export function parseQuestPetSnapshot({value}={}){
  const character=value?.character;
  if(!character||!validName(character.name)||!validServer(character.server)||!Number.isFinite(character.confirmedAt)||character.confirmedAt<0)throw new TypeError('Questlog pet owner is not confirmed');
  return {character:{name:character.name,server:character.server},status:'unknown',complete:true,at:character.confirmedAt,
    levels:records(character.levels,validLevel),souls:records(character.souls,isPetSoulBalance),genera:{}};
}
