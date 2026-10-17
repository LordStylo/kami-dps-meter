import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync(new URL('../data/bosses.json',import.meta.url),'utf8'));
const bosses=new Map(catalog.bosses.map(entry=>[entry.npc,entry]));
export const bossInfo=npc=>bosses.get(npc);
