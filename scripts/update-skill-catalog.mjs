// Read public skill metadata only; combat data never leaves this computer.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const language = process.argv[2] || 'en-nc';
if (!['en', 'en-nc'].includes(language)) throw Error('Use en (global) or en-nc (KR/TW English)');
const endpoint = new URL('https://questlog.gg/aion-2/api/trpc/skillBuilder.getSkills');
endpoint.searchParams.set('input', JSON.stringify({ language }));
const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw Error(`Skill catalog: HTTP ${response.status}`);
const list = (await response.json()).result?.data;
if (!Array.isArray(list) || !list.length || list.length > 5000) throw Error('Unexpected skill catalog');
const destination = path.join(root, 'public/icons/skills');
await fs.mkdir(destination, { recursive: true });
const skills = {}, downloads = new Map();
for (const entry of list) {
  const id = Number(entry.id);
  if (!Number.isSafeInteger(id) || id <= 0 || typeof entry.name !== 'string' || entry.name.length > 128) throw Error('Invalid skill');
  const skill = { name: entry.name };
  if (typeof entry.icon === 'string' && /^\/assets\/Game\/UI\/Resource\/Texture\/Skill\/[\w.]+$/.test(entry.icon)) {
    const stem = entry.icon.includes('.') ? entry.icon.slice(0, entry.icon.lastIndexOf('.')) : entry.icon;
    const filename = path.basename(stem) + '.webp';
    skill.icon = '/icons/skills/' + filename;
    downloads.set(filename, 'https://cdn.questlog.gg/aion-2' + stem + '.webp');
  }
  skills[id] = skill;
}
const jobs = [...downloads];
for (let i = 0; i < jobs.length; i += 4) {
  await Promise.all(jobs.slice(i, i + 4).map(async ([filename, url]) => {
    const dest = path.join(destination, filename);
    try { await fs.access(dest); return; } catch { /* fetch missing assets */ }
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error(`Icon ${filename}: HTTP ${r.status}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > 512 * 1024 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw Error(`Invalid WebP: ${filename}`);
    await fs.writeFile(dest, bytes);
  }));
}
await fs.writeFile(path.join(root, 'data/skills.json'), JSON.stringify({
  source: endpoint.href, sourcePage: `https://questlog.gg/aion-2/${language}/db/skills`,
  retrievedAt: new Date().toISOString(), language, skills,
}, null, 2) + '\n');
console.log(JSON.stringify({ skills: Object.keys(skills).length, icons: downloads.size, runtimeNetworkRequired: false }));
