// Exact Questlog 0.1.36 tile-grid facts; the tiles are public NCSOFT artwork.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const key='Abyss_Reshanta_C',tiles=[];
await fs.mkdir(path.join(root,'public/pet-maps'),{recursive:true});
for(let y=0;y<2;y++)for(let x=0;x<2;x++){
 const name=`${key}_${String(x).padStart(2,'0')}_${String(y).padStart(2,'0')}.webp`;
 const source=`https://cdn.questlog.gg/aion-2/assets/Game/UI/Map/WorldMap/${key}/Res/${name}`;
 const filename=path.join(root,'public/pet-maps',name);let bytes;
 try{bytes=await fs.readFile(filename);}catch{const r=await fetch(source,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://questlog.gg/aion-2/en/map'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Tile: HTTP ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());}
 if(bytes.length>4*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Invalid tile');
 let size;
 for(let at=12;at+8<=bytes.length;){const type=bytes.toString('ascii',at,at+4),length=bytes.readUInt32LE(at+4),s=at+8;if(s+length>bytes.length)throw Error('Truncated tile');if(type==='VP8 '&&length>=10){size=[bytes.readUInt16LE(s+6)&16383,bytes.readUInt16LE(s+8)&16383];break;}if(type==='VP8X'&&length>=10){size=[1+bytes.readUIntLE(s+4,3),1+bytes.readUIntLE(s+7,3)];break;}if(type==='VP8L'&&length>=5){const b=bytes.readUInt32LE(s+1);size=[1+(b&16383),1+((b>>>14)&16383)];break;}at=s+length+(length&1);}
 if(size?.[0]!==1024||size?.[1]!==1024)throw Error('Tile must be 1024 square');
 await fs.writeFile(filename,bytes);tiles.push({image:'/pet-maps/'+name,x:x*1024,y:y*1024,width:1024,height:1024,source,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
const data={version:1,retrievedAt:new Date().toISOString(),attribution:{artwork:'NCSOFT',delivery:'Questlog public CDN',referenceApplication:'Questlog 0.1.36'},maps:[{id:22,name:'Chaotic Middle Reshanta',key,image:null,width:2048,height:2048,originX:-102000,originY:-102000,rows:2,columns:2,cellUnits:102000,tileSize:1024,tiles}]};
await fs.writeFile(path.join(root,'data/pet-maps.json'),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({maps:1,tiles:tiles.length,bytes:tiles.reduce((n,t)=>n+t.bytes,0)}));
