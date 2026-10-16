const sizes={dps:{width:400,height:360},cube:{width:320,height:148}};
const BAR_HEIGHT=36;
function boundsFor(panel,saved,area){
 const size=sizes[panel];
 const collapsed=panel==='dps'&&saved?.collapsed===true;
 const width=Math.min(size.width,area.width),height=collapsed?BAR_HEIGHT:Math.min(size.height,area.height);
 const fallback={x:area.x+24,y:panel==='cube'?area.y+72:area.y+area.height-height-24};
 const value=(k)=>Number.isFinite(saved?.[k])?Math.round(saved[k]):fallback[k];
 return {x:Math.max(area.x,Math.min(value('x'),area.x+area.width-width)),y:Math.max(area.y,Math.min(value('y'),area.y+area.height-height)),width,height};
}
module.exports={sizes,BAR_HEIGHT,boundsFor};
