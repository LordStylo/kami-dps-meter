import {POSITION_OPCODES, readPositionObservation} from './protocol/position.mjs';

// Visibility-circle model, independently implemented. The 100-units/metre and
// 55/65 m radii are reference-tool assumptions, not calibrated game constants.
export const POSITION_FRESH_MS = 3000;
// Conservative continuity guard, not a calibrated game radius or accuracy.
export const POSITION_JUMP_METERS = 120;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)/100;
export function fitVisibilityPosition(seed, samples) {
  if (samples.length<4 || samples.length>128) return null;
  let x=seed.x/100,y=seed.y/100,condition=0;
  for(let step=0;step<30;step++) {
    let a=.05,b=0,c=.05,gx=0,gy=0;
    for(const s of samples) {
      const dx=x-s.position.x/100,dy=y-s.position.y/100,d=Math.max(.001,Math.hypot(dx,dy)),e=d-s.radius;
      const ux=dx/d,uy=dy/d; a+=ux*ux;b+=ux*uy;c+=uy*uy;gx+=ux*e;gy+=uy*e;
    }
    const det=a*c-b*b;condition=det/(a+c)**2;if(det<1e-6)return null;
    const dx=(c*gx-b*gy)/det,dy=(a*gy-b*gx)/det;x-=dx;y-=dy;
    if(Math.abs(dx)+Math.abs(dy)<.001)break;
  }
  const position={x:x*100,y:y*100};
  const residual=Math.sqrt(samples.reduce((sum,s)=>sum+(distance(position,s.position)-s.radius)**2,0)/samples.length);
  // Residual is fit consistency, NOT a claimed metre accuracy. Weak geometry,
  // contradictions and large jumps suppress proximity audio.
  if(!Number.isFinite(x+y+residual)||condition<.02||residual>6||distance(seed,position)>120)return null;
  return {position,residual,condition,samples:samples.length};
}

export class PlayerPositionTracker {
  constructor({clock=Date.now}={}){this.clock=clock;this.streams=new Map();this.errors=0;this.generationSequence=0;this.revisionSequence=0;}
  invalidate(stream){if(stream)this.streams.delete(stream);else this.streams.clear();}
  suspend(stream){
    const previous=this.streams.get(stream);if(!previous)return;
    // A framing interruption on the same TCP connection does not identify a
    // different character. Keep that key, but none of the old spatial evidence.
    this.streams.set(stream,{self:previous.self,nodes:new Map(),edges:new Map(),position:null,at:0,seedAt:0,lastFitAt:-Infinity,
      quality:null,source:null,generation:++this.generationSequence,revision:0,anchor:null});
  }
  state(stream){
    if(!this.streams.has(stream)){
      if(this.streams.size>=128)return null;
      this.streams.set(stream,{self:null,nodes:new Map(),edges:new Map(),position:null,at:0,seedAt:0,lastFitAt:-Infinity,quality:null,source:null,
        generation:++this.generationSequence,revision:0,anchor:null});
    }return this.streams.get(stream);
  }
  updatePosition(s, position, at, quality, source, reset = false) {
    if (s.position && at < s.at) return false;
    const unseeded=!s.position,changed = s.quality !== quality || s.source !== source;
    const jumped = s.position && distance(s.position,position) > POSITION_JUMP_METERS;
    const interrupted = s.position && at-s.at>POSITION_FRESH_MS;
    if (reset || changed || jumped || interrupted) {
      s.generation = ++this.generationSequence; s.edges.clear(); s.lastFitAt = -Infinity; s.anchor = null;
      // A warp/respawn or a large unexplained jump also invalidates stationary
      // visibility references from the old neighborhood.
      if (reset || jumped || unseeded) { s.nodes.clear(); s.seedAt = at; }
    }
    // A visibility fit only supplies XY. Never carry a previous floor's Z
    // forward as if it had been observed at the estimated position.
    s.position={x:position.x,y:position.y,...(quality==='observed'&&Number.isFinite(position.z)&&Math.abs(position.z)<1e7?{z:position.z}:{})};s.at=at;s.quality=quality;s.source=source;
    s.revision=++this.revisionSequence;return true;
  }
  observe(event,stream,at) {
    if(event.kind==='reset'){this.invalidate(stream);return;}
    const s=this.state(stream);if(!s||!Number.isFinite(at))return;
    if(event.kind==='self'||event.kind==='arrival'){
      if (s.position && at < s.at) return;
      s.self=event.entity??s.self;this.updatePosition(s,event.position,at,'observed',event.kind,true);return;
    }
    if(event.kind==='warp'){
      if(event.entity===s.self)this.updatePosition(s,event.position,at,'observed','warp',true);
      return;
    }
    if(event.kind==='buff-anchor'){
      if(event.entity!==s.self||event.caster!==s.self||!event.position)return;
      const age=at-s.at,corroborated=!!s.position&&s.quality==='observed'&&age>=0&&age<=1000&&distance(s.position,event.position)<=2;
      // This stores corroborating area-origin evidence only. It must not make
      // an old coordinate fresh, advance a motion sample or move the player.
      s.anchor={at,source:'self-buff-range',quality:'anchor',corroborated};return;
    }
    if(event.kind==='move'){
      if(event.entity===s.self){this.updatePosition(s,event.position,at,'observed','move');s.edges.clear();}
      else if(s.nodes.has(event.entity)){
        const node=s.nodes.get(event.entity);
        // Moving NPCs cannot be a reliable stationary boundary reference.
        node.moved=true;node.position=event.position;s.edges.delete(event.entity);
      }return;
    }
    let edge;
    if(event.kind==='npc'){
      const duplicate=s.nodes.has(event.entity);
      if(s.nodes.size>=4096&&!duplicate)s.nodes.delete(s.nodes.keys().next().value);
      s.nodes.set(event.entity,{...event,moved:false});
      // Only ordinary visibility changes; respawns/teleports are not circles.
      if(duplicate||event.reason!==1)return;
      edge={entity:event.entity,position:event.position,radius:55,at};
    }else if(event.kind==='remove'){
      const node=s.nodes.get(event.entity);s.nodes.delete(event.entity);s.edges.delete(event.entity);
      if(event.reason!==1||!node||node.moved)return;
      edge={entity:event.entity,position:node.position,radius:65,at};
    }
    if(!edge||!s.position||at-s.seedAt<2000||at<s.at)return;
    s.edges.set(edge.entity,edge);
    for(const [id,e]of s.edges)if(at-e.at>4000)s.edges.delete(id);
    if(s.edges.size>128)s.edges.delete(s.edges.keys().next().value);
    if(at-s.lastFitAt<250||(s.quality==='observed'&&at-s.at<2000))return;
    s.lastFitAt=at;
    const fit=fitVisibilityPosition(s.position,[...s.edges.values()]);
    if(fit){this.updatePosition(s,fit.position,at,'estimated','visibility');s.fit={residual:fit.residual,samples:fit.samples};}
  }
  message(packet,stream){
    if(!POSITION_OPCODES.has(packet.opcode))return;
    try{const event=readPositionObservation(packet.opcode,packet.payload);if(event)this.observe(event,stream,packet.at);}
    catch{this.errors++;this.suspend(stream);}
  }
  status(stream,now=this.clock()) {
    const s=this.streams.get(stream),age=s?.position?Math.max(0,now-s.at):null;
    const fresh=!!s?.position&&now-s.at>=-1000&&age<=POSITION_FRESH_MS;
    return {quality:s?.quality??null,source:s?.source??null,at:s?.position?s.at:null,ageMs:age,
      fresh,generation:s?.generation??null,revision:s?.position?s.revision:null,
      usableForTrend:fresh&&s.self!==null&&['observed','estimated'].includes(s.quality),
      anchor:s?.anchor?{...s.anchor,ageMs:Math.max(0,now-s.anchor.at)}:null,experimental:true};
  }
  proximity(stream,position,now=this.clock()) {
    const status=this.status(stream,now),s=this.streams.get(stream);
    if(!status.fresh||!position)return {...status,distance:null};
    return {...status,distance:Math.round(distance(s.position,position)),horizontal:true};
  }
  coordinates(stream,now=this.clock()) {
    const state=this.streams.get(stream);if(!state?.position)return null;
    const status=this.status(stream,now);
    return {x:state.position.x,y:state.position.y,z:Number.isFinite(state.position.z)?state.position.z:null,
      at:status.at,ageMs:status.ageMs,fresh:status.fresh,quality:status.quality,source:status.source,
      generation:status.generation,revision:status.revision};
  }
  summary(now=this.clock()) {
    const candidates=[...this.streams.keys()].map(k=>this.status(k,now)).filter(s=>s.at!==null).sort((a,b)=>b.at-a.at);
    return candidates[0]??{quality:null,source:null,at:null,ageMs:null,fresh:false,generation:null,revision:null,usableForTrend:false,anchor:null,experimental:true};
  }
}
