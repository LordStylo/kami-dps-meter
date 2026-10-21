import test from 'node:test';
import assert from 'node:assert/strict';
import { Meter } from '../src/meter.mjs';

const send = (m, type, data, at) => m.ingest({ type, ...data, at });
const hit = (m, actor, at, damage = 100, target = 99) => send(m, 'damage', { actor, target, damage, skill: 11010000 }, at);
function setup(options) {
  const m = new Meter(options);
  send(m, 'map', { map: 101 }, 0);
  send(m, 'player', { entity: 1, self: true, name: 'Me', server: 1, id: 'self-db', hp: 1000 }, 1);
  send(m, 'player', { entity: 2, name: 'Party', server: 1, id: 'friend-db' }, 2);
  send(m, 'roster', { members: [{ entity: 1, name: 'Me', server: 1, id: 'self-db' }, { entity: 2, name: 'Party', server: 1, id: 'friend-db' }] }, 3);
  send(m, 'spawn', { entity: 99, npc: 2300471, hp: 10000, maxHp: 10000 }, 4);
  hit(m, 1, 1000, 1000);
  hit(m, 2, 2000, 3000);
  return m;
}

test('death, out-of-range boss removal and same-map respawn retain the party encounter', () => {
  const m = setup();
  send(m, 'death', { entity: 1 }, 3000);
  send(m, 'combat-state', { entity: 1, inCombat: false }, 3001);
  send(m, 'removed', { entity: 99, reason: 1 }, 4000);
  send(m, 'map', { map: 101 }, 5000);
  m.tick(150000);
  assert.equal(m.history.length, 0);
  send(m, 'player', { entity: 1, self: true, name: 'Me', server: 1, id: 'self-db', hp: 1000 }, 150001);
  send(m, 'spawn', { entity: 99, npc: 2300471, hp: 4000, maxHp: 10000 }, 151000);
  hit(m, 1, 152000, 500);
  assert.equal(m.history.length, 0);
  const s = m.snapshot();
  assert.equal(s.damage, 4500);
  assert.equal(s.players.find(p => p.self).damage, 1500);
  assert.equal(s.seconds, 151);
  assert.equal(s.players.find(p => p.self).dps, 1500 / 151);
  send(m, 'death', { entity: 99 }, 153000);
  assert.equal(m.history.length, 1);
  assert.equal(m.history[0].reason, 'kill');
});

test('a returning hit after 15 seconds uses the same boss idle window as the timer', () => {
  const m = setup();
  m.tick(20000);
  hit(m, 1, 21000, 500);
  assert.equal(m.history.length, 0);
  assert.equal(m.snapshot().damage, 4500);
});

test('repeated same-character entity changes merge their earlier damage and pet ownership', () => {
  const m = setup();
  send(m, 'spawn', { entity: 20, owner: 1 }, 2500);
  hit(m, 20, 2600, 200);
  for (const [entity, at] of [[5, 5000], [8, 10000]]) {
    send(m, 'death', { entity: m.self }, at - 2);
    send(m, 'player', { entity, self: true, name: 'Me', server: 1, id: 'self-db', hp: 1000 }, at);
    hit(m, entity, at + 1000, 100);
  }
  hit(m, 20, 12000, 100);
  const self = m.snapshot().players.filter(p => p.self);
  assert.equal(self.length, 1);
  assert.equal(self[0].entity, 8);
  assert.equal(self[0].damage, 1500);
  assert.equal(self[0].petDamage, 300);
  assert.equal(m.history.length, 0);
});

test('same name on a different server cannot inherit earlier damage', () => {
  const m = setup();
  send(m, 'player', { entity: 5, name: 'Party', server: 2 }, 3000);
  hit(m, 5, 4000, 9999);
  assert.equal(m.snapshot().damage, 4000);
});

test('real zone changes and observed boss HP resets still finish a retained fight', () => {
  for (const action of ['zone', 'wipe']) {
    const m = setup();
    send(m, 'hp', { entity: 99, hp: 4000, maxHp: 10000 }, 2500);
    send(m, 'death', { entity: 1 }, 3000);
    send(m, 'removed', { entity: 99, reason: 1 }, 4000);
    if (action === 'zone') send(m, 'map', { map: 102 }, 5000);
    else send(m, 'hp', { entity: 99, hp: 10000, maxHp: 10000 }, 5000);
    assert.equal(m.history.length, 1);
    assert.equal(m.history[0].reason, action === 'zone' ? 'zone' : 'wipe');
  }
});

test('recovery has a finite timeout and saves one immutable callback per completed encounter', () => {
  const saves = [];
  const m = setup({ onEncounter: s => saves.push(s) });
  send(m, 'death', { entity: 1 }, 3000);
  send(m, 'removed', { entity: 99, reason: 1 }, 4000);
  m.tick(304001);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].damage, 4000);
  assert.equal(saves[0].selfCharacter.id, 'self-db');
  m.tick(400000);
  assert.equal(saves.length, 1);
  send(m, 'player', { entity: 1, name: 'Changed' }, 400001);
  assert.equal(saves[0].players.find(p => p.self).name, 'Me');
});
