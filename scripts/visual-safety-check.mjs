/* Visual safety regression: no battlefield-wide flashing, brightness pulses or camera shake under any setting. Effects stay local to impacts, small banners and cards. */
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../src/gfx/renderer.js', import.meta.url), 'utf8');
const fx = fs.readFileSync(new URL('../src/gfx/fx.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const failures = [];
const reject = (name, condition) => { if (condition) failures.push(name); };

for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = match[1].split(',').map((selector) => selector.trim());
  const declarations = match[2];
  const fullSurface = selectors.some((selector) =>
    /^(?:body(?:[.:\[].*)?|\.stage(?:[.:\[].*)?|#scene3d(?:[.:\[].*)?|#scene3d\s+canvas(?:[.:\[].*)?)$/.test(selector));
  if (fullSurface && /\b(?:animation|filter)\s*:/.test(declarations)) {
    failures.push(`전체 화면 선택자에 animation/filter 사용: ${selectors.join(', ')}`);
  }
}

reject('후처리 컴포저를 다시 사용함', /EffectComposer|UnrealBloomPass|RenderPass|OutputPass|_setupComposer|this\.composer/.test(renderer));
reject('전체 화면 블룸 펄스를 다시 사용함', /bloomPulse|\.bloom\b/.test(renderer + fx));
reject('카메라 흔들림 상태를 다시 사용함', /this\.shake|\bs2\s*=\s*this\.shake/.test(renderer + fx));
reject('카메라 위치에 난수 흔들림을 다시 사용함', /camera\.position\.set\([\s\S]{0,300}Math\.random/.test(renderer));
reject('보스 이벤트가 전장 전체 팔레트를 바꿈', /_updateBossMood|setBossMode|bossMode|bossBlend/.test(renderer));
reject('전역 팔레트가 반복 파형으로 밝기를 바꿈', /_updateDaylight[\s\S]{0,2200}(?:Math\.sin|Math\.cos|Math\.random)/.test(renderer));
reject('화면 점멸 오버레이를 다시 사용함', /(?:hitFlash|rarityFlash|lowHpVignette|bossVignette)/.test(css + ui + html));
reject('전술판 전체 밝기 점멸을 다시 사용함', /tacticboardflash|judge-star-pulse|tactic-climax-icon/.test(css));
reject('보스 UI 반복 점멸을 다시 사용함', /(?:#bossWarnBanner|#bossBar\.enraged|\.wchip\.boss)[^{}]*\{[^{}]*animation\s*:(?!\s*none)/s.test(css));

if (failures.length) {
  failures.forEach((failure) => console.error(`❌ ${failure}`));
  process.exitCode = 1;
} else {
  console.log('✅ 전체 화면 점멸·팔레트 전환·밝기 펄스·카메라 흔들림 없음');
  console.log('✅ 보스·전술 피드백은 정적 배너와 국소 파티클로 제한됨');
}
