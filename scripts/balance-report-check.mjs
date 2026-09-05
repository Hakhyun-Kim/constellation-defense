import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import * as Bot from '../src/bot.js';
import { createStableBoard, findLegalSwaps } from '../src/tactics/board.js';
import { TACTIC_POLICIES, choosePolicySwap, playRun } from './balance-bot.mjs';

assert.deepEqual(TACTIC_POLICIES, ['none', 'random', 'threat']);

const state = E.createGame({ rng: Bot.mulberry32(17), difficulty: 'normal' });
state.phase = 'wave';
const board = createStableBoard(state.rng);
const legalMoves = findLegalSwaps(board);
const profile = { tacticUse: 1, tacticSloppy: 0 };

assert.ok(legalMoves.length > 0, 'stable board exposes a legal swap');
assert.equal(choosePolicySwap('none', state, board, profile, state.rng, legalMoves), null, 'none policy never swaps');
const randomMove = choosePolicySwap('random', state, board, profile, state.rng, legalMoves);
assert.ok(legalMoves.some(move => move.from === randomMove.from && move.to === randomMove.to), 'random policy chooses a legal swap');
const threatMove = choosePolicySwap('threat', state, board, profile, state.rng, legalMoves);
assert.ok(legalMoves.some(move => move.from === threatMove.from && move.to === threatMove.to), 'threat policy chooses a legal swap');

const noTactics = playRun('보통', 'normal', 13, { waveCap: 6, tacticPolicy: 'none', trace: true });
assert.equal(noTactics.tactics, 0, 'none policy cannot cast tactics');
assert.ok(noTactics.trace.every(entry => !entry.swap), 'none policy records decisions without swaps');

const traced = playRun('고수', 'easy', 13, { waveCap: 6, tacticPolicy: 'threat', trace: true });
assert.ok(traced.trace.length > 0, 'traced run records tactical decision windows');
for (const decision of traced.trace) {
  assert.ok(Number.isInteger(decision.legalSwaps) && decision.legalSwaps > 0, 'trace records current legal options');
  assert.ok(Number.isFinite(decision.castleHp), 'trace records current castle health');
  assert.equal(decision.lanePressure.length, 3, 'trace records all three lane pressures');
  for (const cast of decision.casts || []) {
    assert.ok(['flare', 'tide', 'bloom'].includes(cast.kind), 'trace records tactic kind');
    assert.ok(cast.route >= 0 && cast.route <= 2, 'trace records target lane');
    /* Sizes 3–5 are ordinary matches; 6 is the semantic Hero Sigil tier. */
    assert.ok(cast.size >= 3 && cast.size <= 6, 'trace records a known match size');
  }
}

console.log('Balance report checks passed.');
