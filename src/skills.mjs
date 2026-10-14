import fs from 'node:fs';

const { skills } = JSON.parse(fs.readFileSync(new URL('../data/skills.json', import.meta.url)));
export function skillInfo(id, buff = 0) {
  const entry = skills[id];
  return {
    name: entry?.name || (id ? `Yetenek ${id}` : buff ? `Etki ${buff}` : 'Bilinmeyen yetenek'),
    icon: entry?.icon || null,
  };
}
