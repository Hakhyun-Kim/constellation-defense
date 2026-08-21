import * as E from '../src/engine.js';
import { seededRandom } from '../src/challenges/weekly.js';
import { createStableBoard, findLegalSwaps, laneForGroup, tacticSizeForGroup } from '../src/tactics/board.js';
import {
  DEMO_GUIDES, DEMO_SEED, DEMO_TOUR, chooseDemoTacticMove,
  demo, describeTacticDetail, describeTacticMove,
} from '../src/demo.js';

let failures = 0;
const check = (condition, message) => {
  if (condition) console.log(`✅ demo: ${message}`);
  else { failures++; console.error(`❌ demo: ${message}`); }
};

const state = { phase: 'over', wave: 7 };
let restarts = 0;
let caption = '';
let detail = '';
let tone = '';
demo.attach({
  getState: () => state,
  isStoryOpen: () => false,
  isRevealOpen: () => false,
  onStart: () => {},
  onStop: () => {},
  onCaption: (title, nextDetail, nextTone) => {
    caption = title; detail = nextDetail; tone = nextTone;
  },
  newGame: () => { restarts++; state.phase = 'journey'; },
});

demo.start('초보');
check(caption.includes('CONSTELLATION DEFENSE') && detail.includes('3D 방어')
  && tone === 'guide' && demo.tourIndex === 0, 'video demo opens with a rich two-line title card');
check(DEMO_TOUR.length >= 4 && DEMO_TOUR.every(scene => scene.title && scene.detail && scene.duration >= 2.4),
  'opening guide covers battlefield, lane/color, hero link, and Hero Sigil in readable cards');
for (const scene of DEMO_TOUR) demo.step(scene.duration + .01);
check(demo.tourIndex === -1 && caption.includes('실제 자동 플레이') && detail.includes('공개 정보'),
  'video demo hands off from explanation to real-rule play');

demo.onTacticCast('tide', 1, 6);
check(caption.includes('HERO SIGIL') && detail.includes('루나·유나') && detail.includes('3/3') && tone === 'sigil',
  'an actual tier-six cast produces a held Hero Sigil explanation');
const heldCaption = caption;
check(!demo.say('덮어쓰면 안 되는 일반 행동') && caption === heldCaption,
  'important guide captions stay readable while ordinary bot actions continue');

demo.start('초보');
for (const scene of DEMO_TOUR) demo.step(scene.duration + .01);
demo.step(0.1);
check(restarts === 0 && demo.overSeen && demo.t === 12, 'game over starts a full twelve-second recap window');
check(caption.includes('결과를 확인'), 'recap caption asks the viewer to inspect the result');
demo.step(11.5);
check(restarts === 0 && demo.t > 0, 'spectate does not restart before the recap window ends');
demo.step(0.6);
check(restarts === 1 && !demo.overSeen, 'spectate restarts once after the recap window');
demo.stop();

const seededState = E.createGame({ rng: seededRandom(DEMO_SEED), difficulty: 'normal' });
const seededBoard = createStableBoard(seededState.rng);
const availableSigil = findLegalSwaps(seededBoard)
  .find(move => move.groups.some(group => tacticSizeForGroup(group) === 6));
const sigilGroup = availableSigil?.groups.find(group => tacticSizeForGroup(group) === 6);
seededState.phase = 'wave';
seededState.enemies = sigilGroup ? [{ dead: false, route: laneForGroup(sigilGroup) }] : [];
const teachingMove = chooseDemoTacticMove(seededState, seededBoard, {}, seededState.rng, true);
check(!!teachingMove && teachingMove.from === availableSigil?.from && teachingMove.to === availableSigil?.to,
  'the deterministic live-demo opening selects a real legal Hero Sigil swap');
check(describeTacticMove(teachingMove).includes('영웅 성좌 문양')
  && describeTacticDetail(teachingMove).includes('액티브 -8초'),
  'the actual teaching swap explains its pattern and combat reward');
check(['journey', 'prep', 'battle', 'firstTactic', 'heroSigil', 'heroActive', 'guardian', 'waveFlow', 'boss']
  .every(key => DEMO_GUIDES[key]?.title && DEMO_GUIDES[key]?.detail),
  'mid-run guide covers campaign, combat, skills, guardian, phase flow, and boss moments');

if (failures) process.exitCode = 1;
else console.log('Demo flow checks passed.');
