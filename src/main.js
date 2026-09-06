/* Main controller wires engine, 3D rendering, UI and sound. */
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
import { CastlePreview } from './gfx/castle-preview.js';
import { adoptPlayerIdentity, initNeonStore, knownPlayerToken } from './app/neon-store.js';
import { startExposedLaneDemo } from './app/neon-scenario.js';
import { initNeonTour } from './app/neontour.js';
import { initDedicatedClient } from './app/dedicated-client.js';
import { initDedicatedOverlay } from './app/dedicated-overlay.js';

registerDucker((amt, dur) => music.duck(amt, dur));

/* Initialization. */
const urlParams = new URLSearchParams(location.search);
const requestedLocale = urlParams.get('lang');
const locale = normalizeLocale(requestedLocale || store.language);
if (requestedLocale) store.language = locale;
const ui = new UI();
const tacticFeedback = createTacticFeedback();
installDocumentLocalization(locale);
/* ?dedicated=1 turns this page into a viewer of the dedicated server; the
 * parameter value may override the ws:// address for remote hosts. */
const dedicatedRoute = urlParams.has('dedicated');
const dedicatedUrl = (urlParams.get('dedicated') || '').startsWith('ws')
  ? urlParams.get('dedicated') : `ws://${location.hostname || '127.0.0.1'}:8643`;
let remoteView = false;
let dedicatedClient = null;
/* In dedicated mode every store call travels over the gateway socket; the
 * store UI stays identical and only the wire changes. The client may boot
 * before the socket exists, so the transport waits for it briefly. */
async function gatewayStoreTransport(path, options) {
  for (let attempt = 0; attempt < 100 && !dedicatedClient; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!dedicatedClient) return { status: 0, ok: false, data: { error: 'gateway unavailable' } };
  return dedicatedClient.store(path, options);
}
let castlePreview = null;
const neonStore = initNeonStore({ locale,
  transport: dedicatedRoute ? gatewayStoreTransport : null,
  onPreview: container => { castlePreview = new CastlePreview(container, renderer.castle); },
  onEntitlements: items => {
    /* In dedicated mode the battlefield castle wears the session's shared
     * cosmetics from snapshots; the store close-up stays personal. */
    if (!remoteView) renderer.cosmetics.setEntitlements(items);
    castlePreview?.setEntitlements(items);
  },
});
window.addEventListener('pagehide', () => castlePreview?.dispose(), { once: true });
/* Override graphics with ?gfx=high|lite|min; min is for tests and very slow devices. */
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
/* Default to restrained effects; explicit vivid effects never override the operating system's reduced-motion preference. */
let reducedEffects = systemReducedEffects || store.effectsReduced !== false;
document.body.classList.toggle('reduced-effects', reducedEffects);
const weeklyReplay = weeklyChallenge ? createSwapReplay(weeklyChallenge.id) : null;
const sessionEligible = !judgeMode && !previewChapter && !urlParams.has('demo')
  && !urlParams.has('perf') && !urlParams.has('sessionqa') && !dedicatedRoute;
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
/* Start muted for automation or ?mute without changing the user's saved sound preferences. */
if (urlParams.has('mute') || urlParams.has('rafshim')) forceMute();

/* Disable expensive scenery on phones and reclaim the sky band for larger touch targets. ?decor=on/off overrides the default for comparison. */
function detectMobile() {
  /* ?mobile=1 exercises mobile behavior on a desktop whose pointer remains fine even at narrow widths. */
  const forced = urlParams.get('mobile');
  if (forced != null) return !/^(0|off|no|false)$/i.test(forced);
  try {
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* Fallback when matchMedia is unavailable. */ }
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent || '');
}
const urlDecor = urlParams.get('decor');
const isMobile = detectMobile();
const useDecor = urlDecor != null ? !/^(0|off|no|false)$/i.test(urlDecor)
                                  : (!isMobile && !store.decorOff);
const graphicsQuality = urlGfx || (store.gfx === 'lite' || (isMobile && store.gfx == null) ? 'lite' : 'high');
/* The validated art-v2 pilot is the default; ?art=procedural supports comparison/recovery without requesting the manifest. */
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
  /* Start phones in lite immediately instead of exposing a slow high-quality opening before adaptation. */
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

/* ?perf=1 exposes a ten-second fixed-seed render probe through DOM output, avoiding browser automation that mutates internal game objects. */
const perfProbe = perfMode ? (() => {
  const output = document.createElement('output');
  output.id = 'perf-probe';
  output.hidden = true;
  document.body.appendChild(output);
  const bootAt = 0; // performance.now() is relative to navigationStart.
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
let selBench = null;      // Benched hero awaiting placement.
let selHero = null;       // Hero shown in the information panel, from bench or field.
let hoverHeroId = null;   // Deployed hero shown in the tooltip.
let overHandled = false;
let heartbeatT = 0;
let panelT = 0;
let sellMode = false;         // Bulk sell mode turns bench cards into checkboxes.
const sellSel = new Set();    // Selected hero IDs for selling.
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

/* Reevaluate cheap achievement predicates on hero creation, tactics, wave completion, level-up, defeat and victory. Automated demo play does not count toward persistent achievements. */
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
    /* Include completed waves during the current run because the best record is otherwise updated only at defeat. */
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

/* Achievements unlock wardrobe options, but never relock an already-equipped option from before this feature existed. */
function closetLock(axis, key) {
  const lock = D.WARDROBE_LOCKS[axis] && D.WARDROBE_LOCKS[axis][key];
  if (!lock || earned[lock.key]) return null;
  if (D.champLookOf(store.champCfg.look)[axis] === key) return null;
  return lock;
}

/* Shared session cleanup for new games, loading and Star Trials. */
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

/* Start legacy army mode with two heroes to avoid an empty bench and initialize collection records. */
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
  gameOverToken++;                 // Invalidate delayed defeat presentation before starting another run.
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
  /* Defer the prologue behind the resume menu so overlays do not overlap. */
  if (!opts.holdStory) playStory('prologue');
}

/* Star Trials preserve champion growth, reset army/gold/castle and scale enemies by loop. */
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
  autoSave();                      // The trial's first preparation is the new resume point.
  checkAchievements();
}

/* Entering sell mode clears placement/movement selection to keep one active interaction mode. */
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
  /* Remove sold/combined heroes from stale sell selections. */
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

/* Interludes are denser early and sparser later; seenStory prevents repeats so the game does not become constant skipping. */
let storyResume = null;
function playStory(key, onDone = null) {
  if (store.storyOff || !Story.beat(key, getLocale())) { if (onDone) onDone(); return false; }
  if (!state.seenStory) state.seenStory = new Set();
  if (state.seenStory.has(key)) { if (onDone) onDone(); return false; }
  state.seenStory.add(key);
  storyResume = onDone;
  /* Substitute the wardrobe's champion name into story text. */
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

/* Legendary/mythic reveals cancel pending automatic progression, then resume the normal flow when closed. */
let revealResume = null;
function playReveal(hero, onDone) {
  if (store.storyOff) { onDone(); return; }
  if (!state.revealed) state.revealed = new Set();
  const key = `${hero.cls}:${hero.tier}`;
  const short = state.revealed.has(key);       // Shorten repeat reveals.
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

/* Champion spells are unavailable while knocked out; always explain failure reasons. */
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

/* Wardrobe previews render immediately, but only Save applies the selection. Closing cancels the draft. */
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
  /* Enforce wardrobe locks beyond the disabled button as well. */
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

/* Feast actions. */
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
  recordHeroBorn(r.hero);              // Feast promotions can unlock a new codex entry.
  const C = D.CLASSES[r.hero.cls];
  ui.toast(`🎉 잔치! ${C.emoji} ${C.name}가 신나게 먹고 ${D.TIERS[r.hero.tier].name}(으)로 승급! (💰-${r.cost})`, 'good');
  renderer.onEvents(state, r.events);
  handleEvents(r.events);
  refreshAll();
}

/* Player actions. */
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
  /* Scale presentation with tier. */
  renderer.summonBurst(r.hero.tier);
  ui.summonReveal(r.hero, r.hero.tier);
  ui.toast(`${T.name} 등급 ${C.name} ${C.emoji} 등장!`, r.hero.tier >= 2 ? 'good' : '');
  if (r.hero.tier === 3) ui.toast(`👑 전설! [${D.LEGEND_ABILITIES[r.hero.cls].name}] ${D.LEGEND_ABILITIES[r.hero.cls].desc}`, 'good');
  refreshAll();
}

/* Combining remains a preparation economy choice; real-time match-3 provides combat interaction and risk management without a question gate. */
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
  /* An occupied pad means swap, not rejection. Bench-to-field swaps preserve bench size and work when full. */
  const occ = E.padOccupant(state, padIndex);
  if (occ) {
    const s = E.swapBenchWithPad(state, selBench, padIndex);
    if (!s.ok) return;
    SFX.place();
    padFx(s.placed, 0x9fdcff);
    ui.toast(`🔀 ${D.CLASSES[s.placed.cls].name} 배치 · ${D.CLASSES[s.benched.cls].name}은 벤치로!`);
    deselectAll();      // Clear selection after placement to prevent the next click from moving another hero accidentally.
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

/* Selecting a deployed hero highlights empty move pads in green and occupied swap pads in blue. */
function selectField(hero) {
  if (hero) setSellMode(false);        // Starting placement or movement exits sell mode.
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

/* Move to empty pads or swap with occupied ones, then clear selection to prevent unintended subsequent moves. */
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

/* Drag movement and swapping. */
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
  if (id == null || selHero !== id || cx == null) return;   // A null client x coordinate means the drag was cancelled.
  const pad = renderer.screenToPad(cx, cy);
  const hero = state.field.find(h => h.id === id);
  if (pad == null || !hero || pad === hero.padIndex) return;   // Dropping on the same pad only selects the hero.
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

/* Download preparation snapshots as JSON and restore from the file. Device-level shards and records remain in localStorage; the file contains only the current run. */
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
  gameOverToken++;                     // Invalidate delayed defeat presentation before loading a run.
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
  autoSave();                          // Update the resume point to the loaded snapshot.
  return true;
}

/* Serialize preparation state immediately after waves, then defer localStorage writes with an idle timeout. Flush on pagehide so deferred work is not lost. Clear autosave on defeat. */
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
  /* Victory owns wave-30 story scheduling; scheduling separately from waveEnd would overlap modals. */
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
        if (!demo.active) codexAddKill(ev.etype);   // Automated demo kills do not count toward the monster codex.
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
        autoSave();                      // Each completed wave creates a resume point.
        checkAchievements();
        refreshAll();
        if (demo.active) demo.guide('waveFlow');
        /* Delay slightly to avoid overlapping clear feedback; preparation has no running combat simulation. */
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

      /* The engine announces victory; main applies shards, records, story and the next-loop offer. Show the unseen wave-30 story before the victory screen. */
      case 'victory': {
        store.victories = store.victories + 1;
        if ((ev.loop || 0) >= 1) store.trialClears = store.trialClears + 1;
        store.shards = store.shards + ev.shards;
        checkAchievements();
        flushRecords();
        const vLoop = ev.loop || 0, vShards = ev.shards;
        setTimeout(() => playStory('w30', () => {
          if (state.phase === 'over') return;      // Avoid overlapping defeat even if the state changed unexpectedly.
          SFX.shard();
          renderer.celebrate(0xffd93d, true);
          ui.showVictory({ loop: vLoop, shards: vShards, state });
          ui.updateHud(state, store.shards, store.best(state.difficulty));
        }), 700);
        break;
      }

      /* Champion feedback. */
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
  pendingAutosave = null;              // Discard queued snapshots so defeat cannot restore a stale resume point.
  store.autosave = null;               // Remove defeated runs from resume storage.
  store.shards = store.shards + state.shardsEarned;
  checkAchievements();
  flushRecords();                      // Defeat is a reliable point to flush codex and achievement records.
  const best = store.best(state.difficulty);
  if (state.wave > best) store.setBest(state.difficulty, state.wave);
  /* A player may restart during the 900ms defeat delay. Check the session token so the old overlay cannot cover the new run. */
  const overToken = ++gameOverToken;
  setTimeout(() => {
    if (overToken !== gameOverToken || state.phase !== 'over') return;
    SFX.shard();
    if (!document.body.classList.contains('tour-on')) ui.showOver(state);
    ui.updateHud(state, store.shards, store.best(state.difficulty));
  }, 900);
}

/* UI bindings. */
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
  /* When recipe materials are missing, guide the player toward summoning without promising a random class result. */
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
      /* The third argument enables swap mode, highlighting occupied pads in blue. */
      renderer.setPlacementMode(true, hero ? D.CLASSES[hero.cls].range : 0, true);
      renderer.setSelectedHero(null);
    }
    ui.renderBench(state, selBench);
    ui.renderHeroPanel(state, selHero);
  },
  /* After selecting a deployed hero: click an empty pad to move, another hero to swap, or the same hero to deselect. Hover provides information without changing selection. */
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
    /* Hover a deployed hero for details. */
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
  /* Bulk selling. */
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
    if (!state.bench.length) setSellMode(false);   // Exit sell mode when the selection is exhausted.
    refreshAll();
  },
  onSave: saveGame,
  onLoad: loadGame,
  /* Champion actions. */
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
  /* Show the startup menu only when autosave exists. */
  onContinue() {
    ui.hideStart();
    SFX.tap();
    /* If autosave is corrupt, continue with the already-prepared new run. */
    if (!loadGame(store.autosave, { replaceSession: true })) playStory('prologue');
  },
  onStartNew() {
    ui.hideStart();
    SFX.tap();
    playStory('prologue');   // Boot already created the new game.
  },
  onCastle(key) {
    const r = E.castleUpgrade(state, key);
    if (!r.ok) {
      if (r.reason === 'gold') ui.toast('골드가 부족해요!', 'bad');
      return;
    }
    SFX.upgrade();
    /* Show an upgrade visually so its effect is more than a changed number. */
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
  /* Codex and records. */
  onBookOpen() {
    ui.renderBook({ state, codex, earned });
    ui.showBook();
    SFX.tap();
  },
  /* Thirtieth-dawn victory. */
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

/* Keyboard controls. */
let kbPad = null;                     // Keyboard placement cursor.

/* Arrow navigation includes all pads except the selected hero's own. Enter moves/places on empty pads or swaps on occupied pads, keeping keyboard functionality equivalent to pointer input. */
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
  setSellMode(false);                  // Starting placement with Tab exits sell mode.
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

/* Derive placement guidance from current state every frame and update DOM only when text changes. Central derivation avoids stale guidance across many selection paths. */
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

/* Cycle deployed heroes with F to choose a movement or upgrade target. */
function cycleField(dir) {
  if (!state.field.length) { ui.toast('배치된 용사가 없어요.', 'bad'); return; }
  const sorted = [...state.field].sort((a, b) => a.padIndex - b.padIndex);
  let idx = sorted.findIndex(h => h.id === selHero);
  idx = (idx + dir + sorted.length) % sorted.length;
  selectField(sorted[idx]);
  kbPad = null;
}

function tryStartWave() {
  if (ui.isStoryOpen() || ui.isRevealOpen()) return;   // Do not start a wave behind an open presentation.
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

/* Blur clicked buttons so Space does not activate them again. */
document.addEventListener('click', (ev) => {
  if (ev.target instanceof HTMLButtonElement) ev.target.blur();
});

document.addEventListener('keydown', (ev) => {
  /* Viewer mode: the server plays; local game hotkeys stay off. */
  if (remoteView) return;
  const key = ev.key;

  /* Store physical key codes so shortcuts work consistently with Korean IME and English layouts. Reserve Escape, Enter, Space, Tab and arrows for UI navigation. */
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

  /* Startup menu: resume or start over. */
  if (ui.isStartOpen()) {
    if (key === 'Escape') { ev.preventDefault(); ui.el.newGameBtn.click(); }
    return;               // Focused buttons handle Enter and Space themselves.
  }

  /* Any key may dismiss a legendary/mythic reveal. */
  if (ui.isRevealOpen()) {
    ev.preventDefault();
    closeReveal();
    return;
  }

  /* Interlude story. */
  if (ui.isStoryOpen()) {
    if (key === 'Escape' || key === 'Enter' || key === ' ') { ev.preventDefault(); closeStory(); }
    return;                       // Consume other keys so a wave cannot start behind the story.
  }

  /* Victory: Enter/Escape continues defense; require pointer input for a new trial to prevent accidental resets. */
  if (ui.isVictoryOpen()) {
    if (key === 'Escape' || key === 'Enter' || key === ' ') { ev.preventDefault(); handlers.onVictoryContinue(); }
    return;
  }

  /* Codex and records. */
  if (ui.isBookOpen()) {
    if (key === 'Escape' || key === 'Enter' || shortcutAction === 'codex') { ev.preventDefault(); ui.hideBook(); }
    return;
  }

  /* Wardrobe modal: text-input keys stay in the field; Escape reaches this handler. */
  if (ui.isClosetOpen()) {
    if (key === 'Escape') { ev.preventDefault(); closeCloset(); }
    else if (key === 'Enter') { ev.preventDefault(); saveCloset(); }
    return;
  }

  /* Constellation skill-tree modal. */
  if (ui.isSkillOpen()) {
    if (key === 'Escape' || key === 'Enter' || shortcutAction === 'skills') { ev.preventDefault(); ui.hideSkills(); }
    return;
  }

  /* Star Blessings modal. */
  if (ui.isMetaOpen()) {
    if (key === 'Escape' || key === 'Enter') { ev.preventDefault(); ui.hideMeta(); return; }
    const n = Number(key);
    if (n >= 1 && n <= 4) {
      const btns = ui.el.metaRows.querySelectorAll('button');
      if (btns[n - 1] && !btns[n - 1].disabled) btns[n - 1].click();
    }
    return;
  }

  /* Defeat screen. */
  if (state.phase === 'over') {
    if (key === 'Enter' || key === ' ') { ev.preventDefault(); SFX.tap(); newGame(store.diff); }
    return;
  }

  /* Gameplay controls. */
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
        doMove(kbPad);                      // Move the selected deployed hero to the keyboard pad.
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

/* Game loop. */
function isPaused() {
  /* Pause for reveals and decision-heavy skill, wardrobe, codex and victory modals so players can read safely. */
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
  /* The spectator bot has its own preparation policy. Pause countdowns behind reading/choice modals; automatic starts use the same command as the manual button. */
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

const STEP = 1 / 60;          // Fixed simulation timestep.
const MAX_STEPS = 8;          // Bound per-frame catch-up work at low FPS.
let lastT = performance.now();
let simAcc = 0;
let bootT = performance.now();
let frameCount = 0;
/* Mobile starts in lite; do not promote it to high based on the opening measurement. */
let gfxDecided = store.gfx != null || urlGfx != null || isMobile;

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min((now - lastT) / 1000, 0.5);
  lastT = now;
  frameCount++;
  syncPlaceBar();
  observePlaySession(now);

  /* Measure automatic graphics quality for three seconds after the first four seconds. */
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
        /* If lite remains too slow, disable scenery on the next launch because changing terrain and camera requires reconstruction. */
        if (avg < 26 && renderer.decor) {
          store.decorOff = true;
          ui.toast('⚙️ 다음에 켤 때는 배경을 더 가볍게 할게요.');
        }
      }
    }
  }

  /* The demo still manages its flow while modals are open. */
  if (demo.active) demo.step(realDt);

  if (remoteView) {
    /* The dedicated server owns the simulation. Between its snapshots only
     * enemy motion is interpolated; no game rule runs in this browser. */
    dedicatedClient?.smooth(realDt);
  } else if (!isPaused() && !perfMode) {
    /* Fixed-step simulation maintains game speed independently of rendering FPS. */
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
    /* Low-health heartbeat and audio lowpass use no visual overlay. */
    const ratio = state.castleMax ? state.castleHp / state.castleMax : 1;
    updateAudioFlow(ratio);
    if (ratio < 0.3 && state.phase === 'wave') {
      heartbeatT -= realDt * speed;
      if (heartbeatT <= 0) { heartbeatT = 1.0; SFX.heartbeat(); }
    }
  }

  /* Boss state affects music and health bars, never global battlefield color or lighting. */
  const greatBoss = state.enemies.find(e => e.boss && !e.dead);
  const midBoss = greatBoss ? null : state.enemies.find(e => e.midBoss && !e.dead);

  if (!isMusicMuted()) {
    if (state.phase === 'wave') {
      music.setTrack(greatBoss ? 'boss' : (midBoss ? 'midboss' : 'battle'));
    } else if (state.phase === 'prep') music.setTrack('prep');
  }

  const autoPhaseRemaining = remoteView ? null : updateAutoPhaseFlow(realDt);

  /* UI updates. */
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
  if (panelT > 0.35) {           // Refresh button availability when gold changes.
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

/* Offer resume when autosave exists. Demo URLs skip the startup menu for immediate viewing. */
const bootSave = (() => {
  if (urlParams.has('demo') || judgeMode || previewChapter || dedicatedRoute) return null;
  const s = store.autosave;
  return s && Number.isFinite(s.wave) && Array.isArray(s.bench) ? s : null;
})();
newGame(store.diff, { holdStory: !!bootSave || !!previewChapter || dedicatedRoute });

/* The tactics board accepts input only during waves and sends results through existing render/sound event paths. */
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
  /* Performance comparisons advance an identical seeded opening by fixed ticks, then freeze the engine so loading differences do not change the measured scene. */
  if (perfMode) {
    for (let tick = 0; tick < 120; tick++) E.tick(state, STEP);
    refreshAll();
  }
  tactics.setOpening(JUDGE_OPENING);
  document.body.classList.add('judge-mode', 'judge-opening');
}
if (bootSave) ui.showStart(bootSave);
/* Apply saved champion appearance and name; use emoji if portrait rendering fails. */
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

/* Unlock audio on the first user gesture. */
window.addEventListener('pointerdown', async () => {
  music.sync();
  await prepareSfxSamples();
  if (audioProbe) audioProbe.textContent = JSON.stringify(sfxSampleSnapshot());
}, { once: true });

/* Preload fonts before visible UI or canvas text needs them to avoid late font swaps and permanently baked fallback glyphs. */
if (document.fonts && document.fonts.load) {
  Promise.all([
    document.fonts.load('16px Jua', 'Constellation Defense'),
    document.fonts.load('700 27px Gaegu', 'CONSTELLATION'),
  ]).catch(() => {});
}

/* Inject only normal player command functions into the demo, preserving the same execution paths as manual play. */
demo.attach({
  getState: () => state,
  isStoryOpen: () => ui.isStoryOpen(),
  isRevealOpen: () => ui.isRevealOpen(),
  /* The store belongs to the viewer: while it is open the bot holds still instead of restarting under a purchase. */
  isStoreOpen: () => !!neonStore?.isOpen?.(),
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

/* ?demo=expert starts spectating unless the dedicated viewer owns the flow. With ?tour=neon the bot plays while the inspector
 * observes; its Play buttons stop the bot and hand the defense to the viewer. Console callers may use __game.demo.start('expert'). */
if (urlParams.has('demo') && !dedicatedRoute) {
  setTimeout(() => demo.start(urlParams.get('demo') || '고수', { cards: urlParams.get('tour') !== 'neon' }), 900);
}

/* Debug hooks for automated validation and testing. */
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
  /* Presentation-only tactic preview; size 6 previews a Hero Sigil without changing rules or state. */
  previewTactic(kind = 'flare', lane = 1, size = 3) { return tactics.preview(kind, lane, size); },
};

/* Payment narration only: observe the wave without changing simulation state. */
if (urlParams.get('tour') === 'neon') {
  initNeonTour({
    locale,
    openStore: () => { closeStory(); ui.hideOver(); neonStore?.open(); },
    closeStore: () => neonStore?.close(),
    refreshStore: () => neonStore?.refresh(),
    spectating: () => demo.active,
    riskyDefense: () => {
      demo.stop(); closeStory();
      startExposedLaneDemo({
        newGame: () => newGame('normal', { holdStory: true }),
        travel: id => handlers.onJourneyTravel(id),
        heroes: () => state.field,
        move: (id, pad) => { selectField(state.field.find(hero => hero.id === id)); doMove(pad); },
        doubleSpeed: () => { if (speed !== 2) handlers.onSpeed(); },
        startWave: tryStartWave,
      });
    },
    play: () => {
      demo.stop();
      if (state.phase === 'over') newGame(store.diff, { holdStory: true });
      closeStory(); ui.hideOver();
      const next = E.journeyChoices(state).find(node => node.kind === 'battle' || node.kind === 'boss');
      if (next) handlers.onJourneyTravel(next.id);
      tryStartWave();
    },
    stage: { snapshot: () => ({ wave: state.wave, hp: state.castleHp, maxHp: state.castleMax, phase: state.phase }) },
  });
}

/* ?dedicated=1 — render the dedicated server's authoritative session.
 * The local engine stays idle; snapshots overwrite the volatile state the
 * renderer and HUD already read. The overlay explains the architecture and
 * offers the switch back to an ordinary local game. */
if (dedicatedRoute) {
  remoteView = true;
  ui.hideStart();
  closeStory();
  ui.setDemoMode(true, locale === 'en' ? 'server' : '서버');
  let refreshHold = 0;
  const overlay = initDedicatedOverlay({
    locale,
    backUrl: location.href,
    client: { command: (op, args) => dedicatedClient
      ? dedicatedClient.command(op, args)
      : Promise.resolve({ ok: false, error: 'disconnected' }) },
    onOpenStore: () => { closeStory(); ui.hideOver(); neonStore?.open(); },
    onTryGame: () => {
      remoteView = false;
      dedicatedClient?.disconnect();
      overlay.minimize();
      ui.setDemoMode(false);
      newGame(store.diff, { replaceSession: true });
    },
  });
  dedicatedClient = initDedicatedClient({
    url: dedicatedUrl,
    key: urlParams.get('key') || null,
    playerToken: knownPlayerToken(),
    api: {
      getState: () => state,
      /* The gateway announces (or switches) the store account for this
       * connection; persisting it keeps client-mode purchases on it too. */
      onStoreIdentity: (playerId) => adoptPlayerIdentity(playerId),
      onBoard: (cells) => { if (remoteView) tactics?.setBoard(cells); },
      onPhase: () => {
        if (!remoteView) return;
        closeStory();
        ui.hideOver();
        ui.hideDefenseVictory();
        refreshAll();
        refreshHold = performance.now();
      },
      onEvents: (events) => { if (remoteView) renderer.onEvents(state, events); },
      onDecision: (decision) => {
        if (!remoteView) return;
        const text = overlay.caption(decision);
        if (text) ui.setDemoCaption(text, '', decision.action === 'tactic' ? 'action' : 'guide');
        if (decision.action === 'tactic') {
          for (const cast of decision.casts || []) {
            if (!cast.ok) continue;
            SFX.tactic(cast.kind, cast.size);
            renderer.tacticCast(state, null, cast.kind, cast.route, cast.size);
            tacticFeedback.showPreview(cast.kind, cast.route, cast.size);
          }
        }
        if (decision.action === 'startWave') SFX.waveStart();
      },
      onSession: () => { if (remoteView) refreshAll(); },
      onStatus: (status) => overlay.setStatus(status),
      onSnapshot: (snapshot) => {
        if (!remoteView) return;
        /* The shared castle wears every cosmetic delivered through this
         * server's gateway — the same truth for every viewer. */
        if (Array.isArray(snapshot.cosmetics)) {
          renderer.cosmetics.setEntitlements(Object.fromEntries(snapshot.cosmetics.map((key) => [key, true])));
        }
        overlay.setLive({
          wave: snapshot.wave, castleHp: Math.ceil(snapshot.castleHp),
          castleMax: snapshot.castleMax, phase: snapshot.phase,
          tick: snapshot.tick, viewers: snapshot.viewers || 0,
        });
        /* Panels rebuild at most once a second; the HUD already updates every frame. */
        if (performance.now() - refreshHold > 1000) {
          refreshHold = performance.now();
          refreshAll();
        }
      },
    },
  });
}
