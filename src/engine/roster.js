/* Hero management: summoning, combining, placement, selling and feasts. */
import * as D from '../data.js';
import { gainChampXp } from './champion.js';
import { activateResonance, heroStarValue, matchingResonanceLanes } from './resonance.js';
import { createSquadHero, heroGrowthMods, refreshHeroDamage } from './squad.js';

export function makeHero(state, cls, tier) {
  const hero = createSquadHero(state, { cls });
  hero.tier = tier || 0;                 // legacy save/test compatibility; fixed squad always stays tier 0.
  if (hero.tier) hero.dmg = Math.round(D.heroStats(cls, hero.tier).dmg * state.dmgMul);
  return hero;
}

/* Effective modifiers apply legendary overrides, then mythic overrides. */
export function heroMods(h) {
  const C = D.CLASSES[h.cls];
  const growth = heroGrowthMods(h);
  const o = Object.assign(
    {},
    h.tier >= 3 ? (D.LEGEND_OVERRIDES[h.cls] || {}) : {},
    h.tier >= 4 ? (D.MYTHIC_OVERRIDES[h.cls] || {}) : {},
  );
  return {
    atk: C.atk,
    range: C.range,
    spd: C.spd,
    hits: growth.hits ?? o.hits ?? C.hits ?? 1,
    burn: growth.burn ?? o.burn ?? C.burn ?? 0,
    slowOnHit: growth.slowOnHit ?? o.slowOnHit ?? C.slowOnHit ?? null,
    splash: (C.splash || 0) * (growth.splashMul ?? o.splashMul ?? 1),
    splashSlow: growth.splashSlow ?? o.splashSlow ?? C.splashSlow ?? null,
    healOnKill: growth.healOnKill ?? o.healOnKill ?? C.healOnKill ?? 0,
    pierce: growth.pierce ?? o.pierce ?? C.pierce ?? 1,
    cleave: growth.cleave ?? !!o.cleave,
    aura: o.aura || 0,
    crit: growth.crit ?? o.crit ?? C.crit ?? null,
    block: (o.block ?? C.block) ? {
      ...(o.block ?? C.block),
      period: (o.block ?? C.block).period * (growth.blockPeriodMul ?? 1),
    } : null,
  };
}

/* Expected DPS for tooltips, including criticals and multiple hits. */
export function heroDps(h) {
  const m = heroMods(h);
  const critMul = m.crit ? 1 + m.crit.chance * (m.crit.mul - 1) : 1;
  return Math.round(h.dmg * m.hits * m.spd * critMul * 10) / 10;
}

/* Summoning. */
export function rollTier(state) {
  const p = D.SUMMON_PROBS;
  let r = state.rng() * 100;
  for (let i = 0; i < 4; i++) { r -= p[i]; if (r < 0) return i; }
  return 3;
}

export function summon(state) {
  if (state.squad) return { ok: false, reason: 'fixed-squad' };
  if (state.phase === 'over') return { ok: false, reason: 'over' };
  if (state.gold < D.SUMMON_COST) return { ok: false, reason: 'gold' };
  if (state.bench.length >= D.BENCH_MAX) return { ok: false, reason: 'bench' };
  state.gold -= D.SUMMON_COST;
  const tier = rollTier(state);
  const cls = state.pick(D.GACHA_KEYS);          // Special classes are recipe-only, never summoned.
  const hero = makeHero(state, cls, tier);
  state.bench.push(hero);
  state.summons++;
  return { ok: true, hero };
}

/* Rank-up combines two same-class/same-tier heroes into tier + 1. Recipes combine two different classes of the same tier into a special class at tier + 1. */

/* Materials include bench and field. Prefer bench materials to preserve deployed defenses. */
export function unitsOf(state, cls, tier) {
  return [
    ...state.bench.filter(h => h.cls === cls && h.tier === tier),
    ...state.field.filter(h => h.cls === cls && h.tier === tier),
  ];
}

/* Prefer a deployed material's pad for the result; if both are deployed, favor higher tier and coverage. */
function resultPad(mats, resultCls) {
  const placed = mats.filter(m => Number.isInteger(m.padIndex) && m.padIndex >= 0);
  if (!placed.length) return -1;
  if (placed.length === 1) return placed[0].padIndex;
  const range = D.CLASSES[resultCls].range;
  const best = placed.slice().sort((a, b) =>
    b.tier - a.tier ||
    D.padCoverage(D.PADS[b.padIndex], range) - D.padCoverage(D.PADS[a.padIndex], range)
  )[0];
  return best.padIndex;
}

/* Remove materials from bench and field. */
function consume(state, mats) {
  state.bench = state.bench.filter(h => !mats.includes(h));
  state.field = state.field.filter(h => !mats.includes(h));
}

/* Highest owned tier of a class, or -1 if absent. */
export function bestTierOf(state, cls) {
  let best = -1;
  for (const h of [...state.bench, ...state.field]) {
    if (h.cls === cls && h.tier > best) best = h.tier;
  }
  return best;
}

/* Distinct owned tiers of a class across bench and field. */
function tiersOf(state, cls) {
  const t = new Set();
  for (const h of state.bench) if (h.cls === cls) t.add(h.tier);
  for (const h of state.field) if (h.cls === cls) t.add(h.tier);
  return [...t];
}

/* Recipes require same-tier pairs and produce tier + 1, avoiding consumption of a high-tier hero for a weaker result. Prefer the highest-result pair when several qualify. */
export function bestRecipePair(state, r) {
  const cap = D.maxTierOf(r.result);
  const tb = new Set(tiersOf(state, r.b));
  let best = null;
  for (const t of tiersOf(state, r.a)) {
    if (!tb.has(t)) continue;                        // Same-tier pairs only.
    const resultTier = Math.min(t + 1, cap);
    if (resultTier <= t) continue;                   // Tier ceiling prevents a non-upgrading combination.
    if (!best || resultTier > best.resultTier) best = { ta: t, tb: t, base: t, resultTier };
  }
  return best;
}

/* Recipe UI status is separate from executable listCombos: ready, insufficient gold, missing materials, tier cap, or no same-tier pair. ta/tb are chosen tiers; missing and low explain unavailable materials. */
export function recipeStatus(state, r, cost) {
  const ta = bestTierOf(state, r.a);
  const tb = bestTierOf(state, r.b);
  const missing = [];
  if (ta < 0) missing.push(r.a);
  if (tb < 0) missing.push(r.b);
  if (missing.length) return { state: 'material', missing, ta, tb };

  const pair = bestRecipePair(state, r);
  if (!pair) {
    const base = Math.min(ta, tb);
    const cap = D.maxTierOf(r.result);
    if (base >= cap) return { state: 'cap', missing: [], ta, tb, base, cap };
    return { state: 'gap', missing: [], ta, tb, low: ta <= tb ? r.a : r.b };
  }

  const c = cost != null ? cost : D.combineCost(pair.resultTier, true);
  return {
    state: state.gold >= c ? 'ready' : 'gold',
    missing: [], ta: pair.ta, tb: pair.tb, base: pair.base, resultTier: pair.resultTier, cost: c,
  };
}

/* Convert a listCombos entry to the same action shape used by UI button datasets. */
export function comboToAction(c) {
  return c.kind === 'rankup'
    ? { kind: 'rankup', cls: c.cls, tier: String(c.tier) }
    : { kind: 'recipe', result: c.result };
}

export function listCombos(state) {
  if (state.squad) return [];
  const out = [];
  /* Count rank-up materials across bench and field; all classes share the mythic ceiling. */
  const seen = new Set();
  for (const h of [...state.bench, ...state.field]) {
    const key = `${h.cls}:${h.tier}`;
    if (seen.has(key) || h.tier >= D.maxTierOf(h.cls)) continue;
    seen.add(key);
    if (unitsOf(state, h.cls, h.tier).length >= 2) {
      const cost = D.combineCost(h.tier + 1, false);
      const c = {
        kind: 'rankup', cls: h.cls, tier: h.tier, result: h.cls, resultTier: h.tier + 1,
        cost, affordable: state.gold >= cost,
      };
      out.push(c);
    }
  }
  /* Recipes create a new class from two same-tier materials at tier + 1. */
  for (const r of D.RECIPES) {
    const pair = bestRecipePair(state, r);
    if (!pair) continue;
    const cost = D.combineCost(pair.resultTier, true);
    const c = {
      kind: 'recipe', result: r.result, a: r.a, b: r.b, gen: r.gen,
      tier: pair.base, ta: pair.ta, tb: pair.tb, resultTier: pair.resultTier,
      cost, affordable: state.gold >= cost,
    };
    out.push(c);
  }
  return out;
}

/* Prefer higher result tiers, then special recipes. Game and bot share this selection function. */
export function bestCombo(state) {
  const combos = listCombos(state).filter(c => c.affordable);
  if (!combos.length) return null;
  const opensResonance = (combo) => matchingResonanceLanes(state, combo)
    .some(lane => !state.resonance?.active?.[lane]);
  return combos.sort((a, b) =>
    b.resultTier - a.resultTier ||
    Number(opensResonance(b)) - Number(opensResonance(a)) ||
    (b.kind === 'recipe' ? 1 : 0) - (a.kind === 'recipe' ? 1 : 0)
  )[0];
}

export function combineRankUp(state, cls, tier) {
  if (state.squad) return { ok: false, reason: 'fixed-squad' };
  const mats = unitsOf(state, cls, tier).slice(0, 2);
  if (mats.length < 2 || tier >= D.maxTierOf(cls)) return { ok: false };
  const cost = D.combineCost(tier + 1, false);
  if (state.gold < cost) return { ok: false, reason: 'gold', cost };
  state.gold -= cost;
  /* A rare lucky rank-up jumps two tiers, up to heroic. */
  const lucky = tier + 2 <= D.LUCKY_MAX_TIER && state.rng() < D.LUCKY_JUMP;
  const newTier = lucky ? tier + 2 : tier + 1;
  const pad = resultPad(mats, cls);
  consume(state, mats);
  const hero = makeHero(state, cls, newTier);
  state.bench.push(hero);
  /* If a material was deployed, place the result directly on its pad. */
  if (pad >= 0) placeHero(state, hero.id, pad);
  state.combos++;
  const resonance = activateResonance(state, heroStarValue(cls) * 2);
  return { ok: true, hero, lucky, cost, pad, resonance };
}

/* Recipe results are one tier above their same-tier materials, capped at mythic. */
export function combineRecipe(state, result) {
  if (state.squad) return { ok: false, reason: 'fixed-squad' };
  const R = D.CLASSES[result];
  if (!R || !R.recipe) return { ok: false };
  const r = D.RECIPES.find(x => x.result === result);
  const pair = bestRecipePair(state, r);
  if (!pair) return { ok: false };
  const a = unitsOf(state, r.a, pair.ta)[0];
  const b = unitsOf(state, r.b, pair.tb)[0];
  if (!a || !b || a === b) return { ok: false };
  const cost = D.combineCost(pair.resultTier, true);
  if (state.gold < cost) return { ok: false, reason: 'gold', cost };
  state.gold -= cost;
  const mats = [a, b];
  const pad = resultPad(mats, result);
  consume(state, mats);
  const hero = makeHero(state, result, pair.resultTier);
  state.bench.push(hero);
  if (pad >= 0) placeHero(state, hero.id, pad);
  state.combos++;
  state.discovered.add(result);
  if (R.mythic) state.mythicsMade++;
  else state.specialsMade++;
  const resonance = activateResonance(state, heroStarValue(r.a) + heroStarValue(r.b));
  return { ok: true, hero, cost, pad, resonance };
}

/* Placement, movement, recall and selling. */
export const padOccupant = (state, padIndex) => state.field.find(h => h.padIndex === padIndex);

/* Swap two deployed heroes directly to adjust formation without recalling either. */
export function swapHeroes(state, idA, idB) {
  const a = state.field.find(v => v.id === idA);
  const b = state.field.find(v => v.id === idB);
  if (!a || !b || a === b) return { ok: false };
  const pa = a.padIndex, pb = b.padIndex;
  /* Preserve attack cooldowns so repeated swapping cannot accelerate attacks. */
  a.padIndex = pb; a.x = D.PADS[pb].x; a.y = D.PADS[pb].y;
  b.padIndex = pa; b.x = D.PADS[pa].x; b.y = D.PADS[pa].y;
  return { ok: true, a, b };
}

/* Move a deployed hero to an empty pad without recalling it. */
export function moveHero(state, heroId, padIndex) {
  const h = state.field.find(v => v.id === heroId);
  if (!h) return { ok: false };
  if (padIndex < 0 || padIndex >= D.PADS.length) return { ok: false };
  if (padIndex === h.padIndex) return { ok: false, reason: 'same' };
  const occupant = padOccupant(state, padIndex);
  if (occupant) return { ok: false, reason: 'occupied' };
  h.padIndex = padIndex;
  h.x = D.PADS[padIndex].x;
  h.y = D.PADS[padIndex].y;
  /* Preserve cooldowns during movement to prevent faster attacks. */
  return { ok: true, hero: h };
}

/* Swap a benched hero with an occupied pad. Bench size remains unchanged, so this also works with a full bench. */
export function swapBenchWithPad(state, benchHeroId, padIndex) {
  const idx = state.bench.findIndex(h => h.id === benchHeroId);
  const occ = padOccupant(state, padIndex);
  if (idx < 0 || !occ) return { ok: false };
  const inc = state.bench[idx];
  state.bench.splice(idx, 1);
  state.field = state.field.filter(v => v !== occ);
  occ.padIndex = -1;          // Bench sentinel is -1; null >= 0 would incorrectly count as deployed.
  state.bench.push(occ);
  inc.padIndex = padIndex;
  inc.x = D.PADS[padIndex].x;
  inc.y = D.PADS[padIndex].y;
  /* Inherit the occupied pad's cooldown to prevent combat replacements from accelerating attacks. */
  inc.cd = occ.cd || 0;
  state.field.push(inc);
  return { ok: true, placed: inc, benched: occ };
}

export function placeHero(state, heroId, padIndex) {
  const idx = state.bench.findIndex(h => h.id === heroId);
  if (idx < 0) return { ok: false };
  if (padIndex < 0 || padIndex >= D.PADS.length) return { ok: false };
  if (padOccupant(state, padIndex)) return { ok: false, reason: 'occupied' };
  const h = state.bench[idx];
  state.bench.splice(idx, 1);
  h.padIndex = padIndex;
  h.x = D.PADS[padIndex].x;
  h.y = D.PADS[padIndex].y;
  h.cd = 0;
  state.field.push(h);
  return { ok: true, hero: h };
}

export function recallHero(state, heroId) {
  if (state.squad) return { ok: false, reason: 'fixed-squad' };
  const h = state.field.find(v => v.id === heroId);
  if (!h) return { ok: false };
  if (state.bench.length >= D.BENCH_MAX) return { ok: false, reason: 'bench' };
  state.field = state.field.filter(v => v !== h);
  h.padIndex = -1;
  state.bench.push(h);
  return { ok: true };
}

export function sellHero(state, heroId) {
  if (state.squad) return { ok: false, reason: 'fixed-squad' };
  const h = state.field.find(v => v.id === heroId) || state.bench.find(v => v.id === heroId);
  if (!h) return { ok: false };
  state.field = state.field.filter(v => v !== h);
  state.bench = state.bench.filter(v => v !== h);
  const price = D.SELL_PRICE[h.tier];
  state.gold += price;
  return { ok: true, price };
}

/* Feast once per preparation promotes an eligible random hero in place and grants champion XP. */
export function holdFeast(state) {
  if (state.squad) return { ok: false, reason: 'fixed-squad' };
  if (state.phase !== 'prep') return { ok: false, reason: 'phase' };
  if (state.feastWave === state.wave) return { ok: false, reason: 'done' };
  const cost = D.feastCost(state.wave);
  if (state.gold < cost) return { ok: false, reason: 'gold', cost };
  const cands = [...state.bench, ...state.field].filter(h => h.tier < D.maxTierOf(h.cls));
  if (!cands.length) return { ok: false, reason: 'none', cost };   // Every hero is mythic; nobody can be promoted.
  state.gold -= cost;
  state.feastWave = state.wave;
  state.feasts++;

  /* Weight lower tiers more heavily using state.rng; saved feast eligibility prevents reload rerolls. */
  let total = 0;
  for (const h of cands) total += D.feastTierWeight(h.tier);
  let r = state.rng() * total;
  let hero = cands[cands.length - 1];
  for (const h of cands) {
    r -= D.feastTierWeight(h.tier);
    if (r < 0) { hero = h; break; }
  }
  const from = hero.tier;
  hero.tier++;
  /* Recompute damage from current tier and persistent modifiers. */
  refreshHeroDamage(state, hero);

  const events = [];
  gainChampXp(state, D.feastChampXp(state.wave), events);
  events.push({
    type: 'feast', heroId: hero.id, cls: hero.cls, from, to: hero.tier,
    pad: hero.padIndex, x: hero.x, y: hero.y, cost,
  });
  return { ok: true, hero, from, cost, events };
}
