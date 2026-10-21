import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCombatDetails, unionDuration } from '../src/combat-analytics.mjs';
import { decodePacket } from '../src/protocol/packets.mjs';
import { FrameStream } from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';

const facts = { buffs: {
  101: [{ stat: 'amplifyalldamage', value: 2000 }], 102: [{ stat: 'decreasedamage', value: -1000 }],
  103: [{ stat: 'critical', value: 100 }], 104: [{ stat: 'hardhit', value: 100 }],
  105: [{ stat: 'attackspeed', value: 1000 }], 106: [{ stat: 'amplifycriticaldamage', value: 3000 }],
}, stats: { 1: 'amplifyalldamage' }, bossTolerance: {} };
const entities = new Map([[1, { kind: 'player', name: 'Self' }], [2, { kind: 'player', name: 'Support' }],
  [3, { kind: 'player', name: 'Opponent' }], [50, { kind: 'npc', boss: true, npc: 100, name: 'Boss', hp: 500, maxHp: 1000 }]]);
const event = (type, at, fields) => ({ type, at, ...fields });
const hit = (at, fields = {}) => event('damage', at, { actor: 1, target: 50, damage: 1300, skill: 11010130, action: 7, speed: 10000, ...fields });
const buff = (target, id, caster = 2, fields = {}) => event('buff', 0, { target, buff: id, uid: id, caster, level: 1, ...fields });
const calculate = (events, options = {}) => buildCombatDetails({ events, entities, self: 1, party: new Set([1, 2]),
  scope: 'party', startedAt: 1000, endedAt: 2000, seconds: 1, players: [], facts, ...options });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('rDPS transfers external amplification and target debuff damage with the same denominator', () => {
  const details = calculate([buff(1, 101), buff(50, 102), hit(1000), hit(2000)]);
  const self = details.players.find(player => player.entity === 1), support = details.players.find(player => player.entity === 2);
  // Attribution spans are half-open, as in Questlog: the last hit exactly at
  // the common window's endpoint is outside the clipped active buff span.
  near(self.received, 300); near(self.rdps, 2300); near(support.added, 300); near(support.rdps, 300);
  near(self.rdps + support.rdps, 2600);
  assert.deepEqual(support.support.map(row => [row.buff, row.debuff, row.uptime]), [[101, false, 1], [102, true, 1]]);
  assert.equal(self.buffs[0].applied, 0, 'A pre-pull active buff is not a new application during the fight');
});

test('self filter retains support given to the party and the supplied common party clock', () => {
  const details = calculate([buff(2, 101, 1), hit(1000, { actor: 2, damage: 1200 }), hit(2000, { actor: 2, damage: 1200 })], { scope: 'self' });
  assert.equal(details.players.length, 1); assert.equal(details.players[0].entity, 1);
  near(details.players[0].added, 200); near(details.players[0].rdps, 200);
});

test('critical and hard-hit chance attribution uses the observed direct-hit rate, not a generic percentage', () => {
  const critical = calculate([buff(1, 103), hit(1000, { damage: 1500, critical: true }), hit(2000, { damage: 1000, critical: false })]);
  near(critical.players.find(player => player.entity === 1).received, 100);
  const hard = calculate([buff(1, 104), hit(1000, { damage: 1500, hardHit: true }), hit(2000, { damage: 1000, hardHit: false })]);
  near(hard.players.find(player => player.entity === 1).received, 15);
});

test('speed attribution uses captured attack speed and critical damage has its 15000 base', () => {
  const speed = calculate([buff(1, 105), hit(1000, { damage: 1500, speed: 12000 })]);
  near(speed.players.find(player => player.entity === 1).received, 125);
  const critical = calculate([buff(1, 106), hit(1000, { damage: 1800, critical: true })]);
  near(critical.players.find(player => player.entity === 1).received, 300);
});

test('self buffs are not transferred; unknown external effects explicitly withhold rDPS', () => {
  const own = calculate([buff(1, 101, 1), hit(1000)]).players.find(player => player.entity === 1);
  near(own.received, 0); near(own.rdps, 1300);
  const unknown = calculate([buff(1, 999), hit(1000)]);
  for (const player of unknown.players) { assert.equal(player.rdps, null); assert.equal(player.rdpsKnown, false); }
  assert.equal(unknown.players.find(player => player.entity === 2).support[0].added, null);
  assert.ok(unknown.warnings.length);
});

test('buff uptime unions overlapping applications and stops at expiry or removal', () => {
  assert.equal(unionDuration([{ from: 0, to: 1600 }, { from: 1400, to: 2100 }], 1000, 2000), 1000);
  const expired = calculate([buff(1, 101, 2, { timer: { endsAt: 1500 } }), hit(1000), hit(2000)]);
  near(expired.players.find(player => player.entity === 1).buffs[0].uptime, 0.5);
  near(expired.players.find(player => player.entity === 1).received, 1300 * 2000 / 12000);
  const removed = calculate([buff(1, 101), hit(1000), event('buff-end', 1250, { target: 1, uid: 101 }), hit(2000)]);
  near(removed.players.find(player => player.entity === 1).buffs[0].uptime, 0.25);
});

test('same application refresh bridges a short advertised expiry gap before post-fight attribution', () => {
  const result = calculate([buff(1, 101, 2, { timer: { endsAt: 1400 } }), hit(1000, { damage: 1200 }),
    hit(1500, { damage: 1200 }), buff(1, 101, 2, { at: 1600, timer: { endsAt: 2200 } }), hit(2000, { damage: 1200 })]);
  const self = result.players.find(player => player.entity === 1);
  near(self.buffs[0].uptime, 1); near(self.received, 400);
});

test('level changes split effect strength without counting a new application; rejected DPS stays excluded', () => {
  const custom = { ...facts, buffs: { ...facts.buffs, 101: [{ stat: 'amplifyalldamage', value: 2000, levels: { 2: 3000 } }] } };
  const result = calculate([buff(1, 101), hit(1000, { damage: 1200 }), buff(1, 101, 2, { at: 1200, level: 2 }),
    hit(1500, { damage: 1300 }), hit(1600, { damage: 9999, acceptedForDps: false }), hit(2000, { damage: 1 })], { facts: custom });
  const self = result.players.find(player => player.entity === 1);
  near(self.received, 500); near(self.rdps, 2001); assert.deepEqual(self.buffs[0].levels, [1, 2]); assert.equal(self.buffs[0].applied, 0);
});

test('damage taken includes enemy direct and periodic hits, defenses and per-source skills', () => {
  const result = calculate([hit(1000), hit(2000), hit(1200, { actor: 50, target: 1, damage: 100, mitigation: 'block', critical: true }),
    event('damage-over-time', 1300, { actor: 50, target: 1, damage: 40, skill: 900 }),
    event('avoided', 1400, { actor: 50, target: 1, skill: 900, outcome: 'resist' })]);
  const self = result.players.find(player => player.entity === 1);
  assert.equal(self.damageTaken, 140); assert.equal(self.dtps, 140); assert.equal(self.takenSources[0].damage, 140);
  assert.equal(self.defense.blocked, 1); assert.equal(self.defense.resisted, 1); assert.equal(self.defense.critsTaken, 1);
  near(self.defense.avoidanceRate, 0.5);
});

test('rotation matches each cast action, tolerates action-byte reuse, and preserves cancellation', () => {
  const events = [event('cast', 1000, { entity: 1, action: 7, skill: 11010130 }), hit(1100, { damage: 600 }),
    event('cast', 1500, { entity: 1, action: 7, skill: 11010130 }), hit(1600, { damage: 500 }),
    event('cast-end', 1700, { entity: 1, action: 7, reason: 'cancelled' })];
  const original = JSON.stringify(events), self = calculate(events).players.find(player => player.entity === 1);
  assert.deepEqual(self.rotation.map(cast => [cast.offsetMs, cast.damage, cast.stop]), [[0, 600, undefined], [500, 500, 'cancelled']]);
  assert.equal(self.casts, 2); assert.equal(self.cancelled, 1); assert.equal(JSON.stringify(events), original);
});

test('boss details preserve observed HP and stagger; no bar is invented without numeric data', () => {
  const boss = calculate([event('stagger', 900, { entity: 50, max: 100, current: 20, broken: true }), hit(1000)]).bosses[0];
  assert.equal(boss.hpPercent, 50); assert.deepEqual(boss.stagger, { max: 100, current: 20, broken: true });
});

test('PvP counts direct known killers, takes enemy damage, and deduplicates repeated death notices', () => {
  const result = calculate([hit(1000, { target: 3, damage: 500 }), hit(1100, { actor: 3, target: 1, damage: 200 }),
    event('death', 1200, { entity: 3, killer: 1 }), event('death', 1201, { entity: 3, killer: 1 }),
    event('death', 1300, { entity: 1, killer: 3 })]);
  assert.deepEqual(result.pvp, { kills: 1, deaths: 1, dealt: 500, taken: 200 });
});

test('new cast and stat packets preserve full wire validation and action metadata', () => {
  const target = f.cat(f.u8(0), f.vu(50), Buffer.alloc(4));
  const payload = f.cat(f.vu(1), f.u8(0), f.i32(11010130), f.u8(7), target, f.vu(12000), f.u8(0), f.vu(5000));
  const cast = decodePacket(0x3802, payload, 1000).events[0];
  assert.equal(cast.type, 'cast'); assert.equal(cast.action, 7); assert.equal(cast.target, 50); assert.equal(cast.speed, 12000);
  assert.throws(() => decodePacket(0x3802, f.cat(payload, f.u8(0)), 1000));
  const stats = decodePacket(0x3649, f.cat(f.u16(0), f.vu(1), f.u16(42), f.i32(100), f.i64(1000)), 1000).events[0];
  assert.deepEqual(stats, { type: 'stats', full: true, stats: { 42: 100 }, at: 1000 });
});

test('buff expiry uses each committed stream clock; speculative probes and malformed clocks do not pollute it', () => {
  const context = {};
  decodePacket(0x3600, f.i64(10000), 1000, context);
  assert.equal(context.serverOffset, 9000);
  assert.throws(() => decodePacket(0x3600, f.cat(f.i64(20000), f.u8(0)), 1000, context));
  assert.equal(context.serverOffset, 9000);
  const abnormal = f.cat(f.u8(1), f.vu(7), f.i32(101), f.i64(5000), f.i64(11500), f.vu(2), f.u8(1), f.u8(0));
  const payload = f.cat(f.vu(1), f.vu(1), abnormal);
  const decoded = decodePacket(0x382a, payload, 1000, context).events[0];
  assert.deepEqual(decoded.timer, { durationMs: 5000, endsAt: 2500, estimated: false });
  const output = [], stream = new FrameStream(packet => output.push(...packet.events));
  stream.push(f.cat(f.frame(0x3600, f.i64(10000)), f.frame(0x3600, f.i64(10000)), f.frame(0x382a, payload)), 1000);
  assert.equal(output[0].timer.endsAt, 2500); assert.equal(output[0].timer.estimated, false);
});
