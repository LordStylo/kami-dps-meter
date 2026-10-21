// Map visibility is independent of alarm Start/Stop and mute preferences.
// A sequence watermark also prevents an old snapshot reviving a hidden cube.
class CubeMapVisibility {
 constructor(saved){
  const valid=typeof saved?.epoch==='string'&&saved.epoch.length>0&&saved.epoch.length<=256&&Number.isSafeInteger(saved.sequence)&&saved.sequence>=0;
  this.epoch=valid?saved.epoch:null;this.sequence=valid?saved.sequence:0;
 }
 snapshot(){return {epoch:this.epoch,sequence:this.sequence};}
 update(state,connected){
  const epoch=state?.cubes?.epoch;
  if(typeof epoch!=='string'||!epoch)return false;
  if(epoch!==this.epoch){this.epoch=epoch;this.sequence=0;}
  let sequence=this.sequence;
  for(const cube of Array.isArray(state.cubes.active)?state.cubes.active:[])
   if(cube?.status==='present'&&Number.isSafeInteger(cube.sequence)&&cube.sequence>0&&typeof cube.id==='string'&&cube.id.length>0)sequence=Math.max(sequence,cube.sequence);
  const fresh=sequence>this.sequence;this.sequence=sequence;
  const age=state.capture?.statusAgeMs;
  const healthyAge=age===undefined||age===null||Number.isFinite(age)&&age>=0&&age<=2500;
  return !!connected&&state.mode==='live'&&state.capture?.state==='capturing'&&healthyAge&&fresh;
 }
}
module.exports={CubeMapVisibility};
