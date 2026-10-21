import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('../',import.meta.url));
const raw=JSON.parse(fs.readFileSync(path.join(base,'data/pets.json'),'utf8'));
if(raw.version!==1||!Array.isArray(raw.pets)||!Array.isArray(raw.spawns))throw Error('Invalid pet catalog');
const byId=new Map(),spawnsByNpc=new Map(),images=new Map();
export const petNpcIds=new Set();
for(const pet of raw.pets){
 if(!Number.isSafeInteger(pet.id)||pet.id<=0||byId.has(pet.id)||typeof pet.name!=='string'||!Array.isArray(pet.monsters)||pet.icon!==null&&!/^\/icons\/pets\/[A-Za-z0-9_]+\.webp$/.test(pet.icon))throw Error('Invalid pet identity');
 byId.set(pet.id,pet);for(const npc of pet.monsters)petNpcIds.add(npc.id);
}
for(const s of raw.spawns){
 if(!petNpcIds.has(s.npcId)||!Number.isSafeInteger(s.mapId)||![s.x,s.y].every(Number.isFinite))throw Error('Invalid pet spawn');
 if(!spawnsByNpc.has(s.npcId))spawnsByNpc.set(s.npcId,[]);spawnsByNpc.get(s.npcId).push(s);
}
for(const [image,metadata]of Object.entries(raw.assets||{})){
 if(!/^\/icons\/pets\/[A-Za-z0-9_]+\.webp$/.test(image)||!/^[a-f0-9]{64}$/.test(metadata.sha256))throw Error('Invalid pet image metadata');
 images.set(image,{filename:path.join(base,'public',image.slice(1)),sha256:metadata.sha256});
}
export const petForId=id=>byId.get(Number(id))??null;
export const petSpawns=id=>{const p=petForId(id);return p?p.monsters.flatMap(n=>spawnsByNpc.get(n.id)||[]):null;};
export const petIcon=pathname=>images.get(pathname)??null;
export const petCatalog={version:1,language:raw.language,retrievedAt:raw.retrievedAt,source:raw.source,attribution:raw.attribution,progression:raw.progression,pets:raw.pets.map(p=>{const spawns=petSpawns(p.id);return {...p,spawnCount:spawns.length,mapIds:[...new Set(spawns.map(s=>s.mapId))]};})};
