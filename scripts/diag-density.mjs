/* Spawn density diagnostic: maximum and average simultaneous enemies per wave. */
import * as D from '../src/data.js';
import * as E from '../src/engine.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Count visible enemies under a typical defense policy. */
function measure(wave, heroSpec) {
  const state = E.createGame({ rng: mulberry32(wave * 7919 + 3), difficulty: 'normal' });
  state.wave = wave;
  for (const [pad, cls, tier] of heroSpec) {
    const h = E.makeHero(state, cls, tier);
    state.bench.push(h);
    E.placeHero(state, h.id, pad);
  }
  state.pendingWave = E.buildWave(state);
  E.startWave(state);
  let peak = 0, sum = 0, n = 0, clock = 0;
  while (state.phase === 'wave' && clock < 600) {
    E.tick(state, 1 / 30);
    clock += 1 / 30;
    peak = Math.max(peak, state.enemies.length);
    sum += state.enemies.length; n++;
  }
  return {
    웨이브: wave,
    총마릿수: Math.round(D.waveCount(wave)),
    분대크기: D.squadSize(wave),
    동시최대: peak,
    동시평균: +(sum / Math.max(1, n)).toFixed(1),
    웨이브길이초: Math.round(clock),
    성체력: `${state.castleHp}/${state.castleMax}`,
  };
}

/* Midgame defense: six rare-to-heroic units. */
const mid = [[2, 'archer', 1], [3, 'mage', 1], [4, 'sentinel', 1], [5, 'frostmage', 1], [0, 'knight', 1], [1, 'guard', 1]];
console.log('\n=== 스폰 밀집도 (중반 방어 구성 기준) ===');
console.table([1, 3, 5, 8, 12].map(w => measure(w, mid)));

console.log('=== 방어가 약할 때 (일반 2명) ===');
const weak = [[2, 'archer', 0], [0, 'knight', 0]];
console.table([1, 3, 5].map(w => measure(w, weak)));
