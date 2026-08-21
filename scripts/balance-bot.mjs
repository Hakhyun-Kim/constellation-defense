/* =====================================================
 * Constellation Defense 밸런스 봇
 *
 * 실제 엔진과 실제 3매치 보드 규칙을 함께 사용한다. 전술은 임의로 시전하지
 * 않는다: 매번 현재 보드에서 유효한 인접 스왑을 찾고, 그 스왑이 만든 각 매치가
 * Flare/Tide/Bloom으로 해당 방어로에 적용된다.
 *
 * 사용법: node scripts/balance-bot.mjs [runs] [difficulty] [profile] [check]
 * ===================================================== */
import * as D from '../src/data.js';
import * as E from '../src/engine.js';
import * as Bot from '../src/bot.js';
import { createStableBoard, findLegalSwaps, findMatchGroups, laneForGroup, refillCells, tacticSizeForGroup } from '../src/tactics/board.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function prepActions(state, profile) {
  for (let key = Bot.nextSkill(state); key; key = Bot.nextSkill(state)) {
    if (!E.takeSkill(state, key).ok) break;
  }
  if (state.squad) {
    for (const key of Bot.castlePlan(state, profile)) E.castleUpgrade(state, key);
    return;
  }
  while (Bot.wantsSummon(state, profile)) {
    if (!E.summon(state).ok) break;
  }
  for (let round = 0; round < 6; round++) {
    const combo = Bot.chooseCombo(state);
    if (!combo || state.rng() >= profile.combineChance) break;
    const result = combo.kind === 'recipe'
      ? E.combineRecipe(state, combo.result)
      : E.combineRankUp(state, combo.cls, combo.tier);
    if (!result.ok) break;
  }
  Bot.placeAll(state, profile.sloppy || 0);
  for (const key of Bot.castlePlan(state, profile)) E.castleUpgrade(state, key);
  if (Bot.wantsFeast(state, profile)) E.holdFeast(state);
}

/* The player may only commit specialization points while standing in the
 * authored town.  Mirror that restriction here so balance results never use
 * a hidden out-of-combat advantage. */
function spendTownSpecializations(state) {
  const node = E.journeyNode(state?.journey?.current, state);
  if (state.phase !== 'journey' || node?.kind !== 'town' || state.journey.pendingRecruit) return;
  for (let choice = Bot.nextHeroSkill(state); choice; choice = Bot.nextHeroSkill(state)) {
    if (!E.takeHeroSkill(state, choice.heroId, choice.key).ok) break;
  }
}

/* 화면 어댑터의 resolveQueue와 같은 순서다. 독립 매치는 타입·대상 방어로를
 * 섞지 않고 각각 해소한 뒤, 보충 때문에 새 매치가 생기면 연쇄로 처리한다. */
export const TACTIC_POLICIES = ['none', 'random', 'threat'];

function lanePressure(state) {
  return [0, 1, 2].map(route => (state.enemies || [])
    .filter(enemy => !enemy.dead && enemy.route === route)
    .reduce((sum, enemy) => sum + 1 + ((enemy.s || 0) / D.ROUTE_LENS[route]) * 2.5
      + (enemy.boss ? 4 : enemy.midBoss ? 2 : 0), 0));
}

export function choosePolicySwap(policy, state, board, profile, rng, legalMoves = findLegalSwaps(board)) {
  if (policy === 'none' || !legalMoves.length) return null;
  if (policy === 'random') {
    if (rng() > profile.tacticUse) return null;
    return legalMoves[Math.floor(rng() * legalMoves.length)];
  }
  return Bot.chooseTacticSwap(state, board, profile, rng);
}

export function resolveTacticSwap(state, move, onCast = null) {
  let cells = move.cells;
  let groups = move.groups;
  let casts = 0;
  for (let cascade = 0; groups.length && cascade < 12; cascade++) {
    for (const group of groups) {
      const kind = cells[group[0]];
      const route = laneForGroup(group);
      const size = tacticSizeForGroup(group);
      const result = E.castTactic(state, route, kind, size);
      if (result.ok) casts++;
      onCast?.({
        cascade: cascade + 1,
        kind,
        route,
        size,
        ok: result.ok,
        reason: result.reason || null,
      });
      cells = refillCells(cells, group, state.rng);
    }
    groups = findMatchGroups(cells);
  }
  return { cells, casts };
}

export function playRun(profileName, difficulty, seed, options = {}) {
  const waveCap = options.waveCap ?? 40;
  const chapterCap = Math.max(1, Math.min(D.JOURNEY_CHAPTERS.length, options.chapterCap ?? 1));
  const tacticPolicy = options.tacticPolicy ?? 'threat';
  const trace = options.trace ? [] : null;
  let heroSigils = 0;
  const profile = Bot.PROFILES[profileName];
  const state = E.createGame({ rng: Bot.mulberry32(seed), difficulty });

  let board = createStableBoard(state.rng);
  let stalemate = false;
  while (state.phase !== 'over' && state.wave <= waveCap && !stalemate) {
    if (state.phase === 'journey' && state.journey?.complete) {
      const chapterIndex = D.JOURNEY_CHAPTERS.findIndex((chapter) => chapter.id === state.journey.chapter);
      if (chapterIndex >= 0 && chapterIndex + 1 < chapterCap) {
        if (!E.advanceJourneyChapter(state).ok) { stalemate = true; break; }
        continue;
      }
      break;
    }
    /* 지도 선택과 영입도 실제 플레이와 같은 순수 엔진 명령으로 처리한다. */
    if (state.phase === 'journey') {
      spendTownSpecializations(state);
      const path = Bot.nextJourneyPath(state);
      if (path) {
        if (!E.chooseJourneyPath(state, path.key).ok) { stalemate = true; break; }
      } else if (state.journey?.pendingRecruit) {
        const key = Bot.nextJourneyRecruit(state);
        if (!key || !E.recruitJourneyHero(state, key).ok) { stalemate = true; break; }
      } else {
        const node = Bot.nextJourneyNode(state);
        if (!node) { stalemate = true; break; }
        const move = E.travelJourney(state, node.id);
        if (!move.ok) { stalemate = true; break; }
        if (move.type === 'battle' && !E.prepareJourneyBattle(state).ok) { stalemate = true; break; }
      }
      continue;
    }
    prepActions(state, profile);
    E.startWave(state);
    let actionTimer = 0;
    let waveClock = 0;
    while (state.phase === 'wave') {
      E.tick(state, 0.05);
      actionTimer += 0.05;
      waveClock += 0.05;
      if (waveClock > 900) { stalemate = true; break; }
      /* 실제 보드 애니메이션과 플레이어 판단 간격을 반영한다. 매 틱마다 스왑하면
       * 손이 없는 봇만 초당 수십 번 전술을 쓰게 되어 사람 플레이 기준선이 아니다. */
      if (actionTimer < 6) continue;
      actionTimer = 0;

      const legalMoves = findLegalSwaps(board);
      const decision = trace && {
        wave: state.wave,
        second: Number(waveClock.toFixed(1)),
        policy: tacticPolicy,
        castleHp: Math.round(state.castleHp),
        lanePressure: lanePressure(state).map(value => Number(value.toFixed(2))),
        legalSwaps: legalMoves.length,
      };
      const swap = choosePolicySwap(tacticPolicy, state, board, profile, state.rng, legalMoves);
      if (swap) {
        if (decision) {
          decision.swap = { from: swap.from, to: swap.to };
          decision.casts = [];
        }
        board = resolveTacticSwap(state, swap, cast => {
          if (cast.ok && cast.size === 6) heroSigils++;
          decision?.casts.push(cast);
        }).cells;
      }
      if (decision) trace.push(decision);

      if (Bot.wantsUlt(state, profile)) E.castUlt(state);
      else if (Bot.wantsStar(state, profile)) E.castStar(state);

      const heroActive = Bot.nextHeroActive(state, profile, state.rng);
      if (heroActive) E.castHeroActive(state, heroActive.heroId);

      const blueprint = Bot.nextMonsterBlueprint(state, profile, state.rng);
      if (blueprint) E.castMonsterBlueprint(state, blueprint.route);

      const constellationAid = Bot.nextConstellationAid(state, profile, state.rng);
      if (constellationAid) E.castConstellationAid(state, constellationAid.route);

      if (profile.midWave && Bot.wantsSummon(state, profile)) {
        if (E.summon(state).ok) Bot.placeAll(state, profile.sloppy || 0);
      }
    }
  }
  const finalChapterIndex = D.JOURNEY_CHAPTERS.findIndex((chapter) => chapter.id === state.journey?.chapter);
  return {
    wave: Math.min(state.wave, waveCap + 1),
    survived: (!!state.journey?.complete && finalChapterIndex + 1 >= chapterCap) || state.wave > waveCap,
    tactics: state.tacticCasts,
    heroSigils,
    blueprints: state.blueprintCasts || 0,
    constellationAids: state.constellationAidCasts || 0,
    chapter: state.journey?.chapter || null,
    node: state.journey?.current || null,
    castleHp: Math.round(state.castleHp || 0),
    reachedAct2: finalChapterIndex >= 1,
    trace,
  };
}

const percentile = (items, p) => {
  const sorted = [...items].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const average = (items) => items.reduce((sum, item) => sum + item, 0) / items.length;

export function runProfile(profile, difficulty, runs, options = {}) {
  const waves = [];
  const survived = [];
  const tactics = [];
  const heroSigils = [];
  const blueprints = [];
  const constellationAids = [];
  const reachedAct2 = [];
  const nodeCounts = {};
  for (let index = 0; index < runs; index++) {
    const result = playRun(profile, difficulty, index * 7919 + 13, options);
    waves.push(result.wave);
    survived.push(result.survived ? 1 : 0);
    tactics.push(result.tactics);
    heroSigils.push(result.heroSigils);
    blueprints.push(result.blueprints);
    constellationAids.push(result.constellationAids);
    reachedAct2.push(result.reachedAct2 ? 1 : 0);
    nodeCounts[result.node || 'none'] = (nodeCounts[result.node || 'none'] || 0) + 1;
  }
  const survivedRate = average(survived);
  const reachedAct2Rate = average(reachedAct2);
  return {
    profile,
    difficulty,
    mean: average(waves).toFixed(1),
    p25: percentile(waves, 0.25), p50: percentile(waves, 0.5), p75: percentile(waves, 0.75),
    min: Math.min(...waves), max: Math.max(...waves),
    survivedRate,
    survivedPct: `${(survivedRate * 100).toFixed(0)}%`,
    reachedAct2Rate,
    reachedAct2Pct: `${(reachedAct2Rate * 100).toFixed(0)}%`,
    tacticMean: average(tactics).toFixed(1),
    heroSigilMean: average(heroSigils).toFixed(1),
    blueprintMean: average(blueprints).toFixed(1),
    constellationAidMean: average(constellationAids).toFixed(1),
    nodeCounts,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
const args = process.argv.slice(2);
const checkMode = args.includes('check');
const runs = Number(args.find(arg => /^\d+$/.test(arg))) || 150;
const difficultyArg = args.find(arg => ['easy', 'normal', 'hard'].includes(arg));
const difficulties = difficultyArg ? [difficultyArg] : ['easy', 'normal', 'hard'];
const profileArg = args.find(arg => Object.hasOwn(Bot.PROFILES, arg));
const profiles = profileArg ? [profileArg] : Object.keys(Bot.PROFILES);

let baseline = null;
if (checkMode) {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'balance-baseline.json');
  baseline = JSON.parse(readFileSync(path, 'utf8'));
}

console.log(`\n=== Constellation Defense 밸런스 봇 (판수: ${runs}${checkMode ? ', 기준선 검증' : ''}) ===\n`);
let drift = false;
for (const difficulty of difficulties) {
  for (const profile of profiles) {
    const result = runProfile(profile, difficulty, runs);
    const baselineKey = `${difficulty}/${profile}`;
    const expected = baseline && baseline.medians[baselineKey];
    const completionMin = baseline?.completionMins?.[baselineKey];
    const outOfRange = expected != null && Math.abs(result.p50 - expected) > baseline.tolerance;
    const completionLow = completionMin != null && result.survivedRate * 100 < completionMin;
    if (outOfRange || completionLow) drift = true;
    const checks = [];
    if (expected != null) checks.push(outOfRange
      ? `⚠ 중앙값 ${expected} ±${baseline.tolerance} 이탈`
      : `✓ 중앙값 ${expected} ±${baseline.tolerance}`);
    if (completionMin != null) checks.push(completionLow
      ? `⚠ 완주율 ${completionMin}% 미만`
      : `✓ 완주율 ${completionMin}% 이상`);
    const check = checks.length ? `  ${checks.join(' · ')}` : '';
    console.log(`[${D.DIFFICULTIES[difficulty].name}] ${result.profile} 평균 ${result.mean}웨이브`
      + ` (p25 ${result.p25} / 중앙 ${result.p50} / p75 ${result.p75}) 범위 ${result.min}~${result.max}`
      + ` · 첫 원정 완수 ${result.survivedPct} · 평균 전술 ${result.tacticMean}회`
      + ` · 영웅 문양 ${result.heroSigilMean}회${check}`);
  }
  console.log('');
}
if (checkMode) {
  console.log(drift ? '❌ 밸런스가 기준선에서 벗어났습니다.' : '✅ 모든 항목이 기준선 안에 있습니다.');
  if (drift) process.exitCode = 1;
}
}
