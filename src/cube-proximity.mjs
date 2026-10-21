// Trend is an approximate horizontal change, never a calibrated metre accuracy
// or a replacement for the independent object-presence alarm.
export const CUBE_TREND_MIN_MS=500;
export const CUBE_TREND_MAX_GAP_MS=3000;
export const CUBE_TREND_LIMITS=Object.freeze({
  observed:Object.freeze({enter:1.5,continue:.6,displacement:1.5,jump:30,speed:30}),
  estimated:Object.freeze({enter:4,continue:2,displacement:4,jump:20,speed:20}),
});
export const cubePositionUsable=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<1e7&&Math.abs(p.y)<1e7&&
  (p.z===undefined||Number.isFinite(p.z)&&Math.abs(p.z)<1e7);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)/100;
const unknown=(reason,count=0)=>({trend:'unknown',trendReason:reason,changeMeters:null,sampleCount:count});

export class CubeProximityTracker {
  constructor(){this.states=new Map();}
  remove(id){this.states.delete(id);}
  reset(id,reason='position-unavailable'){
    const row=this.states.get(id);
    if(row){row.anchor=null;row.previous=null;row.revision=null;row.count=0;row.result=unknown(reason);}
  }
  clearStream(stream,reason='position-unavailable'){
    for(const [id,row]of this.states)if(!stream||row.stream===stream)this.reset(id,reason);
  }
  seed(row,status,position,cube,now,reason){
    row.generation=status.generation??null;row.quality=status.quality;row.source=status.source;
    row.revision=status.revision??status.at;row.cube={x:cube.x,y:cube.y};
    row.previous={at:status.at,position:{x:position.x,y:position.y}};
    row.anchor={...row.previous,distance:distance(position,cube)};
    row.count=1;row.comparedAt=status.at;row.lastNow=now;row.result=unknown(reason,1);
  }
  observe(id,stream,cube,status,position,now) {
    let row=this.states.get(id);
    if(!row){
      if(this.states.size>=128)this.states.delete(this.states.keys().next().value);
      row={stream,anchor:null,previous:null,revision:null,count:0,result:unknown('position-unavailable')};this.states.set(id,row);
    }
    if(!status?.fresh||status.usableForTrend===false||!cubePositionUsable(position)||!cubePositionUsable(cube)||!Number.isFinite(status.at)){
      this.reset(id,status?.at===null?'position-unavailable':!status?.fresh?'position-stale':'position-unusable');return;
    }
    const limits=CUBE_TREND_LIMITS[status.quality];
    if(!limits){this.reset(id,'position-quality-unknown');return;}
    const revision=status.revision??status.at;
    if(row.stream!==stream){row.stream=stream;this.seed(row,status,position,cube,now,'stream-changed');return;}
    if(!row.anchor){this.seed(row,status,position,cube,now,row.result.trendReason==='position-unavailable'?'collecting':row.result.trendReason);return;}
    if(now<row.lastNow){this.reset(id,'clock-reversed');return;}
    row.lastNow=now;
    if((status.generation??null)!==row.generation||status.quality!==row.quality||status.source!==row.source){
      this.seed(row,status,position,cube,now,'position-reset');return;
    }
    if(cube.x!==row.cube.x||cube.y!==row.cube.y){this.seed(row,status,position,cube,now,'cube-position-changed');return;}
    // Repeated HTTP/SSE snapshots and repeated revisions are not samples.
    if(revision===row.revision)return;
    const elapsed=status.at-row.previous.at;
    if(elapsed<=0){this.reset(id,'time-not-increasing');return;}
    if(elapsed>CUBE_TREND_MAX_GAP_MS){this.seed(row,status,position,cube,now,'position-gap');return;}
    const step=distance(position,row.previous.position);
    if(step>limits.jump||step/(elapsed/1000)>limits.speed){this.seed(row,status,position,cube,now,'position-jump');return;}
    row.previous={at:status.at,position:{x:position.x,y:position.y}};row.revision=revision;
    if(status.at-row.comparedAt<CUBE_TREND_MIN_MS)return;
    row.comparedAt=status.at;
    const current=distance(position,cube),change=current-row.anchor.distance,movement=distance(position,row.anchor.position);
    const previous=row.result.trend,sameDirection=previous==='approaching'&&change<0||previous==='receding'&&change>0;
    const threshold=sameDirection?limits.continue:limits.enter;
    let trend='steady',reason=movement<limits.displacement?'below-displacement-threshold':'within-deadband';
    if(movement>=limits.displacement&&Math.abs(change)>=threshold){
      trend=change<0?'approaching':'receding';reason='distance-change';
    }
    row.count++;
    row.result={trend,trendReason:reason,changeMeters:Math.round(change*10)/10,sampleCount:row.count};
    // Keep the reference while small genuine steps accumulate. Refresh it
    // after a directional result or at three seconds to bound long-term drift.
    if(trend==='approaching'||trend==='receding'||status.at-row.anchor.at>=CUBE_TREND_MAX_GAP_MS)
      row.anchor={at:status.at,position:{x:position.x,y:position.y},distance:current};
  }
  snapshot(id,proximity,now) {
    const row=this.states.get(id);
    if(!proximity?.fresh||!Number.isFinite(proximity?.distance)||proximity.usableForTrend===false){
      const reason=proximity?.at===null?'position-unavailable':!proximity?.fresh?'position-stale':'position-unusable';
      this.reset(id,reason);return {...proximity,...unknown(reason)};
    }
    if(!row)return {...proximity,...unknown('collecting')};
    if(row.previous&&now-row.previous.at>CUBE_TREND_MAX_GAP_MS){this.reset(id,'trend-stale');return {...proximity,...unknown('trend-stale')};}
    if(now<row.lastNow){this.reset(id,'clock-reversed');return {...proximity,...unknown('clock-reversed')};}
    row.lastNow=now;
    if((proximity.generation??null)!==row.generation||proximity.quality!==row.quality||proximity.source!==row.source){
      this.reset(id,'position-reset');return {...proximity,...unknown('position-reset')};
    }
    return {...proximity,...row.result};
  }
}
