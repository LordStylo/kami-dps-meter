const fs=require('node:fs'),path=require('node:path');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const id=n=>Number.isSafeInteger(n)&&n>0;
const localImage=value=>typeof value==='string'&&/^\/(?:maps|pet-maps)\/[A-Za-z0-9_-]+\.webp$/.test(value);
function readMaps(root){
 const catalogs=['world-maps.json','pet-maps.json'].map(file=>JSON.parse(fs.readFileSync(path.join(root,'data',file),'utf8'))),seen=new Set();
 if(catalogs.some(raw=>raw.version!==1||!Array.isArray(raw.maps)))throw Error('Invalid pet-map catalog');
 return catalogs.flatMap(raw=>raw.maps).map(m=>{
  if(!id(m.id)||typeof m.name!=='string'||![m.width,m.height,m.originX,m.originY,m.rows,m.columns,m.cellUnits,m.tileSize].every(finite)||m.width<=0||m.height<=0||m.width>16384||m.height>16384||m.rows<=0||m.columns<=0||m.cellUnits<=0||m.tileSize<=0||m.width!==m.columns*m.tileSize||m.height!==m.rows*m.tileSize)throw Error('Invalid pet-map projection');
  if(seen.has(m.id))throw Error('Duplicate pet-map region');seen.add(m.id);
  const result={id:m.id,name:m.name.slice(0,120),width:m.width,height:m.height,originX:m.originX,originY:m.originY,rows:m.rows,columns:m.columns,cellUnits:m.cellUnits,tileSize:m.tileSize,image:null};
  const asset=image=>{if(!localImage(image)||!fs.existsSync(path.join(root,'public',image.slice(1))))throw Error('Invalid local pet-map asset');return image;};
  if(m.image)result.image=asset(m.image);
  else{if(!Array.isArray(m.tiles)||!m.tiles.length||m.tiles.length>16)throw Error('Invalid pet-map tiles');result.tiles=m.tiles.map(t=>{if(![t.x,t.y,t.width,t.height].every(finite)||t.x<0||t.y<0||t.width<=0||t.height<=0||t.x+t.width>m.width||t.y+t.height>m.height)throw Error('Invalid pet-map tile bounds');return {image:asset(t.image),x:t.x,y:t.y,width:t.width,height:t.height};});}
  return result;
 });
}
class PetMapSelection{
 constructor(root){
  this.maps=readMaps(root);this.pet=null;this.spawns=[];this.preferredMapId=null;this.revision=0;
  const raw=JSON.parse(fs.readFileSync(path.join(root,'data','pets.json'),'utf8'));
  if(raw.version!==1||!Array.isArray(raw.pets)||!Array.isArray(raw.spawns))throw Error('Invalid pet catalog');
  this.pets=new Map();this.byNpc=new Map();
  for(const p of raw.pets){if(!id(p.id)||typeof p.name!=='string'||!Array.isArray(p.monsters))throw Error('Invalid pet identity');const monsters=p.monsters.map(n=>{if(!id(n.id))throw Error('Invalid pet NPC');return {id:n.id,name:typeof n.name==='string'?n.name.slice(0,160):'NPC #'+n.id};});this.pets.set(p.id,{id:p.id,name:p.name.slice(0,160),genus:typeof p.genus==='string'?p.genus:null,monsters});}
  for(const s of raw.spawns){if(!id(s.npcId)||!id(s.mapId)||![s.x,s.y].every(finite))throw Error('Invalid pet spawn');if(!this.byNpc.has(s.npcId))this.byNpc.set(s.npcId,[]);this.byNpc.get(s.npcId).push({id:String(s.id).slice(0,100),npcId:s.npcId,mapId:s.mapId,x:s.x,y:s.y,z:finite(s.z)?s.z:null});}
 }
 select(petId,mapId=null){
  if(!id(petId)||mapId!==null&&!id(mapId))throw Error('Geçersiz pet veya bölge seçimi');
  const pet=this.pets.get(petId);if(!pet)throw Error('Pet yerel katalogda bulunamadı');
  const spawns=pet.monsters.flatMap(n=>this.byNpc.get(n.id)||[]);if(spawns.length>4096)throw Error('Pet konum sınırı aşıldı');
  if(mapId!==null&&!spawns.some(s=>s.mapId===mapId)&&!this.maps.some(m=>m.id===mapId))throw Error('Bölge pet veya harita kataloğunda bulunamadı');
  this.pet={...pet,mapIds:[...new Set(spawns.map(s=>s.mapId))]};this.spawns=spawns;this.preferredMapId=mapId;this.revision++;
  return this.summary();
 }
 summary(){return this.pet?{petId:this.pet.id,name:this.pet.name,mapId:this.preferredMapId,revision:this.revision}:null;}
 snapshot(){return {revision:this.revision,pet:this.pet,spawns:this.spawns,maps:this.maps,preferredMapId:this.preferredMapId};}
}
module.exports={PetMapSelection};
