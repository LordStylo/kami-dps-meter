// Download public game facts/art only. No player information is sent anywhere.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const inputDir=process.argv.find(a=>a.startsWith('--input-dir='))?.slice(12);
const language='en';
const sourceFor=route=>{const u=new URL('https://questlog.gg/aion-2/api/trpc/'+route);u.searchParams.set('input',JSON.stringify({language}));return u.href;};
async function read(route){
 const body=inputDir?JSON.parse(await fs.readFile(path.resolve(root,inputDir,route+'.json'),'utf8')):await(async()=>{const r=await fetch(sourceFor(route),{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${route}: HTTP ${r.status}`);return r.json();})();
 const result=body.result?.data;if(!Array.isArray(result))throw Error('Invalid public '+route);return result;
}
const [rawPets,rawMarkers]=await Promise.all([read('map.getPets'),read('map.getMarkers')]);
if(rawPets.length<100||rawPets.length>1500||rawMarkers.length>200000)throw Error('Unexpected public catalog size');
const positive=id=>Number.isSafeInteger(id)&&id>0;
const label=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const pets=[],ids=new Set(),icons=new Map(),npcIds=new Set();
for(const p of rawPets){
 if(!positive(p.id)||ids.has(p.id)||!label(p.name)||!['special','intellect','nature','feral','trans'].includes(p.genus)||p.needSoul!==5||!Array.isArray(p.monsters))throw Error('Invalid pet fact');
 ids.add(p.id);
 const monsters=p.monsters.map(n=>{if(!positive(n.id)||!label(n.name))throw Error('Invalid NPC fact');npcIds.add(n.id);return {id:n.id,name:n.name,level:Number.isSafeInteger(n.level)?n.level:null,named:n.named===true};});
 let icon=null;
 if(typeof p.icon==='string'&&/^\/assets\/Game\/UI\/Resource\/Texture\/Portrait\/[A-Za-z0-9_/.]+$/.test(p.icon)){
  const stem=p.icon.slice(0,p.icon.lastIndexOf('.')),name=path.basename(stem)+'.webp';icon='/icons/pets/'+name;icons.set(icon,'https://cdn.questlog.gg/aion-2'+stem+'.webp');
 }
 const stats=(p.stats||[]).filter(s=>Number.isInteger(s.level)&&s.level>=1&&s.level<=3&&Array.isArray(s.stats)).map(s=>({level:s.level,stats:s.stats.filter(v=>typeof v.id==='string'&&/^[A-Za-z0-9_]+$/.test(v.id)&&Number.isFinite(v.value)).map(v=>({id:v.id,value:v.value}))}));
 pets.push({id:p.id,name:p.name,genus:p.genus,needSoul:5,icon,monsters,sources:(p.sources||[]).filter(s=>positive(s.id)&&label(s.name)).map(s=>({id:s.id,name:s.name})),stats});
}
const spawns=[],spawnIds=new Set();
for(const marker of rawMarkers){
 const npcId=Number(marker.dbId),mapId=Number(marker.mapWorldId);
 if(marker.dbType!=='npc'||marker.mapType!=='monster'||!npcIds.has(npcId))continue;
 if(!positive(mapId)||!Array.isArray(marker.coordinates))throw Error('Invalid spawn group');
 for(const [index,xy]of marker.coordinates.entries()){
  if(!Array.isArray(xy)||xy.length<2||!xy.slice(0,2).every(v=>Number.isFinite(v)&&Math.abs(v)<1e7))throw Error('Invalid spawn coordinates');
  const id=String(marker.id)+':'+index;if(spawnIds.has(id))continue;spawnIds.add(id);
  // Public markers use [rawX,-rawY]. Convert once to raw game coordinates,
  // matching live NPC XYZ before the common map projection is applied.
  spawns.push({id,mapId,npcId,x:xy[0],y:-xy[1],z:null});
 }
}
const assets={},missingIcons=[];
await fs.mkdir(path.join(root,'public/icons/pets'),{recursive:true});
const jobs=[...icons];
for(let i=0;i<jobs.length;i+=6)await Promise.all(jobs.slice(i,i+6).map(async([icon,url])=>{
 try{
  const filename=path.join(root,'public',icon.slice(1));let bytes;
  try{bytes=await fs.readFile(filename);}catch{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://questlog.gg/aion-2/en/db/pets'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);bytes=Buffer.from(await r.arrayBuffer());}
  if(bytes.length>512*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Invalid pet icon');
  await fs.writeFile(filename,bytes);assets[icon]={source:url,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
 }catch(error){missingIcons.push({icon,error:error.message});for(const pet of pets)if(pet.icon===icon)pet.icon=null;}
}));
const catalog={version:1,language,retrievedAt:new Date().toISOString(),source:{pets:sourceFor('map.getPets'),spawns:sourceFor('map.getMarkers'),page:'https://questlog.gg/aion-2/en/map'},attribution:{facts:'Questlog public Aion 2 database',artwork:'NCSOFT',delivery:'Questlog public CDN'},projection:'public marker [x,y] -> raw game [x,-y]; then normal world-map projection',progression:{maxLevel:3,soulCosts:[5,25,75],reference:'Questlog 0.1.36'},pets,spawns,assets,missingIcons};
await fs.writeFile(path.join(root,'data/pets.json'),JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({pets:pets.length,npcs:npcIds.size,spawns:spawns.length,icons:Object.keys(assets).length,missingIcons}));
