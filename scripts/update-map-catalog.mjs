import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Independent projection metadata, checked against Questlog 0.1.36's public
// world-map configuration. No application code is bundled or executed here.
const root=fileURLToPath(new URL('../',import.meta.url));
const definitions=[
  [1000,'Poeta','World_L_Starter',4,-204000,-204000],
  [1010,'Verteron','World_L_A',8,-408000,-408000],
  [1011,'Eltnen','World_L_B',8,-408000,-408000],
  [1100,'Ishalgen','World_D_Starter',5,-329748,-257999.78],
  [1110,'Altgard','World_D_A',8,-408000,-408000],
  [1111,'Morheim','World_D_B',8,-408000,-408000],
  [20,'Chaotic Lower Reshanta','Abyss_Reshanta_A',4,-204000,-204000],
];
function dimensions(bytes){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw Error('Not a WebP image');
  for(let at=12;at+8<=bytes.length;){
    const type=bytes.toString('ascii',at,at+4),length=bytes.readUInt32LE(at+4),start=at+8;
    if(start+length>bytes.length)throw Error('Truncated WebP');
    if(type==='VP8 '&&length>=10&&bytes.toString('hex',start+3,start+6)==='9d012a')return [bytes.readUInt16LE(start+6)&16383,bytes.readUInt16LE(start+8)&16383];
    if(type==='VP8X'&&length>=10)return [1+bytes.readUIntLE(start+4,3),1+bytes.readUIntLE(start+7,3)];
    if(type==='VP8L'&&length>=5&&bytes[start]===47){const bits=bytes.readUInt32LE(start+1);return [1+(bits&16383),1+((bits>>>14)&16383)];}
    at=start+length+(length&1);
  }
  throw Error('Unsupported WebP dimensions');
}
const imageDir=path.join(root,'public/maps');fs.mkdirSync(imageDir,{recursive:true});
const results=await Promise.allSettled(definitions.map(async([id,name,key,rows,originX,originY])=>{
  const source=`https://cdn.questlog.gg/aion-2/map/v3/${key}.webp`,filename=path.join(imageDir,key+'.webp');
  let bytes;
  if(fs.existsSync(filename)&&!process.argv.includes('--refresh'))bytes=fs.readFileSync(filename);
  else {
    const response=await fetch(source,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://questlog.gg/aion-2/en/map'},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`${key}: HTTP ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>16*1024*1024)throw Error(`${key}: image too large`);
  }
  const [width,height]=dimensions(bytes);
  if(width!==rows*1024||height!==rows*1024)throw Error(`${key}: expected ${rows*1024} square, got ${width}x${height}`);
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(filename,bytes);
  return {id,name,key,image:`/maps/${key}.webp`,width,height,originX,originY,rows,columns:rows,cellUnits:102000,tileSize:1024,source,sha256,bytes:bytes.length};
}));
const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason.message);
if(errors.length)throw Error(errors.join('; '));
const maps=results.map(r=>r.value);
const catalog={version:1,retrievedAt:new Date().toISOString(),attribution:{artwork:'NCSOFT',delivery:'Questlog public CDN',referenceApplication:'Questlog 0.1.36',referenceUrl:'https://questlog.gg/aion-2/en/map'},projection:'x=(worldX-originX)*tileSize/cellUnits; y=(worldY-originY)*tileSize/cellUnits',maps};
fs.writeFileSync(path.join(root,'data/world-maps.json'),JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({maps:maps.map(({id,name,width,height,bytes})=>({id,name,width,height,bytes})),totalBytes:maps.reduce((n,m)=>n+m.bytes,0)}));
