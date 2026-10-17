const {interactionFor}=require('./interaction.cjs');

// The game always keeps keyboard focus during overlay mouse interaction.
// Suppress the whole app-switch gesture, including the Alt-release tick.
class FocusSession {
 constructor(){this.suppressed=false;}
 update({foreground,alt,tab,escape,windows,desktopEdit,hiddenByUser}){
  alt=!!alt;
  if((alt&&(tab||escape))||windows||(alt&&foreground!=='game'&&!desktopEdit))this.suppressed=true;
  const cancelled=this.suppressed;
  if(!alt&&!windows)this.suppressed=false;
  const policy=interactionFor({gameFocused:foreground==='game',alt,desktopEdit,hiddenByUser});
  return {
   visible:policy.visible&&!cancelled,
   interactive:policy.interactive&&!cancelled,
  };
 }
}
module.exports={FocusSession};
