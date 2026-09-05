/* Pure AI decisions shared by the headless balance bot and browser demo. No DOM, timers or Node APIs. Expose both batch prepActions and streamed nextPrepAction so both clients use the same policy. */
import * as D from './data.js';
import * as E from './engine.js';
import { findLegalSwaps, findMatchGroups, laneForGroup, refillCells, tacticSizeForGroup } from './tactics/board.js';

/* Seeded randomness makes repeated runs deterministic. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Player profiles: combineChance is combination probability; reserve is unspent gold; useCastle selects all, repair-only or no upgrades; midWave enables combat actions; sloppy controls random placement; tacticUse and tacticSloppy control legal-swap frequency and quality. */
export const PROFILES = {
  '초보': { combineChance: 0.15, reserve: 0,   useCastle: false,        midWave: false, sloppy: 0.5, spellUse: 0.3, activeUse: 0.3, tacticUse: 0.32, tacticSloppy: 0.65 },
  '보통': { combineChance: 0.70, reserve: 50,  useCastle: 'repairOnly', midWave: false, sloppy: 0.3, spellUse: 0.6, activeUse: 0.68, tacticUse: 0.68, tacticSloppy: 0.22 },
  '고수': { combineChance: 1.00, reserve: 100, useCastle: true,         midWave: true,  sloppy: 0,   spellUse: 0.95, activeUse: 0.96, tacticUse: 0.96, tacticSloppy: 0.03 },
};

/* Placement favors pads covering the greatest weighted path length within the class's range. */
const coverageCache = new Map();
export function rankedPads(range) {
  if (!coverageCache.has(range)) {
    const scored = D.PADS.map((pad, i) => ({ i, cover: D.padCoverage(pad, range) }))
      .sort((a, b) => b.cover - a.cover);
    coverageCache.set(range, scored);
  }
  return coverageCache.get(range);
}

/* Assign stronger heroes to better pads first. */
export const benchOrder = (state) => [...state.bench].sort((a, b) => b.tier - a.tier);

/* Choose placement without mutating engine state. */
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

/* Combination selection shares E.bestCombo with the game. */
export const chooseCombo = E.bestCombo;

/* Castle policy returns an action key without executing engine commands. */
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

/* Champion skills follow SKILL_PLAN as one representative player build. */
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

/* Use Starfall against gathered enemies; reserve Galaxy for bosses or large crowds. */
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

/* Map decisions use public information only, prioritizing recruitable allies, then supplies and battles. */
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

/* Tactics candidates are legal adjacent swaps from pure board rules. Choose using visible lane threats and castle health. */
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

/* Named swap policies shared by the balance gate, its reports, and the
 * dedicated host — one implementation for every consumer of "how the bot
 * decides to swap". */
export const TACTIC_POLICIES = ['none', 'random', 'threat'];

export function choosePolicySwap(policy, state, board, profile, rng, legalMoves = findLegalSwaps(board)) {
  if (policy === 'none' || !legalMoves.length) return null;
  if (policy === 'random') {
    if (rng() > profile.tacticUse) return null;
    return legalMoves[Math.floor(rng() * legalMoves.length)];
  }
  return chooseTacticSwap(state, board, profile, rng);
}

/* Resolve one chosen swap the way the view adapter does: independent matches
 * first, then refill cascades, each cast through the ordinary engine command. */
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

/* Stream one preparation action at a time so summoning, combining and placement remain visible. null means preparation is complete. */
export function nextPrepAction(state, P, rng = Math.random) {
  /* Learn free champion skills first. */
  const sk = nextSkill(state);
  if (sk) return { type: 'skill', key: sk, skill: D.CHAMP_SKILLS[sk] };

  if (state.squad) {
    const squadPlan = castlePlan(state, P);
    return squadPlan.length ? { type: 'castle', key: squadPlan[0] } : null;
  }

  /* Summon to fill the bench. */
  if (wantsSummon(state, P)) return { type: 'summon' };

  /* Combine when eligible according to the profile probability. */
  const combo = chooseCombo(state);
  if (combo && rng() < P.combineChance) {
    return { type: 'combine', action: E.comboToAction(combo), combo };
  }

  /* Place remaining benched heroes on good pads. */
  for (const h of benchOrder(state)) {
    const pad = pickPad(state, h, P.sloppy || 0, rng);
    if (pad != null) return { type: 'place', heroId: h.id, pad, hero: h };
  }

  /* Manage castle upgrades. */
  const plan = castlePlan(state, P);
  if (plan.length) return { type: 'castle', key: plan[0] };

  /* Feast only after other preparation with gold remaining. */
  if (wantsFeast(state, P)) return { type: 'feast' };

  return null;
}

/* The expert profile can summon using surplus gold during combat. */
export function midWaveAction(state, P) {
  if (!P.midWave) return null;
  return wantsSummon(state, P) ? { type: 'summon' } : null;
}

/* Only full castle-management profiles feast, with enough gold left afterward. */
export function wantsFeast(state, P) {
  if (P.useCastle !== true || state.phase !== 'prep') return false;
  if (state.feastWave === state.wave) return false;
  const cost = D.feastCost(state.wave);
  if (state.gold < cost + 600) return false;
  return [...state.bench, ...state.field].some(h => h.tier < D.maxTierOf(h.cls));
}
