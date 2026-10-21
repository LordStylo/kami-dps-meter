// Public numerical game facts only. No combat data is uploaded.
import fs from 'node:fs/promises';
const endpoint = name => `https://questlog.gg/aion-2/api/trpc/${name}`;
const sources = [endpoint('combatLog.catalog.buffEffects'), `${endpoint('statFormat.getStatFormat')}?input=${encodeURIComponent(JSON.stringify({ language: 'en' }))}`, endpoint('combatLog.catalog.bosses'), `${endpoint('combatLog.entities.buffs')}?input=${encodeURIComponent(JSON.stringify({ language: 'en-nc' }))}`];
const [buffEffects, statFormat, bosses, buffDisplay] = await Promise.all(sources.map(async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Combat catalog: HTTP ${response.status}`);
  return (await response.json()).result?.data;
}));
if (!Array.isArray(buffEffects) || !buffEffects.length || buffEffects.length > 100000 || !statFormat || !Array.isArray(bosses) || !buffDisplay || Object.keys(buffDisplay).length > 100000) throw Error('Unexpected combat catalog');
const buffs = {};
for (const entry of buffEffects) {
  if (!Number.isSafeInteger(entry.buff) || !Array.isArray(entry.effects)) throw Error('Invalid buff');
  buffs[entry.buff] = entry.effects.map(effect => {
    if (typeof effect.stat !== 'string' || !/^[a-z]+$/.test(effect.stat) || !Number.isFinite(effect.value)) throw Error('Invalid buff stat');
    if (effect.levels && Object.values(effect.levels).some(value => !Number.isFinite(value))) throw Error('Invalid buff levels');
    return { stat: effect.stat, value: effect.value, ...(effect.levels ? { levels: effect.levels } : {}) };
  });
}
const stats = Object.fromEntries(Object.values(statFormat).filter(row => Number.isSafeInteger(row.statId)).map(row => [row.statId, row.id]));
const bossTolerance = Object.fromEntries(bosses.filter(row => Number.isFinite(row.tolerance)).map(row => [row.npc, row.tolerance]));
const buffNames = {};
for (const buff of Object.values(buffDisplay)) {
  if (!Number.isSafeInteger(buff.id) || buff.name !== undefined && (typeof buff.name !== 'string' || buff.name.length > 256) || !Array.isArray(buff.effects)) throw Error('Invalid buff display metadata');
  buffNames[buff.id] = buff.name || '';
}
await fs.writeFile(new URL('../data/combat-analytics.json', import.meta.url), JSON.stringify({
  sourceVersion: 'Questlog 0.1.35', sources, retrievedAt: new Date().toISOString(),
  note: 'Public buff names, numeric buff effects, stat ids and boss tolerance. Named buffs absent from buffEffects have no effects in the supported Questlog attribution groups; this does not imply no effect on actual game damage. Unknown ids remain unavailable. Analytics implementation is independent.', buffs, buffNames, stats, bossTolerance,
}, null, 2) + '\n');
console.log(JSON.stringify({ buffs: Object.keys(buffs).length, buffNames: Object.keys(buffNames).length, stats: Object.keys(stats).length, bossTolerance: Object.keys(bossTolerance).length }));
