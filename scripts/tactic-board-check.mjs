import * as Board from '../src/tactics/board.js';
import { describeTacticMove } from '../src/demo.js';
import { JUDGE_OPENING, judgeOpeningMatch, prepareJudgeWave } from '../src/app/judge-run.js';

let failures = 0;
function check(condition, message) {
  if (condition) return;
  failures++;
  console.error(`FAIL: ${message}`);
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const stable = Board.createStableBoard(mulberry32(20260810));
check(stable.length === Board.BOARD_SIZE ** 2, 'stable board has 36 cells');
check(Board.findMatchGroups(stable).length === 0, 'stable board has no automatic match');

const source = Array.from({ length: 36 }, (_, index) => `cell-${index}`);
const swapped = Board.swapCells(source, 0, 1);
check(source[0] === 'cell-0' && source[1] === 'cell-1', 'swap does not mutate the source board');
check(swapped[0] === 'cell-1' && swapped[1] === 'cell-0', 'swap exchanges requested cells');
check(Board.areNeighbors(0, 1), 'horizontal neighbors are accepted');
check(Board.areNeighbors(0, 6), 'vertical neighbors are accepted');
check(!Board.areNeighbors(0, 2), 'non-neighbors are rejected');
check(Board.swipeNeighbor(7, 28, 3) === 8, 'right swipe selects the adjacent board cell');
check(Board.swipeNeighbor(7, -4, 30) === 13, 'vertical swipe follows its dominant direction');
check(Board.swipeNeighbor(0, -24, 1) === null, 'swipes cannot leave the board edge');

const legalSource = Array.from({ length: 36 }, (_, index) => `cell-${index}`);
legalSource[0] = 'flare'; legalSource[1] = 'tide'; legalSource[2] = 'flare'; legalSource[7] = 'flare';
const legalMoves = Board.findLegalSwaps(legalSource);
const legal = legalMoves.find(move => move.from === 1 && move.to === 7);
check(!!legal, 'legal swaps include an adjacent swap that creates a match');
check(legal && legal.groups.some(group => group.length === 3 && legal.cells[group[0]] === 'flare'),
  'legal swap reports its matched type and group');
check(legal && describeTacticMove(legal) === '🌌 왼쪽 길 · 유성 3매치',
  'spectator copy reports the real matched lane, type, and size');
check(legalSource[1] === 'tide' && legalSource[7] === 'flare', 'legal-swap search does not mutate its source board');

const separate = Array.from({ length: 36 }, (_, index) => `cell-${index}`);
[0, 1, 2].forEach(index => { separate[index] = 'flare'; });
[9, 15, 21].forEach(index => { separate[index] = 'tide'; });
const separateGroups = Board.findMatchGroups(separate);
check(separateGroups.length === 2, 'independent matches remain separate groups');
check(separateGroups.some(group => group.length === 3 && separate[group[0]] === 'flare'), 'flare group is preserved');
check(separateGroups.some(group => group.length === 3 && separate[group[0]] === 'tide'), 'tide group is preserved');
check(Board.laneForGroup([0, 1, 2]) === 0, 'left group maps to left lane');
check(Board.laneForGroup([9, 15, 21]) === 1, 'middle group maps to middle lane');

const cross = Array.from({ length: 36 }, (_, index) => `cell-${index}`);
[1, 6, 7, 8, 13].forEach(index => { cross[index] = 'bloom'; });
const crossGroups = Board.findMatchGroups(cross);
check(crossGroups.length === 1 && crossGroups[0].length === 5, 'cross-shaped match is one connected group');
check(Board.matchShape(crossGroups[0]) === 'sigil' && Board.isHeroSigilGroup(crossGroups[0]),
  'a cross-shaped five-match is classified as a Hero Sigil');
check(Board.tacticSizeForGroup(crossGroups[0]) === 6,
  'a Hero Sigil promotes the standard tactic command to semantic tier six');

const corner = Array.from({ length: 36 }, (_, index) => `cell-${index}`);
[0, 1, 2, 6, 12].forEach(index => { corner[index] = 'flare'; });
const cornerGroup = Board.findMatchGroups(corner)[0];
check(cornerGroup?.length === 5 && Board.matchShape(cornerGroup) === 'sigil'
  && Board.tacticSizeForGroup(cornerGroup) === 6, 'an L-shaped five-match is a Hero Sigil');

const line = [0, 1, 2, 3, 4];
check(Board.matchShape(line) === 'line' && !Board.isHeroSigilGroup(line)
  && Board.tacticSizeForGroup(line) === 5, 'a straight five-match remains the existing tier five tactic');
check(Board.matchShape([0, 1, 6, 7, 12]) === 'cluster'
  && Board.tacticSizeForGroup([0, 1, 6, 7, 12]) === 5,
  'a compact cluster without intersecting three-cell runs is not promoted');

const sigilSource = Array.from({ length: 36 }, (_, index) => `cell-${index}`);
[2, 8, 13, 15, 20].forEach(index => { sigilSource[index] = 'tide'; });
const sigilMove = Board.findLegalSwaps(sigilSource).find(move => move.from === 14 && move.to === 20);
const sigilMoveGroup = sigilMove?.groups.find(group => Board.tacticSizeForGroup(group) === 6);
check(!!sigilMoveGroup && sigilMoveGroup.length === 5,
  'one legal adjacent swap can complete a T-shaped Hero Sigil');
check(sigilMove && describeTacticMove(sigilMove) === '🌌 가운데 길 · 서리 영웅 성좌 문양',
  'spectator copy names the Hero Sigil created by the real legal swap');

const refilled = Board.refillCells(source, [0, 5], () => 0);
check(source[0] === 'cell-0' && source[5] === 'cell-5', 'refill does not mutate the source board');
check(refilled[0] === 'flare' && refilled[5] === 'flare', 'refill uses the injected random source');

const judgeMatch = judgeOpeningMatch();
check(!!judgeMatch, 'judge opening begins stable and creates a match with its highlighted swap');
check(judgeMatch?.kind === 'flare' && judgeMatch?.lane === 1 && judgeMatch?.group.length === 3,
  'judge opening teaches a three-flare cast on the middle lane');
const judgeAfterRefill = Board.swapCells(JUDGE_OPENING.cells, JUDGE_OPENING.from, JUDGE_OPENING.to);
judgeMatch.group.forEach((index, offset) => { judgeAfterRefill[index] = JUDGE_OPENING.refill[offset]; });
check(Board.findMatchGroups(judgeAfterRefill).length === 0,
  'judge opening refill does not hide the taught cast behind an accidental cascade');
const judgeState = { pendingWave: [{ t: 1.2, type: 'slime', route: 0 }] };
check(prepareJudgeWave(judgeState), 'judge wave can author its first threat');
check(judgeState.pendingWave[0].route === JUDGE_OPENING.lane && judgeState.pendingWave[0].t === 0.15,
  'judge wave puts the first threat promptly on the taught lane');
check(judgeState.pendingWave[0].type === 'ogrelord',
  'judge wave keeps the taught target alive long enough for a first-time player to cast');

if (failures) process.exitCode = 1;
else console.log('Tactic board checks passed.');
