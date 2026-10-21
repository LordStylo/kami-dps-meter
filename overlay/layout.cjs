const sizes={dps:{width:232,height:210},cube:{width:206,height:206},'cube-map':{width:360,height:360},'pet-map':{width:420,height:420},controls:{width:44,height:44}};
const BAR_HEIGHT=36;
const SETTINGS_HEIGHT=232,DEFAULT_TRANSPARENCY=8;
const transparencyFor=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,Math.round(value))):DEFAULT_TRANSPARENCY;
const dpsLimits={minWidth:220,minHeight:150,maxWidth:800,maxHeight:800};
function migrateDpsLayout(saved){
 if(saved?.compactVersion>=1)return saved;
 // Apply the requested compact size once; later manual resizing stays intact.
 return {...saved,...sizes.dps,compactVersion:1};
}
function dpsSize(saved){
 const dimension=(key,min,max)=>Number.isFinite(saved?.[key])?Math.max(min,Math.min(max,Math.round(saved[key]))):sizes.dps[key];
 return {width:dimension('width',dpsLimits.minWidth,dpsLimits.maxWidth),height:dimension('height',dpsLimits.minHeight,dpsLimits.maxHeight)};
}
function resizeBounds(start,delta,area){
 const maxWidth=Math.max(1,Math.min(dpsLimits.maxWidth,area.x+area.width-start.x));
 const maxHeight=Math.max(1,Math.min(dpsLimits.maxHeight,area.y+area.height-start.y));
 const clamp=(value,min,max)=>Math.max(Math.min(min,max),Math.min(max,Math.round(value)));
 return {x:start.x,y:start.y,width:clamp(start.width+delta.x,dpsLimits.minWidth,maxWidth),height:clamp(start.height+delta.y,dpsLimits.minHeight,maxHeight)};
}
function boundsFor(panel,saved,area){
 const size=panel==='dps'?dpsSize(saved):panel==='controls'&&saved?.controlsOpen?{width:224,height:292}:sizes[panel];
 const collapsed=panel==='dps'&&saved?.collapsed===true;
 const width=Math.min(size.width,area.width),height=panel==='dps'&&saved?.settingsOpen?Math.min(SETTINGS_HEIGHT,area.height):collapsed?BAR_HEIGHT:Math.min(size.height,area.height);
 const fallback={x:area.x+(panel==='pet-map'?638:panel==='cube-map'?254:24),y:panel==='controls'?area.y+16:['cube','cube-map','pet-map'].includes(panel)?area.y+72:area.y+area.height-height-24};
 const value=(k)=>Number.isFinite(saved?.[k])?Math.round(saved[k]):fallback[k];
 return {x:Math.max(area.x,Math.min(value('x'),area.x+area.width-width)),y:Math.max(area.y,Math.min(value('y'),area.y+area.height-height)),width,height};
}
module.exports={sizes,BAR_HEIGHT,boundsFor,transparencyFor,dpsSize,resizeBounds,migrateDpsLayout};
