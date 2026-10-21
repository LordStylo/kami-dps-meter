import fs from 'node:fs';
import { Reader, WireError, UnsupportedPacket, safeNumber } from './reader.mjs';
import {readPetObservation} from './pets.mjs';

const facts = JSON.parse(fs.readFileSync(new URL('../../data/effect-types.json', import.meta.url)));
const effects = Object.fromEntries(Object.entries(facts).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k, new Set(v)]));
const classes = [null, 'Gladiator', 'Templar', 'Ranger', 'Assassin', 'Elementalist', 'Sorcerer', 'Cleric', 'Chanter', null, null, 'Fighter'];
const className = pcId => classes[Math.floor((pcId - 1) / 4)] ?? `Sınıf ${pcId}`;
const optional = (flags, bit, read, fallback = 0) => flags & (1 << bit) ? read() : fallback;

function description(r) {
  const flags = r.u8(); const name = optional(flags, 0, () => r.str(), ''); const pcId = r.i32();
  optional(flags, 1, () => r.u8()); optional(flags, 2, () => r.u8());
  optional(flags, 3, () => { r.u8(); r.i32(); }); optional(flags, 4, () => r.u8());
  return { name, pcId, class: className(pcId) };
}

function state(r, includePosition = false) {
  const flags = r.u16(), position = r.vec(); r.f32(); r.u16();
  optional(flags, 0, () => r.vec()); optional(flags, 1, () => r.f32()); optional(flags, 2, () => r.u16());
  optional(flags, 3, () => r.vec()); optional(flags, 4, () => r.vec());
  const target = optional(flags, 5, () => r.i32()); const live = r.u8();
  const hp = safeNumber(r.vi64()), maxHp = safeNumber(r.vi64()); r.skip(13 * 4);
  optional(flags, 6, () => r.u8()); optional(flags, 7, () => r.i32());
  optional(flags, 8, () => r.u8()); optional(flags, 9, () => r.u8());
  optional(flags, 10, () => r.vi32());
  for (let bit = 11; bit < 16; bit++) optional(flags, bit, () => r.i32());
  if (includePosition && !Object.values(position).every(Number.isFinite)) throw new WireError('Invalid self position');
  return { hp, maxHp, target, live, ...(includePosition ? { position } : {}) };
}

// The self-appearance packet provides a reliable spawn position, not a stream
// of current walking positions. Keep this separate from the live DPS events.
export function readSelfPosition(payload) {
  const r = new Reader(payload), entity = r.vi32(); r.u32(); ownDescription(r);
  const { position } = state(r, true);
  if (entity <= 0) throw new WireError('Invalid self entity');
  return { entity, position };
}

// Spatial observations are kept separate from combat events and identity data.
export function readNpcPosition(payload) {
  const r = new Reader(payload), entity = r.vi32(), flags = r.u16();
  const { pcId: template } = description(r), { position } = state(r, true);
  r.list(abnormal);
  optional(flags, 0, () => r.u8()); optional(flags, 1, () => r.u8());
  const reason = optional(flags, 2, () => r.u8());
  if (entity <= 0 || template <= 0) throw new WireError('Invalid NPC position');
  return { entity, template, position, reason };
}

function abnormal(r, includeRangeBase = false) {
  const flags = r.u8();
  if (includeRangeBase && flags & ~31) throw new WireError('Unknown buff position flags');
  const uid = r.vi32(), buff = r.i32();
  const durationMs = safeNumber(r.i64()), serverEndsAt = safeNumber(r.i64());
  const caster = optional(flags, 0, () => r.vi32()), level = r.u8();
  const skill = optional(flags, 1, () => r.i32()); r.bool();
  optional(flags, 2, () => r.vi32()); optional(flags, 3, () => r.i32());
  const rangeBase = optional(flags, 4, () => r.vec(), undefined);
  const offset = r.context?.serverOffset;
  const endsAt = serverEndsAt > 0 && Number.isFinite(offset) ? serverEndsAt - offset : durationMs > 0 ? r.at + durationMs : undefined;
  return { uid, buff, caster: caster || undefined, skill: skill || undefined, level,
    ...(includeRangeBase && rangeBase ? { rangeBase } : {}),
    ...(durationMs > 0 ? { timer: { durationMs, endsAt, estimated: !Number.isFinite(offset) } } : {}) };
}

// Spatial evidence kept outside the normal combat event schema. The map's
// requested Quest-compatible model accepts own-cast/own-target range origins
// as estimated map coordinates; conservative near/far uses corroboration only.
export function readBuffPositionAnchors(opcode, payload) {
  const r = new Reader(payload), entity = r.vi32();
  let buffs;
  if (opcode === 0x382a) buffs = r.list(x => abnormal(x, true));
  else if (opcode === 0x382b) { buffs = [abnormal(r, true)]; r.bool(); }
  else throw new WireError('Not a buff position packet');
  r.done();
  return { entity, anchors: buffs.filter(buff => buff.rangeBase).map(buff => ({ caster: buff.caster, uid: buff.uid, buff: buff.buff, position: buff.rangeBase })) };
}

function ownDescription(r) {
  const flags = r.u8(), name = optional(flags, 0, () => r.str(), ''), server = r.u16(), pcId = r.i32();
  optional(flags, 1, () => r.u8());
  r.skip(4 * 4); r.i64(); r.i32(); r.i64(); optional(flags, 2, () => r.u8());
  r.list(x => x.skip(14)); r.list(x => x.skip(13));
  r.i32(); r.i32(); r.i64(); r.u8(); optional(flags, 3, () => r.u8());
  optional(flags, 4, () => r.list(x => x.skip(3))); optional(flags, 5, () => r.list(x => x.skip(3)));
  return { name, server, pcId, class: className(pcId) };
}

function appearance(r, kind) {
  const entity = r.vi32(), flags = kind === 'npc' ? r.u16() : r.u32();
  const desc = kind === 'self' ? ownDescription(r) : description(r);
  const hp = state(r); let owner = 0, initialBuffs = [];
  if (kind === 'npc') {
    initialBuffs = r.list(abnormal);
    for (let bit = 0; bit < 3; bit++) optional(flags, bit, () => r.u8());
    optional(flags, 3, () => r.bool()); owner = optional(flags, 4, () => r.i32());
  } else if (kind === 'player') desc.server = optional(flags, 0, () => r.u16());
  if (desc.name.length > 128 || !entity) throw new WireError('Invalid identity prefix');
  return [{ type: kind === 'npc' ? 'spawn' : 'player', entity, ...hp,
    ...(kind === 'npc' ? { npc: desc.pcId, owner: owner || undefined } : { ...desc, self: kind === 'self' }) },
  ...initialBuffs.map(buff => ({ type: 'buff', target: entity, ...buff, initial: true }))];
}

function member(r, raid = false) {
  const flags = r.u8(); r.u8(); const entity = r.i32(), server = r.u16(); r.u16();
  r.str(); // account identifier: discard, never expose or record
  const id = String(r.i64()), name = r.str(), pcId = r.i32();
  const hp = safeNumber(r.vi64()), maxHp = safeNumber(r.vi64());
  if (!raid) r.skip(24);
  r.i64(); r.i32(); if (!raid) r.vec(); r.bool();
  optional(flags, 0, () => r.str()); optional(flags, 1, () => r.i32());
  r.i32(); r.i32();
  if (raid) { r.bool(); r.i32(); r.vec(); }
  else {
    r.i32(); r.bool(); r.bool();
    optional(flags, 2, () => r.list(x => { const f = x.u8(); x.i32(); x.u8(); optional(f, 0, () => x.vi32()); }));
  }
  r.i64(); r.u8();
  return { entity, id, name, server, class: className(pcId), hp, maxHp };
}

function targetMarker(r) { const f = r.u8(); r.u8(); r.i32(); r.str(); optional(f, 0, () => r.i32()); }
function worldMarker(r) { r.u8(); r.i32(); r.vec(); r.bool(); }
function mapPin(r) {
  const f = r.u8(); r.u8(); r.str(); r.i32(); r.vec(); r.i64(); r.i64();
  optional(f, 0, () => r.list(x => x.i64()));
}
function party(r, raid = false) {
  const flags = r.u8(); r.i64(); r.i64(); if (raid) r.list(x => x.i64());
  r.i32(); r.skip(raid ? 3 : 4);
  if (!raid) optional(flags, 0, () => { const f = r.u8(); r.i32(); optional(f, 0, () => r.i32()); r.i32(); });
  optional(flags, raid ? 0 : 1, () => r.list(targetMarker));
  optional(flags, raid ? 1 : 2, () => r.list(worldMarker));
  if (!raid && (flags & 8)) {
    const count = r.v32(); if (count) throw new UnsupportedPacket('Party scan-list variant');
  }
  const members = raid ? r.list(x => { x.i64(); x.u8(); x.i32(); return x.list(y => member(y, true)); }).flat() : r.list(x => member(x));
  if (!raid) optional(flags, 4, () => r.list(mapPin));
  r.u8(); return [{ type: 'roster', members }];
}

function direct(r) {
  const target = r.vi32(), flags = r.u16(), actor = r.vi32(), skill = r.i32();
  const action = r.u8(); optional(flags, 0, () => r.i32()); const hitType = r.u8();
  const details = {};
  if (flags & 2) {
    for (const k of ['block', 'parry', 'perfect', 'hardHit', 'ironwall', 'restoration']) details[k] = r.bool();
    r.vi64(); details.perfectBlock = r.bool(); const angle = r.u8(); details.back = angle === 1; details.front = angle === 2;
  }
  const effect = r.i32(); r.i32(); const speed = r.vi32();
  const damage = safeNumber(optional(flags, 2, () => r.vi64(), 0n));
  optional(flags, 3, () => r.i32()); optional(flags, 4, () => r.bool());
  const additional = optional(flags, 5, () => r.list(x => x.vi64()), []);
  optional(flags, 6, () => r.list(x => x.i32())); optional(flags, 7, () => r.u8());
  optional(flags, 8, () => r.list(x => x.i32())); r.u16();
  const drain = safeNumber(optional(flags, 9, () => r.vi64(), 0n));
  const recovery = safeNumber(optional(flags, 10, () => r.vi64(), 0n));
  optional(flags, 11, () => r.i32()); optional(flags, 12, () => r.bool()); optional(flags, 13, () => r.i32());
  const base = { actor, target, skill, effect };
  if (effects.directIgnore.has(effect)) return [];
  if (effects.directHeal.has(effect)) return damage > 0 ? [{ type: 'heal', ...base, amount: damage }] : [];
  const mitigation = details.perfectBlock ? 'perfect-block' : details.block ? 'block' : details.parry ? 'parry' : details.ironwall ? 'iron-wall' : details.restoration ? 'restoration' : undefined;
  const outcome = { 1: 'evade', 4: 'immune', 5: 'immune', 6: 'resist', 7: 'immune', 8: 'immune', 9: 'reflect' }[hitType];
  const events = damage > 0 ? [{ type: 'damage', ...base, damage, hits: 1 + additional.length, critical: hitType === 3, action, speed, mitigation, ...details }]
    : outcome ? [{ type: 'avoided', ...base, outcome }] : [];
  if (drain + recovery > 0) events.push({ type: 'heal', ...base, target: actor, amount: drain + recovery });
  return events;
}

function periodic(r) {
  const target = r.vi32(), flags = r.u8(), actor = r.vi32(), uid = r.vi32(), effect = r.i32();
  const remaining = safeNumber(optional(flags, 0, () => r.vi64(), 0n));
  const damage = safeNumber(optional(flags, 1, () => r.vi64(), 0n));
  optional(flags, 2, () => r.list(x => x.i32()));
  const skill = optional(flags, 3, () => r.i32()); const blockedActor = optional(flags, 4, () => r.vi32());
  const blockedSkill = optional(flags, 5, () => r.i32()); const reflected = optional(flags, 6, () => r.i32());
  if (effects.barrier.has(effect)) return [{ type: 'barrier', target, remaining, uid }];
  if (blockedSkill && blockedActor !== target) return [{ type: 'avoided', actor: blockedActor, target, skill: blockedSkill, outcome: 'immune' }];
  if (effects.periodicIgnore.has(effect) || effects.periodicIgnore2.has(effect) || damage <= 0) return [];
  const base = { actor, target, skill: reflected || skill, effect, uid };
  return [!reflected && effects.periodicHeal.has(effect) ? { type: 'heal', ...base, amount: damage } : { type: 'damage-over-time', ...base, damage }];
}

const readers = new Map();
const define = (opcode, name, read, complete = true) => readers.set(opcode, { name, read, complete });
define(0x3600, 'MapFrame_NT', r => { r.serverTime = safeNumber(r.i64()); return []; });
define(0x3603, 'Ping_RS', r => { r.u16(); r.i64(); r.serverTime = safeNumber(r.i64()); return []; });
define(0x3621, 'PrepareEnterMap_NT', r => { r.i32(); return [{ type: 'map', map: r.i32() }]; }, false);
define(0x3633, 'MyCharAppear_NT', r => appearance(r, 'self'), false);
define(0x3645, 'CharAppear_NT', r => appearance(r, 'player'), false);
define(0x3641, 'NpcAppear_NT', r => appearance(r, 'npc'), false);
define(0x3642, 'NpcDisappear_NT', r => { const entity = r.vi32(), f = r.u8(), reason = r.u8(); optional(f, 0, () => r.i32()); return [{ type: 'removed', entity, reason }]; });
define(0x3647, 'CharDisappear_NT', r => { const entity = r.vi32(), reason = r.u8(); r.vi32(); return [{ type: 'removed', entity, reason }]; });
define(0x3804, 'SkillEffect_NT', direct);
define(0x3805, 'SkillEffectByAbnormal_NT', periodic);
function castTarget(r) {
  const flags = r.u8(), target = r.vi32(); optional(flags, 0, () => r.i32()); r.f32(); optional(flags, 1, () => r.vec()); return target || undefined;
}
function projectiles(r) { r.list(x => { x.vi32(); x.vec(); }); }
define(0x3802, 'SkillStart_NT', r => {
  const entity = r.vi32(), flags = r.u8(), skill = r.i32(), action = r.u8();
  optional(flags, 0, () => r.u8()); const target = castTarget(r), speed = r.vi32(); r.u8();
  optional(flags, 1, () => r.vi32()); const cooldownMs = r.vi32();
  optional(flags, 2, () => r.u8()); optional(flags, 3, () => r.vi32()); optional(flags, 4, () => r.bool());
  optional(flags, 5, () => projectiles(r));
  return [{ type: 'cast', entity, skill, action, target, speed, cooldownMs: cooldownMs > 0 ? cooldownMs : undefined }];
});
define(0x3806, 'SkillEnd_NT', r => {
  const entity = r.vi32(), skill = r.i32(), action = r.u8(), code = r.u8();
  return code ? [{ type: 'cast-end', entity, skill, action, code, reason: { 1: 'cancelled', 2: 'died', 3: 'interrupted', 12: 'cancelled' }[code] }] : [];
});
define(0x3809, 'SkillCastingStart_NT', r => {
  const entity = r.vi32(), flags = r.u8(), skill = r.i32(), level = r.u8(), target = castTarget(r), castMs = r.vi32(); r.u8();
  optional(flags, 0, () => r.vi32()); optional(flags, 1, () => r.vi32()); optional(flags, 2, () => projectiles(r));
  return [{ type: 'cast-begin', entity, skill, level, target, castMs, kind: 'cast' }];
});
define(0x381c, 'SkillChargingStart_NT', r => {
  const entity = r.vi32(), flags = r.u8(), skill = r.i32(), level = r.u8(), target = castTarget(r), chargeRate = optional(flags, 0, () => r.f32()); r.u8(); optional(flags, 1, () => r.vi32());
  return [{ type: 'cast-begin', entity, skill, level, target, chargeRate, kind: 'charge' }];
});
for (const [opcode, name, kind] of [[0x380c, 'SkillCastingStop_NT', 'cast'], [0x3821, 'SkillChargingStop_NT', 'charge']]) define(opcode, name, r => {
  const entity = r.vi32(), code = r.u16(), skill = r.i32(), cooldownMs = r.vi32();
  return [{ type: 'cast-stop', entity, code, skill, cooldownMs, kind, reason: code === 6152 ? 'interrupted' : code === 0 ? 'cancelled' : 'failed' }];
});
const statList = r => Object.fromEntries(r.list(x => [x.u16(), x.i32()]));
define(0x3649, 'CharAllStats_RS', r => { const result = r.u16(), stats = statList(r); r.i64(); return result === 0 ? [{ type: 'stats', full: true, stats }] : []; });
define(0x364a, 'CharStatsUpdate_NT', r => { const entity = r.vi32(), stats = statList(r); r.i64(); return [{ type: 'stats', full: false, entity, stats }]; });
define(0x382a, 'AbnormalAdd_NT', r => { const target = r.vi32(); return r.list(abnormal).map(a => ({ type: 'buff', target, ...a })); });
define(0x382b, 'AbnormalChange_NT', r => { const target = r.vi32(), a = abnormal(r); r.bool(); return [{ type: 'buff', target, ...a }]; });
define(0x382c, 'AbnormalRemoveList_NT', r => {
  const target = r.vi32(); return r.list(x => { const f = x.u8(), uid = x.vi32(), reason = x.u8(); const dispeller = optional(f, 0, () => x.vi32()), dispelSkill = optional(f, 1, () => x.i32()); optional(f, 2, () => x.i32()); return { type: 'buff-end', target, uid, reason, dispeller: dispeller || undefined, dispelSkill: dispelSkill || undefined }; });
});
define(0x3835, 'TargetUpdate_NT', r => { const entity = r.vi32(), f = r.u8(), target = r.vi32(); optional(f, 0, () => r.i32()); return [{ type: 'target', entity, target }]; });
define(0x8d00, 'CharPointUpdate_NT', r => {
  const entity = r.vi32(), f = r.u8(); const values = {};
  for (const bit of [0, 1]) if (f & (1 << bit)) r.list(x => { const id = x.u8(); values[id] = bit ? safeNumber(x.i64()) : x.i32(); });
  return values[0] === undefined ? [] : [{ type: 'hp', entity, hp: values[0], maxHp: values[7] }];
});
define(0x8d04, 'CharDie_NT', r => {
  const entity = r.vi32(), skill = r.i32(), killer = r.vi32(); r.u16(); r.str(); r.str(); r.u16(); const npc = r.vi32(); r.i32(); r.u8(); r.u8();
  return [{ type: 'death', entity, skill: skill || undefined, killer: killer || undefined, npc: npc || undefined }];
});
define(0x8d21, 'CombatStateUpdate_NT', r => { const entity = r.vi32(), f = r.u8(), combat = r.u8(); optional(f, 0, () => r.i64()); return [{ type: 'combat-state', entity, inCombat: combat !== 0 }]; });
define(0xe005, 'UpdateGroggyInfo_NT', r => {
  const entity=r.vi32(), flags=r.u8(), state=r.u8();
  const max=optional(flags,0,()=>r.i32()), current=optional(flags,1,()=>r.i32());
  optional(flags,2,()=>r.i32()); optional(flags,3,()=>r.i64()); optional(flags,4,()=>r.i64());
  r.bool(); optional(flags,5,()=>r.i64()); r.bool();
  if(entity<=0||max<0||current<0)throw new WireError('Invalid stagger state');
  return [{type:'stagger',entity,max,current,state,broken:state===3}];
});
define(0x572e, 'PartyDungeonRewardMiddleBossKill_NT', r => [{type:'dungeon-boss-killed',npc:r.i32()}]);
define(0x9200, 'PartyInfo_NT', r => party(r));
for (const [opcode, name] of [[0x920d, 'PartyAddMember_NT'], [0x9222, 'PartyReconnectMember_NT']]) define(opcode, name, r => [{ type: 'roster-add', members: [member(r)] }]);
define(0x9219, 'PartyKickout_NT', r => { r.bool(); return [{ type: 'party-left' }]; });
define(0x921f, 'PartyDisband_NT', r => { r.u8(); return [{ type: 'party-left' }]; });
define(0x931f, 'PartyLeave_NT', r => { r.i64(); r.u8(); return [{ type: 'party-left' }]; });
define(0x9602, 'ForceInfo_NT', r => party(r, true));
define(0x960a, 'ForceAddMember_NT', r => { r.i64(); return [{ type: 'roster-add', members: [member(r, true)] }]; });
define(0x961b, 'ForceReconnectMember_NT', r => [{ type: 'roster-add', members: [member(r, true)] }]);
define(0x9622, 'ForceRemoveMember_NT', r => { const id = String(r.i64()); r.i64(); r.u8(); return [{ type: 'roster-remove', id }]; });
define(0x961a, 'ForceDisband_NT', () => [{ type: 'party-left' }]);
define(0x962e, 'ForceLeave_NT', r => { r.i64(); r.u8(); return [{ type: 'party-left' }]; });
for (const opcode of [0x921b, 0x962b]) define(opcode, 'MemberHPMP_NT', r => {
  const entity = r.vi32(), hp = safeNumber(r.vi64()), maxHp = safeNumber(r.vi64()); r.skip(24); r.bool();
  if (entity <= 0 || hp < 0 || maxHp < 0) throw new WireError('Invalid party member HP');
  // These messages are sent for party/force members, not arbitrary nearby
  // characters. Preserve that evidence even if the initial roster was missed.
  return [{ type: 'party-member', entity, hp, maxHp }];
});

// Collection packets are strict framing anchors, but never combat events.
// The separate PetCollectionTracker consumes the committed raw observation.
for(const [opcode,name]of [[0x9000,'RideInitData_NT'],[0x9009,'CharRideAcquire_NT'],[0x900d,'RideSoulPointIncrease_NT'],[0x900e,'RideSoulPointDecrease_NT']])define(opcode,name,r=>{readPetObservation(opcode,r.bytes);r.skip(r.bytes.length);return [];});

export const packetCoverage = () => [...readers].map(([opcode, v]) => ({ opcode, name: v.name, validation: v.complete ? 'full' : 'prefix' }));
export const isKnown = opcode => readers.has(opcode);
export function decodePacket(opcode, payload, at = 0, context = undefined) {
  const definition = readers.get(opcode);
  if (!definition) return { opcode, known: false, complete: false, events: [] };
  const r = new Reader(payload); r.at = at; r.context = context;
  const events = definition.read(r);
  if (definition.complete) r.done();
  if (context && Number.isFinite(r.serverTime)) context.serverOffset = r.serverTime - at;
  return { opcode, known: true, complete: definition.complete, name: definition.name, events: events.map(e => ({ ...e, at })) };
}
