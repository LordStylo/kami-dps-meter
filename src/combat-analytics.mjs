import fs from 'node:fs';
import { skillInfo } from './skills.mjs';
import { bossInfo } from './bosses.mjs';

// Independently implemented from the observed Questlog 0.1.35 calculations.
// Only numerical game facts are stored in the catalog; no installed-app code is
// imported or executed. Unknown external effects make attribution unavailable.
const catalog = JSON.parse(fs.readFileSync(new URL('../data/combat-analytics.json', import.meta.url)));
const baseSkill = value => value >= 11000000 && value <= 19999999 ? Math.floor(value / 10000) * 10000 : value || 0;
const sum = values => values.reduce((total, value) => total + value, 0);
const ratio = (a, b) => b > 0 ? a / b : 0;
const names = (skill, buff) => { const info = skillInfo(baseSkill(skill), buff); return buff && catalog.buffNames?.[buff] ? { ...info, name: catalog.buffNames[buff] } : info; };
const damageType = type => type === 'damage' || type === 'damage-over-time';
const groups = [
  { raise: ['amplifyalldamage', 'pveamplifydamage', 'bossnpcamplifydamage'], lower: ['decreasedamage', 'pvedecreasedamage', 'bossnpcdecreasedamage'], base: 10000 },
  { raise: ['damageratio'], lower: [], base: 10000 },
  { raise: ['combatspeed', 'attackspeed', 'spellspeed'], lower: [], base: 10000, kind: 'speed' },
  { raise: ['amplifycriticaldamage'], lower: ['decreasecriticaldamage'], base: 15000, kind: 'critical' },
  { raise: ['amplifyfrontattack'], lower: ['decreasefrontattack'], base: 10000, kind: 'front' },
  { raise: ['amplifybackattack'], lower: ['decreasebackattack'], base: 10000, kind: 'back' },
  { raise: ['critical'], lower: ['criticalresist'], kind: 'criticalChance', perPoint: 0.001 },
  { raise: ['hardhit'], lower: ['hardhitresist'], kind: 'hardHitChance', perPoint: 0.0001 },
];
const statSum = (stats, keys) => sum(keys.map(key => stats[key] || 0));
const cache = new WeakMap();

function spanLookup(records) {
  const boundaries = new Map();
  records.forEach((record, index) => {
    if (!(record.to > record.from)) return;
    if (!boundaries.has(record.from)) boundaries.set(record.from, { add: [], remove: [] });
    if (!boundaries.has(record.to)) boundaries.set(record.to, { add: [], remove: [] });
    boundaries.get(record.from).add.push(index); boundaries.get(record.to).remove.push(index);
  });
  const times = [...boundaries.keys()].sort((a, b) => a - b), active = new Set(), segments = [];
  for (const time of times) {
    const change = boundaries.get(time);
    for (const index of change.remove) active.delete(index);
    for (const index of change.add) active.add(index);
    const unique = new Set();
    segments.push([...active].sort((a, b) => a - b).map(index => records[index]).filter(record => {
      const key = `${record.buff}:${record.caster}:${record.debuff}`;
      if (unique.has(key)) return false; unique.add(key); return true;
    }));
  }
  return at => {
    let left = 0, right = times.length;
    while (left < right) { const middle = (left + right) >>> 1; if (times[middle] <= at) left = middle + 1; else right = middle; }
    return left ? segments[left - 1] : [];
  };
}

export function buffStats(buff, level, facts = catalog) {
  const effects = facts.buffs[buff];
  if (!effects) return Object.hasOwn(facts.buffNames || {}, buff) ? {} : null;
  const result = {};
  for (const effect of effects) if (!(effect.stat in result)) result[effect.stat] = effect.levels?.[level] ?? effect.value;
  return result;
}

// Union, rather than addition, prevents overlapping applications or several
// casters of the same buff from exceeding 100% uptime.
export function unionDuration(spans, from, to) {
  const ranges = spans.map(span => [Math.max(from, span.from), Math.min(to, span.to)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, coveredUntil = from;
  for (const [a, b] of ranges) { total += Math.max(0, b - Math.max(a, coveredUntil)); coveredUntil = Math.max(coveredUntil, b); }
  return total;
}

function by(items, keyOf) {
  const result = new Map();
  for (const item of items) { const key = keyOf(item); if (!result.has(key)) result.set(key, []); result.get(key).push(item); }
  return result;
}

function summarizeBuffs(spans, start, end, self) {
  return [...by(spans, span => span.buff)].map(([buff, records]) => {
    const ms = unionDuration(records, start, end), skill = records.find(record => record.skill)?.skill;
    return { buff, skill: baseSkill(skill), ...names(skill, buff), uptime: ratio(ms, end - start), activeSeconds: ms / 1000,
      applied: records.filter(record => record.application !== false && !record.initial && record.from >= start && record.from <= end).length,
      bySelf: records.filter(record => record.application !== false && !record.initial && record.caster === self && record.from >= start && record.from <= end).length,
      levels: [...new Set(records.map(record => record.level).filter(Number.isFinite))].sort((a, b) => a - b) };
  }).filter(buff => buff.uptime > 0 || buff.applied > 0).sort((a, b) => b.uptime - a.uptime);
}

function summarizeSkills(hits, seconds) {
  return [...by(hits, hit => baseSkill(hit.skill))].map(([skill, rows]) => {
    const direct = rows.filter(row => row.type === 'damage'), damage = sum(rows.map(row => row.damage));
    return { skill, ...names(skill), damage, dps: ratio(damage, seconds), hits: direct.length,
      overTimeHits: rows.length - direct.length, critRate: ratio(direct.filter(row => row.critical).length, direct.length) };
  }).sort((a, b) => b.damage - a.damage);
}

function chanceRates(hits) {
  const result = {};
  for (const hit of hits) {
    if (hit.type !== 'damage') continue;
    const critKey = hit.back ? 'back' : 'other';
    result[critKey] ??= { count: 0, critical: 0 }; result[critKey].count++; result[critKey].critical += hit.critical ? 1 : 0;
    result.direct ??= { count: 0, hardHit: 0 }; result.direct.count++; result.direct.hardHit += hit.hardHit ? 1 : 0;
  }
  return { criticalChance: hit => { const row = result[hit.back ? 'back' : 'other']; return row ? ratio(row.critical, row.count) : 1; },
    hardHitChance: () => result.direct ? ratio(result.direct.hardHit, result.direct.count) : 1 };
}

function supportGain(hit, stats, debuff, observed) {
  let gain = 0;
  for (const group of groups) {
    const points = debuff ? -statSum(stats, group.lower) : statSum(stats, group.raise);
    if (points <= 0) continue;
    if (group.kind === 'speed' && !(hit.speed > 10000)) continue;
    if ((group.kind === 'critical' || group.kind === 'criticalChance') && !hit.critical) continue;
    if (group.kind === 'front' && !hit.front || group.kind === 'back' && !hit.back) continue;
    if (group.kind === 'hardHitChance' && !hit.hardHit) continue;
    const attacker = hit.attackerStats, target = hit.targetStats;
    if (group.perPoint) {
      const rate = observed[group.kind](hit);
      const multiplier = group.kind === 'hardHitChance' ? 0.5
        : 1 - 10000 / Math.max(10000, 15000 + (attacker.amplifycriticaldamage || 0) - (target.decreasecriticaldamage || 0));
      gain += hit.damage * multiplier * Math.min(1, group.perPoint * points / rate);
    } else if (group.kind === 'speed') gain += hit.damage * Math.min(points, hit.speed - 10000) / hit.speed;
    else {
      const knownAttacker = group.raise.some(stat => Object.hasOwn(attacker, stat));
      const denominator = Math.max(points, group.base + (knownAttacker || debuff ? statSum(attacker, group.raise) : points) - statSum(target, group.lower));
      gain += hit.damage * points / denominator;
    }
  }
  return gain;
}

function defenseDetails(hits, misses) {
  const direct = hits.filter(hit => hit.type === 'damage'), count = direct.length;
  const matching = name => direct.filter(hit => hit.mitigation === name);
  const blocked = direct.filter(hit => ['block', 'perfect-block'].includes(hit.mitigation)), parried = matching('parry');
  const evaded = misses.filter(hit => hit.outcome === 'evade').length, resisted = misses.filter(hit => hit.outcome === 'resist').length;
  let prevented = 0;
  for (const rows of by(direct, hit => `${hit.actor}:${hit.skill}`).values()) {
    const unmitigated = rows.reduce((max, hit) => hit.mitigation ? max : Math.max(max, hit.damage), 0);
    prevented += sum(rows.filter(hit => hit.mitigation).map(hit => Math.max(0, unmitigated - hit.damage)));
  }
  return { landed: count, damage: sum(hits.map(hit => hit.damage)), highestHit: direct.reduce((max, hit) => Math.max(max, hit.damage), 0),
    averageHit: ratio(sum(direct.map(hit => hit.damage)), count), critsTaken: direct.filter(hit => hit.critical).length,
    backHitsTaken: direct.filter(hit => hit.back).length, blocked: blocked.length, blockedDamage: sum(blocked.map(hit => hit.damage)),
    perfectBlocks: matching('perfect-block').length, parried: parried.length, parriedDamage: sum(parried.map(hit => hit.damage)),
    ironWalls: matching('iron-wall').length, restorations: matching('restoration').length,
    plainDamage: sum(direct.filter(hit => !hit.mitigation).map(hit => hit.damage)), evaded, resisted,
    immune: misses.filter(hit => hit.outcome === 'immune').length, prevented,
    avoidanceRate: ratio(evaded + resisted, count + evaded + resisted), mitigationRate: ratio(direct.filter(hit => hit.mitigation).length, count) };
}

export function buildCombatDetails(options) {
  const { events = [], entities = new Map(), self = null, party = new Set(), scope = 'party', target = null,
    startedAt, endedAt, seconds = 0, players = [], ownerOf = entity => entity, facts = catalog } = options;
  const start = Number.isFinite(startedAt) ? startedAt : 0, end = Number.isFinite(endedAt) ? Math.max(start, endedAt) : start;
  const duration = Math.max(1000, seconds * 1000), buffEnd = start + duration;
  const cacheKey = `${events.length}:${events.at(-1)?.at}:${start}:${end}:${seconds}:${scope}:${target}:${self}:${[...party]}:${players.map(player => `${player.entity}/${player.damage}`).join(',')}`;
  if (facts === catalog && cache.get(events)?.key === cacheKey) return cache.get(events).value;
  const owner = (event, field) => event[`${field}Owner`] ?? (field === 'actor' ? event.owner : undefined) ?? ownerOf(event[field]);
  const selectedPlayers = new Set(players.map(player => player.entity));
  const isPlayer = entity => entities.get(entity)?.kind === 'player' || entity === self || party.has(entity) || selectedPlayers.has(entity);
  const isParty = entity => entity === self || party.has(entity);
  // Self is a presentation filter: support given to other party members still
  // contributes to the player's rDPS, using the supplied common party clock.
  const counts = entity => isPlayer(entity) && (scope === 'all' || isParty(entity));
  const visible = entity => scope === 'self' ? entity === self : counts(entity);
  const targetMatches = entity => target === null || target === undefined || entity === Number(target);
  const active = new Map(), activeTargets = new Map(), revisions = new Map(), aggregated = new Map();
  const spans = new Map(), outgoing = [], incoming = [], avoided = [], casts = [], latestCast = new Map(), castStops = [], deaths = [], dead = new Set();
  const participants = new Set(players.map(player => player.entity)), bossStates = new Map(), touchedTargets = new Set(), warnings = new Set();
  const ownStats = {}; let hasOwnStats = false;
  const getSpans = entity => spans.get(entity) ?? [];
  function appendSpan(record, at) {
    const to = Math.min(at, record.endsAt ?? at);
    if (!spans.has(record.target)) spans.set(record.target, []);
    if (to >= record.from) spans.get(record.target).push({ ...record, to });
  }
  function activeOn(entity) { return [...(activeTargets.get(entity)?.values() || [])]; }
  function replaceActive(key, record) {
    const previous = active.get(key), entity = record?.target ?? previous?.target;
    if (entity === undefined) return;
    revisions.set(entity, (revisions.get(entity) || 0) + 1);
    if (record) {
      if (!activeTargets.has(entity)) activeTargets.set(entity, new Map());
      activeTargets.get(entity).set(key, record); active.set(key, record);
    } else { activeTargets.get(entity)?.delete(key); active.delete(key); }
  }
  function aggregate(entity) {
    const revision = revisions.get(entity) || 0;
    if (aggregated.get(entity)?.revision === revision) return aggregated.get(entity).stats;
    // Questlog's stat state follows explicit removal packets, while its uptime
    // and attribution spans also respect the advertised expiration time.
    const stats = {}, unique = new Map(activeOn(entity).map(record => [record.buff, record.stats]));
    for (const row of unique.values()) for (const [name, value] of Object.entries(row || {})) stats[name] = (stats[name] || 0) + value;
    aggregated.set(entity, { revision, stats });
    return stats;
  }
  const ordered = events.every((event, index) => !index || event.at >= events[index - 1].at) ? events : events.toSorted((a, b) => a.at - b.at);
  for (const event of ordered) {
    if (!Number.isFinite(event.at)) continue;
    // Boss HP/death can arrive just after the last damaging hit; the immutable
    // entity snapshot is authoritative for its final HP below.
    if (event.at > Math.max(end, buffEnd)) continue;
    const inFight = event.at >= start && event.at <= end;
    if (event.type === 'stats') {
      if (event.full || (event.entity ?? self) === self) {
        if (event.full) { for (const key of Object.keys(ownStats)) delete ownStats[key]; hasOwnStats = true; }
        for (const [id, value] of Object.entries(event.stats || {})) {
          const stat = facts.stats[id] || (/^[a-z]+$/.test(id) ? id : undefined);
          if (stat && Number.isFinite(value)) ownStats[stat] = value;
        }
      }
      continue;
    }
    if (event.type === 'buff' || event.type === 'buff-end') {
      const key = `${event.target}:${event.uid}`, previous = active.get(key);
      if (event.type === 'buff-end') {
        if (previous) appendSpan(previous, event.at);
        replaceActive(key, undefined);
        continue;
      }
      const caster = event.caster === undefined || !event.caster ? undefined : owner(event, 'caster');
      const stats = event.stats && typeof event.stats === 'object' ? event.stats : buffStats(event.buff, event.level, facts);
      const next = { target: event.target, uid: event.uid, buff: event.buff, skill: event.skill, level: event.level, caster, stats,
        from: event.at, endsAt: event.timer?.endsAt, initial: event.initial || event.at < start, application: true, timerEstimated: event.timer?.estimated === true };
      if (previous && previous.buff === event.buff) {
        next.caster = previous.caster; next.skill = previous.skill;
        if (previous.level === event.level) { next.from = previous.from; next.initial = previous.initial; next.application = previous.application; }
        else { appendSpan(previous, event.at); next.application = false; }
      } else if (previous) appendSpan(previous, event.at);
      replaceActive(key, next);
      if (inFight && caster !== undefined && counts(caster)) participants.add(caster);
      continue;
    }
    if (event.type === 'spawn' || event.type === 'hp' || event.type === 'stagger' || event.type === 'death') {
      const entity = event.entity, state = bossStates.get(entity) || {};
      if (event.type === 'spawn') Object.assign(state, { npc: event.npc, hp: event.hp, maxHp: event.maxHp, boss: event.boss || !!bossInfo(event.npc) });
      if (event.type === 'hp') Object.assign(state, { hp: event.hp, maxHp: event.maxHp ?? state.maxHp });
      if (event.type === 'death') state.hp = 0;
      if (event.type === 'stagger') Object.assign(state, { boss: true, stagger: { max: event.max, current: event.current, broken: event.broken === true } });
      bossStates.set(entity, state);
      if ((event.type === 'spawn' || event.type === 'hp') && event.hp > 0) dead.delete(entity);
    }
    if (!inFight) continue;
    if (damageType(event.type) && Number.isSafeInteger(event.damage) && event.damage > 0) {
      const actor = owner(event, 'actor'), receiver = owner(event, 'target');
      if (event.acceptedForDps !== false && counts(actor) && targetMatches(event.target) && (!isPlayer(receiver) || isParty(actor) !== isParty(receiver))) {
        const attackerStats = actor === self && hasOwnStats ? { ...ownStats } : aggregate(actor), targetStats = { ...aggregate(event.target) };
        const tolerance = facts.bossTolerance[entities.get(event.target)?.npc ?? bossStates.get(event.target)?.npc];
        if (tolerance) targetStats.pvedecreasedamage = (targetStats.pvedecreasedamage || 0) + tolerance;
        outgoing.push({ ...event, actorOwner: actor, attackerStats, targetStats });
        participants.add(actor); touchedTargets.add(event.target);
      }
      if (counts(receiver) && (!isPlayer(actor) || isParty(actor) !== isParty(receiver))) { incoming.push({ ...event, targetOwner: receiver }); participants.add(receiver); }
      if (event.type === 'damage' && event.action !== undefined) {
        const cast = latestCast.get(`${event.actor}:${event.action}`);
        if (cast) { cast.damage += event.damage; for (const flag of ['critical', 'back', 'perfect', 'hardHit']) cast[flag] ||= !!event[flag]; }
      }
    }
    if (event.type === 'avoided' && counts(owner(event, 'target'))) avoided.push({ ...event, targetOwner: owner(event, 'target') });
    if (event.type === 'heal' && counts(owner(event, 'actor'))) participants.add(owner(event, 'actor'));
    if (event.type === 'cast' && counts(owner(event, 'entity'))) {
      const row = { entity: event.entity, owner: owner(event, 'entity'), skill: baseSkill(event.skill), target: event.target, action: event.action,
        at: event.at, offsetMs: event.at - start, damage: 0, critical: false, back: false, perfect: false, hardHit: false, stop: undefined };
      casts.push(row); latestCast.set(`${event.entity}:${event.action}`, row); participants.add(row.owner);
    }
    if (event.type === 'cast-end') { const cast = latestCast.get(`${event.entity}:${event.action}`); if (cast) cast.stop = event.reason; }
    if (event.type === 'cast-stop' && event.reason === 'interrupted') castStops.push(owner(event, 'entity'));
    if (event.type === 'death' && !dead.has(event.entity)) { deaths.push(event); dead.add(event.entity); }
  }
  for (const record of active.values()) appendSpan(record, buffEnd);
  const contributions = [], unknownReceivers = new Set(), unknownCasters = new Set();
  const lookups = new Map();
  function externalAt(entity, receiver, debuff, at) {
    const key = `${entity}:${receiver}:${debuff}`;
    if (!lookups.has(key)) lookups.set(key, spanLookup(getSpans(entity).filter(record => record.caster !== undefined && record.caster !== receiver && isPlayer(record.caster)
      && (record.stats === null || Object.keys(record.stats).length > 0)).map(record => ({ ...record, debuff }))));
    return lookups.get(key)(at);
  }
  for (const [receiver, hits] of by(outgoing, hit => hit.actorOwner)) {
    const observed = chanceRates(hits);
    for (const hit of hits) for (const record of [...externalAt(receiver, receiver, false, hit.at), ...externalAt(hit.target, receiver, true, hit.at)]) {
      if (counts(record.caster)) participants.add(record.caster);
      if (record.stats === null) { unknownReceivers.add(receiver); unknownCasters.add(record.caster); continue; }
      if (record.timerEstimated) warnings.add('Bazı etki süreleri sunucu saati görülmeden süre alanından hesaplandı.');
      const amount = supportGain(hit, record.stats, record.debuff, observed);
      if (amount > 0) contributions.push({ receiver, caster: record.caster, buff: record.buff, debuff: record.debuff, amount });
    }
  }
  if (unknownReceivers.size) warnings.add('Bazı dış etkilerin sayısal verisi bilinmediğinden ilgili rDPS hesaplanamıyor.');
  const fullParticipants = [...participants].filter(counts), rows = [];
  const mainTarget = [...by(outgoing, hit => hit.target)].map(([entity, hits]) => ({ entity, damage: sum(hits.map(hit => hit.damage)) })).sort((a, b) => b.damage - a.damage)[0]?.entity;
  for (const entity of fullParticipants.filter(visible)) {
    const hits = outgoing.filter(hit => hit.actorOwner === entity), taken = incoming.filter(hit => hit.targetOwner === entity), ownCasts = casts.filter(cast => cast.owner === entity);
    const receive = contributions.filter(row => row.receiver === entity), give = contributions.filter(row => row.caster === entity);
    const known = !unknownReceivers.has(entity) && !unknownCasters.has(entity);
    const received = known ? sum(receive.map(row => row.amount)) : null, added = known ? sum(give.map(row => row.amount)) : null;
    const damage = sum(hits.map(hit => hit.damage)), damageTaken = sum(taken.map(hit => hit.damage));
    const others = fullParticipants.filter(other => other !== entity), supportKeys = new Map();
    for (const other of others) for (const record of getSpans(other).filter(record => record.caster === entity)) supportKeys.set(`${record.buff}:false`, { ...record, debuff: false });
    for (const record of getSpans(mainTarget).filter(record => record.caster === entity)) supportKeys.set(`${record.buff}:true`, { ...record, debuff: true });
    const support = [...supportKeys.values()].map(record => {
      const related = candidate => candidate.buff === record.buff && candidate.caster === entity;
      const uptime = record.debuff ? ratio(unionDuration(getSpans(mainTarget).filter(related), start, buffEnd), duration)
        : ratio(sum(others.map(other => unionDuration(getSpans(other).filter(related), start, buffEnd))), duration * others.length);
      const contribution = give.filter(row => row.buff === record.buff && row.debuff === record.debuff);
      return { buff: record.buff, skill: baseSkill(record.skill), ...names(record.skill, record.buff), debuff: record.debuff, uptime,
        added: record.stats === null || unknownCasters.has(entity) ? null : sum(contribution.map(row => row.amount)) };
    }).filter(row => row.uptime > 0).sort((a, b) => b.uptime - a.uptime);
    rows.push({ entity, damageTaken, dtps: ratio(damageTaken, seconds),
      takenSources: [...by(taken, hit => hit.actor)].map(([actor, actorHits]) => { const info = entities.get(actor), amount = sum(actorHits.map(hit => hit.damage)); return {
        entity: actor, name: info?.name || bossInfo(info?.npc)?.name || `Kaynak #${info?.npc || actor}`, npc: info?.npc, damage: amount,
        share: ratio(amount, damageTaken), skills: summarizeSkills(actorHits, seconds) }; }).sort((a, b) => b.damage - a.damage),
      defense: defenseDetails(taken, avoided.filter(hit => hit.targetOwner === entity)),
      buffs: summarizeBuffs(getSpans(entity), start, buffEnd, self), support,
      rotation: ownCasts.slice(-128).map(({ skill, offsetMs, damage: amount, critical, back, perfect, hardHit, stop }) => ({ skill, ...names(skill), offsetMs, damage: amount, critical, back, perfect, hardHit, stop })),
      casts: ownCasts.length, interrupted: ownCasts.filter(cast => cast.stop === 'interrupted').length + castStops.filter(owner => owner === entity).length,
      cancelled: ownCasts.filter(cast => cast.stop === 'cancelled').length,
      kills: deaths.filter(event => event.killer !== undefined && ownerOf(event.killer) === entity && isPlayer(ownerOf(event.entity)) && isParty(entity) !== isParty(ownerOf(event.entity))).length,
      deaths: deaths.filter(event => ownerOf(event.entity) === entity).length,
      received, added, rdps: known && seconds > 0 ? (damage - received + added) / seconds : null, rdpsKnown: known && seconds > 0 });
  }
  const bosses = [...touchedTargets].map(entity => {
    const info = { ...bossStates.get(entity), ...entities.get(entity) };
    if (!(info.boss || bossInfo(info.npc) || info.stagger)) return null;
    const stagger = info.stagger || bossStates.get(entity)?.stagger || null;
    return { entity, npc: info.npc, name: info.name || bossInfo(info.npc)?.name || `Boss #${info.npc || entity}`,
      hp: Number.isFinite(info.hp) ? info.hp : null, maxHp: Number.isFinite(info.maxHp) ? info.maxHp : null,
      hpPercent: info.maxHp > 0 && Number.isFinite(info.hp) ? Math.min(100, Math.max(0, info.hp / info.maxHp * 100)) : null,
      stagger, buffs: summarizeBuffs(getSpans(entity), start, buffEnd, self) };
  }).filter(Boolean);
  const selfDetail = rows.find(row => row.entity === self);
  const value = { version: 1, formula: 'questlog-0.1.35', catalogRetrievedAt: facts.retrievedAt || null, players: rows, bosses, pvp: {
    kills: selfDetail?.kills || 0,
    deaths: deaths.filter(event => ownerOf(event.entity) === self && event.killer !== undefined && isPlayer(ownerOf(event.killer)) && !isParty(ownerOf(event.killer))).length,
    dealt: sum(outgoing.filter(hit => hit.actorOwner === self && isPlayer(ownerOf(hit.target)) && !isParty(ownerOf(hit.target))).map(hit => hit.damage)),
    taken: sum(incoming.filter(hit => hit.targetOwner === self && isPlayer(ownerOf(hit.actor)) && !isParty(ownerOf(hit.actor))).map(hit => hit.damage)),
  }, warnings: [...warnings] };
  if (facts === catalog) cache.set(events, { key: cacheKey, value });
  return value;
}
