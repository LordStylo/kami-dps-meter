import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Meter, acceptedTypes } from './meter.mjs';

const root = path.join(process.env.APPDATA || '', 'Questlog/aion-2');
const safeId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export function listEncounters(limit = 40) {
  const dir = path.join(root, 'encounters');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => safeId(f.replace(/\.json$/, ''))).map(f => {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!safeId(record.log)) return null;
      return { id: record.id, savedAt: record.savedAt, seconds: record.summary.durationSeconds, damage: record.summary.damage,
        players: record.summary.participants.length, log: record.log };
    } catch { return null; }
  }).filter(Boolean).sort((a,b) => b.savedAt - a.savedAt).slice(0, limit);
}

export async function replayEncounter(id) {
  if (!safeId(id)) throw Error('Geçersiz kayıt kimliği');
  const record = JSON.parse(fs.readFileSync(path.join(root, 'encounters', `${id}.json`), 'utf8'));
  if (!safeId(record.log)) throw Error('Geçersiz günlük kimliği');
  const summary = record.summary, targets = new Set(summary.targets.filter(t => t.inScope).map(t => t.entity));
  const bosses = new Set(summary.targets.filter(t => t.boss && t.inScope).map(t => t.entity));
  const meter = new Meter({ splitIdle: false }); let lines = 0;
  const filename = path.join(root, 'combat-logs', `${record.log}.ndjson`);
  if (fs.statSync(filename).size > 128 * 1024 * 1024) throw Error('Kayıt boyutu 128 MB sınırını aşıyor');
  const input = fs.createReadStream(filename, { encoding: 'utf8' });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const event = JSON.parse(line); lines++;
      if (!acceptedTypes.has(event.type) || event.at > summary.endedAt) continue;
      // Event order matters: further events may share the killing blow's timestamp.
      if (summary.end === 'kill' && event.type === 'death' && bosses.has(event.entity) && event.at >= summary.endedAt) break;
      if (['damage', 'damage-over-time', 'heal'].includes(event.type)) {
        if (event.at < summary.startedAt || event.type !== 'heal' && !targets.has(event.target)) continue;
      }
      meter.ingest(event);
    }
  } finally { reader.close(); input.destroy(); }
  // Saved encounters have a player scope as well as a target scope. Open-world
  // logs include nearby strangers even when the saved summary is self/party.
  // Retain exactly the saved participants for this scoped replay; damage is
  // still calculated from events, never copied from the reference totals.
  const participants = new Set(summary.participants.map(p => p.entity));
  meter.hits = meter.hits.filter(hit => participants.has(hit.owner));
  meter.heals = meter.heals.filter(heal => participants.has(heal.owner));
  const snapshot = meter.snapshot({ scope: 'all' });
  const comparisons = summary.participants.map(p => {
    const calculated = snapshot.players.find(row => row.entity === p.entity);
    return { entity: p.entity, expected: p.damage, calculated: calculated?.damage || 0, delta: (calculated?.damage || 0) - p.damage };
  });
  return { meter, snapshot, source: { id, savedAt: record.savedAt, lines, kind: 'parsed-events', targets: [...targets], participants: [...participants] },
    comparison: { expectedDamage: summary.damage, calculatedDamage: snapshot.damage, damageDelta: snapshot.damage - summary.damage,
      expectedSeconds: summary.durationSeconds, calculatedSeconds: snapshot.seconds, secondsDelta: snapshot.seconds - summary.durationSeconds,
      players: comparisons } };
}
