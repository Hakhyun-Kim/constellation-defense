import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CastleCosmetics } from '../src/gfx/cosmetics.js';
import { observePayments, paymentEvent, redactPayment } from '../src/app/neon-events.js';
import { PRODUCTS } from '../server/catalog.mjs';

// Independent attachments must survive refresh and remove only the refunded item.
const castle = new THREE.Group();
const cosmetics = new CastleCosmetics(castle);
const keys = Object.values(PRODUCTS).map(product => product.entitlement);
assert.equal(keys.length, 3);
assert.deepEqual([...cosmetics.groups.keys()], keys);
const all = Object.fromEntries(keys.map(key => [key, { purchaseId: 'test' }]));
cosmetics.setEntitlements(all);
assert.ok([...cosmetics.groups.values()].every(group => group.visible));
const allocations = cosmetics.geometries.size;
delete all[keys[1]];
for (let i = 0; i < 100; i++) cosmetics.setEntitlements(all);
assert.equal(cosmetics.geometries.size, allocations);
assert.equal(cosmetics.groups.get(keys[1]).visible, false);
assert.equal(cosmetics.groups.get(keys[0]).visible, true);
assert.equal(cosmetics.groups.get(keys[2]).visible, true);
cosmetics.setEntitlements({});
assert.ok([...cosmetics.groups.values()].every(group => !group.visible));
cosmetics.dispose();
assert.equal(castle.children.length, 0);
const seen = [];
const stop = observePayments(event => seen.push(event));
paymentEvent('request', { response: redactPayment({ playerId: 'secret', token: 'secret', code: 'secret', items: [{ sku: 'A' }] }) });
stop(); paymentEvent('request');
assert.equal(seen.length, 1);
assert.ok(!JSON.stringify(seen).includes('secret'));
assert.equal(seen[0].response.items[0].sku, 'A');
const source = readFileSync('src/app/neontour.js', 'utf8');
const html = readFileSync('index.html', 'utf8');
for (const match of source.matchAll(/get\('([^']+)'\)/g)) assert.ok(html.includes(`id="${match[1]}"`), match[1]);
assert.doesNotMatch(source, /mock-complete|mock-refund|fetch\(/, 'Inspector observes the shared store; it cannot secretly purchase');
assert.doesNotMatch(source, /ctx\.stage\.(hurry|fall)|castleHp\s*=/);
console.log('tour check: independent 3D delivery/refund, stable allocations, redacted events, DOM contract');

// A poor legal formation reaches real defeat without changing HP or wave data.
const E = await import('../src/engine.js');
const { mulberry32 } = await import('../src/bot.js');
const { startExposedLaneDemo } = await import('../src/app/neon-scenario.js');
let game;
startExposedLaneDemo({
  newGame: () => { game = E.createGame({ rng: mulberry32(3) }); },
  travel: id => { assert.ok(E.travelJourney(game, id).ok); assert.ok(E.prepareJourneyBattle(game).ok); },
  heroes: () => game.field,
  move: (id, pad) => assert.ok(E.moveHero(game, id, pad).ok),
  doubleSpeed: () => {},
  startWave: () => assert.ok(E.startWave(game).ok),
});
for (let tick = 0; tick < 9000 && game.phase !== 'over'; tick++) {
  if (game.phase === 'prep') E.startWave(game);
  E.tick(game, 1 / 60);
}
assert.equal(game.phase, 'over');
assert.equal(game.castleHp, 0);
console.log('tour scenario: normal commands and actual enemy damage reach defeat');
