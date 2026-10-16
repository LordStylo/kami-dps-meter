import {randomUUID} from 'node:crypto';
import {readWorldEvidence} from './research/world-evidence.mjs';
import {Reader} from './protocol/reader.mjs';
import {PlayerPositionTracker} from './player-position.mjs';

// Experimental allowlist: one marked capture linked this template to a cube.
// An appearance is an interest-area signal, not a measured distance.
export const CUBE_TEMPLATE = 1200039;
export class CubeDetector {
  constructor({clock=Date.now,onChange=()=>{},onPosition=()=>{}}={}) {
    this.clock=clock;this.onChange=onChange;this.epoch=randomUUID();this.revision=0;
    this.sequence=0;this.active=new Map();this.recent=[];this.lastSeen=new Map();this.parseErrors=0;
    this.player=new PlayerPositionTracker({clock});this.positions=new Map();this.onPosition=onPosition;
  }
  snapshot() {
    const now=this.clock(),copy=x=>({...x,proximity:x.status==='present'?this.player.proximity(x.stream,this.positions.get(x.id),now):null});
    return {experimental:true,templates:[CUBE_TEMPLATE],epoch:this.epoch,revision:this.revision,total:this.sequence,
      active:[...this.active.values()].map(copy),recent:this.recent.map(copy),parseErrors:this.parseErrors,position:this.player.summary(now)};
  }
  end(key,reason,at=this.clock()) {
    const entry=this.active.get(key);if(!entry)return;
    this.active.delete(key);entry.status=reason==='disappeared'?'disappeared':'uncertain';entry.endedAt=at;entry.reason=reason;
    this.positions.delete(entry.id);
    this.revision++;this.onChange({kind:'cube-alert',event:entry.status,at,entity:entry.entity,stream:entry.stream,
      template:entry.template,alertId:entry.id,sequence:entry.sequence,reason,experimental:true});
  }
  invalidate(stream,reason,at=this.clock()) {
    this.player.invalidate(stream);
    for(const [key,entry] of this.active)if(!stream||entry.stream===stream)this.end(key,reason,at);
    if(stream)this.lastSeen.delete(stream);else this.lastSeen.clear();
  }
  tick() {
    const now=this.clock();
    for(const [stream,at] of this.lastSeen)if(now-at>15000)this.invalidate(stream,'stream-silent',now);
  }
  message(packet,stream) {
    if(this.lastSeen.size<128||this.lastSeen.has(stream))this.lastSeen.set(stream,this.clock());
    if(packet.opcode===0x3621||packet.opcode===0x3633){this.invalidate(stream,'map-change',packet.at);this.observePosition(packet,stream);return;}
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
      const entry={id:this.epoch+':'+sequence,sequence,entity:event.entity,stream,template:event.template,
        detectedAt:packet.at,receivedAt:this.clock(),status:'present',endedAt:null,reason:null};
      const spatial=new Reader(packet.payload);spatial.vi32();spatial.u16();spatial.i32();
      this.positions.set(entry.id,spatial.vec());
      this.active.set(key,entry);this.recent.unshift(entry);this.recent.length=Math.min(this.recent.length,30);
      this.revision++;this.onChange({kind:'cube-alert',event:'appeared',at:packet.at,entity:entry.entity,stream,
        template:entry.template,alertId:entry.id,sequence,experimental:true});
    }catch{
      this.parseErrors++;this.revision++;
      // A malformed removal can hide a disappearance; invalidate this stream.
      this.invalidate(stream,'schema-error',packet.at);
    }
  }
  observePosition(packet,stream) {
    const before=this.player.status(stream,packet.at).at;
    this.player.message(packet,stream);
    const after=this.player.status(stream,packet.at),s=this.player.streams.get(stream);
    if(after.at!==null&&after.at!==before)this.onPosition({kind:'player-position',at:after.at,stream,
      quality:after.quality,source:after.source,position:{...s.position},fit:s.quality==='estimated'?{...s.fit}:null,experimental:true});
  }
}
