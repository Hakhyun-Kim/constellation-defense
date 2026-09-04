/* =====================================================
 * 메인 컨트롤러: 엔진 + 3D 렌더러 + UI + 사운드 배선
 * ===================================================== */
import * as D from './data.js';
import * as E from './engine.js';
import { Renderer3D } from './gfx/renderer.js';
import { VillageRenderer } from './gfx/village.js';
import { RuntimeAssetLoader } from './gfx/asset-loader.js';
import { decodeGltfAsset } from './gfx/gltf-assets.js';
import { heroPortrait, champPortrait } from './gfx/units3d.js';
import { UI } from './ui.js';
import { SFX, toggleSfx, toggleMusic, toggleAll, isSfxMuted, isMusicMuted, forceMute, getAc, getMaster, registerDucker, updateAudioFlow, registerSfxAssets, prepareSfxSamples, sfxSampleSnapshot } from './sfx.js';
import { music } from './music.js';
import * as Story from './story.js';
import { DEMO_SEED, demo } from './demo.js';
import {
  store, heroName,
  codex, earned, codexAddHero, codexAddKill, flushRecords, markDirty,
} from './app/store.js';
import { createTacticFlow } from './app/tacticflow.js';
import { createTacticFeedback } from './app/tacticfeedback.js';
import { JUDGE_OPENING, prepareJudgeWave } from './app/judge-run.js';
import { createSwapReplay, createWeeklyChallenge, seededRandom } from './challenges/weekly.js';
import { advanceAutoPhase, createAutoPhaseClock } from './app/phase-flow.js';
import { summarizeFrameDurations } from './app/perf-probe.js';
import { captureCanvasVideo, captureFilename } from './app/visual-capture.js';
import { createLocalPlaytestLog, createSessionMeter, formatPlayMinutes } from './app/session-metrics.js';
import { normalizePlaytestExperience } from './app/playtest-analysis.js';
import {
  KEY_ACTIONS, actionForCode, defaultBindings, keyCodeLabel, normalizeBindings, rebindAction,
} from './app/preferences.js';
import { getLocale, installDocumentLocalization, normalizeLocale } from './app/i18n.js';
import { initNeonStore } from './app/neon-store.js';

registerDucker((amt, dur) => music.duck(amt, dur));

/* ---------- 초기화 ---------- */
const urlParams = new URLSearchParams(location.search);
const requestedLocale = urlParams.get('lang');
const locale = normalizeLocale(requestedLocale || store.language);
if (requestedLocale) store.language = locale;
const ui = new UI();
const tacticFeedback = createTacticFeedback();
installDocumentLocalization(locale);
initNeonStore({ locale });
/* URL로 강제 지정 가능: ?gfx=high|lite|min (min은 테스트/초저사양용) */
const urlGfx = urlParams.get('gfx');
const judgeMode = urlParams.has('judge');
const demoRoute = urlParams.has('demo');
const previewBlueprint = urlParams.has('blueprint');
const previewChapter = urlParams.get('chapter') === '2' || previewBlueprint ? 'beyond-page' : null;
const weeklyChallenge = urlParams.has('weekly') ? createWeeklyChallenge(urlParams.get('weekly')) : null;
const playtestRoute = urlParams.has('playtest');
const playtestExperience = playtestRoute
  ? normalizePlaytestExperience(urlParams.get('playtest')) : 'unspecified';
const systemReducedEffects = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
/* 눈이 편한 쪽이 기본값이다. 사용자가 생동감을 명시적으로 켠 경우에만
 * 전체 품질을 쓰며, 운영체제의 동작 줄이기 설정은 항상 우선한다. */
let reducedEffects = systemReducedEffects || store.effectsReduced !== false;
document.body.classList.toggle('reduced-effects', reducedEffects);
const weeklyReplay = weeklyChallenge ? createSwapReplay(weeklyChallenge.id) : null;
const sessionEligible = !judgeMode && !previewChapter && !urlParams.has('demo')
  && !urlParams.has('perf') && !urlParams.has('sessionqa');
const playtestLog = createLocalPlaytestLog();
ui.setPlaytestLogStatus(playtestLog.records().length);
let keyBindings = normalizeBindings(store.keyBindings);
let keyCaptureAction = null;
if (weeklyChallenge) {
  document.body.classList.add('weekly-mode');
  const badge = document.createElement('div');
  badge.className = 'weekly-badge';
  badge.textContent = `✦ ${weeklyChallenge.label}`;
  ui.el.scene3d.closest('.left')?.querySelector('.topbar')?.appendChild(badge);
}
if (playtestRoute) {
  document.body.classList.add('human-playtest-mode');
  const profileLabel = locale === 'en'
    ? { novice: 'Novice', regular: 'Regular', expert: 'Expert', unspecified: 'Profile required' }[playtestExperience]
    : { novice: '초보', regular: '보통', expert: '숙련', unspecified: '경험 구간 미지정' }[playtestExperience];
  const badge = document.createElement('div');
  badge.className = `weekly-badge playtest-badge ${playtestExperience === 'unspecified' ? 'invalid' : ''}`;
  badge.textContent = `🧪 ${locale === 'en' ? 'Human playtest' : '사람 플레이테스트'} · ${profileLabel}`;
  ui.el.scene3d.closest('.left')?.querySelector('.topbar')?.appendChild(badge);
}
/* 자동화로 열었거나 ?mute를 붙였으면 소리 없이 시작한다.
 * 검증을 돌릴 때마다 옆에서 효과음이 터지면 사람이 못 견딘다.
 * (설정을 저장하지 않으므로 사용자가 평소 쓰던 소리 설정은 그대로 남는다) */
if (urlParams.has('mute') || urlParams.has('rafshim')) forceMute();

/* ---------- 모바일이면 배경 장식을 끈다 ----------
 * 잔디 14,000장 · 픽셀마다 도는 파도 셰이더 · 하늘 밴드는 데스크톱 GPU 기준으로
 * 만든 것들이라 폰에서는 프레임을 그대로 먹는다. 게다가 작은 화면에서는
 * 하늘에 내줬던 19%가 아깝다 — 끄면 그만큼 전장이 커져 발판을 누르기 쉬워진다.
 * ?decor=on 으로 폰에서도 켜 볼 수 있고, ?decor=off 로 데스크톱에서 꺼 볼 수 있다. */
function detectMobile() {
  /* ?mobile=1 은 폰 없이 이 경로를 확인하려고 둔다. 데스크톱 브라우저는
   * 창을 줄여도 pointer:coarse 로 안 바뀌어서 그냥은 검증이 안 된다. */
  const forced = urlParams.get('mobile');
  if (forced != null) return !/^(0|off|no|false)$/i.test(forced);
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* matchMedia 없는 환경 */ }
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent || '');
}
const urlDecor = urlParams.get('decor');
const isMobile = detectMobile();
const useDecor = urlDecor != null ? !/^(0|off|no|false)$/i.test(urlDecor)
                                  : (!isMobile && !store.decorOff);
const graphicsQuality = urlGfx || (store.gfx === 'lite' || (isMobile && store.gfx == null) ? 'lite' : 'high');
/* P0 파일럿을 통과한 art-v2가 출시 기본값이다. 저사양 비교·복구에는
 * ?art=procedural을 사용하며, 이 경로는 manifest조차 요청하지 않는다. */
const requestedArt = urlParams.get('art');
const artMode = /^(procedural|off|0)$/i.test(requestedArt || '') ? 'procedural' : 'v2';
const perfMode = urlParams.has('perf');
const assetLoader = new RuntimeAssetLoader({
  enabled: artMode === 'v2',
  quality: graphicsQuality,
  decoders: { model: decodeGltfAsset },
});
const assetPreload = assetLoader.preload();
void assetPreload.then(registerSfxAssets);
const audioProbe = urlParams.has('audioProbe') ? (() => {
  const output = document.createElement('output');
  output.id = 'audio-probe';
  output.hidden = true;
  document.body.appendChild(output);
  void assetPreload.then(() => { output.textContent = JSON.stringify(sfxSampleSnapshot()); });
  return output;
})() : null;
const captureMode = perfMode && urlParams.has('capture');

const renderer = new Renderer3D(ui.el.scene3d, {
  /* 폰은 처음부터 lite 로 시작한다. high 로 켰다가 7초 뒤에 떨어뜨리면
   * 그 7초가 하필 제일 버벅이는 구간(첫인상)이 된다. */
  quality: graphicsQuality,
  preserve: urlParams.has('rafshim') || urlGfx === 'min',
  decor: useDecor,
  touch: isMobile,
  reducedEffects,
  assets: assetLoader,
});
const villageRenderer = new VillageRenderer({ quality: renderer.quality, touch: isMobile, reducedEffects });
window.addEventListener('pagehide', () => assetLoader.dispose(), { once: true });

if (captureMode) {
  const link = document.createElement('a');
  const media = document.createElement('video');
  const data = document.createElement('output');
  link.id = 'visual-capture';
  link.hidden = true;
  link.textContent = 'preparing';
  media.id = 'visual-capture-media';
  media.hidden = true;
  media.muted = true;
  media.preload = 'metadata';
  data.id = 'visual-capture-data';
  data.hidden = true;
  document.body.appendChild(link);
  document.body.appendChild(media);
  document.body.appendChild(data);
  void assetPreload.then(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const blob = await captureCanvasVideo(ui.el.scene3d.querySelector('canvas'));
      link.href = URL.createObjectURL(blob);
      media.src = link.href;
      link.download = captureFilename({ artMode, quality: renderer.quality, mobile: isMobile });
      link.dataset.bytes = String(blob.size);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const encoded = btoa(binary);
      for (let offset = 0; offset < encoded.length; offset += 0x10000) {
        const chunk = document.createElement('span');
        chunk.textContent = encoded.slice(offset, offset + 0x10000);
        data.appendChild(chunk);
      }
      link.textContent = 'ready';
      window.addEventListener('pagehide', () => URL.revokeObjectURL(link.href), { once: true });
    } catch (error) {
      link.dataset.error = error.message;
      link.textContent = 'failed';
    }
  });
}

/* ?perf=1은 같은 시드 장면의 10초 렌더링을 기계적으로 비교하는 숨은 probe다.
 * DOM output을 쓰므로 브라우저 자동화가 게임 내부 객체를 직접 조작하지 않는다. */
const perfProbe = perfMode ? (() => {
  const output = document.createElement('output');
  output.id = 'perf-probe';
  output.hidden = true;
  document.body.appendChild(output);
  const bootAt = 0; // performance.now() 기준점은 navigationStart다.
  const probe = {
    output, bootAt, firstFrameMs: null, assetsReadyMs: null,
    sampleStart: null, lastSample: null, durations: [], complete: false,
  };
  void assetPreload.then(() => { probe.assetsReadyMs = performance.now() - bootAt; });
  return probe;
})() : null;

function recordPerformanceProbe(now) {
  const probe = perfProbe;
  if (!probe || probe.complete) return;
  if (probe.firstFrameMs == null) probe.firstFrameMs = now - probe.bootAt;
  if (probe.assetsReadyMs == null) return;
  const readyAt = probe.bootAt + probe.assetsReadyMs + 500;
  if (now < readyAt) return;
  if (probe.sampleStart == null) {
    probe.sampleStart = now;
    probe.lastSample = now;
    return;
  }
  probe.durations.push(now - probe.lastSample);
  probe.lastSample = now;
  if (now - probe.sampleStart < 10000) return;

  const frame = summarizeFrameDurations(probe.durations);
  const resources = performance.getEntriesByType('resource');
  const bytesOf = (entry) => entry.transferSize || entry.encodedBodySize || 0;
  const assetResources = resources.filter((entry) => /\/assets\//.test(entry.name));
  const round = (value) => Math.round(value * 100) / 100;
  const report = {
    complete: true,
    artMode,
    quality: renderer.quality,
    mobile: isMobile,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: round(window.devicePixelRatio || 1),
    },
    scene: {
      phase: state.phase,
      wave: state.wave,
      enemies: state.enemies.filter((enemy) => !enemy.dead).length,
      pendingEnemies: state.pendingWave?.filter((enemy) => !enemy.warnOnly).length || 0,
      region: E.journeyBattleProgress(state)?.node.region || 'verdant-dawn',
    },
    firstPlayMs: round(probe.firstFrameMs),
    assetsReadyMs: round(probe.assetsReadyMs),
    transferBytes: resources.reduce((sum, entry) => sum + bytesOf(entry), 0),
    assetTransferBytes: assetResources.reduce((sum, entry) => sum + bytesOf(entry), 0),
    resourceCount: resources.length,
    assetResourceCount: assetResources.length,
    frames: frame.frames,
    avgFps: round(frame.avgFps),
    avgFrameMs: round(frame.avgFrameMs),
    p95FrameMs: round(frame.p95FrameMs),
    render: renderer.performanceSnapshot(),
  };
  probe.complete = true;
  probe.output.textContent = JSON.stringify(report);
}

let state = null;
let speed = 1;
let selBench = null;      // 배치 대기 중인 벤치 용사
let selHero = null;       // 정보 패널에 표시 중인 용사 (벤치/필드)
let hoverHeroId = null;   // 툴팁 표시 중인 필드 용사
let overHandled = false;
let heartbeatT = 0;
let panelT = 0;
let sellMode = false;         // 여러 명 판매 모드 (벤치 카드가 체크박스가 된다)
const sellSel = new Set();    // 판매하려고 고른 용사 id
let tactics = null;
let autoPhaseClock = createAutoPhaseClock();
let sessionMeter = null;
let lastSessionSequence = null;

function playtestContext() {
  return {
    chapter: state?.journey?.chapter || null,
    node: state?.journey?.current || null,
    wave: state?.wave || 1,
  };
}

function startPlaySession(difficulty, startKind = 'new', retryOf = null) {
  if (!sessionEligible || demo.active) return null;
  sessionMeter = createSessionMeter({
    mode: weeklyChallenge ? 'weekly' : 'campaign',
    challengeId: weeklyChallenge?.id || null,
    difficulty,
    experience: playtestExperience,
    startKind,
    retryOf,
  });
  return sessionMeter;
}

function discardPlaySession() {
  sessionMeter = null;
}

function finishPlaySession(outcome) {
  if (!sessionMeter || sessionMeter.finished) return null;
  const record = sessionMeter.finish(outcome, playtestContext());
  const stored = playtestLog.append(record);
  if (stored) {
    lastSessionSequence = stored.sequence;
    ui.setPlaytestLogStatus(playtestLog.records().length);
  }
  return stored;
}

function exportPlaytestLog() {
  const data = playtestLog.export();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `constellation-defense-playtest-${new Date().toISOString().slice(0, 10)}.json`;
  link.hidden = true;
  document.body.appendChild(link);
  ui.setPlaytestLogStatus(data.sessions.length, true);
  ui.toast(`📊 로컬 플레이 기록 ${data.sessions.length}개를 내보냈어요. 외부 전송은 하지 않습니다.`, 'good');
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 도감 · 업적 ----------
 * 조건은 전부 값 비교라 아무 때나 다시 평가해도 싸다. 언제 부르는지가 전부다:
 * 용사 탄생 · 전술 시전 · 웨이브 종료 · 레벨 업 · 게임 오버 · 승리.
 * 데모(봇)가 딴 업적은 업적이 아니므로 데모 중엔 기록도 평가도 멈춘다. */
function recordHeroBorn(hero) {
  if (demo.active || !hero || state?.squad) return;
  codexAddHero(hero.cls, hero.tier);
  checkAchievements();
}

function checkAchievements() {
  if (demo.active) return;
  const bestStored = Math.max(0, ...Object.keys(D.DIFFICULTIES).map(d => store.best(d)));
  const ctx = {
    state, codex,
    /* 진행 중엔 "치른 웨이브"(wave-1)도 인정 — 기록 갱신은 게임 오버 때라 늦다 */
    bestWave: Math.max(bestStored, state ? state.wave - 1 : 0),
    victories: store.victories,
    trialClears: store.trialClears,
  };
  for (const a of D.ACHIEVEMENTS) {
    if (earned[a.key]) continue;
    let ok = false;
    try { ok = !!a.check(ctx); } catch { ok = false; }
    if (!ok) continue;
    earned[a.key] = 1;
    markDirty();
    store.shards = store.shards + a.shards;
    SFX.shard();
    ui.toast(`🏅 업적 달성! [${a.emoji} ${a.name}] ✨별조각 +${a.shards}`, 'good');
    if (a.unlocks) {
      const A = D.CHAMP_WARDROBE[a.unlocks.axis];
      ui.toast(`🪞 옷장이 열렸어요! ${A.emoji} ${A.name}: ${A.options[a.unlocks.key].name}`, 'good');
    }
    ui.pingBook();
  }
}

/* 옷장 잠금 — 업적으로 열린다. 단 지금 입고 있는 옷은 잠그지 않는다
 * (해금 기능이 나중에 생겼으므로, 이미 입은 옷이 잠기면 뺏는 셈이 된다) */
function closetLock(axis, key) {
  const lock = D.WARDROBE_LOCKS[axis] && D.WARDROBE_LOCKS[axis][key];
  if (!lock || earned[lock.key]) return null;
  if (D.champLookOf(store.champCfg.look)[axis] === key) return null;
  return lock;
}

/* 새 판 공통 리셋 — 새 게임·불러오기·별의 시련이 같은 정리를 밟는다 */
function resetSession() {
  selBench = null;
  selHero = null;
  overHandled = false;
  sellMode = false;
  sellSel.clear();
  renderer.setPlacementMode(false);
  renderer.setSelectedHero(null);
  renderer.setHover(null);
}

/* 시작 용사 두 명 — 빈 벤치는 "뭘 해야 하지"가 된다. 도감도 여기서 첫 칸이 채워진다 */
function giveStarters() {
  if (state?.squad) return;
  for (const cls of ['knight', 'archer']) {
    const h = E.makeHero(state, cls, 0);
    state.bench.push(h);
    recordHeroBorn(h);
  }
}

function newGame(difficulty, opts = {}) {
  let retryOf = opts.retry ? lastSessionSequence : null;
  if (sessionMeter && !sessionMeter.finished) {
    if (opts.replaceSession) discardPlaySession();
    else {
      const previous = finishPlaySession(opts.retry ? 'restart' : 'new-game');
      if (opts.retry) retryOf = previous?.sequence || lastSessionSequence;
    }
  }
  gameOverToken++;                 // 게임오버 연출 예약이 새 판을 덮지 않게
  weeklyReplay?.clear();
  state = E.createGame({
    difficulty,
    metaLevels: store.meta,
    rng: weeklyChallenge ? seededRandom(weeklyChallenge.seed)
      : demoRoute ? seededRandom(DEMO_SEED) : undefined,
    journeyChapter: opts.journeyChapter || previewChapter,
  });
  if (previewBlueprint && state.journey?.chapter === 'beyond-page') {
    state.journey.current = 'alignment-hub';
    if (!state.journey.visited.includes('alignment-hub')) state.journey.visited.push('alignment-hub');
    E.chooseJourneyPath(state, 'market');
    E.travelJourney(state, 'refugee-station');
    E.travelJourney(state, 'corrector-hunt');
    E.prepareJourneyBattle(state);
  }
  autoPhaseClock = createAutoPhaseClock();
  if (tactics) tactics.reset();
  tacticFeedback.reset();
  giveStarters();
  resetSession();
  startPlaySession(difficulty, opts.retry ? 'retry' : 'new', retryOf);
  if (opts.retry) sessionMeter?.action('restarts');
  refreshAll();
  ui.hideOver();
  ui.hideDefenseVictory();
  music.setWave(1);
  /* 이어하기 메뉴를 띄울 때는 프롤로그를 잠시 미룬다 — 메뉴 위에 이야기가 겹치면 안 된다 */
  if (!opts.holdStory) playStory('prologue');
}

/* ---------- 별의 시련 — 승리 후 다음 회차 ----------
 * 별지기의 성장은 그대로, 용사·골드·성은 처음부터, 몬스터는 회차만큼 세게. */
function startTrial() {
  if (!state || state.phase === 'over') return;
  gameOverToken++;
  state = E.nextLoop(state);
  autoPhaseClock = createAutoPhaseClock();
  tacticFeedback.reset();
  giveStarters();
  resetSession();
  ui.hideVictory();
  ui.hideDefenseVictory();
  refreshAll();
  music.setWave(1);
  SFX.waveStart();
  const run = (state.loop || 0) + 1;
  ui.toast(`🌟 별의 시련 ${run}회차! 몬스터 체력 ×${D.loopHpMul(state.loop).toFixed(2)} — ${heroName()}의 성장은 그대로예요`, 'good');
  autoSave();                      // 시련의 첫 준비 단계가 곧 이어하기 지점
  checkAchievements();
}

/* 판매 모드에 들어가면 배치/이동 선택은 모두 풀어 한 번에 한 가지만 하게 한다 */
function setSellMode(on) {
  if (sellMode === !!on) return;
  sellMode = !!on;
  sellSel.clear();
  if (sellMode) {
    selBench = null;
    selHero = null;
    kbPad = null;
    renderer.setPlacementMode(false);
    renderer.setSelectedHero(null);
    renderer.setHover(null);
    ui.restoreTab();
  }
  refreshPanels();
}

function refreshPanels() {
  /* 조합 등으로 사라진 용사가 판매 선택에 남지 않게 정리 */
  if (sellSel.size) {
    for (const id of [...sellSel]) if (!state.bench.some(h => h.id === id)) sellSel.delete(id);
  }
  ui.renderSquad(state, selHero);
  ui.renderSellBar(state, false, sellSel);
  ui.renderSquadGrowth(state);
  ui.renderCastlePanel(state);
  ui.renderHeroPanel(state, selHero);
  ui.renderCombatSkillDock(state);
}
function refreshAll() {
  const journeyBattle = E.journeyBattleProgress(state);
  renderer.setRegionTheme(journeyBattle?.node.region || 'verdant-dawn');
  refreshPanels();
  ui.updateHud(state, store.shards, store.best(state.difficulty));
  ui.setWaveUI(state);
  ui.renderWavePreview(state, E.waveSummary(state));
  ui.renderJourney(state);
}

/* ---------- 막간 이야기 ----------
 * 매 웨이브 띄우면 "스킵을 누르는 게임"이 된다. 초반에 몰고 뒤로 갈수록 성글게,
 * 한 판에 최대 열댓 번. 이미 본 것은 state.seenStory로 걸러진다. */
let storyResume = null;
function playStory(key, onDone = null) {
  if (store.storyOff || !Story.beat(key, getLocale())) { if (onDone) onDone(); return false; }
  if (!state.seenStory) state.seenStory = new Set();
  if (state.seenStory.has(key)) { if (onDone) onDone(); return false; }
  state.seenStory.add(key);
  storyResume = onDone;
  /* {name} = 옷장에서 지은 별지기 이름 — 이야기가 그 이름을 부른다 */
  const beat = Story.beat(key, getLocale());
  ui.showStory({ ...beat, lines: beat.lines.map(l => l.replace(/\{name\}/g, heroName())) });
  SFX.tap();
  return true;
}
function closeStory() {
  ui.hideStory();
  const fn = storyResume;
  storyResume = null;
  if (fn) fn();
}

/* ---------- 전설·신화 탄생 연출 ----------
 * 수학 모달이 아직 열려 있는 상태에서 그 위에 덮인다.
 * 예약된 자동 진행을 반드시 끄고, 닫힐 때 원래 흐름을 이어 준다. */
let revealResume = null;
function playReveal(hero, onDone) {
  if (store.storyOff) { onDone(); return; }
  if (!state.revealed) state.revealed = new Set();
  const key = `${hero.cls}:${hero.tier}`;
  const short = state.revealed.has(key);       // 두 번째부터는 짧게
  state.revealed.add(key);
  const C = D.CLASSES[hero.cls];
  const T = D.TIERS[hero.tier];
  const ab = hero.tier >= 4 ? (D.MYTHIC_ABILITIES && D.MYTHIC_ABILITIES[hero.cls])
                            : (D.LEGEND_ABILITIES && D.LEGEND_ABILITIES[hero.cls]);
  revealResume = onDone;
  ui.showReveal({
    tierName: T.name, tierColor: T.color, name: C.name, emoji: C.emoji,
    desc: ab ? `[${ab.name}] ${ab.desc}` : C.desc,
    art: heroPortrait(hero.cls, hero.tier), short,
  });
  SFX.summon(hero.tier);
  renderer.celebrate(hero.tier >= 4 ? 0xd8b4ff : 0xffd93d, true);
  clearTimeout(revealTimer);
  revealTimer = setTimeout(closeReveal, short ? 1200 : 3200);
}
let revealTimer = null;
function closeReveal() {
  clearTimeout(revealTimer);
  if (!ui.isRevealOpen()) return;
  ui.hideReveal();
  const fn = revealResume;
  revealResume = null;
  if (fn) fn();
}

/* ---------- 별지기 액션 ----------
 * 마법은 별지기의 것 — 쓰러져 있으면 못 쓴다. 실패 이유는 반드시 말해 준다. */
function doSpell() {
  if (!state.champ) return;
  const r = E.castStar(state);
  if (!r.ok) {
    if (r.reason === 'phase') ui.toast('☄️ 별똥별은 전투 중에만! 웨이브를 시작해 보세요', 'bad');
    else if (r.reason === 'ko') ui.toast(`😵 ${heroName()}가 쓰러져 있어요 — 다음 웨이브에 돌아와요`, 'bad');
    else if (r.reason === 'cd') ui.toast(`☄️ 별이 아직 오는 중이에요 (${Math.ceil(r.left)}초)`, 'bad');
    else if (r.reason === 'none') ui.toast('☄️ 지금은 떨어뜨릴 곳이 없어요 — 몬스터가 오면 눌러요!');
    return;
  }
  SFX.starfall(D.FIELD_W / 2);
  renderer.onEvents(state, r.events);
  handleEvents(r.events);
  refreshAll();
}
function doUlt() {
  if (!state.champ) return;
  const r = E.castUlt(state);
  if (!r.ok) {
    if (r.reason === 'phase') ui.toast('🌌 은하수는 전투 중에만 쏟아부을 수 있어요', 'bad');
    else if (r.reason === 'ko') ui.toast(`😵 ${heroName()}가 쓰러져 있어요 — 다음 웨이브에 돌아와요`, 'bad');
    else if (r.reason === 'charge') ui.toast(`🌌 은하수 충전 ${Math.round((r.ult || 0) * 100)}% — 몬스터를 잡으면 차올라요`, 'bad');
    else if (r.reason === 'none') ui.toast('🌌 지금은 쏟아부을 곳이 없어요 — 몬스터가 오면 눌러요!');
    return;
  }
  SFX.ultimate();
  renderer.onEvents(state, r.events);
  handleEvents(r.events);
  refreshAll();
}
function doHeroActive(heroId) {
  const r = E.castHeroActive(state, heroId);
  if (!r.ok) {
    if (r.reason === 'phase') ui.toast('✦ 영웅 액티브는 전투 중에만 사용할 수 있어요.', 'bad');
    else if (r.reason === 'cd') ui.toast(`${r.spec.emoji} ${r.spec.name} 재사용까지 ${Math.ceil(r.left)}초`, 'bad');
    else if (r.reason === 'none') ui.toast('✦ 기술을 쓸 적이 아직 도착하지 않았어요.');
    return;
  }
  renderer.onEvents(state, r.events);
  handleEvents(r.events);
  sessionMeter?.action('heroActives');
  ui.renderHeroPanel(state, heroId);
  ui.renderCombatSkillDock(state);
}
function doMonsterBlueprint() {
  const result = E.castMonsterBlueprint(state);
  if (!result.ok) {
    if (result.reason === 'locked') ui.toast('👺 지하 몬스터 시장에서 청사진을 기록해야 합니다.', 'bad');
    else if (result.reason === 'phase') ui.toast('👺 몬스터 청사진은 전투 중에만 사용할 수 있습니다.', 'bad');
    else if (result.reason === 'charge') ui.toast('👺 이번 방어에서는 이미 청사진을 사용했습니다.', 'bad');
    else if (result.reason === 'none') ui.toast('👺 소환할 방어로에 적이 아직 없습니다.');
    return false;
  }
  SFX.summon(1);
  renderer.onEvents(state, result.events);
  handleEvents(result.events);
  sessionMeter?.action('blueprintCasts');
  ui.updateHud(state, store.shards, store.best(state.difficulty));
  return true;
}
function doConstellationAid() {
  const result = E.castConstellationAid(state);
  if (!result.ok) {
    if (result.reason === 'phase') ui.toast('✦ 별자리 수호자는 전투 중에만 부를 수 있어요.', 'bad');
    else if (result.reason === 'charge') ui.toast(`✦ 성좌 인장 ${result.charge || 0}/${D.TACTICS.constellationAid.chargeNeeded} · 4매치 +1, 직선 5매치 +2, 영웅 문양 +3`, 'bad');
    else if (result.reason === 'active') ui.toast('✦ 별자리 수호자가 이미 길을 지키고 있어요.');
    else if (result.reason === 'none') ui.toast('✦ 적이 나타나면 가장 위급한 길에 수호자를 보낼 수 있어요.');
    return false;
  }
  SFX.ultimate();
  renderer.onEvents(state, result.events);
  handleEvents(result.events);
  sessionMeter?.action('constellationAids');
  ui.updateHud(state, store.shards, store.best(state.difficulty));
  return true;
}
function openSkills() {
  if (!state.champ) return;
  if (state.phase === 'over') return;
  ui.renderSkills(state);
  ui.showSkills();
  SFX.tap();
}

/* ---------- 별지기의 옷장 ----------
 * 미리보기는 초상 렌더러가 실시간으로 굽는다 — 고르는 즉시 갈아입은 모습이 보인다.
 * 저장을 눌러야 진짜로 입는다: 닫으면 원래대로. */
let closetDraft = null;
function openCloset() {
  const cfg = store.champCfg;
  closetDraft = { look: D.champLookOf(cfg.look) };
  ui.renderCloset(closetDraft.look, D.champNameOf(cfg.name), closetLock);
  ui.setClosetPreview(champPortrait(closetDraft.look));
  ui.showCloset();
  SFX.tap();
}
function pickCloset(axis, key) {
  if (!closetDraft || !D.CHAMP_WARDROBE[axis] || !D.CHAMP_WARDROBE[axis].options[key]) return;
  /* 잠긴 옷 — 버튼은 눌리지 않지만(disabled) 다른 경로도 막아 둔다 */
  const lock = closetLock(axis, key);
  if (lock) { ui.toast(`🔒 업적 [${lock.emoji} ${lock.name}]을 달성하면 열려요 — ${lock.desc}`, 'bad'); return; }
  closetDraft.look = { ...closetDraft.look, [axis]: key };
  ui.renderCloset(closetDraft.look, ui.readClosetName(), closetLock);
  ui.setClosetPreview(champPortrait(closetDraft.look));
  SFX.tap();
}
function saveCloset() {
  if (!closetDraft) return;
  const name = D.champNameOf(ui.readClosetName());
  store.champCfg = { name, look: closetDraft.look };
  renderer.setChampLook(closetDraft.look);
  ui.setChampFace(champPortrait(closetDraft.look));
  ui.setChampName(name);
  ui.hideCloset();
  closetDraft = null;
  SFX.upgrade();
  ui.toast(`🪞 ${name}, 새 모습으로 변신! 길에서 확인해 보세요`, 'good');
}
function closeCloset() {
  ui.hideCloset();
  closetDraft = null;
}

/* ---------- 잔치 ---------- */
function doFeast() {
  const r = E.holdFeast(state);
  if (!r.ok) {
    if (r.reason === 'phase') ui.toast('🎉 잔치는 준비 단계에만! 전투가 끝나면 벌여요', 'bad');
    else if (r.reason === 'done') ui.toast('🎉 이번 준비엔 벌써 즐겼어요 — 다음 웨이브에 또!', 'bad');
    else if (r.reason === 'gold') ui.toast(`잔치에는 💰${r.cost}이 필요해요 — 몬스터를 잡아 모아요 ⚔️`, 'bad');
    else if (r.reason === 'none') ui.toast('전원 신화! 승급할 용사가 없어요 — 최강 군단이에요 🌌', 'good');
    return;
  }
  SFX.feast();
  recordHeroBorn(r.hero);              // 잔치 승급도 도감의 새 칸이 될 수 있다
  const C = D.CLASSES[r.hero.cls];
  ui.toast(`🎉 잔치! ${C.emoji} ${C.name}가 신나게 먹고 ${D.TIERS[r.hero.tier].name}(으)로 승급! (💰-${r.cost})`, 'good');
  renderer.onEvents(state, r.events);
  handleEvents(r.events);
  refreshAll();
}

/* ---------- 액션 ---------- */
function doSummon() {
  const r = E.summon(state);
  if (!r.ok) {
    if (r.reason === 'gold') ui.toast('골드가 부족해요! 몬스터를 잡으면 골드가 들어와요 ⚔️', 'bad');
    else if (r.reason === 'bench') ui.toast('벤치가 가득 찼어요! 배치하거나 조합해 보세요.', 'bad');
    return;
  }
  SFX.summon(r.hero.tier);
  recordHeroBorn(r.hero);
  const C = D.CLASSES[r.hero.cls], T = D.TIERS[r.hero.tier];
  /* 등급이 높을수록 화려하게 */
  renderer.summonBurst(r.hero.tier);
  ui.summonReveal(r.hero, r.hero.tier);
  ui.toast(`${T.name} 등급 ${C.name} ${C.emoji} 등장!`, r.hero.tier >= 2 ? 'good' : '');
  if (r.hero.tier === 3) ui.toast(`👑 전설! [${D.LEGEND_ABILITIES[r.hero.cls].name}] ${D.LEGEND_ABILITIES[r.hero.cls].desc}`, 'good');
  refreshAll();
}

/* 수학 관문은 별자리 전술판으로 옮겼다. 조합은 준비 단계의 경제 판단으로
 * 남겨 두고, 전투 중 손맛과 위험 관리는 3매치가 맡는다. */
function doCombineDirect(action) {
  if (state.phase !== 'prep') {
    ui.toast('⚗️ 조합은 웨이브 사이에만! 전투 중엔 별자리 전술판으로 길을 지켜요.', 'bad');
    return;
  }
  const r = action.kind === 'rankup'
    ? E.combineRankUp(state, action.cls, Number(action.tier))
    : E.combineRecipe(state, action.result);
  if (!r.ok) {
    if (r.reason === 'gold') ui.toast(`조합에는 💰${r.cost}이 필요해요 — 웨이브와 별자리 연쇄로 모아 봐요.`, 'bad');
    else ui.toast('조합 재료가 달라졌어요. 용사 구성을 다시 확인해 주세요.', 'bad');
    refreshAll();
    return;
  }
  SFX.combine();
  recordHeroBorn(r.hero);
  const C = D.CLASSES[r.hero.cls];
  let msg = `✨ 성좌 조합! ${D.TIERS[r.hero.tier].name} ${C.name} ${C.emoji} 탄생! (💰-${r.cost})`;
  if (r.lucky) msg = `🍀 성좌 공명! ${D.TIERS[r.hero.tier].name} ${C.name} ${C.emoji} 탄생! (💰-${r.cost})`;
  if (action.kind === 'recipe') ui.toast(`📖 도감 해금! ✨ [${C.name}] ${C.desc}`, 'good');
  if (r.hero.tier >= 2) renderer.combineFlourish(r.pad, r.hero.tier);
  if (r.pad >= 0) renderer.burst((D.PADS[r.pad].x - D.FIELD_W / 2) / 36, 0.5, (D.PADS[r.pad].y - D.FIELD_H / 2) / 36, 0x7fff9e, 12, 2.4);
  ui.toast(msg, 'good');
  if (r.resonance?.activated) {
    const pct = Math.round((D.RESONANCE_DAMAGE_MUL - 1) * 100);
    ui.toast(`✦ 성좌 공명! 합 ${r.resonance.value} = ${E.laneName(r.resonance.lane)} 길 · 이번 웨이브 그 길 피해 +${pct}%`, 'good');
    if (r.pad >= 0) renderer.burst((D.PADS[r.pad].x - D.FIELD_W / 2) / 36, 0.5, (D.PADS[r.pad].y - D.FIELD_H / 2) / 36, 0xffdb72, 20, 3.2);
  }
  if (r.hero.tier === 3) ui.toast(`👑 전설! [${D.LEGEND_ABILITIES[r.hero.cls].name}] ${D.LEGEND_ABILITIES[r.hero.cls].desc}`, 'good');
  refreshAll();
}

function doPlace(padIndex) {
  /* 이미 용사가 있는 자리를 골랐다면 "거기 놓고 싶다"는 뜻이다 — 거절하지 말고 자리를 바꾼다.
   * 벤치 ↔ 필드 교환이라 벤치 수가 그대로여서 벤치가 가득 차 있어도 항상 된다. */
  const occ = E.padOccupant(state, padIndex);
  if (occ) {
    const s = E.swapBenchWithPad(state, selBench, padIndex);
    if (!s.ok) return;
    SFX.place();
    padFx(s.placed, 0x9fdcff);
    ui.toast(`🔀 ${D.CLASSES[s.placed.cls].name} 배치 · ${D.CLASSES[s.benched.cls].name}은 벤치로!`);
    deselectAll();      // 배치가 끝나면 선택도 끝 — 다음 클릭이 또 뭔가를 옮기지 않게
    refreshAll();
    return;
  }
  const r = E.placeHero(state, selBench, padIndex);
  if (!r.ok) return;
  SFX.place();
  renderer.burst((r.hero.x - D.FIELD_W / 2) / 36, 0.5, (r.hero.y - D.FIELD_H / 2) / 36, 0x7fff9e, 10, 2.2);
  deselectAll();
  refreshAll();
}

/* 배치된 용사 선택 — 선택하면 빈 발판(초록)과 다른 용사 자리(파랑)가 함께 빛난다 */
function selectField(hero) {
  if (hero) setSellMode(false);        // 배치/이동을 시작하면 판매 모드는 끝
  selBench = null;
  selHero = hero ? hero.id : null;
  renderer.setSelectedHero(selHero);
  renderer.setPlacementMode(!!hero, hero ? D.CLASSES[hero.cls].range : 0, true);
  ui.renderSquad(state, selHero);
  ui.renderHeroPanel(state, selHero);
  if (hero) { ui.showHeroTab(); SFX.tap(); }
  else ui.restoreTab();
}

const padFx = (h, color) =>
  renderer.burst((h.x - D.FIELD_W / 2) / 36, 0.5, (h.y - D.FIELD_H / 2) / 36, color, 8, 2);

/* 이동 — 목적지에 용사가 있으면 "자리 교환"이 된다 (회수 없이 진형만 바꾼다).
 * 한 번 움직이면 선택을 푼다 — 선택이 남아 있으면 다음 클릭이
 * 의도치 않은 이동/교환이 돼서 "누를 때마다 자리가 바뀌는" 불편이 생긴다. */
function doMove(padIndex) {
  const occ = E.padOccupant(state, padIndex);
  if (occ && occ.id !== selHero) {
    const r = E.swapHeroes(state, selHero, occ.id);
    if (!r.ok) return;
    SFX.place();
    padFx(r.a, 0x9fdcff);
    padFx(r.b, 0x9fdcff);
    ui.toast(`🔀 ${D.CLASSES[r.a.cls].name} ↔ ${D.CLASSES[r.b.cls].name} 자리를 바꿨어요!`);
    deselectAll();
    refreshAll();
    return;
  }
  const r = E.moveHero(state, selHero, padIndex);
  if (!r.ok) return;
  SFX.place();
  padFx(r.hero, 0x9fdcff);
  deselectAll();
  refreshAll();
}

/* ---------- 끌어서 옮기기 / 자리 바꾸기 ---------- */
let dragId = null;
function onDragStart(cx, cy) {
  if (state.phase === 'over') return false;
  const pad = renderer.screenToPad(cx, cy);
  if (pad == null) return false;
  const hero = E.padOccupant(state, pad);
  if (!hero) return false;
  dragId = hero.id;
  selectField(hero);
  return true;
}
function onDragMove(cx, cy) {
  renderer.setHover(renderer.screenToPad(cx, cy));
}
function onDragEnd(cx, cy) {
  const id = dragId;
  dragId = null;
  renderer.setHover(null);
  if (id == null || selHero !== id || cx == null) return;   // cx == null: 드래그 취소
  const pad = renderer.screenToPad(cx, cy);
  const hero = state.field.find(h => h.id === id);
  if (pad == null || !hero || pad === hero.padIndex) return;   // 제자리에 놓으면 그냥 선택만
  doMove(pad);
}

function doRecall(heroId) {
  const r = E.recallHero(state, heroId);
  if (!r.ok) { ui.toast('벤치가 가득 차서 회수할 수 없어요!', 'bad'); return; }
  SFX.tap();
  if (selHero === heroId) { selHero = null; renderer.setSelectedHero(null); renderer.setPlacementMode(false); }
  ui.toast('↩ 용사를 벤치로 회수했어요.');
  refreshAll();
}

/* ---------- 저장 / 불러오기 (간단한 파일 하나) ----------
 * 저장 = 준비 단계 스냅샷을 JSON으로 내려받기, 불러오기 = 그 파일을 다시 열기.
 * 별조각·최고 기록은 원래 localStorage에 있으니 파일에는 "이번 판"만 담는다. */
function saveGame() {
  if (state.phase === 'wave') {
    ui.toast('⚔️ 전투 중에는 저장할 수 없어요 — 웨이브를 끝내고 눌러 주세요!', 'bad');
    return;
  }
  if (state.phase === 'over') {
    ui.toast('끝난 판은 저장할 수 없어요 — 새로 시작한 뒤에 저장해요', 'bad');
    return;
  }
  const data = E.serialize(state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `constellation-defense_${state.wave}wave_${D.DIFFICULTIES[state.difficulty].name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  SFX.tap();
  ui.toast(`💾 ${state.wave}웨이브 준비 상태를 파일로 저장했어요!`, 'good');
}

function loadGame(data, { replaceSession = false } = {}) {
  const next = data ? E.deserialize(data, { fixedSquad: true, journey: true }) : null;
  if (!next) {
    ui.toast('😢 저장 파일을 읽을 수 없어요 — 이 게임에서 저장한 파일이 맞는지 확인해 주세요', 'bad');
    return false;
  }
  gameOverToken++;                     // 예약된 게임오버 연출이 불러온 판을 덮지 않게
  if (replaceSession) discardPlaySession();
  else finishPlaySession('load');
  state = next;
  autoPhaseClock = createAutoPhaseClock();
  tacticFeedback.reset();
  store.diff = state.difficulty;
  resetSession();
  startPlaySession(state.difficulty, 'continue');
  ui.hideOver();
  refreshAll();
  music.setWave(state.wave);
  SFX.tap();
  ui.toast(`📂 불러왔어요! ${state.wave}웨이브 준비부터 이어서 시작해요`, 'good');
  autoSave();                          // 이어하기도 이 지점을 가리키게
  return true;
}

/* ---------- 자동 저장 ----------
 * 웨이브가 끝날 때마다 준비 단계 스냅샷을 브라우저(localStorage)에 남긴다.
 * 직렬화는 그 순간(상태가 확실한 준비 단계일 때) 바로 하고, 실제 쓰기는
 * 한가할 때로 미뤄 웨이브 클리어 연출 프레임을 방해하지 않는다.
 * 단 requestIdleCallback은 숨은 탭에서 무기한 미뤄질 수 있어 timeout을 걸고,
 * 탭이 가려지거나 닫힐 때는 그 자리에서 flush한다 — "곧 쓸게"가 유실이 되면 안 된다.
 * 성이 함락되면 슬롯을 지운다 — 끝난 판은 이어하기 대상이 아니다. */
const idle = window.requestIdleCallback
  ? (fn) => window.requestIdleCallback(fn, { timeout: 400 })
  : (fn) => setTimeout(fn, 60);
let pendingAutosave = null;
function flushAutosave() {
  if (!pendingAutosave) return;
  store.autosave = pendingAutosave;
  pendingAutosave = null;
}
function autoSave() {
  if (state.phase !== 'prep' && state.phase !== 'journey') return;
  const data = E.serialize(state);
  data.savedAt = Date.now();
  pendingAutosave = data;
  idle(() => { flushAutosave(); flushRecords(); });
}
window.addEventListener('pagehide', () => {
  finishPlaySession('abandon');
  flushAutosave();
  flushRecords();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    observePlaySession(performance.now(), true);
    flushAutosave();
    flushRecords();
  }
});

function handleEvents(events) {
  /* 승리(서른 번째 아침)가 낀 배치에서는 waveEnd의 이야기 예약을 승리 쪽이 가져간다 —
   * 둘이 따로 w30 이야기를 걸면 모달이 겹친다 */
  const hasVictory = events.some(e => e.type === 'victory');
  for (const ev of events) {
    switch (ev.type) {
      case 'enemyHit':
        if (ev.kind === 'hit') SFX.hit(ev.x);
        else if (ev.kind === 'crit') SFX.crit(ev.x);
        break;
      case 'block': SFX.block(ev.x); break;
      case 'heroActive':
        if (ev.kind === 'ward') SFX.block(ev.x);
        else if (ev.kind === 'volley') SFX.shoot(ev.x);
        else SFX.explode(ev.x);
        ui.toast(`${ev.emoji} ${ev.heroName} · ${ev.ability}!`, 'good');
        break;
      case 'blueprintSummon':
        SFX.orb(ev.x);
        ui.toast(`${ev.emoji} ${ev.name} · ${['왼쪽', '가운데', '오른쪽'][ev.route]} 길 지원!`, 'good');
        break;
      case 'kill':
        if (!demo.active) codexAddKill(ev.etype);   // 몬스터 도감 — 봇의 사냥은 세지 않는다
        if (ev.boss) {
          SFX.bossDown(true);
          ui.toast(`🎉 대보스 ${ev.name}를 물리쳤어요!! 💰${ev.gold}`, 'good');
        } else if (ev.midBoss) {
          SFX.bossDown(false);
          ui.toast(`👊 중간보스 ${ev.name} 격파! 💰${ev.gold}`, 'good');
        } else {
          SFX.kill(ev.x); SFX.coin();
        }
        if (ev.mul > 1 && (ev.combo === D.COMBO.x2At || ev.combo === D.COMBO.x3At)) SFX.combo(ev.mul);
        break;
      case 'shoot':
        if (ev.kind === 'arrow') SFX.shoot(ev.x);
        else if (ev.kind === 'orb') SFX.orb(ev.x);
        else SFX.bolt(ev.x);
        break;
      case 'explode': SFX.explode(ev.x); break;
      case 'castleHit':
        if (state.castleHp > 0 && state.castleHp / state.castleMax <= 0.3) {
          setTimeout(() => { if (state.phase !== 'over') playStory('castleHurt'); }, 400);
        }
        SFX.castleHit();
        break;
      case 'bossWarn':
        SFX.bossWarn(ev.tier === 'great');
        ui.bossWarn(ev.tier, ev.name, ev.emoji);
        break;
      case 'bossSpawn':
        if (ev.tier === 'great') SFX.bossRoar();
        else SFX.midBossRoar();
        ui.showBossBanner(ev.tier, ev.name, ev.emoji);
        if (demo.active) demo.guide('boss');
        break;
      case 'bossEnrage':
        SFX.bossEnrage();
        ui.showEnrage(ev.name);
        break;
      case 'waveEnd':
        SFX.waveClear();
        ui.toast(ev.journey
          ? `🎉 ${ev.journey.name} · 방어 ${ev.journey.step}/${ev.journey.total} 완료! 보너스 💰${ev.bonus}`
          : `🎉 ${ev.wave}웨이브 클리어! 보너스 💰${ev.bonus}`, 'good');
        autoSave();                      // 매 웨이브가 이어하기 지점이 된다
        checkAchievements();
        refreshAll();
        if (demo.active) demo.guide('waveFlow');
        /* 클리어 토스트/효과음과 겹치지 않게 살짝 늦춘다. 준비 단계라 시뮬레이션 손실은 없다 */
        if (!hasVictory && !state.journey) {
          const key = Story.beatForWave(ev.wave);
          if (key) setTimeout(() => playStory(key), 700);
        }
        break;
      case 'constellationCharge':
        if (ev.charge < ev.needed) ui.toast(`✦ 성좌 인장 +${ev.gained} · ${ev.charge}/${ev.needed}`, 'good');
        break;
      case 'constellationReady':
        SFX.shard();
        ui.toast('✦ 성좌 완성! 별자리 지원 준비 완료 · 보스까지 아껴 둘 수 있어요.', 'good');
        break;
      case 'constellationAidSummon':
        ui.toast('✦ 별자리 수호자가 길을 지킵니다!', 'good');
        break;
      case 'journeyReturn':
        SFX.waveClear();
        ui.showDefenseVictory({ name: ev.name, total: ev.total, state });
        ui.toast(`✦ ${ev.name} · 방어 ${ev.total}/${ev.total} 완료! 다음 별길을 선택하세요.`, 'good');
        autoSave();
        refreshAll();
        break;
      case 'chapterComplete':
        SFX.shard();
        ui.toast(`✦ ${E.journeyChapter(state).title}을(를) 지켜냈습니다!`, 'good');
        sessionMeter?.checkpoint(`${state.journey.chapter}-complete`, playtestContext());
        if (weeklyChallenge?.endsAfterChapter === state.journey.chapter) {
          const record = finishPlaySession('weekly-complete');
          if (record) ui.toast(`📊 주간 도전 활성 플레이 ${formatPlayMinutes(record.activeMs)} · 목표 10–15분`, 'good');
        }
        refreshAll();
        break;
      case 'gameOver': onGameOver(); break;

      /* ---------- 서른 번째 아침 ----------
       * 엔진은 알렸고, 여기서 갚는다: 별조각·기록·연출·다음 회차 제안.
       * w30 이야기를 먼저 보여 주고(2회차부터는 이미 봐서 건너뜀) 승리 화면을 연다. */
      case 'victory': {
        store.victories = store.victories + 1;
        if ((ev.loop || 0) >= 1) store.trialClears = store.trialClears + 1;
        store.shards = store.shards + ev.shards;
        checkAchievements();
        flushRecords();
        const vLoop = ev.loop || 0, vShards = ev.shards;
        setTimeout(() => playStory('w30', () => {
          if (state.phase === 'over') return;      // 그 사이 함락됐다면(있을 수 없지만) 겹치지 않게
          SFX.shard();
          renderer.celebrate(0xffd93d, true);
          ui.showVictory({ loop: vLoop, shards: vShards, state });
          ui.updateHud(state, store.shards, store.best(state.difficulty));
        }), 700);
        break;
      }

      /* ---------- 별지기 ---------- */
      case 'champHurt': SFX.heroHurt(ev.x); break;
      case 'champKo':
        SFX.heroDead();
        ui.toast(`😵 별지기 ${heroName()}가 쓰러졌어요! 다음 웨이브 준비 때 다시 일어나요`, 'bad');
        break;
      case 'heroLevel':
        SFX.levelUp();
        renderer.burst((ev.x - D.FIELD_W / 2) / 36, 0.52, (ev.y - D.FIELD_H / 2) / 36, 0xd8b4ff, 10, 1.8);
        ui.toast(`✦ ${ev.name} Lv ${ev.level}! 영웅 성장 탭에서 전문화를 고르세요.`, 'good');
        checkAchievements();
        break;
      case 'champLevel':
        SFX.levelUp();
        ui.toast(`🌠 ${heroName()} 레벨 업! Lv ${ev.level} — 스킬 포인트 +1 (V키로 별자리를 이어요)`, 'good');
        checkAchievements();
        break;
      case 'ultReady':
        SFX.shard();
        ui.toast('🌌 은하수가 가득 찼어요! E키로 쏟아부어요!', 'good');
        break;
      case 'starfall': SFX.starfall(ev.x); break;
      case 'starAuto':
        ui.toast('☄️ 루나가 스스로 별똥별을 던졌어요 — A키로 직접 부를 수도 있어요!');
        break;
      case 'ultCast': SFX.ultimate(); break;
      case 'champWave':
        if (ev.perfect) {
          store.shards = store.shards + ev.shard;
          SFX.shard();
          ui.toast(`🛡️ 완벽 방어! 성이 무피해예요 — ✨별조각 +${ev.shard} · ${heroName()} 경험치 +${ev.xp}`, 'good');
        } else if (ev.revived) {
          ui.toast(`🌠 ${heroName()}가 다시 일어났어요! 체력이 가득 찼어요`);
        }
        break;
    }
  }
}

let gameOverToken = 0;
function onGameOver() {
  if (overHandled) return;
  overHandled = true;
  finishPlaySession('defeat');
  SFX.gameOver();
  music.stop();
  pendingAutosave = null;              // 쓰기 대기 중이던 스냅샷도 되살아나면 안 된다
  store.autosave = null;               // 함락된 판은 이어하기에서 지운다
  store.shards = store.shards + state.shardsEarned;
  checkAchievements();
  flushRecords();                      // 게임 오버는 확실한 저장 시점 — 도감·수학 기록을 남긴다
  const best = store.best(state.difficulty);
  if (state.wave > best) store.setBest(state.difficulty, state.wave);
  /* 900ms 연출 대기 중에 사용자가 Enter로 새 게임을 시작할 수 있다.
   * 가드가 없으면 새 판 위에 게임오버 화면이 뒤늦게 덮인다. */
  const overToken = ++gameOverToken;
  setTimeout(() => {
    if (overToken !== gameOverToken || state.phase !== 'over') return;
    SFX.shard();
    ui.showOver(state);
    ui.updateHud(state, store.shards, store.best(state.difficulty));
  }, 900);
}

/* ---------- UI 바인딩 ---------- */
const handlers = {
  onWaveStart() { tryStartWave(); },
  onVillagePresentation(presentation) { villageRenderer.setPresentation(presentation); },
  onVillagePick(clientX, clientY) { return villageRenderer.pickWorld(clientX, clientY); },
  onJourneyTravel(id) {
    const result = E.travelJourney(state, id);
    if (!result.ok) return;
    sessionMeter?.action('journeyMoves');
    SFX.tap();
    if (result.type === 'battle') {
      const prepared = E.prepareJourneyBattle(state);
      if (!prepared.ok) return;
      ui.toast(`⚔ ${result.node.name} · 방어 1/${result.node.waves}를 준비하세요.`, 'good');
    } else if (result.type === 'recruit') {
      ui.toast(`✦ ${result.node.name}에서 함께할 영웅을 고르세요.`, 'good');
    } else if (result.type === 'town') {
      ui.toast(`⌂ ${result.node.name} · 구조 ${result.refuge.survivors}명 · 사기 ${result.refuge.morale}/5`, 'good');
    } else {
      ui.toast(`✧ 보급 확보 · 골드 +${result.gold} · 성 내구도 +${result.heal}`, 'good');
    }
    refreshAll();
    autoSave();
  },
  onJourneyRecruit(key) {
    const result = E.recruitJourneyHero(state, key);
    if (!result.ok) return;
    sessionMeter?.action('recruits');
    SFX.upgrade();
    renderer.burst((result.hero.x - D.FIELD_W / 2) / 36, .5, (result.hero.y - D.FIELD_H / 2) / 36, 0xd8b4ff, 12, 2);
    ui.toast(`✦ ${result.hero.name}이(가) 영웅단에 합류했습니다!`, 'good');
    refreshAll();
    autoSave();
  },
  onSummon: doSummon,
  onCombine(action) { doCombineDirect(action); },
  /* 조합 재료가 모자랄 때 "그 용사 뽑으러 가기" — 소환은 무작위라 약속은 못 하지만,
   * 적어도 무엇을 해야 하는지는 분명해진다. */
  onNeedHero(cls) {
    const C = D.CLASSES[cls];
    if (state.gold < D.SUMMON_COST) {
      ui.toast(`${C.emoji} ${C.name}를 뽑으려면 💰${D.SUMMON_COST}이 필요해요 — 몬스터를 잡아 모아요 ⚔️`, 'bad');
      return;
    }
    ui.showTab('bench');
    ui.toast(`${C.emoji} ${C.name}를 노려요! ${keyCodeLabel(keyBindings.squad)}키로 영웅 성장을 열어 보세요`, '');
    doSummon();
  },
  onSpeed() {
    speed = speed === 1 ? 2 : 1;
    ui.setSpeedLabel(speed, keyCodeLabel(keyBindings.speed));
    SFX.tap();
  },
  onToggleSfx() {
    toggleSfx();
    ui.setSoundLabels(isSfxMuted(), isMusicMuted());
    if (ui.isSettingsOpen()) renderSettings();
    if (!isSfxMuted()) SFX.tap();
  },
  onToggleBgm() {
    toggleMusic();
    ui.setSoundLabels(isSfxMuted(), isMusicMuted());
    music.sync();
    if (ui.isSettingsOpen()) renderSettings();
  },
  onToggleEffects() {
    if (!setEffectsPreference(!reducedEffects)) return;
    ui.toast(reducedEffects ? '🌙 국소 파티클을 줄였어요.' : '✨ 국소 파티클을 더 보여줘요. 전체 화면 점멸은 항상 꺼져요.', 'good');
    if (ui.isSettingsOpen()) renderSettings();
  },
  onSettingsOpen() {
    keyCaptureAction = null;
    renderSettings();
    ui.showSettings();
    SFX.tap();
  },
  onSettingsClose() {
    keyCaptureAction = null;
    ui.hideSettings();
    SFX.tap();
  },
  onSettingsLanguage(value) {
    store.language = normalizeLocale(value);
    location.reload();
  },
  onSettingsGraphics(value) {
    store.gfx = value === 'lite' ? 'lite' : 'high';
    renderSettings();
    ui.toast('⚙️ 그래픽 품질은 다음 실행부터 적용됩니다.', 'good');
  },
  onSettingsEffects(value) {
    if (setEffectsPreference(value === 'reduced')) {
      ui.toast(reducedEffects ? '🌙 절제 효과를 사용합니다.' : '✨ 국소 파티클 밀도를 높였습니다.', 'good');
    }
    renderSettings();
  },
  onSettingsKeyCapture(actionId) {
    keyCaptureAction = actionId;
    renderSettings();
  },
  onSettingsKeyReset() {
    keyBindings = defaultBindings();
    store.keyBindings = keyBindings;
    keyCaptureAction = null;
    syncShortcutLabels();
    renderSettings();
    ui.toast('⌨️ 단축키를 기본값으로 되돌렸어요.', 'good');
  },
  onDiff(d) {
    if (!(state.phase === 'prep' && state.wave === 1)) return;
    store.diff = d;
    newGame(d, { replaceSession: true });
    ui.toast(`${D.DIFFICULTIES[d].emoji} ${D.DIFFICULTIES[d].name} 난이도로 시작!`);
  },
  onCancelPlace() { SFX.tap(); deselectAll(); },
  onBenchSelect(id) {
    SFX.tap();
    if (selBench === id) {
      selBench = null;
      selHero = null;
      renderer.setPlacementMode(false);
      ui.restoreTab();
    } else {
      ui.showHeroTab();
      selBench = id;
      selHero = id;
      const hero = state.bench.find(h => h.id === id);
      /* 세 번째 인자 = 교환 모드: 찬 자리도 후보(파랑)로 표시된다 */
      renderer.setPlacementMode(true, hero ? D.CLASSES[hero.cls].range : 0, true);
      renderer.setSelectedHero(null);
    }
    ui.renderBench(state, selBench);
    ui.renderHeroPanel(state, selHero);
  },
  /* 배치된 용사를 고른 뒤 —
   *   빈 발판 클릭    → 회수 없이 이동
   *   다른 용사 클릭  → 두 용사의 자리 교환 (끌어다 놓기와 같은 결과)
   *   같은 용사 클릭  → 선택 해제
   * 다른 용사의 정보만 보고 싶을 땐 마우스를 올리면 툴팁이 뜬다. */
  onSquadSelect(id) {
    const hero = state.field.find((entry) => entry.id === id);
    if (!hero) return;
    if (selHero === id) { deselectAll(); return; }
    selectField(hero);
  },
  onHeroSkill(heroId, key) {
    const result = E.takeHeroSkill(state, heroId, key);
    if (!result.ok) {
      if (result.reason === 'facility') {
        const facility = D.HERO_FACILITIES[result.facility];
        ui.toast(`${facility?.emoji || '⌂'} ${facility?.name || '마을 시설'}에서만 이 전문화를 선택할 수 있어요.`, 'bad');
      } else if (result.reason === 'sp') ui.toast('이 영웅은 아직 전문화 포인트가 없어요.', 'bad');
      else if (result.reason === 'level') ui.toast(`Lv ${result.level}에 열리는 전문화예요.`, 'bad');
      return;
    }
    SFX.upgrade();
    renderer.burst((result.hero.x - D.FIELD_W / 2) / 36, 0.55, (result.hero.y - D.FIELD_H / 2) / 36, 0xd8b4ff, 12, 2.1);
    ui.toast(`✦ ${result.hero.name} · [${result.skill.name}] ${result.rank}/${result.skill.max}`, 'good');
    checkAchievements();
    refreshAll();
    autoSave();
  },
  onJourneyPath(key) {
    const result = E.chooseJourneyPath(state, key);
    if (!result.ok) return false;
    SFX.tap();
    ui.toast(`${result.choice.icon} ${result.choice.name}의 설명을 기록했습니다.`, 'good');
    refreshAll();
    autoSave();
    return true;
  },
  onJourneyNextChapter() {
    if (weeklyChallenge && state.journey?.chapter === weeklyChallenge.endsAfterChapter) {
      ui.toast(`✦ 이번 주 도전은 1막 7회 방어로 완료됐어요. 기록을 확인하거나 다시 도전해 보세요.`, 'good');
      return false;
    }
    const result = E.advanceJourneyChapter(state);
    if (!result.ok) return false;
    sessionMeter?.checkpoint('act2-start', playtestContext());
    SFX.shard();
    ui.toast(`▤ CHAPTER ${String(result.chapter.number).padStart(2, '0')} · ${result.chapter.title}`, 'good');
    refreshAll();
    autoSave();
    return true;
  },
  onJourneyEnding(key) {
    const result = E.chooseJourneyEnding(state, key);
    if (!result.ok) return false;
    SFX.shard();
    ui.toast(`${result.ending.icon} ${result.ending.name} 엔딩을 선택했습니다.`, 'good');
    const record = finishPlaySession('campaign-complete');
    if (record) ui.toast(`📊 캠페인 활성 플레이 ${formatPlayMinutes(record.activeMs)} · 실경과 ${formatPlayMinutes(record.elapsedMs)}`, 'good');
    refreshAll();
    autoSave();
    return true;
  },
  onHeroActive(heroId) { doHeroActive(heroId); },
  onMonsterBlueprint() { return doMonsterBlueprint(); },
  onConstellationAid() { return doConstellationAid(); },
  onSceneClick(cx, cy) {
    const pad = renderer.screenToPad(cx, cy);
    if (pad == null) { deselectAll(); return; }
    if (selBench != null) { doPlace(pad); return; }
    const hero = E.padOccupant(state, pad);
    const onField = selHero != null && state.field.some(h => h.id === selHero);
    if (onField) {
      if (hero && hero.id === selHero) { deselectAll(); return; }
      doMove(pad);
      return;
    }
    selectField(hero);
  },
  onSceneRightClick(cx, cy) {
    const pad = renderer.screenToPad(cx, cy);
    if (pad == null) return;
    const hero = E.padOccupant(state, pad);
    if (!hero) return;
    doRecall(hero.id);
  },
  onSceneMove(cx, cy) {
    if (cx == null) { renderer.setHover(null); ui.hideTooltip(); return; }
    const pad = renderer.screenToPad(cx, cy);
    renderer.setHover(pad);
    /* 배치된 용사에 마우스를 올리면 상세 정보 */
    const hero = pad == null ? null : E.padOccupant(state, pad);
    if (hero) {
      if (hoverHeroId !== hero.id) {
        hoverHeroId = hero.id;
        ui.showTooltip(hero, state, cx, cy);
      } else ui.moveTooltip(cx, cy);
    } else if (hoverHeroId != null) {
      hoverHeroId = null;
      ui.hideTooltip();
    }
  },
  onRecall() { doRecall(selHero); },
  onSell() {
    const r = E.sellHero(state, selHero);
    if (!r.ok) return;
    SFX.coin();
    ui.toast(`용사를 보내주고 💰${r.price}을 받았어요.`);
    selHero = null;
    renderer.setSelectedHero(null);
    refreshAll();
  },
  /* --- 여러 명 판매 --- */
  onSellMode() { setSellMode(!sellMode); SFX.tap(); },
  onSellToggle(id) {
    if (!sellSel.delete(id)) sellSel.add(id);
    SFX.tap();
    ui.renderBench(state, null, sellSel);
    ui.renderSellBar(state, true, sellSel);
  },
  onSellAll() {
    const all = state.bench.length > 0 && state.bench.every(h => sellSel.has(h.id));
    sellSel.clear();
    if (!all) for (const h of state.bench) sellSel.add(h.id);
    SFX.tap();
    ui.renderBench(state, null, sellSel);
    ui.renderSellBar(state, true, sellSel);
  },
  onSellGo() {
    const picked = state.bench.filter(h => sellSel.has(h.id));
    if (!picked.length) { ui.toast('팔 용사를 골라 주세요 — 카드를 누르면 선택돼요', 'bad'); return; }
    let total = 0;
    for (const h of picked) {
      const r = E.sellHero(state, h.id);
      if (r.ok) total += r.price;
    }
    sellSel.clear();
    SFX.coin();
    ui.toast(`💰 용사 ${picked.length}명을 보내주고 ${total} 골드를 받았어요.`, 'good');
    if (!state.bench.length) setSellMode(false);   // 다 팔았으면 모드도 끝
    refreshAll();
  },
  onSave: saveGame,
  onLoad: loadGame,
  /* --- 별지기 --- */
  onSpell: doSpell,
  onUlt: doUlt,
  onSkillOpen: openSkills,
  onClosetOpen: openCloset,
  onClosetPick: pickCloset,
  onClosetSave: saveCloset,
  onClosetClose: closeCloset,
  onFeast: doFeast,
  onSkillPick(key) {
    const r = E.takeSkill(state, key);
    if (!r.ok) {
      if (r.reason === 'sp') ui.toast('스킬 포인트가 없어요 — 레벨 업으로 얻어요! (몬스터 처치·웨이브 클리어)', 'bad');
      else if (r.reason === 'need') ui.toast(`🔒 이 별자리에 먼저 ${r.need}포인트를 써야 열려요 (지금 ${r.spent})`, 'bad');
      return;
    }
    SFX.upgrade();
    const SK = r.skill;
    ui.toast(`✨ [${SK.name}] ${r.rank}단계! ${SK.per}`, 'good');
    ui.renderSkills(state);
    ui.updateChampChip(state);
  },
  /* --- 시작 메뉴 (자동 저장이 있을 때만 뜬다) --- */
  onContinue() {
    ui.hideStart();
    SFX.tap();
    /* 자동 저장이 깨져 있으면 이미 준비된 새 게임을 그대로 진행한다 */
    if (!loadGame(store.autosave, { replaceSession: true })) playStory('prologue');
  },
  onStartNew() {
    ui.hideStart();
    SFX.tap();
    playStory('prologue');   // 새 게임은 boot에서 이미 만들어져 있다
  },
  onCastle(key) {
    const r = E.castleUpgrade(state, key);
    if (!r.ok) {
      if (r.reason === 'gold') ui.toast('골드가 부족해요!', 'bad');
      return;
    }
    SFX.upgrade();
    /* 강화한 순간을 눈으로 보여 준다 — 숫자만 오르면 뭐가 달라졌는지 모른다 */
    if (key !== 'repair') renderer.castleUpgradeFx(key);
    const lv = key === 'repair' ? 0 : state.castle[key];
    const NOTE = {
      fortify: ['성벽이 높아졌어요!', '흉벽이 늘었어요!', '방어 말뚝을 박았어요!', '성문이 강철문이 됐어요!', '성벽이 대리석으로 빛나요!'],
      tower: ['마법 포탑이 솟았어요!', '포탑이 하나 더!', '마법진이 성을 감쌌어요!'],
    };
    const note = NOTE[key] && NOTE[key][lv - 1];
    ui.toast(`${D.CASTLE_UPGRADES[key].emoji} ${D.CASTLE_UPGRADES[key].name} 완료!${note ? ' ' + note : ''}`, 'good');
    refreshAll();
  },
  onMetaOpen() {
    ui.renderMeta(store.shards, store.meta);
    ui.showMeta();
    SFX.tap();
  },
  /* --- 도감 · 기록 --- */
  onBookOpen() {
    ui.renderBook({ state, codex, earned });
    ui.showBook();
    SFX.tap();
  },
  /* --- 서른 번째 아침 --- */
  onTrial() { SFX.tap(); startTrial(); },
  onVictoryContinue() {
    ui.hideVictory();
    SFX.tap();
    ui.toast('▶ 끝없는 밤을 계속 지켜요 — 몬스터는 계속 세져요!', 'good');
  },
  onMetaBuy(key) {
    const M = D.META_UPGRADES[key];
    if (!M || M.legacy) return;
    const levels = store.meta;
    const lv = levels[key] || 0;
    if (lv >= M.max) return;
    const cost = M.cost(lv);
    if (store.shards < cost) return;
    store.shards = store.shards - cost;
    levels[key] = lv + 1;
    store.meta = levels;
    SFX.shard();
    ui.toast(`🌟 ${M.name} Lv${lv + 1}! 다음 게임부터 적용돼요.`, 'good');
    ui.renderMeta(store.shards, store.meta);
    ui.updateHud(state, store.shards, store.best(state.difficulty));
  },
  onRestart() {
    SFX.tap();
    newGame(store.diff, { retry: true });
  },
  onPlaytestExport: exportPlaytestLog,
  onShare() { ui.makeShareCard(state, store.best(state.difficulty)); },
  onDragStart, onDragMove, onDragEnd,
  onDemoToggle() {
    if (!demo.active) finishPlaySession('spectate');
    demo.toggle();
    SFX.tap();
  },
  onStoryClose: closeStory,
  onStoryOff() { store.storyOff = true; ui.toast('이야기를 끄었어요. 다시 보려면 새로고침 후 설정에서…', 'bad'); closeStory(); },
  onRevealClose: closeReveal,
};
ui.bind(handlers);

/* ---------- 키보드 조작 (전 기능) ---------- */
let kbPad = null;                     // 키보드 배치 커서

/* ←→로 훑을 발판 목록 — 자기 자리만 빼고 전부다.
 * 빈 발판에서 Enter는 배치/이동, 찬 발판에서 Enter는 자리 교환이 된다.
 * 빈 곳만 훑게 하면 "저 자리랑 바꾸고 싶다"는 조작을 키보드로는 못 하게 된다. */
function padCandidates() {
  const self = selBench == null && selHero != null
    ? state.field.find(h => h.id === selHero)
    : null;
  const all = D.PADS.map((_, i) => i);
  return self ? all.filter(i => i !== self.padIndex) : all;
}

function cyclePad(dir) {
  const cand = padCandidates();
  if (!cand.length) return;
  if (kbPad == null || !cand.includes(kbPad)) kbPad = cand[0];
  else kbPad = cand[(cand.indexOf(kbPad) + dir + cand.length) % cand.length];
  renderer.setHover(kbPad);
}

function cycleBench(dir) {
  if (!state.bench.length) { ui.toast('벤치가 비어 있어요. S키로 소환해 보세요!', 'bad'); return; }
  setSellMode(false);                  // Tab으로 배치를 시작하면 판매 모드는 끝
  let idx = state.bench.findIndex(h => h.id === selBench);
  idx = (idx + dir + state.bench.length) % state.bench.length;
  const hero = state.bench[idx];
  selBench = hero.id;
  selHero = hero.id;
  renderer.setPlacementMode(true, D.CLASSES[hero.cls].range, true);
  renderer.setSelectedHero(null);
  if (kbPad == null) cyclePad(1);
  else renderer.setHover(kbPad);
  ui.renderBench(state, selBench);
  ui.renderHeroPanel(state, selHero);
  SFX.tap();
}

/* ---------- 배치 중 표시 ----------
 * 선택을 바꾸는 자리가 열 군데가 넘는다(카드 · 발판 · 키보드 · 판매 모드 · 조합 …).
 * 그 전부에 호출을 심으면 반드시 하나를 빠뜨린다 — 안내 바가 남아 있는 버그가
 * 제일 흔하다. 그래서 매 프레임 "지금 상태"에서 다시 계산하고, 바뀔 때만 DOM 을
 * 건드린다. 문자열 비교 한 번이라 비용은 없는 셈. */
let placeLabelCache = null;
function syncPlaceBar() {
  let label = null;
  if (state && !sellMode) {
    if (selBench != null) {
      const h = state.bench.find(x => x.id === selBench);
      if (h) label = `${D.CLASSES[h.cls].emoji} ${D.TIERS[h.tier].name} ${D.CLASSES[h.cls].name} — 빈 발판을 눌러 배치!`;
    } else if (selHero != null && state.field.some(x => x.id === selHero)) {
      const h = state.field.find(x => x.id === selHero);
      if (h) label = `${D.CLASSES[h.cls].emoji} ${D.CLASSES[h.cls].name} — 갈 곳을 누르세요 (용사를 누르면 자리 교환)`;
    }
  }
  if (label === placeLabelCache) return;
  placeLabelCache = label;
  ui.setPlacing(label, label || '');
}

function deselectAll() {
  selBench = null;
  selHero = null;
  kbPad = null;
  renderer.setPlacementMode(false);
  renderer.setSelectedHero(null);
  renderer.setHover(null);
  ui.renderSquad(state, null);
  ui.renderHeroPanel(state, null);
  ui.restoreTab();
}

/* 필드 용사 순환 선택 (F키) — 회수 없이 이동/강화 대상 고르기 */
function cycleField(dir) {
  if (!state.field.length) { ui.toast('배치된 용사가 없어요.', 'bad'); return; }
  const sorted = [...state.field].sort((a, b) => a.padIndex - b.padIndex);
  let idx = sorted.findIndex(h => h.id === selHero);
  idx = (idx + dir + sorted.length) % sorted.length;
  selectField(sorted[idx]);
  kbPad = null;
}

function tryStartWave() {
  if (ui.isStoryOpen() || ui.isRevealOpen()) return;   // 연출 중에 웨이브가 몰래 시작되지 않게
  const incoming = E.journeyEncounter(state);
  const quip = store.storyOff || incoming.boss ? null : Story.waveQuip(state.wave, Math.random, getLocale());
  if (quip) setTimeout(() => ui.toast(`📣 ${quip}`), 260);
  const r = E.startWave(state);
  if (!r.ok) return;
  sessionMeter?.action('waveStarts');
  sessionMeter?.checkpoint('first-defense-start', playtestContext());
  SFX.waveStart();
  music.setWave(state.wave);
  ui.toast(`🌊 ${state.wave}웨이브 시작! 몬스터를 막아요!`);
  if (r.boss) ui.toast('⚠️ 지역 대보스와 중간보스 호위대가 함께 진군해요!', 'bad');
  else if (r.encounter?.midBoss) ui.toast('⚠️ 중간보스가 졸개들을 이끌고 세 길을 압박해요!', 'bad');
  ui.setWaveUI(state);
}

/* 버튼 클릭 후 Space가 그 버튼을 다시 누르지 않도록 포커스 해제 */
document.addEventListener('click', (ev) => {
  if (ev.target instanceof HTMLButtonElement) ev.target.blur();
});

document.addEventListener('keydown', (ev) => {
  const key = ev.key;

  /* 문자 입력값이 아닌 물리 키 코드로 저장하므로 한글 IME와 영문 배열에서
   * 같은 위치의 단축키가 동작한다. Esc/Enter/Space/Tab/방향키는 UI 탐색용 고정 키다. */
  if (ui.isSettingsOpen()) {
    ev.preventDefault();
    if (keyCaptureAction) {
      if (key === 'Escape') {
        keyCaptureAction = null;
        renderSettings();
        return;
      }
      if (ev.ctrlKey || ev.altKey || ev.metaKey) {
        ui.toast('⌨️ Ctrl·Alt·시스템 키 조합은 단축키로 저장하지 않습니다.', 'bad');
        return;
      }
      const action = KEY_ACTIONS.find(({ id }) => id === keyCaptureAction);
      const result = rebindAction(keyBindings, keyCaptureAction, ev.code);
      if (!result.ok) {
        ui.toast('⌨️ Esc·Enter·Space·Tab·방향키는 화면 탐색용으로 유지합니다.', 'bad');
        return;
      }
      keyBindings = result.bindings;
      store.keyBindings = keyBindings;
      keyCaptureAction = null;
      syncShortcutLabels();
      renderSettings();
      const swapped = KEY_ACTIONS.find(({ id }) => id === result.swappedAction);
      ui.toast(swapped
        ? `⌨️ ${action?.label}와 ${swapped.label}의 키를 서로 바꿨어요.`
        : `⌨️ ${action?.label} 단축키를 ${keyCodeLabel(ev.code)}로 바꿨어요.`, 'good');
      return;
    }
    if (key === 'Escape') handlers.onSettingsClose();
    return;
  }

  const shortcutAction = actionForCode(keyBindings, ev.code);

  /* --- 시작 메뉴 (이어하기 / 처음부터) --- */
  if (ui.isStartOpen()) {
    if (key === 'Escape') { ev.preventDefault(); ui.el.newGameBtn.click(); }
    return;               // Enter/Space는 포커스된 버튼이 알아서 처리한다
  }

  /* --- 전설·신화 연출: 아무 키나 눌러 넘긴다 (수학 모달보다 위) --- */
  if (ui.isRevealOpen()) {
    ev.preventDefault();
    closeReveal();
    return;
  }

  /* --- 막간 이야기 --- */
  if (ui.isStoryOpen()) {
    if (key === 'Escape' || key === 'Enter' || key === ' ') { ev.preventDefault(); closeStory(); }
    return;                       // 나머지 키는 삼킨다 — 뒤에서 웨이브가 몰래 시작되면 안 된다
  }

  /* --- 서른 번째 아침 (승리) — Enter/Esc = 계속 지키기. 시련은 마우스로만(실수 방지) --- */
  if (ui.isVictoryOpen()) {
    if (key === 'Escape' || key === 'Enter' || key === ' ') { ev.preventDefault(); handlers.onVictoryContinue(); }
    return;
  }

  /* --- 도감 · 기록 --- */
  if (ui.isBookOpen()) {
    if (key === 'Escape' || key === 'Enter' || shortcutAction === 'codex') { ev.preventDefault(); ui.hideBook(); }
    return;
  }

  /* --- 옷장 모달 (이름 입력창의 키는 여기까지 안 온다 — Esc만 온다) --- */
  if (ui.isClosetOpen()) {
    if (key === 'Escape') { ev.preventDefault(); closeCloset(); }
    else if (key === 'Enter') { ev.preventDefault(); saveCloset(); }
    return;
  }

  /* --- 별자리(스킬트리) 모달 --- */
  if (ui.isSkillOpen()) {
    if (key === 'Escape' || key === 'Enter' || shortcutAction === 'skills') { ev.preventDefault(); ui.hideSkills(); }
    return;
  }

  /* --- 별의 축복 모달 --- */
  if (ui.isMetaOpen()) {
    if (key === 'Escape' || key === 'Enter') { ev.preventDefault(); ui.hideMeta(); return; }
    const n = Number(key);
    if (n >= 1 && n <= 4) {
      const btns = ui.el.metaRows.querySelectorAll('button');
      if (btns[n - 1] && !btns[n - 1].disabled) btns[n - 1].click();
    }
    return;
  }

  /* --- 게임 오버 --- */
  if (state.phase === 'over') {
    if (key === 'Enter' || key === ' ') { ev.preventDefault(); SFX.tap(); newGame(store.diff); }
    return;
  }

  /* --- 게임 화면 --- */
  switch (key) {
    case ' ':
    case 'Enter': {
      ev.preventDefault();
      const onField = selHero != null && state.field.some(h => h.id === selHero);
      if (selBench != null && kbPad != null) {
        const pad = kbPad;
        kbPad = null;
        renderer.setHover(null);
        doPlace(pad);
      } else if (onField && kbPad != null) {
        doMove(kbPad);                      // 배치된 용사를 골라둔 발판으로 이동
      } else if (state.phase === 'prep') {
        tryStartWave();
      }
      return;
    }
    case 'Escape':
      if (sellMode) { setSellMode(false); return; }
      deselectAll();
      return;
    case 'Tab':
      ev.preventDefault();
      cycleBench(ev.shiftKey ? -1 : 1);
      return;
    case 'ArrowLeft':
    case 'ArrowUp':
      if (selBench != null || selHero != null) { ev.preventDefault(); cyclePad(-1); }
      return;
    case 'ArrowRight':
    case 'ArrowDown':
      if (selBench != null || selHero != null) { ev.preventDefault(); cyclePad(1); }
      return;
  }
  switch (shortcutAction) {
    case 'spell': if (state.champ) doSpell(); return;
    case 'ultimate': if (state.champ) doUlt(); return;
    case 'skills': if (state.champ) openSkills(); return;
    case 'codex': handlers.onBookOpen(); return;
    case 'squad': ui.showTab('squad'); return;
    case 'combine': {
      if (state.squad) { ui.showTab('squad'); return; }
      const combo = E.bestCombo(state);
      if (combo) doCombineDirect(E.comboToAction(combo));
      else {
        const unpaid = E.listCombos(state).find(c => !c.affordable);
        ui.toast(unpaid
          ? `조합 골드가 부족해요! (💰${unpaid.cost} 필요) 몬스터를 잡아 모아 보세요 ⚔️`
          : '지금 가능한 조합이 없어요. 용사를 더 모아 보세요!', 'bad');
      }
      return;
    }
    case 'spectate': demo.toggle(); SFX.tap(); return;
    case 'mute': {
      const off = toggleAll();
      ui.setSoundLabels(isSfxMuted(), isMusicMuted());
      music.sync();
      ui.toast(off ? '🔇 소리를 모두 껐어요 (M)' : '🔊 소리를 다시 켰어요 (M)');
      return;
    }
    case 'speed':
      speed = speed === 1 ? 2 : 1;
      ui.setSpeedLabel(speed, keyCodeLabel(keyBindings.speed));
      SFX.tap();
      return;
    case 'cycleHero': cycleField(1); return;
    case 'blueprint': doMonsterBlueprint(); return;
    case 'recall': if (selHero != null && !ui.el.recallBtn.classList.contains('hidden')) ui.el.recallBtn.click(); return;
    case 'sell': if (selHero != null) ui.el.sellBtn.click(); return;
    case 'castleRepair': ui.el.castleRows.querySelector('button[data-key="repair"]')?.click(); return;
    case 'castleFortify': ui.el.castleRows.querySelector('button[data-key="fortify"]')?.click(); return;
    case 'castleTower': ui.el.castleRows.querySelector('button[data-key="tower"]')?.click(); return;
  }
});

/* ---------- 게임 루프 ---------- */
function isPaused() {
  /* 이야기는 준비 단계에만 뜨므로 멈출 게 없지만, 전설 연출은 전투 중에도 뜬다.
   * 별자리(스킬)·옷장·도감·승리 화면도 멈춘다 — 열어 놓고 고민할 시간을 준다 */
  return ui.isMetaOpen() || ui.isSkillOpen() || ui.isClosetOpen() || ui.isSettingsOpen()
    || ui.isRevealOpen() || ui.isBookOpen() || ui.isVictoryOpen() || ui.isDefenseVictoryOpen() || state.phase === 'over';
}

let desktopInfo = null;
const desktopInfoRequest = window.constellationDesktop?.getInfo?.();
if (desktopInfoRequest && typeof desktopInfoRequest.then === 'function') {
  void desktopInfoRequest.then((info) => {
    if (info && typeof info.storagePath === 'string') desktopInfo = info;
    if (ui.isSettingsOpen()) renderSettings();
  }).catch(() => {});
}

function settingsSaveLocation() {
  if (desktopInfo?.storagePath) return desktopInfo.storagePath;
  return window.constellationDesktop ? '데스크톱 앱 데이터 폴더' : '브라우저 사이트 저장소';
}

function renderSettings() {
  ui.renderSettings({
    actions: KEY_ACTIONS.map(({ id, label }) => ({ id, label, key: keyCodeLabel(keyBindings[id]) })),
    bindings: keyBindings,
    captureAction: keyCaptureAction,
    graphics: store.gfx || graphicsQuality,
    reducedEffects,
    systemReduced: systemReducedEffects,
    sfxMuted: isSfxMuted(),
    bgmMuted: isMusicMuted(),
    locale: getLocale(),
    saveLocation: settingsSaveLocation(),
  });
}

function syncShortcutLabels() {
  ui.setShortcutLabels(keyBindings, keyCodeLabel);
  ui.setSpeedLabel(speed, keyCodeLabel(keyBindings.speed));
}

function setEffectsPreference(next) {
  if (systemReducedEffects) {
    reducedEffects = true;
    ui.toast('🌙 기기의 동작 줄이기 설정을 따르고 있어요.', 'good');
    return false;
  }
  reducedEffects = !!next;
  store.effectsReduced = reducedEffects;
  document.body.classList.toggle('reduced-effects', reducedEffects);
  renderer.setReducedEffects(reducedEffects);
  villageRenderer.setReducedEffects(reducedEffects);
  ui.setEffectsLabel(reducedEffects, false);
  return true;
}

function observePlaySession(now, forceInactive = false) {
  if (!sessionMeter || sessionMeter.finished) return;
  const management = ui.isMetaOpen() || ui.isSkillOpen() || ui.isClosetOpen() || ui.isSettingsOpen()
    || ui.isBookOpen() || ui.isVictoryOpen() || ui.isDefenseVictoryOpen();
  const phase = ui.isStoryOpen() ? 'story'
    : ui.isVillageActive() ? 'village'
      : management ? 'management' : state.phase;
  sessionMeter.observe({
    ...playtestContext(),
    phase,
    active: !forceInactive && !document.hidden && !ui.isStartOpen() && !demo.active && state.phase !== 'over',
  }, now);
}

function updateAutoPhaseFlow(dt) {
  /* 관전 봇은 자체 준비 정책을 쓰며, 사람이 읽거나 선택하는 모달 뒤에서는
   * 카운트다운을 멈춘다. 자동 시작도 수동 버튼과 같은 경로만 호출한다. */
  if (demo.active) {
    autoPhaseClock = createAutoPhaseClock();
    return null;
  }
  const blocked = isPaused() || ui.isStoryOpen() || ui.isStartOpen() || document.hidden;
  autoPhaseClock = advanceAutoPhase(autoPhaseClock, state, dt, blocked);
  if (!autoPhaseClock.key) return null;
  const remaining = autoPhaseClock.remaining;
  if (autoPhaseClock.ready) {
    autoPhaseClock = createAutoPhaseClock();
    tryStartWave();
  }
  return remaining;
}

const STEP = 1 / 60;          // 고정 시뮬레이션 타임스텝
const MAX_STEPS = 8;          // 프레임당 최대 캐치업 (낮은 fps 대비)
let lastT = performance.now();
let simAcc = 0;
let bootT = performance.now();
let frameCount = 0;
/* 폰은 lite 로 이미 결정된 것으로 친다 — 실측해서 high 로 올릴 이유가 없다 */
let gfxDecided = store.gfx != null || urlGfx != null || isMobile;

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min((now - lastT) / 1000, 0.5);
  lastT = now;
  frameCount++;
  syncPlaceBar();
  observePlaySession(now);

  /* 그래픽 자동 품질: 시작 4초 후부터 3초간 실측 fps */
  if (!gfxDecided) {
    const elapsed = (now - bootT) / 1000;
    if (elapsed > 4) {
      if (!frame._fpsStart) { frame._fpsStart = now; frame._fpsFrames = 0; }
      frame._fpsFrames++;
      const win = (now - frame._fpsStart) / 1000;
      if (win > 3) {
        gfxDecided = true;
        const avg = frame._fpsFrames / win;
        const q = avg < 45 ? 'lite' : 'high';
        store.gfx = q;
        if (q === 'lite') { renderer.setQuality('lite'); ui.toast('⚙️ 부드러운 화면을 위해 그래픽을 조절했어요.'); }
        /* lite 로 낮춰도 안 되는 기기: 배경 장식까지 접는다.
         * 지형과 카메라가 같이 바뀌는 일이라 실행 중엔 못 바꾸고 다음 실행부터다. */
        if (avg < 26 && renderer.decor) {
          store.decorOff = true;
          ui.toast('⚙️ 다음에 켤 때는 배경을 더 가볍게 할게요.');
        }
      }
    }
  }

  /* 데모는 모달이 열려도 흐름을 관리해야 한다. */
  if (demo.active) demo.step(realDt);

  if (!isPaused() && !perfMode) {
    /* 고정 타임스텝: fps가 낮아도 게임 속도는 유지 */
    simAcc = Math.min(simAcc + realDt * speed, STEP * MAX_STEPS);
    while (simAcc >= STEP) {
      simAcc -= STEP;
      const events = E.tick(state, STEP);
      if (events.length) {
        renderer.onEvents(state, events);
        handleEvents(events);
      }
      if (isPaused()) { simAcc = 0; break; }
    }
    /* 저체력 심장박동 & Audio Lowpass Flow. 시각 오버레이는 사용하지 않는다. */
    const ratio = state.castleMax ? state.castleHp / state.castleMax : 1;
    updateAudioFlow(ratio);
    if (ratio < 0.3 && state.phase === 'wave') {
      heartbeatT -= realDt * speed;
      if (heartbeatT <= 0) { heartbeatT = 1.0; SFX.heartbeat(); }
    }
  }

  /* 보스 상태 → 음악/체력바. 전장 전체의 색·조명은 바꾸지 않는다. */
  const greatBoss = state.enemies.find(e => e.boss && !e.dead);
  const midBoss = greatBoss ? null : state.enemies.find(e => e.midBoss && !e.dead);

  if (!isMusicMuted()) {
    if (state.phase === 'wave') {
      music.setTrack(greatBoss ? 'boss' : (midBoss ? 'midboss' : 'battle'));
    } else if (state.phase === 'prep') music.setTrack('prep');
  }

  const autoPhaseRemaining = updateAutoPhaseFlow(realDt);

  /* UI 갱신 */
  ui.updateHud(state, store.shards, store.best(state.difficulty));
  ui.updateChampChip(state);
  ui.setWaveUI(state, autoPhaseRemaining);
  ui.comboChip(state.combo.count, state.combo.count >= D.COMBO.x3At ? 3 : state.combo.count >= D.COMBO.x2At ? 2 : 1);
  const barBoss = greatBoss || midBoss;
  ui.setBossBar(barBoss ? {
    ratio: barBoss.hp / barBoss.maxHp,
    name: barBoss.name,
    emoji: D.ENEMY_TYPES[barBoss.type].emoji,
    great: !!barBoss.boss,
    enraged: !!barBoss.enraged,
  } : null);
  panelT += realDt;
  if (panelT > 0.35) {           // 골드 변동에 따른 버튼 활성화 갱신
    panelT = 0;
    ui.renderCastlePanel(state);
    if (selHero != null) ui.renderHeroPanel(state, selHero);
    ui.renderCombatSkillDock(state);
  }

  if (ui.isVillageActive()) {
    if (!isPaused()) ui.updateVillage(realDt);
    villageRenderer.frame(isPaused() ? 0 : realDt);
  } else {
    renderer.sync(state);
    renderer.frame(isPaused() ? 0 : realDt * speed, state);
    recordPerformanceProbe(now);
  }
}

/* ---------- 시작 ----------
 * 자동 저장이 있으면 "이어하기 / 처음부터"를 먼저 묻는다.
 * 데모 링크(?demo=)는 구경이 목적이니 메뉴 없이 바로 시작한다. */
const bootSave = (() => {
  if (urlParams.has('demo') || judgeMode || previewChapter) return null;
  const s = store.autosave;
  return s && Number.isFinite(s.wave) && Array.isArray(s.bench) ? s : null;
})();
newGame(store.diff, { holdStory: !!bootSave || !!previewChapter });

/* 전술판은 웨이브 동안만 손을 받는다. 이벤트는 기존 렌더러와 사운드 경로로
 * 흘려 보내므로, 새 퍼즐도 원래 전장의 별똥별·피격·회복 연출을 똑같이 쓴다. */
tactics = createTacticFlow({
  getPhase: () => state.phase,
  random: () => state.rng(),
  resolveTactic: (lane, type, size) => E.castTactic(state, lane, type, size),
  toast: (msg, tone) => ui.toast(msg, tone),
  onCast(result, type, lane, size) {
    sessionMeter?.action('tacticCasts');
    SFX.tactic(type, size);
    renderer.tacticCast(state, result, type, lane, size);
    renderer.onEvents(state, result.events);
    handleEvents(result.events);
    tacticFeedback.showCast(result, type, lane, size);
    demo.onTacticCast(type, lane, size);
    ui.toast(`${['☄️ 유성', '❄️ 서리', '🛡️ 수호'][['flare','tide','bloom'].indexOf(type)]} 성좌 ${size}개 — ${['왼쪽','가운데','오른쪽'][lane]} 길 전술 발동!`, 'good');
    refreshAll();
  },
  onMatch(type, lane, size) {
    SFX.match(type, size);
    tacticFeedback.announceMatch(type, lane, size);
  },
  onSwap(from, to, groups) {
    sessionMeter?.action('tacticSwaps');
    if (judgeMode) document.body.classList.remove('judge-opening');
    weeklyReplay?.record({ wave: state.wave, time: state.time, from, to, groups });
  },
  onPreview(type, lane, size) {
    SFX.tactic(type, size);
    renderer.tacticCast(state, null, type, lane, size);
    tacticFeedback.showPreview(type, lane, size);
    ui.toast(`✨ 테스트 연출 · ${['☄️ 유성', '❄️ 서리', '🛡️ 수호'][['flare','tide','bloom'].indexOf(type)]} ${size}개`, 'good');
  },
});
if (judgeMode) {
  /* Skip menus and story, but keep the real journey, wave, swap, and tactic paths. */
  ui.hideStory();
  ui.hideStart();
  E.travelJourney(state, 'meadow');
  E.prepareJourneyBattle(state);
  prepareJudgeWave(state);
  refreshAll();
  /* The direct review route skips menus, not the first-defense countdown.
   * Reviewers can still use the same manual-start override as normal play. */
  /* 성능 비교는 로딩 시간 차이 때문에 서로 다른 전투 시점을 재지 않도록
   * 같은 시드의 초반 전투를 고정 틱만큼 진행한 뒤 엔진 상태를 멈춘다. */
  if (perfMode) {
    for (let tick = 0; tick < 120; tick++) E.tick(state, STEP);
    refreshAll();
  }
  tactics.setOpening(JUDGE_OPENING);
  document.body.classList.add('judge-mode', 'judge-opening');
}
if (bootSave) ui.showStart(bootSave);
/* 별지기 꾸미기 적용 — 옷장에서 고른 모습·이름으로 시작한다 (초상 실패 시 이모지) */
{
  const cfg = store.champCfg;
  renderer.setChampLook(cfg.look);
  ui.setChampFace(champPortrait(cfg.look));
  ui.setChampName(D.champNameOf(cfg.name));
}
ui.setSoundLabels(isSfxMuted(), isMusicMuted());
ui.setEffectsLabel(reducedEffects, systemReducedEffects);
syncShortcutLabels();
ui.coachChip();
requestAnimationFrame(frame);

/* 첫 사용자 입력에서 오디오 잠금 해제 */
window.addEventListener('pointerdown', async () => {
  music.sync();
  await prepareSfxSamples();
  if (audioProbe) audioProbe.textContent = JSON.stringify(sfxSampleSnapshot());
}, { once: true });

/* 폰트를 미리 받아 둔다.
 * 브라우저는 "화면에 실제로 그려질 때"만 폰트를 내려받는다. 그냥 두면 ① 첫 문제창이 열리는
 * 순간 기본 폰트로 그려졌다가 바뀌고(아이가 문제를 읽는 바로 그 타이밍에 깜빡인다)
 * ② 3D 캔버스에 그리는 글자는 아예 폴백 폰트로 구워져 텍스처에 박힌다. */
if (document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load('16px Jua', 'Constellation Defense'),
    document.fonts.load('700 27px Gaegu', 'CONSTELLATION'),
  ]).catch(() => {});
}

/* ---------- 데모 배선 ----------
 * 데모에게 게임 내부를 열어 주지 않는다. 사람이 누르는 것과 같은 함수만 넘긴다 —
 * 그래야 "데모에서만 되는" 또는 "데모에서만 안 되는" 버그가 안 생긴다. */
demo.attach({
  getState: () => state,
  isStoryOpen: () => ui.isStoryOpen(),
  isRevealOpen: () => ui.isRevealOpen(),
  closeStory,
  summon: doSummon,
  place(heroId, pad) { selBench = heroId; doPlace(pad); },
  combine(action) { doCombineDirect(action); },
  castle(key) { handlers.onCastle(key); },
  spell: doSpell,
  ult: doUlt,
  skill(key) { handlers.onSkillPick(key); },
  heroSkill(heroId, key) { handlers.onHeroSkill(heroId, key); },
  heroActive: doHeroActive,
  monsterBlueprint: doMonsterBlueprint,
  constellationAid: doConstellationAid,
  feast: doFeast,
  journeyTravel(id) { handlers.onJourneyTravel(id); },
  journeyRecruit(key) { handlers.onJourneyRecruit(key); },
  journeyPath(key) { return handlers.onJourneyPath(key); },
  journeyNext() { return handlers.onJourneyNextChapter(); },
  journeyEnding(key) { return handlers.onJourneyEnding(key); },
  startWave: tryStartWave,
  newGame: () => newGame(store.diff),
  comboLabel: (c) => (c.kind === 'rankup'
    ? `${D.CLASSES[c.cls].name} ${D.TIERS[c.resultTier].name}`
    : `${D.CLASSES[c.result].name}`),
  heroLabel: (h) => `${h.name || D.CLASSES[h.cls].name} · Lv ${h.level || 1}`,
  onCaption: (title, detail, tone) => ui.setDemoCaption(title, detail, tone),
  getTacticBoard: () => tactics ? tactics.getBoard() : [],
  tacticSwap(from, to) { return tactics ? tactics.swap(from, to) : false; },
  onStart(profile) {
    ui.setDemoMode(true, profile);
    setSellMode(false);
    deselectAll();
    ui.restoreTab();
  },
  onStop() {
    ui.setDemoMode(false);
    setSellMode(false);
    deselectAll();
  },
});

/* ?demo=고수 로 열면 바로 시작. 콘솔에서는 __game.demo.start('보통') */
if (urlParams.has('demo')) {
  setTimeout(() => demo.start(urlParams.get('demo') || '고수'), 900);
}

/* 디버그 훅 (자동 검증/테스트용) */
window.__game = {
  get state() { return state; },
  E, D, renderer, ui, SFX, demo, assets: assetLoader,
  env: { isMobile, decor: useDecor, quality: renderer.quality, artMode, judgeMode, weeklyChallenge, locale, playtestRoute, playtestExperience },
  exportWeeklyReplay() { return weeklyReplay?.export() || null; },
  playtest: {
    snapshot: () => sessionMeter?.snapshot() || null,
    export: () => playtestLog.export(),
  },
  sfxCore: { getAc, getMaster, isSfxMuted, isMusicMuted, sampleSnapshot: sfxSampleSnapshot },
  records: { codex, earned },
  refresh: refreshAll,
  selectHero(id) { selHero = id; renderer.setSelectedHero(id); ui.renderHeroPanel(state, id); },
  gold(n) { state.gold += n; refreshAll(); },
  jump(w) { state.wave = w; refreshAll(); },
  hurt(n) { state.castleHp = Math.max(0, state.castleHp - n); if (state.castleHp <= 0) { state.phase = 'over'; state.shardsEarned = D.shardReward(state.wave, state.bossKills); onGameOver(); } },
  /* 규칙·상태는 바꾸지 않는 시각 연출 훅. 6은 영웅 문양 미리보기다. */
  previewTactic(kind = 'flare', lane = 1, size = 3) { return tactics.preview(kind, lane, size); },
};
