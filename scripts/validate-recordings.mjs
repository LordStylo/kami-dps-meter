import fs from 'node:fs';
import path from 'node:path';
import { listEncounters, replayEncounter } from '../src/replay.mjs';
const all = listEncounters(1000);
const eligible=all.filter(r=>fs.statSync(path.join(process.env.APPDATA||'','Questlog/aion-2/combat-logs',r.log+'.ndjson')).size<=128*1024*1024);
const selected = eligible.filter((x,i) => i % Math.max(1, Math.floor(eligible.length / 10)) === 0).slice(0,10);
const results = [];
for (const record of selected) {
  const { comparison, source } = await replayEncounter(record.id);
  results.push({ id: record.id, lines: source.lines, ...comparison });
}
fs.mkdirSync('research', { recursive: true });
fs.writeFileSync('research/recording-validation.json', JSON.stringify({ availableEncounters: all.length, sourceType: 'Already parsed Questlog combat events; not raw packets', results }, null, 2));
const passed = results.filter(r => r.damageDelta === 0 && Math.abs(r.secondsDelta) < 0.001 && r.players.every(p => p.delta === 0));
console.log(JSON.stringify({ available: all.length, skippedOversized: all.length-eligible.length, tested: results.length, exactMatches: passed.length, details: results.map(r=>({id:r.id,damageDelta:r.damageDelta,secondsDelta:r.secondsDelta,playerDeltas:r.players.filter(p=>p.delta!==0)})) }, null, 2));
if (passed.length !== results.length || !results.length) process.exitCode = 1;
