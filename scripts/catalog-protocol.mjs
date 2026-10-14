// Extract numeric protocol facts, never evaluate the inspected application's code.
import fs from 'node:fs';
const source = fs.readFileSync('research/private/.output/electron/workers/aion-2/combat.cjs', 'utf8');
const packets = [...source.matchAll(/([\w$]+):\s*\{\s*opcode:\s*(\d+)/g)]
  .map(m => ({ name: m[1], opcode: Number(m[2]), hex: `0x${Number(m[2]).toString(16)}` }));
const effects = { sourceVersion: '0.1.24', source: 'Local installation; static numeric protocol facts' };
for (const [symbol, name] of Object.entries({ D0: 'directHeal', E0: 'directIgnore', R0: 'periodicHeal', C0: 'barrier', M0: 'periodicIgnore', U0: 'periodicIgnore2' })) {
  const match = source.match(new RegExp(`\\b${symbol} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!match || !/^[\d,\s]+$/.test(match[1])) throw Error(`Unsupported effect table: ${symbol}`);
  effects[name] = match[1].split(',').map(x => x.trim()).filter(Boolean).map(Number);
}
fs.mkdirSync('research', { recursive: true });
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('research/packet-catalog.json', JSON.stringify({ sourceVersion: '0.1.24', packets }, null, 2));
fs.writeFileSync('data/effect-types.json', JSON.stringify(effects, null, 2));
console.log(`${packets.length} packet identifiers; effect tables: ${Object.entries(effects).filter(([,v])=>Array.isArray(v)).map(([k,v])=>`${k}=${v.length}`).join(', ')}`);
