// Presentation controls only; packet capture and research recording stay in
// the backend. Hiding a panel never stops its renderer or this alarm state.
class CubeAlarm {
 constructor(){this.running=false;this.muted=false;this.alertVersion=0;this.seen=new Set();}
 command(action){
  if(action==='start'){if(!this.running)this.seen.clear();this.running=true;}
  else if(action==='stop')this.running=false;
  else if(action==='mute')this.muted=!this.muted;
  else return false;
  return true;
 }
 update(state,connected){
  if(!connected||state?.mode!=='live'||state.capture?.state!=='capturing')return false;
  const active=(state.cubes?.active||[]).filter(c=>c.status==='present');
  const keys=new Set(active.map(c=>`${state.cubes.epoch}:${c.id??c.sequence}:${c.sequence}`));
  const fresh=this.running&&[...keys].some(key=>!this.seen.has(key));
  this.seen=keys;
  if(fresh)this.alertVersion++;
  return fresh;
 }
 snapshot(){return {running:this.running,muted:this.muted,alertVersion:this.alertVersion};}
}
module.exports={CubeAlarm};
