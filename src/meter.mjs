import { skillInfo } from './skills.mjs';
const baseSkill = skill => skill >= 11000000 && skill <= 19999999 ? Math.floor(skill / 10000) * 10000 : skill;
export const acceptedTypes = new Set(['player', 'spawn', 'roster', 'roster-add', 'roster-remove', 'party-left', 'map', 'hp', 'target', 'buff', 'buff-end', 'damage', 'damage-over-time', 'heal', 'death', 'removed', 'capture-gap']);

export class Meter {
  constructor({ idleMs = 15000, splitIdle = true } = {}) {
    this.idleMs = idleMs; this.splitIdle = splitIdle; this.entities = new Map(); this.party = new Set();
    this.buffs = new Map(); this.self = null; this.map = null; this.history = []; this.sequence = 0;
    this.totalEvents = 0; this.resetFight();
  }
  resetFight() { this.hits = []; this.heals = []; this.lastHit = null; this.gaps = 0; this.unresolvedHits = 0; this.truncated = false; this.fightId = ++this.sequence; }
  finish(reason = 'manual') {
    if (this.hits.length) {
      // Keep one immutable fight for filtering after it ends; older history is summaries only.
      this.lastFight = Object.assign(Object.create(Meter.prototype), this, {
        entities: new Map([...this.entities].map(([key,value]) => [key,{...value}])),
        party: new Set(this.party), hits: this.hits.slice(), history: [], lastFight: null,
      });
      const snapshot = this.snapshot({ scope: 'all' }); snapshot.reason = reason;
      this.history.unshift(snapshot); this.history = this.history.slice(0, 30);
    }
    this.resetFight();
  }
  ownerOf(entity) {
    const seen = new Set();
    while (this.entities.get(entity)?.owner && !seen.has(entity)) { seen.add(entity); entity = this.entities.get(entity).owner; }
    return entity;
  }
  upsert(entity, attributes) {
    if (!Number.isInteger(entity) || !entity) return;
    if (!this.entities.has(entity) && this.entities.size >= 50000) return;
    this.entities.set(entity, { ...this.entities.get(entity), ...Object.fromEntries(Object.entries(attributes).filter(([,v]) => v !== undefined)), entity });
  }
  ingest(event) {
    if (!event || !acceptedTypes.has(event.type) || !Number.isFinite(event.at)) return;
    this.totalEvents++;
    const e = event;
    switch (e.type) {
      case 'map':
        this.finish('zone'); this.entities.clear(); this.party.clear(); this.buffs.clear(); this.self = null; this.map = e.map; break;
      case 'player': {
        const old = this.entities.get(e.entity);
        this.upsert(e.entity, { name: e.name, class: e.class, kind: 'player', id: e.id, hp: e.hp, maxHp: e.maxHp });
        if (e.self) this.self = e.entity;
        if (e.id) for (const [key, member] of this.entities) if (key !== e.entity && member.id === e.id && this.party.has(key)) { this.party.delete(key); this.party.add(e.entity); }
        if (old?.kind === 'npc') this.entities.get(e.entity).owner = undefined;
        break;
      }
      case 'spawn': this.upsert(e.entity, { kind: 'npc', npc: e.npc, owner: e.owner || null, hp: e.hp, maxHp: e.maxHp, dead: false }); break;
      case 'roster': this.party.clear(); // falls through
      case 'roster-add':
        for (const member of e.members ?? []) { this.upsert(member.entity, { ...member, kind: 'player' }); this.party.add(member.entity); } break;
      case 'roster-remove': for (const key of this.party) if (this.entities.get(key)?.id === e.id) this.party.delete(key); break;
      case 'party-left': this.party.clear(); break;
      case 'hp': this.upsert(e.entity, { hp: e.hp, maxHp: e.maxHp, dead: e.hp > 0 ? false : undefined }); break;
      case 'target': this.upsert(e.entity, { target: e.target }); break;
      case 'buff': if (this.buffs.size < 100000) this.buffs.set(`${e.target}:${e.uid}`, { buff: e.buff, skill: e.skill }); break;
      case 'buff-end': this.buffs.delete(`${e.target}:${e.uid}`); break;
      case 'capture-gap': this.gaps++; break;
      case 'death': this.upsert(e.entity, { hp: 0, dead: true }); break;
      case 'heal':
        if (this.heals.length < 200000 && Number.isSafeInteger(e.amount) && e.amount > 0) this.heals.push({ at: e.at, actor: e.actor, target: e.target, skill: e.skill, amount: e.amount }); break;
      case 'damage': case 'damage-over-time': {
        if (!Number.isSafeInteger(e.damage) || e.damage <= 0 || !Number.isInteger(e.actor) || !Number.isInteger(e.target)) return;
        const owner = this.ownerOf(e.actor), actor = this.entities.get(owner);
        // Known enemy damage must not start/split a player encounter.
        if (actor?.kind === 'npc') return;
        if (actor?.kind !== 'player') { this.unresolvedHits++; return; }
        if (this.splitIdle && this.lastHit !== null && e.at - this.lastHit > this.idleMs) this.finish('idle');
        const buff = this.buffs.get(`${e.target}:${e.uid}`);
        if (this.hits.length >= 200000) { this.truncated = true; return; }
        this.hits.push({ at: e.at, actor: e.actor, owner, target: e.target, skill: baseSkill(e.skill || buff?.skill || 0),
          buff: e.buff || buff?.buff, damage: e.damage, critical: !!e.critical, hits: Math.max(1, e.hits || 1), dot: e.type === 'damage-over-time',
          party: this.party.has(owner) || owner === this.self });
        this.lastHit = Math.max(this.lastHit ?? e.at, e.at); break;
      }
    }
  }
  tick(at) { if (this.splitIdle && this.lastHit !== null && at - this.lastHit > this.idleMs) this.finish('idle'); }
  snapshot({ scope = 'party', target = null } = {}) {
    const players = new Map(), targets = new Map(); let start = Infinity, end = -Infinity, total = 0, unknown = 0;
    const filtered = [];
    for (const hit of this.hits) {
      const owner = hit.owner ?? this.ownerOf(hit.actor), entity = this.entities.get(owner);
      if (entity?.kind === 'npc') continue;
      if (scope === 'self' && owner !== this.self) continue;
      if (scope === 'party' && !hit.party && !this.party.has(owner) && owner !== this.self) continue;
      if (target !== null && hit.target !== Number(target)) continue;
      if (!entity?.name) unknown++;
      start = Math.min(start, hit.at); end = Math.max(end, hit.at); total += hit.damage;
      let player = players.get(owner);
      if (!player) { player = { entity: owner, name: entity?.name || `Oyuncu #${owner}`, class: entity?.class || 'Bilinmiyor', self: owner === this.self,
        damage: 0, directDamage: 0, dotDamage: 0, petDamage: 0, hits: 0, directHits: 0, criticalHits: 0, skills: new Map() }; players.set(owner, player); }
      player.damage += hit.damage; player.hits += hit.hits;
      if (hit.dot) player.dotDamage += hit.damage;
      else { player.directDamage += hit.damage; player.directHits++; if (hit.critical) player.criticalHits++; }
      if (owner !== hit.actor) player.petDamage += hit.damage;
      const key = hit.skill ? `skill:${hit.skill}` : `buff:${hit.buff || 0}`;
      let skill = player.skills.get(key);
      if (!skill) { skill = { key, id: hit.skill, ...skillInfo(hit.skill, hit.buff), damage: 0, hits: 0, dotDamage: 0, directHits: 0, criticalHits: 0 }; player.skills.set(key, skill); }
      skill.damage += hit.damage; skill.hits += hit.hits;
      if (hit.dot) skill.dotDamage += hit.damage;
      else { skill.directHits++; if (hit.critical) skill.criticalHits++; }
      const targetInfo = this.entities.get(hit.target), t = targets.get(hit.target) ?? { entity: hit.target, name: targetInfo?.name || `NPC #${targetInfo?.npc || hit.target}`, damage: 0, hp: targetInfo?.hp, maxHp: targetInfo?.maxHp };
      t.damage += hit.damage; targets.set(hit.target, t); filtered.push(hit);
    }
    const seconds = total ? Math.max(1, (end - start) / 1000) : 0;
    const rows = [...players.values()].map(p => ({ ...p, dps: p.damage / seconds, share: p.damage / total * 100,
      critRate: p.directHits ? p.criticalHits / p.directHits * 100 : 0,
      skills: [...p.skills.values()].map(s => ({ ...s, dps: s.damage / seconds, share: s.damage / p.damage * 100,
        critRate: s.directHits ? s.criticalHits / s.directHits * 100 : null })).sort((a,b) => b.damage - a.damage) })).sort((a,b) => b.damage - a.damage);
    const buckets = new Map(); const bucketSeconds = Math.max(1, Math.ceil(seconds / 90));
    for (const h of filtered) { const n = Math.floor((h.at - start) / 1000 / bucketSeconds); buckets.set(n, (buckets.get(n) || 0) + h.damage); }
    return { id: this.fightId, map: this.map, scope, target, startedAt: total ? start : null, endedAt: total ? end : null,
      seconds, damage: total, dps: seconds ? total / seconds : 0, players: rows, targets: [...targets.values()].sort((a,b) => b.damage - a.damage),
      chart: total ? Array.from({ length: Math.floor(seconds / bucketSeconds) + 1 }, (_, n) => ({ second: n * bucketSeconds, dps: (buckets.get(n) || 0) / bucketSeconds })) : [],
      issues: { gaps: this.gaps, unknownHits: unknown + this.unresolvedHits, truncated: this.truncated }, totalEvents: this.totalEvents };
  }
}
