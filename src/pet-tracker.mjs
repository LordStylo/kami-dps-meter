import {petNpcIds} from './pet-catalog.mjs';
import {PetCollectionTracker} from './pet-collection.mjs';
import {PET_OPCODES} from './protocol/pets.mjs';
import {decodePacket} from './protocol/packets.mjs';
import {readPositionObservation} from './protocol/position.mjs';

const spatialOpcodes=new Set([0x3641,0x371a,0x371b,0x371c,0x373c]);
export const MAX_LIVE_PET_NPCS=4096;
const validEntity=value=>Number.isSafeInteger(value)&&value>0&&value<10000000;
const validPosition=point=>point&&['x','y','z'].every(key=>Number.isFinite(point[key])&&Math.abs(point[key])<1e7);

// Collection ownership and nearby NPC entities have independent lifetimes.
// Static catalog spawns are never inserted into this observed-entity list.
export class PetTracker {
  constructor({npcIds=petNpcIds,collection=new PetCollectionTracker()}={}){
    this.npcIds=npcIds;this.collection=collection;this.streams=new Map();this.worldRevision=0;this.errors=0;this.npcCount=0;
  }
  get revision(){return this.worldRevision+(this.collection.revision??0);}
  clearWorld(stream){
    if(stream){const state=this.streams.get(stream);if(state){this.npcCount-=state.entities.size;this.streams.delete(stream);this.worldRevision++;}}
    else if(this.streams.size){this.streams.clear();this.npcCount=0;this.worldRevision++;}
  }
  removeEntity(state,entity){if(state.entities.delete(entity)){this.npcCount--;this.worldRevision++;}}
  invalidate(stream,reason){this.clearWorld(stream);this.collection.invalidate(stream,reason);}
  bind(stream,context){
    if(!context||context.stream!==stream||typeof context.id!=='string'){
      this.clearWorld(stream);return null;
    }
    let state=this.streams.get(stream);
    if(state?.contextId!==context.id){
      if(!state&&this.streams.size>=128)return null;
      if(state)this.npcCount-=state.entities.size;
      state={contextId:context.id,mapId:context.mapId??null,entities:new Map(),players:new Set()};
      this.streams.set(stream,state);this.worldRevision++;
    }
    return state;
  }
  reconcile(contexts){
    const active=new Set(contexts.map(context=>context.stream));
    for(const stream of this.streams.keys())if(!active.has(stream))this.clearWorld(stream);
    for(const context of contexts)this.bind(context.stream,context);
  }
  observe(event,stream,state){
    if(!state||!validEntity(event.entity))return;
    if(event.type==='player'){
      if(state.players.size<512)state.players.add(event.entity);
      this.removeEntity(state,event.entity);
    }else if(event.type==='spawn'){
      if(!this.npcIds.has(event.npc)||event.owner||state.players.has(event.entity)){
        this.removeEntity(state,event.entity);return;
      }
      this.removeEntity(state,event.entity);
      // Bound the entire capture, not 4096 records multiplied by every flow.
      if(this.npcCount>=MAX_LIVE_PET_NPCS){
        const victim=[...this.streams.values()].find(candidate=>candidate.entities.size);
        if(victim)this.removeEntity(victim,victim.entities.keys().next().value);
      }
      state.entities.set(event.entity,{entity:event.entity,npcId:event.npc,point:null,at:null,dead:Number.isFinite(event.hp)&&event.hp<=0});this.worldRevision++;
      this.npcCount++;
    }else if(event.type==='removed'){
      state.players.delete(event.entity);this.removeEntity(state,event.entity);
    }else if(event.type==='death'||event.type==='hp'){
      const entry=state.entities.get(event.entity);if(!entry)return;
      const dead=event.type==='death'?true:Number.isFinite(event.hp)?event.hp<=0:entry.dead;
      if(dead!==entry.dead){entry.dead=dead;this.worldRevision++;}
    }
  }
  message(packet,stream,context){
    if(packet.opcode===0x3621||packet.opcode===0x3633){
      this.clearWorld(stream);this.collection.invalidate(stream,packet.opcode===0x3621?'map-change':'self-appearance');
    }
    const state=this.bind(stream,context);
    if(PET_OPCODES.has(packet.opcode))this.collection.message(packet,stream);
    if(packet.error){this.errors++;this.clearWorld(stream);return;}
    let events=packet.events;
    try{if(!Array.isArray(events))events=decodePacket(packet.opcode,packet.payload,packet.at).events;}
    catch{this.errors++;this.clearWorld(stream);return;}
    for(const event of events){
      if(event.type==='player'&&event.self)this.collection.identify(stream,{entity:event.entity,name:event.name,server:event.server},packet.at);
      this.observe(event,stream,state);
    }
    if(!state||!spatialOpcodes.has(packet.opcode))return;
    try{
      // NPC appearance is the existing validated identity/spatial PREFIX,
      // not a claim that its unparsed optional tail has been decoded fully.
      const observation=readPositionObservation(packet.opcode,packet.payload),entry=state.entities.get(observation?.entity);
      if(!entry||!validPosition(observation.position)||observation.position.x===0&&observation.position.y===0||!Number.isFinite(packet.at)||entry.at!==null&&packet.at<entry.at)return;
      entry.point={x:observation.position.x,y:observation.position.y};entry.at=packet.at;this.worldRevision++;
    }catch{this.errors++;this.clearWorld(stream);}
  }
  snapshot(contexts=[]){
    this.reconcile(contexts);
    const markers=[];
    for(const [stream,state]of this.streams)for(const entry of state.entities.values()){
      if(entry.dead||!entry.point)continue;
      markers.push({id:`${state.contextId}:npc:${entry.entity}`,entity:entry.entity,npcId:entry.npcId,stream,
        contextId:state.contextId,mapId:state.mapId,x:Math.round(entry.point.x),y:Math.round(entry.point.y),z:null,at:entry.at,status:'present'});
    }
    return {collection:this.collection.snapshot(),map:{contexts,markers}};
  }
}
