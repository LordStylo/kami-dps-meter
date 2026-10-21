import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const base=fileURLToPath(new URL('../',import.meta.url));
const catalog=JSON.parse(fs.readFileSync(path.join(base,'data/world-maps.json'),'utf8'));
const imageFiles=new Map(),ids=new Set();
if(catalog.version!==1||!Array.isArray(catalog.maps))throw Error('Invalid world-map catalog');
for(const map of catalog.maps){
  if(!Number.isInteger(map.id)||map.id<=0||ids.has(map.id)||!/^\/maps\/[A-Za-z0-9_]+\.webp$/.test(map.image))throw Error('Invalid map identity');
  for(const key of ['width','height','tileSize','cellUnits','rows','columns'])if(!Number.isFinite(map[key])||map[key]<=0)throw Error('Invalid map dimensions');
  if(!Number.isFinite(map.originX)||!Number.isFinite(map.originY)||map.width!==map.columns*map.tileSize||map.height!==map.rows*map.tileSize)throw Error('Invalid map projection');
  if(map.width>16384||map.height>16384||!/^[a-f0-9]{64}$/.test(map.sha256))throw Error('Invalid map image metadata');
  const filename=path.join(base,'public',map.image.slice(1));
  ids.add(map.id);imageFiles.set(map.image,{filename,sha256:map.sha256});
}
export const worldMapCatalog=catalog;
export const worldMapImage=pathname=>imageFiles.get(pathname)??null;
