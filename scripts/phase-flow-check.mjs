import assert from 'node:assert/strict';
import {
  AUTO_PHASE_DELAY,
  advanceAutoPhase,
  autoPhaseKey,
  createAutoPhaseClock,
} from '../src/app/phase-flow.js';

const test = (name, run) => {
  run();
  console.log(`✅ phase flow: ${name}`);
};

test('the first defense starts the same visible countdown', () => {
  assert.equal(autoPhaseKey({ phase: 'prep', wave: 1 }), 'wave:0:1');
  assert.equal(autoPhaseKey({ phase: 'prep', wave: 4, journey: { activeBattle: 'gate', wavesInBattle: 0 } }), 'journey:gate:0');
  assert.equal(autoPhaseKey({ phase: 'journey', wave: 4, journey: { activeBattle: null, wavesInBattle: 0 } }), null);
});

test('a completed defense arms the next phase countdown', () => {
  assert.equal(AUTO_PHASE_DELAY, 10);
  assert.equal(autoPhaseKey({ phase: 'prep', wave: 2 }), 'wave:0:2');
  assert.equal(autoPhaseKey({ phase: 'prep', wave: 4, journey: { activeBattle: 'meadow', wavesInBattle: 1 } }), 'journey:meadow:1');
});

test('the player-facing warning counts down in whole seconds', () => {
  const state = { phase: 'prep', wave: 1 };
  let clock = createAutoPhaseClock();
  const shown = [];
  for (let second = 0; second < AUTO_PHASE_DELAY; second++) {
    clock = advanceAutoPhase(clock, state, 1);
    shown.push(Math.ceil(clock.remaining));
  }
  assert.deepEqual(shown, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('map, combat, and game-over states never auto-advance', () => {
  for (const phase of ['journey', 'wave', 'over']) {
    assert.equal(autoPhaseKey({ phase, wave: 8 }), null);
  }
});

test('the clock pauses behind player-facing overlays', () => {
  const state = { phase: 'prep', wave: 2 };
  const armed = advanceAutoPhase(createAutoPhaseClock(), state, 1);
  const paused = advanceAutoPhase(armed, state, 99, true);
  assert.equal(paused.remaining, AUTO_PHASE_DELAY - 1);
  assert.equal(paused.ready, false);
});

test('the clock becomes ready once and resets for a different phase', () => {
  const state = { phase: 'prep', wave: 2 };
  const armed = advanceAutoPhase(createAutoPhaseClock(), state, AUTO_PHASE_DELAY);
  assert.equal(armed.ready, true);
  assert.equal(armed.remaining, 0);
  const next = advanceAutoPhase(armed, { phase: 'prep', wave: 3 }, .5);
  assert.equal(next.ready, false);
  assert.equal(next.remaining, AUTO_PHASE_DELAY - .5);
});

console.log('Automatic phase-flow checks passed.');
