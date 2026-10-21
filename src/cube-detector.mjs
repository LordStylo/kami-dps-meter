import {randomUUID} from 'node:crypto';
import {readWorldEvidence} from './research/world-evidence.mjs';
import {Reader} from './protocol/reader.mjs';
import {PlayerPositionTracker} from './player-position.mjs';
import {MapPositionTracker} from './map-position.mjs';
import {CubeProximityTracker,cubePositionUsable} from './cube-proximity.mjs';

// Experimental allowlist: one marked capture linked this template to a cube.
// An appearance is an interest-area signal, not a measured distance.
export const CUBE_TEMPLATE = 1200039;
const SOFT_STREAM_ISSUES=new Set(['stream-gap','bad-frame','sync-discard','unrecognized-stream']);
const RETAIN_MAP_ISSUES=new Set(['stream-silent','schema-error']);
export class CubeDetector {
  constructor({clock=Date.now,onChange=()=>{},onPosition=()=>{}}={}) {
    this.clock=clock;this.onChange=onChange;this.epoch=randomUUID();this.revision=0;
    this.sequence=0;this.active=new Map();this.recent=[];this.lastSeen=new Map();this.parseErrors=0;
    this.player=new PlayerPositionTracker({clock});this.positions=new Map();this.onPosition=onPosition;this.proximity=new CubeProximityTracker();
    this.mapPlayer=new MapPositionTracker({clock});
    this.contexts=new Map();this.contextSequence=0;
  }
  snapshot() {
    const now=this.clock(),copy=x=>({...x,proximity:x.status==='present'?this.proximity.snapshot(x.id,this.player.proximity(x.stream,this.positions.get(x.id),now),now):null});
    return {experimental:true,templates:[CUBE_TEMPLATE],epoch:this.epoch,revision:this.revision,total:this.sequence,
      active:[...this.active.values()].map(copy),recent:this.recent.map(copy),parseErrors:this.parseErrors,position:this.player.summary(now),
      map:{contexts:[...this.contexts.values()].map(context=>({...context,player:this.mapPlayer.coordinates(context.stream,now)})),
        markers:[...this.active.values()].flatMap(entry=>{
          const position=this.positions.get(entry.id),context=this.contexts.get(entry.stream);
          if(!position||!context||context.id!==entry.contextId)return [];
          return [{id:entry.id,sequence:entry.sequence,contextId:context.id,mapId:context.mapId,
            x:position.x,y:position.y,z:Number.isFinite(position.z)?position.z:null,detectedAt:entry.detectedAt,status:'present'}];
        })}};
  }
  end(key,reason,at=this.clock()) {
    const entry=this.active.get(key);if(!entry)return;
    this.active.delete(key);entry.status=reason==='disappeared'?'disappeared':'uncertain';entry.endedAt=at;entry.reason=reason;
    this.positions.delete(entry.id);
    this.proximity.remove(entry.id);
    this.revision++;this.onChange({kind:'cube-alert',event:entry.status,at,entity:entry.entity,stream:entry.stream,
      template:entry.template,alertId:entry.id,sequence:entry.sequence,reason,experimental:true});
  }
  context(stream,at=this.clock()) {
    if(!this.contexts.has(stream)){
      if(this.contexts.size>=128){
        const old=[...this.contexts.values()].find(context=>context.mapId===null&&!this.lastSeen.has(context.stream));
        if(old)this.contexts.delete(old.stream);else return null;
      }
      this.contexts.set(stream,{id:`${this.epoch}:map:${++this.contextSequence}`,stream,mapId:null,mapState:'unknown',confirmedAt:null,enteredAt:at,observedAt:at});
    }
    return this.contexts.get(stream);
  }
  resetContext(stream,at,mapId=null,enteredAt=at,metadata={}) {
    const previous=this.contexts.get(stream),context=this.context(stream,at);if(!context)return;
    const identity={mapId,mapState:mapId===null?'unknown':metadata.mapState??'confirmed',confirmedAt:mapId===null?null:metadata.confirmedAt??at};
    if(!previous){Object.assign(context,{...identity,enteredAt,observedAt:at});return;}
    this.contexts.set(stream,{id:`${this.epoch}:map:${++this.contextSequence}`,stream,...identity,enteredAt,observedAt:at});
    this.revision++;
  }
  invalidate(stream,reason,at=this.clock(),contextOptions=null) {
    const soft=!!stream&&(SOFT_STREAM_ISSUES.has(reason)||typeof reason==='string'&&reason.includes(':0xffff:'));
    const retainMap=!!stream&&(soft||RETAIN_MAP_ISSUES.has(reason));
    const previous=stream?this.contexts.get(stream):null;
    if(soft)this.player.suspend(stream);else this.player.invalidate(stream);
    if(retainMap)this.mapPlayer.retain(stream);else this.mapPlayer.invalidate(stream);
    for(const [key,entry] of this.active)if(!stream||entry.stream===stream)this.end(key,reason,at);
    if(stream)this.lastSeen.delete(stream);else this.lastSeen.clear();
    if(!stream)this.contexts.clear();
    else if(reason==='connection-closed')this.contexts.delete(stream);
    else if(retainMap&&previous)this.resetContext(stream,at,previous.mapId,previous.enteredAt,{mapState:'retained',confirmedAt:previous.confirmedAt});
    else if(this.contexts.has(stream)||contextOptions)this.resetContext(stream,at,contextOptions?.mapId??null,contextOptions?.enteredAt??at,contextOptions??{});
  }
  tick() {
    const now=this.clock();
    for(const [stream,at] of this.lastSeen)if(now-at>15000)this.invalidate(stream,'stream-silent',now);
  }
  message(packet,stream) {
    if(this.lastSeen.size<128||this.lastSeen.has(stream))this.lastSeen.set(stream,this.clock());
    if(packet.opcode===0x3621){
      let mapId=null;
      try{
        // PrepareEnterMap_NT's validated prefix: enterMapTicket i32, mapId i32.
        // The ticket is not an instance identifier and must not key map reuse.
        const reader=new Reader(packet.payload);reader.i32();mapId=reader.i32();
        if(mapId<=0)throw Error('Invalid map ID');
      }catch{mapId=null;this.parseErrors++;}
      this.invalidate(stream,'map-change',packet.at,{mapId});this.observePosition(packet,stream);this.revision++;return;
    }
    if(packet.opcode===0x3633){
      const previous=this.contexts.get(stream);
      this.invalidate(stream,'map-change',packet.at,{mapId:previous?.mapId??null,enteredAt:previous?.enteredAt??packet.at,
        mapState:previous?.mapState,confirmedAt:previous?.confirmedAt});
      this.observePosition(packet,stream);this.revision++;return;
    }
    this.observePosition(packet,stream);
    if(packet.opcode!==0x3634&&packet.opcode!==0x3635)return;
    try {
      const [event]=readWorldEvidence(packet.opcode,packet.payload),key=stream+':'+event.entity;
      if(event.kind==='object-disappear'){this.end(key,'disappeared',packet.at);return;}
      // Only accept the exact prefix header and suffix length observed in the
      // first capture; unrelated objects and schema drift cannot trigger audio.
      if(event.template!==CUBE_TEMPLATE||event.headerWord!==4||event.unparsedBytes!==34){
        if(this.active.has(key))this.end(key,'entity-reused',packet.at);return;
      }
      if(this.active.has(key))return; // duplicate appearance: no repeated alarm
      if(this.active.size>=128)this.end(this.active.keys().next().value,'capacity',packet.at);
      const sequence=++this.sequence;
      const context=this.context(stream,packet.at);
      const entry={id:this.epoch+':'+sequence,sequence,entity:event.entity,stream,template:event.template,
        detectedAt:packet.at,receivedAt:this.clock(),status:'present',endedAt:null,reason:null,contextId:context?.id??null};
      const spatial=new Reader(packet.payload);spatial.vi32();spatial.u16();spatial.i32();
      const position=spatial.vec();if(cubePositionUsable(position))this.positions.set(entry.id,position);
      this.active.set(key,entry);this.recent.unshift(entry);this.recent.length=Math.min(this.recent.length,30);
      this.observeProximity(entry,this.player.status(stream,this.clock()));
      this.revision++;this.onChange({kind:'cube-alert',event:'appeared',at:packet.at,entity:entry.entity,stream,
        template:entry.template,alertId:entry.id,sequence,experimental:true});
    }catch{
      this.parseErrors++;this.revision++;
      // A malformed removal can hide a disappearance; invalidate this stream.
      this.invalidate(stream,'schema-error',packet.at);
    }
  }
  observePosition(packet,stream) {
    const mapBefore=this.mapPlayer.coordinates(stream,packet.at);
    this.mapPlayer.message(packet,stream);
    const mapAfter=this.mapPlayer.coordinates(stream,packet.at);
    if(mapAfter&&mapAfter.revision!==mapBefore?.revision){this.context(stream,packet.at);this.revision++;}
    const before=this.player.status(stream,packet.at);
    this.player.message(packet,stream);
    const after=this.player.status(stream,packet.at),s=this.player.streams.get(stream);
    const changed=after.revision!==undefined?after.revision!==before.revision:after.at!==before.at;
    if(after.at===null){if(before.at!==null)this.proximity.clearStream(stream,'position-unavailable');return;}
    if(changed){
      this.context(stream,packet.at);
      for(const entry of this.active.values())if(entry.stream===stream)this.observeProximity(entry,this.player.status(stream,this.clock()));
      this.onPosition({kind:'player-position',at:after.at,stream,
        quality:after.quality,source:after.source,position:{...s.position},fit:s.quality==='estimated'?{...s.fit}:null,experimental:true});
    }
  }
  observeProximity(entry,status){this.proximity.observe(entry.id,entry.stream,this.positions.get(entry.id),status,this.player.streams.get(entry.stream)?.position,this.clock());}
}
