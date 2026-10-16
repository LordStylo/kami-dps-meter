import {POSITION_OPCODES, readPositionObservation} from './protocol/position.mjs';

// Visibility-circle model, independently implemented. The 100-units/metre and
// 55/65 m radii are reference-tool assumptions, not calibrated game constants.
export const POSITION_FRESH_MS = 3000;
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
  constructor({clock=Date.now}={}){this.clock=clock;this.streams=new Map();this.errors=0;}
  invalidate(stream){if(stream)this.streams.delete(stream);else this.streams.clear();}
  state(stream){
    if(!this.streams.has(stream)){
      if(this.streams.size>=128)return null;
      this.streams.set(stream,{self:null,nodes:new Map(),edges:new Map(),position:null,at:0,seedAt:0,lastFitAt:-Infinity,quality:null,source:null});
    }return this.streams.get(stream);
  }
  observe(event,stream,at) {
    if(event.kind==='reset'){this.invalidate(stream);return;}
    const s=this.state(stream);if(!s||!Number.isFinite(at))return;
    if(event.kind==='self'||event.kind==='arrival'){
      s.self=event.entity??s.self;s.position={x:event.position.x,y:event.position.y};s.at=at;s.seedAt=at;
      s.quality='observed';s.source=event.kind;s.nodes.clear();s.edges.clear();s.lastFitAt=-Infinity;return;
    }
    if(event.kind==='move'){
      if(event.entity===s.self){s.position={x:event.position.x,y:event.position.y};s.at=at;s.quality='observed';s.source='move';s.edges.clear();}
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
    if(fit){s.position=fit.position;s.at=at;s.quality='estimated';s.source='visibility';s.fit={residual:fit.residual,samples:fit.samples};}
  }
  message(packet,stream){
    if(!POSITION_OPCODES.has(packet.opcode))return;
    try{const event=readPositionObservation(packet.opcode,packet.payload);if(event)this.observe(event,stream,packet.at);}
    catch{this.errors++;this.invalidate(stream);}
  }
  status(stream,now=this.clock()) {
    const s=this.streams.get(stream),age=s?.position?Math.max(0,now-s.at):null;
    return {quality:s?.quality??null,source:s?.source??null,at:s?.position?s.at:null,ageMs:age,
      fresh:!!s?.position&&now-s.at>=-1000&&age<=POSITION_FRESH_MS,experimental:true};
  }
  proximity(stream,position,now=this.clock()) {
    const status=this.status(stream,now),s=this.streams.get(stream);
    if(!status.fresh||!position)return {...status,distance:null};
    return {...status,distance:Math.round(distance(s.position,position)),horizontal:true};
  }
  summary(now=this.clock()) {
    const candidates=[...this.streams.keys()].map(k=>this.status(k,now)).filter(s=>s.at!==null).sort((a,b)=>b.at-a.at);
    return candidates[0]??{quality:null,source:null,at:null,ageMs:null,fresh:false,experimental:true};
  }
}
