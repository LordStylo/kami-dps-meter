import { skillInfo } from './skills.mjs';
import { bossInfo } from './bosses.mjs';
import { buildCombatDetails } from './combat-analytics.mjs';
const baseSkill = skill => skill >= 11000000 && skill <= 19999999 ? Math.floor(skill / 10000) * 10000 : skill;
export const acceptedTypes = new Set(['player', 'spawn', 'roster', 'roster-add', 'roster-remove', 'party-member', 'party-left', 'map', 'hp', 'target', 'buff', 'buff-end', 'damage', 'damage-over-time', 'heal', 'death', 'removed', 'combat-state', 'stagger', 'dungeon-boss-killed', 'capture-gap', 'cast', 'cast-end', 'cast-begin', 'cast-stop', 'stats', 'avoided']);

export class Meter {
  constructor({ idleMs = 15000, bossIdleMs = 90000, bossResumeMs = 300000, splitIdle = true, splitEncounters = splitIdle, onEncounter = null } = {}) {
    this.idleMs = idleMs; this.bossIdleMs = bossIdleMs; this.splitIdle = splitIdle; this.splitEncounters = splitEncounters;
    this.bossResumeMs = bossResumeMs; this.onEncounter = onEncounter;
    this.entities = new Map(); this.party = new Set(); this.roster = new Map();
    this.buffs = new Map(); this.self = null; this.map = null; this.history = []; this.sequence = 0;
    this.totalEvents = 0; this.entityAliases = new Map(); this.latestStats = new Map(); this.resetFight();
  }
  resetFight() {
    this.hits = []; this.heals = []; this.lastHit = null; this.lastOwnAttack = null;
    this.gaps = 0; this.unresolvedHits = 0; this.truncated = false; this.fightId = ++this.sequence;
    this.fightTargets = new Map(); this.fightParty = new Set(); this.opponents = new Set();
    this.endReason = null; this.finishedAt = null; this.selfRecoveryUntil = 0; this.suspendedAt = null;
    this.pvpStartedAt = null; this.lastPvpAt = null;
    this.detailEvents = [...this.buffs.values(), ...this.latestStats.values()].map(e => ({ ...e }));
    this.detailRevision = 0; this.detailCache = new Map();
  }
  finish(reason = 'manual', at = this.lastHit) {
    if (this.hits.length || this.pvpStartedAt !== null) {
      // Keep one immutable fight for filtering after it ends; older history is summaries only.
      this.lastFight = Object.assign(Object.create(Meter.prototype), this, {
        entities: new Map([...this.entities].map(([key,value]) => [key,{...value}])),
        party: new Set(this.party), roster: new Map(this.roster), hits: this.hits.slice(), heals: this.heals.slice(), history: [], lastFight: null,
        buffs: new Map(this.buffs), latestStats: new Map(this.latestStats), entityAliases: new Map(this.entityAliases),
        detailEvents: this.detailEvents.map(e => ({ ...e })), detailCache: new Map(), onEncounter: null,
        fightParty: new Set(this.fightParty), opponents: new Set(this.opponents),
        fightTargets: new Map([...this.fightTargets].map(([key,value]) => [key,{...value,owners:new Set(value.owners)}])),
        endReason: reason, finishedAt: at,
      });
      const snapshot = this.lastFight.snapshot({ scope: 'all' });
      this.history.unshift(snapshot); this.history = this.history.slice(0, 30);
      if (typeof this.onEncounter === 'function') this.onEncounter(this.lastFight.snapshot({ scope: 'party' }));
    }
    this.resetFight();
  }
  ownerOf(entity) {
    const seen = new Set();
    while (!seen.has(entity)) {
      seen.add(entity); const next = this.entityAliases.get(entity) || this.entities.get(entity)?.owner;
      if (!next) break; entity = next;
    }
    return entity;
  }
  sameCharacter(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id && a.id !== '0' && b.id !== '0') return a.id === b.id;
    return !!(a.name && a.server && a.name === b.name && a.server === b.server);
  }
  remapParticipant(from, to) {
    if (from === to) return;
    this.entityAliases.delete(to); this.entityAliases.set(from, to);
    for (const h of this.hits) { if (h.owner === from) h.owner = to; if (h.target === from) h.target = to; }
    for (const h of this.heals) { if (h.owner === from) h.owner = to; if (h.target === from) h.target = to; }
    for (const e of this.detailEvents) for (const key of ['actor','target','entity','caster','killer','actorOwner','targetOwner','casterOwner']) if (e[key] === from) e[key] = to;
    for (const set of [this.party, this.fightParty, this.opponents]) if (set.delete(from)) set.add(to);
    for (const t of this.fightTargets.values()) if (t.owners.delete(from)) t.owners.add(to);
    for (const entity of this.entities.values()) { if (entity.owner === from) entity.owner = to; if (entity.target === from) entity.target = to; }
    for (const [key, value] of this.buffs) {
      const updated = { ...value };
      for (const field of ['target','caster','actorOwner','targetOwner','casterOwner']) if (updated[field] === from) updated[field] = to;
      if (updated.target !== value.target) this.buffs.delete(key);
      this.buffs.set(updated.target !== value.target ? `${to}:${value.uid}` : key, updated);
    }
    if (this.latestStats.has(from)) { const value = this.latestStats.get(from); this.latestStats.delete(from); this.latestStats.set(to, { ...value, entity: to }); }
    this.detailRevision++; this.detailCache.clear();
  }
  recordDetail(e) {
    if (this.detailEvents.length >= 200000) { this.truncated = true; return; }
    const event = { ...e };
    if (['damage','damage-over-time'].includes(e.type)) event.acceptedForDps = e.acceptedForDps === true;
    for (const key of ['actor','target','caster']) if (Number.isInteger(e[key])) event[`${key}Owner`] = this.ownerOf(e[key]);
    this.detailEvents.push(event); this.detailRevision++; this.detailCache.clear();
  }
  hasBoss() { return this.encounterTargets().some(t => t.boss && t.died === undefined); }
  upsert(entity, attributes) {
    if (!Number.isInteger(entity) || !entity) return;
    if (!this.entities.has(entity) && this.entities.size >= 50000) return;
    this.entities.set(entity, { ...this.entities.get(entity), ...Object.fromEntries(Object.entries(attributes).filter(([,v]) => v !== undefined)), entity });
  }
  rememberMember(member) {
    if (!member) return;
    const { id, name, server, class: job } = member;
    const key = id && id !== '0' ? `id:${id}` : name && server ? `name:${server}:${name}` : null;
    // Only stable character identity survives a zone change, never an entity ID.
    if (key && (this.roster.has(key) || this.roster.size < 128)) this.roster.set(key, { id, name, server, class: job });
  }
  bindMember(entity) {
    const player = this.entities.get(entity);
    if (player?.kind !== 'player') return;
    const matches = [...this.roster.values()].filter(member => {
      if (member.id && player.id) return member.id === player.id;
      return member.name && member.server && member.name === player.name && member.server === player.server;
    });
    if (matches.length === 1) { this.confirmMember(entity); this.upsert(entity, { id: matches[0].id }); }
  }
  confirmMember(entity) {
    this.party.add(entity);
    // Recover already captured damage once membership arrives, and retain that
    // attribution if the member subsequently leaves during this encounter.
    for (const hit of this.hits) if (hit.owner === entity) { hit.party = true; this.fightParty.add(entity); }
    for (const heal of this.heals) if (heal.owner === entity) { heal.party = true; this.fightParty.add(entity); }
    for (const target of this.fightTargets.values()) if (target.owners.has(entity)) target.party = true;
  }
  partyState() {
    return { knownIdentities: this.roster.size, members: [...this.party].map(entity => ({ entity, name: this.entities.get(entity)?.name || null })) };
  }
  encounterTargets() {
    return [...this.fightTargets.values()].filter(t => t.party || [...t.owners].some(owner => owner === this.self || this.party.has(owner)));
  }
  inParty(owner) { return owner === this.self || this.party.has(owner); }
  addParticipant(owner) { if (this.self === null || this.inParty(owner)) this.fightParty.add(owner); }
  partyCombatStatus() {
    const members = new Set([...this.fightParty, ...this.hits.filter(h => this.inParty(h.owner)).map(h => h.owner)]);
    const states = [...members].map(id => this.entities.get(id)?.inCombat).filter(value => typeof value === 'boolean');
    return states.length ? states.includes(true) : undefined;
  }
  targetOutcome() {
    const targets = this.encounterTargets();
    if (!this.hits.length || !targets.length || targets.some(t => t.died === undefined && this.entities.get(t.entity)?.inCombat !== false)) return;
    return targets.every(t => t.died !== undefined) ? 'kill' : 'wipe';
  }
  resolveTargets(at) {
    const outcome = this.targetOutcome();
    if (this.splitEncounters && outcome && (this.encounterTargets().some(t => t.boss) || this.partyCombatStatus() === undefined)) this.finish(outcome, at);
  }
  resolvePartyExit(at) {
    if (this.splitEncounters && this.hits.length && !this.encounterTargets().some(t => t.boss) && this.partyCombatStatus() === false) this.finish(this.targetOutcome() || 'idle', at);
  }
  checkIdle(at, fromTimer = false) {
    if (!this.splitIdle) return;
    if (!this.hits.length) { if (this.pvpStartedAt !== null && at - this.lastPvpAt > this.idleMs) this.finish('idle', this.lastPvpAt); return; }
    // A missing/out-of-range combat flag must not turn the first returning hit
    // into a different encounter. Timers and incoming hits use the same window.
    const boss = this.hasBoss();
    const last = this.hits.findLast(h => this.fightParty.has(h.owner) || this.inParty(h.owner)) || this.hits.at(-1);
    if (boss && at < this.selfRecoveryUntil) return;
    if (at - last.at > (boss ? this.bossIdleMs : this.idleMs)) this.finish(this.targetOutcome() || 'idle', last.at);
  }
  combatState(now = Date.now()) {
    // Presentation follows the player's combat flag independently of encounter
    // accounting. A boss intermission may hide the panel without losing damage.
    const player = this.entities.get(this.self), selfState = player?.inCombat;
    // A missed combat-enter packet must not leave a new direct attack hidden
    // behind a stale false flag. A later false wins immediately, even if both
    // packets have the same capture timestamp. DoT/pets never sustain this.
    const attack = this.lastOwnAttack, age = now - (attack?.at ?? -Infinity);
    const recentAttack = attack?.entity === this.self && attack.revision > (player?.combatRevision ?? 0) && age >= -1000 && age < 3000;
    return { active: recentAttack || (selfState ?? (this.hits.length > 0 || this.pvpStartedAt !== null)), known: typeof selfState === 'boolean', encounterActive: this.hits.length > 0 || this.pvpStartedAt !== null };
  }
  ingest(event) {
    if (!event || !acceptedTypes.has(event.type) || !Number.isFinite(event.at)) return;
    this.totalEvents++;
    const e = event;
    if (!['damage', 'damage-over-time', 'heal'].includes(e.type)) this.recordDetail(e);
    switch (e.type) {
      case 'map':
        if (this.map === e.map && this.hasBoss() && (this.entities.get(this.self)?.dead || e.at < this.selfRecoveryUntil)) { this.suspendedAt = e.at; break; }
        this.finish('zone', e.at); this.entities.clear(); this.entityAliases.clear(); this.latestStats.clear(); this.party.clear(); this.buffs.clear(); this.self = null; this.map = e.map;
        this.detailEvents = []; this.detailRevision++; this.detailCache.clear(); break;
      case 'player': {
        const previousSelf = this.entities.get(this.self);
        const conflictingSelf = previousSelf && (previousSelf.id && e.id && previousSelf.id !== e.id || previousSelf.name && e.name && previousSelf.name !== e.name || previousSelf.server && e.server && previousSelf.server !== e.server);
        const sameSelf = e.self && previousSelf && (this.sameCharacter(previousSelf, e) || this.self === e.entity && !conflictingSelf);
        if (sameSelf && this.hasBoss() && (previousSelf.dead || e.at < this.selfRecoveryUntil)) this.selfRecoveryUntil = Math.max(this.selfRecoveryUntil, e.at + this.bossResumeMs);
        const previous = sameSelf ? previousSelf : [...this.entities.values()].reverse().find(p => p.kind === 'player' && p.entity !== e.entity && this.ownerOf(p.entity) === p.entity && this.sameCharacter(p, e));
        if (previous && (this.hits.length || this.pvpStartedAt !== null)) this.remapParticipant(previous.entity, e.entity);
        this.entityAliases.delete(e.entity);
        const old = this.entities.get(e.entity);
        const replaced = old && (old.kind === 'npc' || old.id && e.id && old.id !== e.id || old.name && e.name && old.name !== e.name || old.server && e.server && old.server !== e.server);
        if (replaced) { this.entities.delete(e.entity); this.party.delete(e.entity); }
        this.upsert(e.entity, { name: e.name, class: e.class, kind: 'player', owner: null, id: e.id || previous?.id, server: e.server || undefined, hp: e.hp, maxHp: e.maxHp, dead: e.hp === 0 ? true : e.hp > 0 ? false : undefined });
        if (e.self) this.self = e.entity;
        if (e.id) for (const [key, member] of this.entities) if (key !== e.entity && member.id === e.id && this.party.has(key)) { this.party.delete(key); this.party.add(e.entity); }
        if (this.party.has(e.entity)) this.rememberMember(this.entities.get(e.entity));
        this.bindMember(e.entity);
        break;
      }
      case 'spawn':
        this.entityAliases.delete(e.entity);
        if (this.entities.get(e.entity)?.kind === 'player') this.entities.delete(e.entity);
        this.party.delete(e.entity);
        { const info=bossInfo(e.npc);
          this.upsert(e.entity, { kind: 'npc', npc: e.npc, name:info?.name, boss:e.boss===true||!!info, scriptedExit:info?.scriptedExit===true, owner: e.owner || null, hp: e.hp, maxHp: e.maxHp, dead: false }); }
        break;
      case 'roster': this.party.clear(); this.roster.clear(); // falls through
      case 'roster-add':
        for (const member of e.members ?? []) {
          this.rememberMember(member);
          if (!Number.isInteger(member.entity) || member.entity <= 0) continue;
          if (this.entities.get(member.entity)?.kind === 'npc') this.entities.delete(member.entity);
          this.upsert(member.entity, { ...member, kind: 'player', owner: null }); this.confirmMember(member.entity);
        }
        for (const [entity, player] of this.entities) if (player.kind === 'player') this.bindMember(entity);
        break;
      case 'roster-remove':
        for (const key of this.party) if (this.entities.get(key)?.id === e.id) this.party.delete(key);
        for (const [key, member] of this.roster) if (member.id === e.id) this.roster.delete(key);
        break;
      case 'party-member':
        if (!Number.isInteger(e.entity) || e.entity <= 0) break;
        if (this.entities.get(e.entity)?.kind === 'npc') this.entities.delete(e.entity);
        this.upsert(e.entity, { kind: 'player', owner: null, hp: e.hp, maxHp: e.maxHp, dead: e.hp === 0 });
        this.confirmMember(e.entity); this.rememberMember(this.entities.get(e.entity)); break;
      case 'party-left': this.party.clear(); this.roster.clear(); break;
      case 'hp': {
        this.upsert(e.entity, { hp: e.hp, maxHp: e.maxHp, dead: e.hp === 0 ? true : e.hp > 0 ? false : undefined });
        const target = this.fightTargets.get(e.entity);
        if (!target || this.entities.get(e.entity)?.kind === 'player') break;
        const wasHurt = target.hp !== undefined && target.maxHp !== undefined && target.hp < target.maxHp;
        target.hp = e.hp; target.maxHp = e.maxHp ?? target.maxHp; target.startHp ??= e.hp;
        if (this.splitEncounters && target.boss && this.encounterTargets().includes(target) && wasHurt && target.hp === target.maxHp && target.damage > 0) this.finish('wipe', e.at);
        break;
      }
      case 'stagger':
        if (this.entities.get(e.entity)?.kind!=='player') {
          this.upsert(e.entity,{kind:'npc',boss:true,stagger:{max:e.max,current:e.current,broken:e.broken ?? e.current===0}});
          const target = this.fightTargets.get(e.entity); if (target) target.boss = true;
        }
        break;
      case 'stats':
        { const entity = e.entity ?? this.self, previous = this.latestStats.get(entity);
          this.latestStats.set(entity, { ...e, entity, full:e.full === true || previous?.full === true, stats:{...(e.full ? {} : previous?.stats), ...e.stats} }); }
        break;
      case 'combat-state':
        this.upsert(e.entity,{inCombat:!!e.inCombat,combatRevision:this.totalEvents});
        if (!e.inCombat) {
          if (this.fightParty.has(e.entity) || this.hits.some(h => h.owner === e.entity && this.inParty(h.owner))) this.resolvePartyExit(e.at);
          else if (this.fightTargets.has(e.entity)) this.resolveTargets(e.at);
        }
        break;
      case 'target': this.upsert(e.entity, { target: e.target }); break;
      case 'buff':
        if (this.buffs.size < 100000) this.buffs.set(`${e.target}:${e.uid}`, { ...e });
        if (this.entities.get(e.caster)?.kind === 'player') this.addParticipant(this.ownerOf(e.caster)); break;
      case 'buff-end': this.buffs.delete(`${e.target}:${e.uid}`); break;
      case 'capture-gap': this.gaps++; break;
      case 'death': {
        if (e.entity === this.self && this.hasBoss()) this.selfRecoveryUntil = e.at + this.bossResumeMs;
        this.upsert(e.entity, { hp: 0, dead: true });
        const target = this.fightTargets.get(e.entity);
        if (!target) break;
        target.died = e.at; target.hp = 0;
        if (this.splitEncounters && target.boss && this.encounterTargets().includes(target)) this.finish('kill', e.at);
        else this.resolveTargets(e.at);
        break;
      }
      case 'removed': {
        const target = this.fightTargets.get(e.entity);
        // A pet's DoT can tick after the pet disappears. Preserve ownership and
        // death state until a new appearance or zone replaces that entity.
        const removed = this.entities.get(e.entity);
        if (removed) {
          if (removed.kind === 'npc') removed.kind = 'removed';
          delete removed.inCombat; delete removed.target;
        }
        if (this.splitEncounters && target?.boss && this.encounterTargets().includes(target) && target.died === undefined && e.reason !== 3 && e.reason !== 'died') {
          const scripted = (e.reason === 7 || e.reason === 'despawned') && bossInfo(target.npc)?.scriptedExit;
          const recovering = this.entities.get(this.self)?.dead || e.at < this.selfRecoveryUntil || this.partyCombatStatus() === true;
          if (!scripted && recovering) { this.suspendedAt = e.at; this.selfRecoveryUntil = Math.max(this.selfRecoveryUntil, e.at + this.bossResumeMs); }
          else this.finish(scripted ? 'despawn' : 'wipe', e.at);
        }
        break;
      }
      case 'heal': {
        if (!this.hits.length || !Number.isInteger(e.actor) || !Number.isInteger(e.target) || !Number.isSafeInteger(e.amount) || e.amount <= 0) break;
        const owner = this.ownerOf(e.actor), targetOwner = this.ownerOf(e.target);
        if (this.entities.get(owner)?.kind !== 'player' || this.entities.get(targetOwner)?.kind !== 'player' || this.opponents.has(owner)) break;
        if (this.heals.length >= 200000) { this.truncated = true; break; }
        const buff = this.buffs.get(`${e.target}:${e.uid}`);
        this.recordDetail(e);
        // Resolve ownership and membership at capture time, just as for damage:
        // a despawned or reassigned pet must not move its earlier healing.
        this.heals.push({ at: e.at, actor: e.actor, owner, pet: owner !== e.actor, target: e.target, skill: baseSkill(e.skill || buff?.skill || 0),
          buff: e.buff || buff?.buff, amount: e.amount, party: this.inParty(owner) });
        this.addParticipant(owner);
        break;
      }
      case 'damage': case 'damage-over-time': {
        if (!Number.isSafeInteger(e.damage) || e.damage <= 0 || !Number.isInteger(e.actor) || !Number.isInteger(e.target)) return;
        const owner = this.ownerOf(e.actor), actor = this.entities.get(owner);
        // Known enemy damage must not start/split a player encounter.
        const targetOwner = this.ownerOf(e.target);
        const targetPlayer = this.entities.get(targetOwner)?.kind === 'player';
        if (targetPlayer && actor?.kind === 'player' && this.inParty(owner) !== this.inParty(targetOwner)) {
          this.opponents.add(this.inParty(owner) ? targetOwner : owner);
          this.pvpStartedAt ??= e.at; this.lastPvpAt = e.at;
        }
        if (actor?.kind === 'npc') { if (this.hits.length) this.recordDetail(e); return; }
        if (actor?.kind !== 'player') { this.unresolvedHits++; if (this.hits.length) this.recordDetail(e); return; }
        if (this.entities.get(targetOwner)?.kind === 'player') {
          if (this.inParty(owner) !== this.inParty(targetOwner)) this.opponents.add(this.inParty(owner) ? targetOwner : owner);
          if (!this.opponents.has(targetOwner) || this.inParty(targetOwner)) { if (this.inParty(targetOwner)) this.recordDetail(e); return; }
        }
        if (this.opponents.has(owner) && !this.inParty(owner)) return;
        // A late periodic/death duplicate must not start an empty new encounter.
        if (this.splitEncounters && !this.hits.length && this.entities.get(e.target)?.dead) return;
        this.checkIdle(e.at);
        // With a known self, only the party may start a new encounter. When
        // attached mid-session without self appearance, keep collecting until
        // identity/party HP arrives so captured damage can be recovered.
        if (this.splitEncounters && !this.hits.length && this.self !== null && !this.inParty(owner)) return;
        const buff = this.buffs.get(`${e.target}:${e.uid}`);
        if (this.hits.length >= 200000) { this.truncated = true; return; }
        this.recordDetail({ ...e, acceptedForDps: true });
        this.hits.push({ at: e.at, actor: e.actor, owner, pet: owner !== e.actor, target: e.target, skill: baseSkill(e.skill || buff?.skill || 0),
          buff: e.buff || buff?.buff, damage: e.damage, critical: !!e.critical, hits: Math.max(1, e.hits || 1), dot: e.type === 'damage-over-time',
          party: this.party.has(owner) || owner === this.self });
        this.addParticipant(owner);
        const npc = this.entities.get(e.target), target = this.fightTargets.get(e.target) || {entity:e.target,owners:new Set(),party:false,boss:false,damage:0};
        target.npc = npc?.npc || target.npc; target.boss ||= npc?.boss === true;
        target.hp = npc?.hp ?? target.hp; target.maxHp = npc?.maxHp ?? target.maxHp; target.startHp ??= target.hp;
        target.damage += e.damage; target.owners.add(owner); target.party ||= this.inParty(owner); this.fightTargets.set(e.target,target);
        if (e.type === 'damage' && e.actor === this.self) {
          this.lastOwnAttack = {entity:this.self,at:e.at,revision:this.totalEvents};
          this.suspendedAt = null; this.selfRecoveryUntil = 0;
        }
        this.lastHit = e.at; break;
      }
    }
  }
  tick(at) { this.checkIdle(at, true); }
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
      if (start === Infinity) start = hit.at; end = hit.at; total += hit.damage;
      let player = players.get(owner);
      if (!player) { player = { entity: owner, name: entity?.name || `Oyuncu #${owner}`, class: entity?.class || 'Bilinmiyor', self: owner === this.self,
        damage: 0, directDamage: 0, dotDamage: 0, petDamage: 0, hits: 0, directHits: 0, criticalHits: 0, skills: new Map() }; players.set(owner, player); }
      player.damage += hit.damage; player.hits += hit.hits;
      if (hit.dot) player.dotDamage += hit.damage;
      else { player.directDamage += hit.damage; player.directHits++; if (hit.critical) player.criticalHits++; }
      if (hit.pet ?? owner !== hit.actor) player.petDamage += hit.damage;
      const key = hit.skill ? `skill:${hit.skill}` : `buff:${hit.buff || 0}`;
      let skill = player.skills.get(key);
      if (!skill) { skill = { key, id: hit.skill, ...skillInfo(hit.skill, hit.buff), damage: 0, hits: 0, dotDamage: 0, directHits: 0, criticalHits: 0 }; player.skills.set(key, skill); }
      skill.damage += hit.damage; skill.hits += hit.hits;
      if (hit.dot) skill.dotDamage += hit.damage;
      else { skill.directHits++; if (hit.critical) skill.criticalHits++; }
      const targetInfo = this.entities.get(hit.target), fightTarget = this.fightTargets.get(hit.target), t = targets.get(hit.target) ?? { entity: hit.target, npc: targetInfo?.npc ?? fightTarget?.npc, boss: targetInfo?.boss === true || fightTarget?.boss === true, name: targetInfo?.name || `NPC #${targetInfo?.npc || hit.target}`, damage: 0, hp: targetInfo?.hp, maxHp: targetInfo?.maxHp, died: fightTarget?.died, stagger: targetInfo?.stagger };
      t.damage += hit.damage; targets.set(hit.target, t); filtered.push(hit);
    }
    const relatedDeath = e => e.type === 'death' && (e.entity === this.self || this.party.has(e.entity) || this.fightParty.has(e.entity) || this.opponents.has(e.entity));
    if (this.pvpStartedAt !== null) {
      start = Math.min(start, this.pvpStartedAt);
      end = Math.max(end, this.lastPvpAt);
      for (const e of this.detailEvents) if (relatedDeath(e)) end = Math.max(end, e.at);
    }
    const seconds = total || this.pvpStartedAt !== null ? Math.max(1, (end - start) / 1000) : 0;
    const rows = [...players.values()].map(p => ({ ...p, dps: p.damage / seconds, share: p.damage / total * 100,
      critRate: p.directHits ? p.criticalHits / p.directHits * 100 : 0,
      skills: [...p.skills.values()].map(s => ({ ...s, dps: s.damage / seconds, share: s.damage / p.damage * 100,
        critRate: s.directHits ? s.criticalHits / s.directHits * 100 : null })).sort((a,b) => b.damage - a.damage) })).sort((a,b) => b.damage - a.damage);
    // Healing has no enemy target in its packets. Keep it encounter-wide even
    // when the DPS target filter changes, and use the party's common damage
    // window so a healer with no outgoing damage still has a meaningful HPS.
    const healingHits = this.hits.filter(hit => scope === 'all' || hit.party || this.inParty(hit.owner));
    const healingSeconds = healingHits.length ? Math.max(1, (healingHits.at(-1).at - healingHits[0].at) / 1000) : 0;
    const healingPlayers = new Map(); let healing = 0;
    for (const heal of this.heals) {
      const owner = heal.owner ?? this.ownerOf(heal.actor);
      if (scope === 'self' && owner !== this.self) continue;
      if (scope === 'party' && !heal.party && !this.inParty(owner)) continue;
      if (this.opponents.has(owner)) continue;
      const entity = this.entities.get(owner);
      let player = healingPlayers.get(owner);
      if (!player) { player = { entity: owner, name: entity?.name || `Oyuncu #${owner}`, class: entity?.class || 'Bilinmiyor', self: owner === this.self,
        healing: 0, petHealing: 0, events: 0, skills: new Map() }; healingPlayers.set(owner, player); }
      healing += heal.amount; player.healing += heal.amount; player.events++;
      if (heal.pet ?? owner !== heal.actor) player.petHealing += heal.amount;
      const key = heal.skill ? `skill:${heal.skill}` : `buff:${heal.buff || 0}`;
      let skill = player.skills.get(key);
      if (!skill) { skill = { key, id: heal.skill, ...skillInfo(heal.skill, heal.buff), healing: 0, events: 0 }; player.skills.set(key, skill); }
      skill.healing += heal.amount; skill.events++;
    }
    const healers = [...healingPlayers.values()].map(p => ({ ...p, hps: healingSeconds ? p.healing / healingSeconds : 0, share: p.healing / healing * 100,
      skills: [...p.skills.values()].map(s => ({ ...s, hps: healingSeconds ? s.healing / healingSeconds : 0, share: s.healing / p.healing * 100 })).sort((a,b) => b.healing - a.healing) })).sort((a,b) => b.healing - a.healing);
    for (const player of rows) {
      const healer = healers.find(h => h.entity === player.entity);
      player.healing = healer?.healing || 0; player.hps = healer?.hps || 0; player.healingSkills = healer?.skills || [];
    }
    const buckets = new Map(); const bucketSeconds = Math.max(1, Math.ceil(seconds / 90));
    for (const h of filtered) { const n = Math.floor((h.at - start) / 1000 / bucketSeconds); buckets.set(n, (buckets.get(n) || 0) + h.damage); }
    const detailStart = this.pvpStartedAt !== null ? start : healingHits.length ? healingHits[0].at : null;
    let detailEnd = detailStart === null ? null : this.pvpStartedAt !== null ? end : healingHits.at(-1)?.at ?? detailStart;
    if (detailEnd !== null) for (const e of this.detailEvents) {
      if (relatedDeath(e) || ['damage','damage-over-time'].includes(e.type) && (e.targetOwner === this.self || this.party.has(e.targetOwner) || this.fightParty.has(e.targetOwner))) detailEnd = Math.max(detailEnd, e.at);
    }
    const detailSeconds = this.pvpStartedAt !== null ? seconds : healingSeconds;
    const key = `${scope}:${target}:${this.detailRevision}:${detailStart}:${detailEnd}`;
    let details = this.detailCache.get(key);
    if (!details) {
      details = buildCombatDetails({ events: this.detailEvents, entities: this.entities, self: this.self, party: new Set([...this.party,...this.fightParty]),
        scope, target, startedAt: detailStart, endedAt: detailEnd, seconds: detailSeconds, players: rows, ownerOf: entity => this.ownerOf(entity) });
      this.detailCache.set(key, details);
    }
    const selfEntity = this.entities.get(this.self);
    return { id: this.fightId, map: this.map, scope, target, kind: this.opponents.size ? 'pvp' : 'pve',
      selfCharacter: selfEntity ? { id:selfEntity.id ?? null,name:selfEntity.name ?? null,server:selfEntity.server ?? null,class:selfEntity.class ?? null } : null,
      startedAt: total || this.pvpStartedAt !== null ? start : null, endedAt: total || this.pvpStartedAt !== null ? end : null,
      seconds, damage: total, dps: seconds ? total / seconds : 0, healing, hps: healingSeconds ? healing / healingSeconds : 0, healingSeconds, healingScope: 'encounter', healers,
      reason:this.endReason,finishedAt:this.finishedAt, players: rows, targets: [...targets.values()].sort((a,b) => b.damage - a.damage),
      details, suspended: this.suspendedAt !== null && this.hasBoss(),
      deaths: this.detailEvents.filter(e => relatedDeath(e) && e.at >= detailStart && e.at <= detailEnd && (e.entity === this.self || this.party.has(e.entity) || this.fightParty.has(e.entity))).map(e => ({entity:e.entity,name:this.entities.get(e.entity)?.name ?? null,at:e.at})),
      chart: total ? Array.from({ length: Math.floor(seconds / bucketSeconds) + 1 }, (_, n) => ({ second: n * bucketSeconds, dps: (buckets.get(n) || 0) / bucketSeconds })) : [],
      issues: { gaps: this.gaps, unknownHits: unknown + this.unresolvedHits, truncated: this.truncated }, totalEvents: this.totalEvents };
  }
}
