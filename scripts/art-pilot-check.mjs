import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ART_PILOT_REGION,
  ART_REGIONS,
  enemyPilotSlot,
  heroPilotSlot,
  landmarkPilotSlot,
  supportsArtRegion,
} from '../src/gfx/art-pilot.js';

const HERO_ASSETS = Object.freeze({
  arin: 'quaternius-warrior',
  luna: 'quaternius-wizard',
  doyun: 'quaternius-monk',
  sera: 'quaternius-ranger',
  yuna: 'quaternius-cleric',
});
const manifest = JSON.parse(readFileSync(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const selectedAssets = new Set();

assert.equal(ART_REGIONS.length, 5);
assert.equal(new Set(ART_REGIONS).size, ART_REGIONS.length);
for (const region of ART_REGIONS) {
  assert.equal(supportsArtRegion(region), true);
  for (const [heroKey, asset] of Object.entries(HERO_ASSETS)) {
    const slot = heroPilotSlot(region, { heroKey });
    assert.equal(slot?.id, asset);
    assert.equal(slot?.yawOffset, Math.PI, `${heroKey} model forward axis must follow movement/attack targets`);
    selectedAssets.add(asset);
  }
  selectedAssets.add(enemyPilotSlot(region, { type: 'goblin' })?.id);
  selectedAssets.add(enemyPilotSlot(region, { type: 'ogrelord', midBoss: true })?.id);
  selectedAssets.add(enemyPilotSlot(region, { type: 'boss', boss: true })?.id);
}

for (const id of selectedAssets) assert.equal(assets.get(id)?.type, 'model', `${id} must be registered as a model`);
assert.equal(assets.get('quaternius-warrior').preload, true);
assert.equal(assets.get('quaternius-wizard').preload, true);
for (const id of ['quaternius-monk', 'quaternius-ranger', 'quaternius-cleric']) {
  assert.equal(assets.get(id).preload, false, `${id} must remain post-first-play`);
}

assert.equal(heroPilotSlot('unknown', { heroKey: 'arin' }), null);
assert.equal(heroPilotSlot(ART_PILOT_REGION, { heroKey: 'unknown' }), null);
assert.equal(enemyPilotSlot('unknown', { type: 'goblin' }), null);
assert.equal(enemyPilotSlot('ember-gate', { type: 'goblin' })?.id, 'quaternius-orc');
assert.equal(enemyPilotSlot('neon-ruins', { type: 'boss', boss: true })?.id, 'quaternius-alien');
assert.equal(enemyPilotSlot('ashen-margin', { type: 'ogrelord', midBoss: true })?.id, 'quaternius-mushroom-king');
assert.equal(enemyPilotSlot('manuscript-core', { type: 'boss2', boss: true })?.id, 'quaternius-blue-demon');

assert.deepEqual(Object.values(landmarkPilotSlot(ART_PILOT_REGION)), [
  'quaternius-gate-wall',
  'quaternius-gate-wall-straight',
  'quaternius-gate-door',
  'quaternius-gate-tower',
]);
assert.equal(landmarkPilotSlot('ember-gate'), null);

console.log('✅ 5 heroes × 5 regions and regional monster/boss art slots passed.');
