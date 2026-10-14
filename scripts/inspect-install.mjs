// Static inspection only: no code from the installed application is executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { format } from 'prettier';

const archive = process.argv[2] ?? 'C:/Program Files/Questlog/resources/app.asar';
const bytes = fs.readFileSync(archive);
const headerSize = bytes.readUInt32LE(4);
const jsonSize = bytes.readUInt32LE(12);
if (16 + jsonSize > 8 + headerSize || 8 + headerSize > bytes.length) throw Error('Invalid ASAR header');
const header = JSON.parse(bytes.subarray(16, 16 + jsonSize).toString('utf8'));
const entries = [];
function walk(node, prefix = '') {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const nameInArchive = prefix + name;
    if (entry.files) walk(entry, nameInArchive + '/');
    else entries.push({ path: nameInArchive, ...entry });
  }
}
walk(header);
const destination = path.resolve('research/private');
fs.mkdirSync(destination, { recursive: true });
for (const entry of entries.filter(e => !e.unpacked && (e.path.startsWith('.output/') || e.path === 'package.json'))) {
  const begin = 8 + headerSize + Number(entry.offset);
  if (begin < 8 + headerSize || begin + entry.size > bytes.length) throw Error('Invalid archive entry');
  const text = bytes.subarray(begin, begin + entry.size).toString('utf8');
  const target = path.resolve(destination, entry.path);
  if (!target.startsWith(destination + path.sep)) throw Error('Unsafe archive path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, entry.path.endsWith('.cjs') ? await format(text, { parser: 'babel' }) : text);
}
const manifest = {
  source: archive,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  entries: entries.map(e => ({ path: e.path, size: e.size, unpacked: !!e.unpacked })),
};
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Inspected ${entries.length} entries. Formatted research copies: ${destination}`);
