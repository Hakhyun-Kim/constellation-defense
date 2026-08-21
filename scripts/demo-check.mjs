import { DEMO_TOUR, demo } from '../src/demo.js';

let failures = 0;
const check = (condition, message) => {
  if (condition) console.log(`✅ demo: ${message}`);
  else { failures++; console.error(`❌ demo: ${message}`); }
};

const state = { phase: 'over', wave: 7 };
let restarts = 0;
let caption = '';
demo.attach({
  getState: () => state,
  isStoryOpen: () => false,
  isRevealOpen: () => false,
  onStart: () => {},
  onStop: () => {},
  onCaption: (text) => { caption = text; },
  newGame: () => { restarts++; state.phase = 'journey'; },
});

demo.start('초보');
check(caption.includes('CONSTELLATION DEFENSE') && demo.tourIndex === 0, 'video demo opens with an explanatory title card');
for (const scene of DEMO_TOUR) demo.step(scene.duration + .01);
check(demo.tourIndex === -1 && caption.includes('실제 규칙 자동 플레이'), 'video demo explains puzzle, hero link, and stored boss support before play');
demo.step(0.1);
check(restarts === 0 && demo.overSeen && demo.t === 12, 'game over starts a full twelve-second recap window');
check(caption.includes('결과를 확인'), 'recap caption asks the viewer to inspect the result');
demo.step(11.5);
check(restarts === 0 && demo.t > 0, 'spectate does not restart before the recap window ends');
demo.step(0.6);
check(restarts === 1 && !demo.overSeen, 'spectate restarts once after the recap window');
demo.stop();

if (failures) process.exitCode = 1;
else console.log('Demo flow checks passed.');
