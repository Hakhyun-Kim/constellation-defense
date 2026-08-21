/* =====================================================
 * AI 플레이어의 판단 — 밸런스 봇과 데모 모드가 함께 쓴다
 *
 * 여기 있는 것은 전부 순수 판단이다. DOM·타이머·Node API를 쓰지 않는다.
 * 그래서 헤드리스 밸런스 봇(scripts/balance-bot.mjs)과
 * 브라우저 데모(src/demo.js)가 **같은 뇌**를 쓸 수 있다.
 * 판단이 두 벌로 갈라지면 "봇은 통과하는데 화면에선 이상한" 상황이 생긴다.
 *
 * 밸런스 봇은 한 번에 다 해치우고(batch), 데모는 프레임마다 하나씩 먹는다(stream).
 * 그래서 같은 정책을 두 모양으로 노출한다 — prepActions(배치) / nextPrepAction(스트림).
 * ===================================================== */
import * as D from './data.js';
import * as E from './engine.js';
import { findLegalSwaps, laneForGroup, tacticSizeForGroup } from './tactics/board.js';

/* 결정적 난수 — 같은 시드는 같은 판을 만든다 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 가상 플레이어 프로필 ----------
 * combineChance  조합할 기회가 왔을 때 실제로 할 확률
 * reserve        소환에 쓰지 않고 남겨 두는 골드
 * useCastle      true=전부 / 'repairOnly'=수리만 / false=안 씀
 * midWave        전투 중에도 소환·배치하는가
 * sloppy         배치를 아무 데나 할 확률
 *
 * tacticUse      전투 중 합법 전술 스왑을 시도할 확률
 * tacticSloppy   더 낮은 기대값의 유효 스왑을 고를 확률
 */
export const PROFILES = {
  '초보': { combineChance: 0.15, reserve: 0,   useCastle: false,        midWave: false, sloppy: 0.5, spellUse: 0.3, activeUse: 0.3, tacticUse: 0.32, tacticSloppy: 0.65 },
  '보통': { combineChance: 0.70, reserve: 50,  useCastle: 'repairOnly', midWave: false, sloppy: 0.3, spellUse: 0.6, activeUse: 0.68, tacticUse: 0.68, tacticSloppy: 0.22 },
  '고수': { combineChance: 1.00, reserve: 100, useCastle: true,         midWave: true,  sloppy: 0,   spellUse: 0.95, activeUse: 0.96, tacticUse: 0.96, tacticSloppy: 0.03 },
};

/* ---------- 배치 정책 ----------
 * 각 발판이 그 직업의 사거리로 덮는 "길의 길이"를 재서 큰 쪽부터 채운다. */
const coverageCache = new Map();
export function rankedPads(range) {
  if (!coverageCache.has(range)) {
    const scored = D.PADS.map((pad, i) => ({ i, cover: D.padCoverage(pad, range) }))
      .sort((a, b) => b.cover - a.cover);
    coverageCache.set(range, scored);
  }
  return coverageCache.get(range);
}

/* 센 용사부터 좋은 자리에 */
export const benchOrder = (state) => [...state.bench].sort((a, b) => b.tier - a.tier);

/* 이 용사를 어디에 놓을까 — 엔진을 건드리지 않고 자리만 고른다 */
export function pickPad(state, hero, sloppy = 0, rng = Math.random) {
  const free = (i) => !E.padOccupant(state, i);
  if (sloppy && rng() < sloppy) {
    const empties = D.PADS.map((_, i) => i).filter(free);
    return empties.length ? empties[Math.floor(rng() * empties.length)] : null;
  }
  const slot = rankedPads(D.CLASSES[hero.cls].range).find(r => free(r.i));
  return slot ? slot.i : null;
}

export function placeAll(state, sloppy = 0) {
  for (const h of benchOrder(state)) {
    const pad = pickPad(state, h, sloppy, state.rng);
    if (pad != null) E.placeHero(state, h.id, pad);
  }
}

/* 조합 선택 — 게임(main.js)과 같은 판단을 쓴다 (E.bestCombo) */
export const chooseCombo = E.bestCombo;

/* ---------- 성 관리 ----------
 * 엔진을 부르지 않고 "무엇을 할지" 키만 돌려준다. */
export function castlePlan(state, P) {
  const out = [];
  if (!P.useCastle) return out;
  if (state.castleHp < state.castleMax * 0.5 && state.gold > 100) out.push('repair');
  if (P.useCastle === true) {
    if (state.wave >= 4 && state.castle.tower < 1 && state.gold > 250) out.push('tower');
    if (state.wave >= 8 && state.castle.tower < 2 && state.gold > 400) out.push('tower');
    if (state.wave >= 6 && state.castle.fortify < 3 && state.gold > 350) out.push('fortify');
  }
  return out;
}

export const wantsSummon = () => false;

/* ---------- 별지기 ----------
 * 스킬은 정해진 순서(SKILL_PLAN)로 찍는다 — 사람마다 다르지만 봇은 무난한 한 길이면 된다. */
export function nextSkill(state) {
  const c = state.champ;
  if (!c || c.sp < 1) return null;
  for (const key of D.SKILL_PLAN) {
    const SK = D.CHAMP_SKILLS[key];
    if ((c.skills[key] || 0) >= SK.max) continue;
    if (E.branchSpent(c, SK.branch) < SK.need) continue;
    return key;
  }
  return null;
}

/* 전투 중 마법 판단: 별똥별은 적이 몇이라도 몰리면, 은하수는 보스나 대부대가 있을 때 */
export function nextHeroSkill(state) {
  for (const hero of state.field) {
    if (hero.sp < 1) continue;
    for (const key of D.HERO_SKILL_KEYS) {
      const skill = D.HERO_SKILLS[key];
      if (skill.cls !== hero.cls) continue;
      if ((hero.skills[key] || 0) >= skill.max || hero.level < skill.level) continue;
      return { heroId: hero.id, key, hero, skill };
    }
  }
  return null;
}

export function nextJourneyHeroSkill(state) {
  const node = E.journeyNode(state?.journey?.current, state);
  if (state?.phase !== 'journey' || node?.kind !== 'town') return null;
  const choice = nextHeroSkill(state);
  if (!choice) return null;
  return node.facilities?.includes(D.facilityForHero(choice.hero.heroKey)) ? choice : null;
}

export function wantsStar(state, P) {
  const c = state.champ;
  if (!c || c.ko || c.spellCd > 0) return false;
  return state.enemies.filter(e => !e.dead).length >= 3 && state.rng() < P.spellUse;
}
export function wantsUlt(state, P) {
  const c = state.champ;
  if (!c || c.ko || c.ult < 1) return false;
  const boss = state.enemies.some(e => (e.boss || e.midBoss) && !e.dead);
  const horde = state.enemies.filter(e => !e.dead).length >= 10;
  return (boss || horde) && state.rng() < P.spellUse;
}

export function nextHeroActive(state, P, rng = state.rng || Math.random) {
  if (state?.phase !== 'wave' || !state.enemies.some((enemy) => !enemy.dead)) return null;
  if (rng() > (P.activeUse || 0)) return null;
  const hero = state.field.find((entry) => D.heroActiveSpec(entry.heroKey) && (entry.activeCd || 0) <= 0);
  return hero ? { heroId: hero.id, hero, spec: D.heroActiveSpec(hero.heroKey) } : null;
}

export function nextMonsterBlueprint(state, P, rng = state.rng || Math.random) {
  const status = E.canCastMonsterBlueprint(state);
  if (!status.ok || rng() > (P.activeUse || 0)) return null;
  return { spec: status.spec, route: status.target.route };
}

/* A completed constellation is deliberately held for a boss, unless the
 * castle is already in a critical lane-pressure situation.  This keeps the
 * balance bot on the same information and strategic timing as a player. */
export function nextConstellationAid(state, P, rng = state.rng || Math.random) {
  const status = E.canCastConstellationAid(state);
  if (!status.ok || rng() > (P.activeUse || 0)) return null;
  const boss = state.enemies.some((enemy) => !enemy.dead && (enemy.boss || enemy.midBoss));
  const critical = state.castleHp / state.castleMax <= .38;
  return boss || critical ? { route: status.target.route } : null;
}

/* 지도에서도 사람과 봇이 같은 공개 정보만 사용한다. 영입 가능한 동료가
 * 있는 길을 먼저 택하고, 그 다음 보급과 전투를 고른다. */
const JOURNEY_KIND_PRIORITY = {
  town: 0,
  recruit: 0,
  treasure: 1,
  camp: 2,
  battle: 3,
  boss: 4,
};

export function nextJourneyNode(state) {
  const choices = E.journeyChoices(state);
  return [...choices].sort((a, b) =>
    (JOURNEY_KIND_PRIORITY[a.kind] ?? 9) - (JOURNEY_KIND_PRIORITY[b.kind] ?? 9)
    || a.id.localeCompare(b.id))[0] || null;
}

export function nextJourneyRecruit(state) {
  const node = E.journeyNode(state?.journey?.pendingRecruit, state);
  if (!node?.offers) return null;
  const owned = new Set(state.field.map((hero) => hero.heroKey));
  return node.offers
    .filter((key) => !owned.has(key))
    .sort((a, b) => (a === 'doyun' ? -1 : b === 'doyun' ? 1 : 0))[0] || null;
}

export function nextJourneyPath(state) {
  const journey = state?.journey;
  const node = E.journeyNode(journey?.current, state);
  if (!node?.choices || journey.flags?.[node.id]) return null;
  /* Stable route for reproducible runs. The market route lets campaign bots
   * exercise the same monster-blueprint command exposed to players. */
  return node.choices.find((choice) => choice.key === 'market') || node.choices[0] || null;
}

/* The bot has no hidden preference signal. The coauthor ending is the stable
 * default because it keeps the public weekly/async continuation available. */
export function nextJourneyEnding(state) {
  return state?.journey?.complete && !state.journey.ending ? 'coauthor' : null;
}

/* ---------- 별자리 전술 ----------
 * 후보는 순수 보드 규칙이 보장한 '유효한 인접 스왑'뿐이다. 적이 어느 길에서
 * 성에 가까운지와 성 체력만 사용해 사람과 같은 공개 정보로 고른다. */
function lanePressure(state, lane) {
  return state.enemies
    .filter(enemy => !enemy.dead && enemy.route === lane)
    .reduce((sum, enemy) => sum + 1 + (enemy.s / D.ROUTE_LENS[lane]) * 2.5
      + (enemy.boss ? 4 : enemy.midBoss ? 2 : 0), 0);
}

function groupScore(state, cells, group) {
  const type = cells[group[0]];
  const lane = laneForGroup(group);
  const stars = tacticSizeForGroup(group);
  const pressure = lanePressure(state, lane);
  if (type === 'flare') {
    const targetCount = D.TACTICS.flare.targetCount[stars];
    return pressure * ((Number.isFinite(targetCount) ? targetCount : 8) + stars * 0.5);
  }
  if (type === 'tide') return pressure * (1.4 + stars * 0.35);
  const missingHp = state.castleMax - state.castleHp;
  return pressure * (0.8 + stars * 0.2) + missingHp / 18;
}

export function chooseTacticSwap(state, cells, P, rng = state.rng || Math.random) {
  if (!state || state.phase !== 'wave' || rng() > P.tacticUse) return null;
  const moves = findLegalSwaps(cells);
  if (!moves.length) return null;
  if (rng() < (P.tacticSloppy || 0)) return moves[Math.floor(rng() * moves.length)];
  return moves
    .map(move => ({ move, score: move.groups.reduce((sum, group) => sum + groupScore(state, move.cells, group), 0) }))
    .sort((a, b) => b.score - a.score || a.move.from - b.move.from || a.move.to - b.move.to)[0].move;
}

/* ---------- 준비 단계: 스트림 ----------
 * 한 번에 하나씩만 돌려준다. 데모가 프레임마다 하나씩 소비하면
 * 소환→조합→배치가 사람이 하는 것처럼 순서대로 화면에 보인다.
 * null이면 준비 완료 = 웨이브를 시작해도 된다. */
export function nextPrepAction(state, P, rng = Math.random) {
  /* ⓪ 별지기 스킬 — 공짜 성장이라 제일 먼저 */
  const sk = nextSkill(state);
  if (sk) return { type: 'skill', key: sk, skill: D.CHAMP_SKILLS[sk] };

  if (state.squad) {
    const squadPlan = castlePlan(state, P);
    return squadPlan.length ? { type: 'castle', key: squadPlan[0] } : null;
  }

  /* ① 소환 — 벤치를 채운다 */
  if (wantsSummon(state, P)) return { type: 'summon' };

  /* ② 조합 — 할 수 있으면 한다 (확률은 프로필이 정한다) */
  const combo = chooseCombo(state);
  if (combo && rng() < P.combineChance) {
    return { type: 'combine', action: E.comboToAction(combo), combo };
  }

  /* ③ 배치 — 벤치에 남은 용사를 좋은 자리에 */
  for (const h of benchOrder(state)) {
    const pad = pickPad(state, h, P.sloppy || 0, rng);
    if (pad != null) return { type: 'place', heroId: h.id, pad, hero: h };
  }

  /* ④ 성 관리 */
  const plan = castlePlan(state, P);
  if (plan.length) return { type: 'castle', key: plan[0] };

  /* ⑤ 잔치 — 할 일이 다 끝났고 골드가 남으면 */
  if (wantsFeast(state, P)) return { type: 'feast' };

  return null;
}

/* 전투 중에는 여유 골드로 소환만 한다 (고수 프로필) */
export function midWaveAction(state, P) {
  if (!P.midWave) return null;
  return wantsSummon(state, P) ? { type: 'summon' } : null;
}

/* ---------- 잔치 ----------
 * 성 관리까지 하는 프로필(고수)만, 잔치 값을 내고도 여유가 남을 때. */
export function wantsFeast(state, P) {
  if (P.useCastle !== true || state.phase !== 'prep') return false;
  if (state.feastWave === state.wave) return false;
  const cost = D.feastCost(state.wave);
  if (state.gold < cost + 600) return false;
  return [...state.bench, ...state.field].some(h => h.tier < D.maxTierOf(h.cls));
}
