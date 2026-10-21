import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {worldMapCatalog} from './world-map-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),assets=new Map();
const raw=JSON.parse(fs.readFileSync(path.join(root,'data/pet-maps.json'),'utf8'));
if(raw.version!==1||!Array.isArray(raw.maps))throw Error('Invalid pet map catalog');
const ids=new Set(worldMapCatalog.maps.map(m=>m.id));
for(const map of raw.maps){
 if(!Number.isSafeInteger(map.id)||map.id<=0||ids.has(map.id)||!Array.isArray(map.tiles)||map.tiles.length!==map.rows*map.columns||map.width!==map.columns*1024||map.height!==map.rows*1024||![map.originX,map.originY,map.cellUnits,map.tileSize].every(Number.isFinite))throw Error('Invalid tiled map');
 ids.add(map.id);
 for(const tile of map.tiles){if(!/^\/pet-maps\/[A-Za-z0-9_]+\.webp$/.test(tile.image)||!/^[a-f0-9]{64}$/.test(tile.sha256)||tile.width!==1024||tile.height!==1024||tile.x<0||tile.y<0||tile.x+1024>map.width||tile.y+1024>map.height)throw Error('Invalid map tile');assets.set(tile.image,{filename:path.join(root,'public',tile.image.slice(1)),sha256:tile.sha256});}
}
export const petMapCatalog={version:1,maps:[...worldMapCatalog.maps,...raw.maps]};
export const petMapImage=pathname=>assets.get(pathname)??null;
