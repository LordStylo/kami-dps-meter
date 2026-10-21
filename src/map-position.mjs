import {POSITION_OPCODES,readPositionObservation} from './protocol/position.mjs';

// Questlog's map keeps the last own-coordinate observation for one minute.
// This model deliberately has no NPC visibility-circle fitting or interpolation.
export const MAP_POSITION_FRESH_MS=60000;
const valid=position=>position&&['x','y','z'].every(key=>Number.isFinite(position[key])&&Math.abs(position[key])<1e7);

export class MapPositionTracker {
  constructor({clock=Date.now}={}){this.clock=clock;this.streams=new Map();this.errors=0;this.generationSequence=0;this.revisionSequence=0;}
  invalidate(stream){if(stream)this.streams.delete(stream);else this.streams.clear();}
  retain(stream){const state=this.streams.get(stream);if(state)state.generation=++this.generationSequence;}
  state(stream){
    if(!this.streams.has(stream)){
      if(this.streams.size>=128)return null;
      this.streams.set(stream,{self:null,position:null,at:null,source:null,quality:null,generation:++this.generationSequence,revision:null});
    }
    return this.streams.get(stream);
  }
  observe(event,stream,at){
    if(event.kind==='reset'){this.invalidate(stream);return;}
    if(!Number.isFinite(at))return;
    if(!['self','move','warp','buff-anchor'].includes(event.kind)||!valid(event.position))return;
    const state=this.state(stream);if(!state||state.at!==null&&at<state.at)return;
    if(event.kind==='self'){
      if(!Number.isInteger(event.entity)||event.entity<=0)return;
      state.self=event.entity;state.generation=++this.generationSequence;
    }else if(state.self===null||event.entity!==state.self)return;
    // The normalizer's common position emitter ignores zero XY for every
    // source. A self appearance still establishes the entity key in that case.
    if(event.position.x===0&&event.position.y===0)return;
    if(event.kind==='buff-anchor'&&event.caster!==state.self)return;
    if(event.kind==='warp')state.generation=++this.generationSequence;
    state.position={x:event.position.x,y:event.position.y,z:event.position.z};state.at=at;
    state.source=event.kind==='buff-anchor'?'self-buff-range':event.kind;
    state.quality=event.kind==='buff-anchor'?'estimated':'observed';state.revision=++this.revisionSequence;
  }
  message(packet,stream){
    if(!POSITION_OPCODES.has(packet.opcode))return;
    try{const event=readPositionObservation(packet.opcode,packet.payload);if(event)this.observe(event,stream,packet.at);}
    catch{this.errors++;} // A rejected packet cannot replace or refresh the accepted map point.
  }
  coordinates(stream,now=this.clock()){
    const state=this.streams.get(stream);if(!state?.position)return null;
    const ageMs=Math.max(0,now-state.at);
    return {x:Math.round(state.position.x),y:Math.round(state.position.y),z:Math.round(state.position.z),
      at:state.at,ageMs,fresh:now-state.at>=-1000&&ageMs<MAP_POSITION_FRESH_MS,
      quality:state.quality,source:state.source,generation:state.generation,revision:state.revision};
  }
}
