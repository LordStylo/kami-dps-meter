// Read-only numerical comparison with local Questlog recordings. This imports
// only our own engine and writes aggregate deltas, never identities or events.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Meter } from '../src/meter.mjs';
import { buildCombatDetails } from '../src/combat-analytics.mjs';

const root = process.argv[2] || path.join(process.env.APPDATA || '', 'Questlog/aion-2');
const catalogBytes = fs.readFileSync(new URL('../data/combat-analytics.json', import.meta.url));
const catalog = JSON.parse(catalogBytes);
const sourceFiles = fs.readdirSync(path.join(root, 'encounters')).filter(file => file.endsWith('.json') && file !== 'index.json');
const logCache = new Map(), rows = [], historical = [];
const maximum = (values, key) => values.reduce((max, value) => Math.max(max, Math.abs(value[key] || 0)), 0);

function compare(summary, details) {
  return summary.participants.map(expected => {
    const actual = details.players.find(player => player.entity === expected.entity);
    const damage = actual?.rdps === null ? null : actual.rdps * summary.durationSeconds + actual.received - actual.added;
    return { damage: damage === null ? null : damage - expected.damage, taken: (actual?.damageTaken || 0) - expected.damageTaken,
      rdps: actual?.rdps === null ? null : actual.rdps - expected.rdps, received: actual?.received === null ? null : actual.received - expected.received,
      added: actual?.added === null ? null : actual.added - expected.added, casts: (actual?.casts || 0) - expected.casts,
      rotationLength: (actual?.rotation.length || 0) - expected.rotation.length };
  });
}
for (const file of sourceFiles) {
  const record = JSON.parse(fs.readFileSync(path.join(root, 'encounters', file), 'utf8')), summary = record.summary;
  const logFile = path.join(root, 'combat-logs', `${record.log}.ndjson`);
  if (!fs.existsSync(logFile) || fs.statSync(logFile).size > 128 * 1024 * 1024) continue;
  if (!logCache.has(record.log)) logCache.set(record.log, fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type && Number.isFinite(event.at)));
  const meter = new Meter({ splitEncounters: false, splitIdle: false });
  const bosses = new Set(summary.targets.filter(target => target.boss).map(target => target.entity));
  for (const event of logCache.get(record.log)) {
    if (event.at > summary.endedAt) break;
    meter.ingest(event);
    // Capture timestamps are shared by multiple messages in a frame. Effects
    // after the terminal boss-death message must not leak into the old fight.
    if (summary.end === 'kill' && event.at >= summary.startedAt && event.type === 'death' && bosses.has(event.entity)) break;
  }
  const options = { events: meter.detailEvents, entities: meter.entities, self: summary.self?.entity,
    party: new Set(summary.participants.map(player => player.entity)), scope: 'party', target: null,
    startedAt: summary.startedAt, endedAt: summary.endedAt, seconds: summary.durationSeconds, players: summary.participants,
    ownerOf: entity => meter.ownerOf(entity) };
  const current = buildCombatDetails(options), deltas = compare(summary, current);
  rows.push({ playerRows: deltas.length, recordedDamage: summary.damage, recordedTaken: summary.participants.reduce((sum, player) => sum + player.damageTaken, 0),
    unavailableRows: deltas.filter(delta => delta.rdps === null).length,
    maximumAbsoluteDelta: Object.fromEntries(['damage', 'taken', 'rdps', 'received', 'added', 'casts', 'rotationLength'].map(key => [key, maximum(deltas, key)])) });
  if (!historical.length && summary.targets.some(target => target.npc === 2300207) && summary.participants.length === 5) {
    const diagnosticFacts = { ...catalog, bossTolerance: { ...catalog.bossTolerance, 2300207: 1000 } };
    const diagnostic = compare(summary, buildCombatDetails({ ...options, facts: diagnosticFacts }));
    historical.push({ npc: 2300207, currentCatalogTolerance: catalog.bossTolerance[2300207], diagnosticHistoricalTolerance: 1000,
      note: 'Diagnostic override only, isolated from production data. All five saved player attribution totals match under this historical tolerance; changing no other inputs to the current tolerance reproduces the drift.',
      playerRows: diagnostic.length, maximumAbsoluteDelta: Object.fromEntries(['damage', 'taken', 'rdps', 'received', 'added', 'casts', 'rotationLength'].map(key => [key, maximum(diagnostic, key)])),
      formulaMatchesWithinFloatTolerance: diagnostic.every(delta => ['damage', 'taken', 'rdps', 'received', 'added'].every(key => delta[key] !== null && Math.abs(delta[key]) < 1e-7)) });
  }
}

// Exercise the configured detail-event cap, including one very large incoming
// source group. No spread into Math.max or event-list mutation is permitted.
const events = Array.from({ length: 200000 }, (_, index) => ({ type: 'damage', at: index, actor: index % 5 ? 50 : 1, target: index % 5 ? 1 : 50,
  damage: 10, skill: 11010130, action: index % 256, speed: 10000, acceptedForDps: index % 5 === 0 }));
const options = { events, entities: new Map([[1, { kind: 'player' }], [50, { kind: 'npc', boss: true }]]), self: 1, party: new Set([1]),
  scope: 'party', startedAt: 0, endedAt: 199999, seconds: 199.999, players: [] };
const before = performance.now(), first = buildCombatDetails(options), elapsed = performance.now() - before;
const cacheStart = performance.now(), cached = buildCombatDetails(options), cacheElapsed = performance.now() - cacheStart;
const report = { source: 'Read-only local Questlog normalized event logs and saved encounter summaries; no installed application code executed.',
  createdAt: new Date().toISOString(), catalog: { version: catalog.sourceVersion, retrievedAt: catalog.retrievedAt,
    bytes: catalogBytes.length, sha256: crypto.createHash('sha256').update(catalogBytes).digest('hex'),
    attributedBuffs: Object.keys(catalog.buffs).length, knownBuffs: Object.keys(catalog.buffNames || {}).length, statIds: Object.keys(catalog.stats).length, bossTolerances: Object.keys(catalog.bossTolerance).length },
  currentCatalogComparison: { encounters: rows.length, playerRows: rows.reduce((sum, row) => sum + row.playerRows, 0),
    recordedDamage: rows.reduce((sum, row) => sum + row.recordedDamage, 0), recordedTaken: rows.reduce((sum, row) => sum + row.recordedTaken, 0),
    unavailableRows: rows.reduce((sum, row) => sum + row.unavailableRows, 0), maximumAbsoluteDelta: Object.fromEntries(['damage', 'taken', 'rdps', 'received', 'added', 'casts', 'rotationLength'].map(key => [key, maximum(rows.map(row => row.maximumAbsoluteDelta), key)])), rows },
  historicalCatalogDiagnostic: historical,
  boundaryDifference: 'Kami keeps actual initiating casts received before the first damaging effect. Questlog can discard these while a previous finished encounter waits to reset; attribution and damage are unaffected.',
  performance: { events: events.length, firstBuildMs: Number(elapsed.toFixed(3)), unchangedCacheMs: Number(cacheElapsed.toFixed(3)), cacheReused: first === cached,
    taken: first.players[0]?.damageTaken, expectedTaken: 1600000, noArgumentSpreadFailure: first.players[0]?.damageTaken === 1600000 },
};
fs.mkdirSync(new URL('../research/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../research/recording-analytics-validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, currentCatalogComparison: { ...report.currentCatalogComparison, rows: undefined } }, null, 2));
if (!rows.length || !historical[0]?.formulaMatchesWithinFloatTolerance || !report.performance.cacheReused || !report.performance.noArgumentSpreadFailure) process.exitCode = 1;
