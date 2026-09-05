/* Game state creation, serialization and restoration. */
import * as D from '../data.js';
import { champStats } from './champion.js';
import { makeHero, padOccupant, placeHero } from './roster.js';
import { createSquadHero, refreshHeroDamage } from './squad.js';
import { buildWave } from './combat.js';
import { createResonance, restoreResonance } from './resonance.js';
import { beginJourneyBattle, createJourney, restoreJourney, serializeJourney } from './journey.js';
import { createRunMemory, restoreRunMemory } from './run-memory.js';

const riFor = (rng) => (a, b) => Math.floor(rng() * (b - a + 1)) + a;
const pickFor = (rng) => (arr) => arr[Math.floor(rng() * arr.length)];

export function createGame(opts = {}) {
  const rng = opts.rng || Math.random;
  const meta = Object.assign(
    { startGold: 0, castleHp: 0, heroDmg: 0, champHp: 0, champDmg: 0, champUlt: 0 },
    opts.metaLevels);
  const diff = D.DIFFICULTIES[opts.difficulty] || D.DIFFICULTIES.normal;
  const castleMax = D.META_UPGRADES.castleHp.apply(meta.castleHp);
  const state = {
    rng, ri: riFor(rng), pick: pickFor(rng),
    difficulty: opts.difficulty || 'normal', diff,
    meta,
    /* Star Trial loop zero is the first journey; enemies.js scales health and gold by loop. */
    loop: Math.max(0, Math.min(99, Math.round(opts.loop || 0))),
    dmgMul: D.META_UPGRADES.heroDmg.apply(meta.heroDmg),

    phase: opts.fixedSquad !== false && opts.journey !== false ? 'journey' : 'prep',
    gold: D.META_UPGRADES.startGold.apply(meta.startGold),
    wave: 1,
    castleHp: castleMax, castleMax,
    castle: { fortify: 0, tower: 0 },
    towerCd: 0,

    nextId: 1,
    bench: [], field: [],
    squad: opts.fixedSquad !== false,
    journey: opts.fixedSquad !== false && opts.journey !== false ? createJourney(opts.journeyChapter) : null,
    enemies: [], projectiles: [],
    spawnQueue: [], waveT: 0,
    pendingWave: null,

    kills: 0, bossKills: 0, midBossKills: 0, summons: 0, combos: 0, goldEarned: 0,
    specialsMade: 0, mythicsMade: 0,
    champKills: 0, starCasts: 0, ultCasts: 0, perfectWaves: 0,
    feasts: 0, feastWave: 0,
    shardsEarned: 0,
    tacticCasts: 0, heroActiveCasts: 0, blueprintCasts: 0, constellationAidCasts: 0,
    blueprintUsedWave: 0, blueprintSummons: [],
    constellationAid: { charge: 0 }, constellationAids: [],
    runMemory: createRunMemory(),
    resonanceCasts: 0,
    resonance: createResonance(1),
    mythicPress: 0,             // Mythic hero count used for this wave's enemy pressure.
    combo: { count: 0, timer: 0 },
    discovered: new Set(),      // Combination results discovered during this run.
    time: 0,
  };
  /* The legacy champion patrols lanes. Compute the persistent Galaxy-charge modifier once. */
  state.champUltMul = D.champUltMul(meta.champUlt);
  state.champ = null;
  if (!state.squad) {
    state.champ = {
      level: 1, xp: 0, sp: 0, skills: {},
      x: D.CHAMP_HOME.x, y: D.CHAMP_HOME.y,
      hp: 1, maxHp: 1,
      ko: false, cd: 0, spellCd: 0, spellReadyT: 0, ult: 0,
      targetId: null, holdT: 0, hurtAcc: 0, moving: false,
      dirX: 0, dirY: 1,
    };
    state.champ.maxHp = champStats(state).maxHp;
    state.champ.hp = state.champ.maxHp;
  }
  if (state.squad) {
    const partyKeys = [...new Set(Array.isArray(opts.partyKeys) ? opts.partyKeys : D.STARTING_SQUAD_KEYS)]
      .slice(0, D.SQUAD_MAX);
    for (const key of partyKeys) {
      const spec = D.squadSpec(key);
      if (!spec) continue;
      const hero = createSquadHero(state, spec);
      hero.padIndex = spec.pad;
      hero.x = D.PADS[spec.pad].x;
      hero.y = D.PADS[spec.pad].y;
      state.field.push(hero);
    }
  }
  state.pendingWave = buildWave(state);
  return state;
}

/* After wave 30, preserve champion growth and viewed story records while resetting army, gold, castle and wave. Scale enemies by loop and reset Galaxy charge so the new opening is not a free clear. */
export function nextLoop(state) {
  const next = createGame({
    difficulty: state.difficulty,
    metaLevels: state.meta,
    rng: state.rng === Math.random ? undefined : state.rng,
    loop: (state.loop || 0) + 1,
    fixedSquad: state.squad === true,
    journey: state.journey != null,
    partyKeys: state.field.map((hero) => hero.heroKey),
  });
  const c = state.champ, n = next.champ;
  if (c && n) {
    n.level = c.level;
    n.xp = c.xp;
    n.sp = c.sp;
    n.skills = { ...c.skills };
    n.maxHp = champStats(next).maxHp;
    n.hp = n.maxHp;
  }
  for (const hero of next.field) {
    const previous = state.field.find((entry) => entry.heroKey === hero.heroKey);
    if (!previous) continue;
    hero.level = previous.level;
    hero.xp = previous.xp;
    hero.sp = previous.sp;
    hero.skills = { ...previous.skills };
    refreshHeroDamage(next, hero);
  }
  next.seenStory = new Set(state.seenStory || []);
  next.revealed = new Set(state.revealed || []);
  return next;
}

/* Save preparation snapshots, not in-flight enemy/projectile object graphs. Restoring mid-wave would also allow reward farming; resume at that wave's preparation instead. */
export const SAVE_VERSION = 8;
const SAVE_STATS = [
  'kills', 'bossKills', 'midBossKills', 'summons', 'combos', 'goldEarned',
  'specialsMade', 'mythicsMade', 'tacticCasts', 'resonanceCasts',
  'champKills', 'starCasts', 'ultCasts', 'heroActiveCasts', 'blueprintCasts', 'constellationAidCasts', 'perfectWaves', 'feasts',
];

export function serialize(state) {
  const hero = (h) => state.squad ? ({
    heroKey: h.heroKey, cls: h.cls, name: h.name, pad: h.padIndex,
    level: h.level, xp: Math.round(h.xp || 0), sp: h.sp || 0, skills: { ...(h.skills || {}) },
  }) : ({ cls: h.cls, tier: h.tier, pad: h.padIndex });
  const stats = {};
  for (const k of SAVE_STATS) stats[k] = state[k];
  return {
    game: 'constellation-defense', v: SAVE_VERSION,
    difficulty: state.difficulty,
    meta: { ...state.meta },
    loop: state.loop || 0,               // Preserve the Star Trial loop on resume.
    wave: state.wave,
    gold: state.gold,
    feastWave: state.feastWave,          // Preserve whether this preparation's feast has already occurred.
    resonance: { active: [...(state.resonance?.active || [])] },
    constellationAid: { charge: state.constellationAid?.charge || 0 },
    castleHp: state.castleHp,
    castleMax: state.castleMax,
    castle: { ...state.castle },
    squad: state.squad === true,
    journey: serializeJourney(state.journey),
    bench: state.squad ? [] : state.bench.map(hero),
    field: state.field.map(hero),
    /* Store champion growth only; position and health reset during preparation. */
    champ: state.champ ? {
      level: state.champ.level, xp: Math.round(state.champ.xp), sp: state.champ.sp,
      skills: { ...state.champ.skills },
      ult: Math.round(state.champ.ult * 100) / 100,
    } : null,
    stats,
    runMemory: restoreRunMemory(state.runMemory),
    discovered: [...state.discovered],
    seenStory: state.seenStory ? [...state.seenStory] : [],
    revealed: state.revealed ? [...state.revealed] : [],
  };
}

/* Treat edited saves as untrusted input: clamp numbers, discard unknown classes and move overlapping deployed heroes to the bench. Return null for an unrecoverable structure. */
export function deserialize(data, opts = {}) {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.field)) return null;
  const clamp = (v, lo, hi, dflt) =>
    (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
  const difficulty = D.DIFFICULTIES[data.difficulty] ? data.difficulty : 'normal';
  const meta = (data.meta && typeof data.meta === 'object') ? data.meta : {};
  const requestedSquad = data.squad === true || opts.fixedSquad === true;
  const partyKeys = requestedSquad && Array.isArray(data.field)
    ? data.field.map((record) => {
      if (typeof record?.heroKey === 'string') return record.heroKey;
      return D.SQUAD.find((spec) => spec.cls === record?.cls)?.key;
    }).filter(Boolean)
    : undefined;
  const state = createGame({
    difficulty, metaLevels: meta, rng: opts.rng, loop: data.loop,
    fixedSquad: requestedSquad,
    journey: data.journey != null || opts.journey === true,
    partyKeys,
  });

  state.wave = clamp(data.wave, 1, 999, 1);
  restoreResonance(state, data.resonance);
  state.constellationAid.charge = clamp(data.constellationAid?.charge, 0, D.TACTICS.constellationAid.chargeNeeded, 0);
  state.gold = clamp(data.gold, 0, 1e9, state.gold);
  state.feastWave = clamp(data.feastWave, 0, 999, 0);
  state.castle.fortify = clamp(data.castle && data.castle.fortify, 0, D.CASTLE_UPGRADES.fortify.max, 0);
  state.castle.tower = clamp(data.castle && data.castle.tower, 0, D.CASTLE_UPGRADES.tower.max, 0);
  state.castleMax = clamp(data.castleMax, 1, 1e6, state.castleMax);
  state.castleHp = clamp(data.castleHp, 1, state.castleMax, state.castleMax);

  if (state.squad) {
    const savedByKey = new Map(data.field
      .filter((record) => record && D.SQUAD.some((spec) => spec.key === record.heroKey || spec.cls === record.cls))
      .map((record) => [record.heroKey || D.SQUAD.find((spec) => spec.cls === record.cls)?.key, record]));
    const usedPads = new Set();
    for (const hero of state.field) hero.padIndex = -1;
    for (const hero of state.field) {
      const record = savedByKey.get(hero.heroKey);
      if (record) {
        hero.name = typeof record.name === 'string' ? record.name.slice(0, 16) : hero.name;
        hero.level = clamp(record.level, 1, D.HERO_XP.maxLevel, 1);
        hero.xp = clamp(record.xp, 0, 1e6, 0);
        hero.sp = clamp(record.sp, 0, 99, 0);
        hero.skills = {};
        if (record.skills && typeof record.skills === 'object') {
          for (const [key, value] of Object.entries(record.skills)) {
            const skill = D.HERO_SKILLS[key];
            const rank = clamp(value, 0, skill?.max || 0, 0);
            if (skill && skill.cls === hero.cls && rank > 0) hero.skills[key] = rank;
          }
        }
        refreshHeroDamage(state, hero);
      }
      const defaultPad = D.squadSpec(hero.heroKey)?.pad ?? -1;
      const savedPad = Number.isInteger(record?.pad) ? record.pad : defaultPad;
      const pad = savedPad >= 0 && savedPad < D.PADS.length && !usedPads.has(savedPad)
        ? savedPad
        : D.PADS.findIndex((_, index) => !usedPads.has(index));
      if (pad < 0) continue;
      hero.padIndex = pad;
      hero.x = D.PADS[pad].x;
      hero.y = D.PADS[pad].y;
      usedPads.add(pad);
    }
  } else {
    const revive = (record, pad) => {
      if (!record || !D.CLASSES[record.cls] || state.bench.length >= D.BENCH_MAX) return;
      const hero = makeHero(state, record.cls, clamp(record.tier, 0, D.maxTierOf(record.cls), 0));
      state.bench.push(hero);
      if (Number.isInteger(pad) && pad >= 0 && pad < D.PADS.length && !padOccupant(state, pad)) placeHero(state, hero.id, pad);
    };
    for (const record of data.field.slice(0, D.PADS.length)) revive(record, record && record.pad);
    for (const record of (data.bench || []).slice(0, D.BENCH_MAX)) revive(record, null);
  }

  /* Validate every champion field; discard unknown skills and clamp ranks. */
  const cd = data.champ;
  if (cd && typeof cd === 'object' && state.champ) {
    const c = state.champ;
    c.level = clamp(cd.level, 1, D.CHAMP_XP.maxLevel, 1);
    c.xp = clamp(cd.xp, 0, 1e6, 0);
    c.sp = clamp(cd.sp, 0, 99, 0);
    c.skills = {};
    if (cd.skills && typeof cd.skills === 'object') {
      for (const [k, v] of Object.entries(cd.skills)) {
        const SK = D.CHAMP_SKILLS[k];
        if (SK) {
          const rank = clamp(v, 0, SK.max, 0);
          if (rank > 0) c.skills[k] = rank;
        }
      }
    }
    c.ult = Number.isFinite(cd.ult) ? Math.min(1, Math.max(0, cd.ult)) : 0;
    c.maxHp = champStats(state).maxHp;
    c.hp = c.maxHp;
  }

  const strings = (arr) => (Array.isArray(arr) ? arr.filter(v => typeof v === 'string') : []);
  for (const k of strings(data.discovered)) if (D.CLASSES[k]) state.discovered.add(k);
  state.seenStory = new Set(strings(data.seenStory));
  state.revealed = new Set(strings(data.revealed));
  const stats = (data.stats && typeof data.stats === 'object') ? data.stats : {};
  for (const k of SAVE_STATS) state[k] = clamp(stats[k], 0, 1e9, 0);
  state.runMemory = restoreRunMemory(data.runMemory);
  if (state.journey) {
    state.journey = restoreJourney(data.journey);
    state.phase = state.journey.activeBattle ? 'prep' : 'journey';
  }
  state.pendingWave = buildWave(state);
  return state;
}

export function prepareJourneyBattle(state) {
  const result = beginJourneyBattle(state);
  if (!result.ok) return result;
  state.pendingWave = buildWave(state);
  return result;
}
