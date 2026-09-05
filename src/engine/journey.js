import * as D from '../data.js';
import { createSquadHero } from './squad.js';

const chapterIdOf = (value) => typeof value === 'string'
  ? value
  : value?.journey?.chapter || value?.chapter;

export function journeyChapter(value = null) {
  const id = chapterIdOf(value);
  return D.JOURNEY_CHAPTERS.find((entry) => entry.id === id) || D.JOURNEY_CHAPTERS[0];
}

export const journeyNode = (id, value = null) =>
  journeyChapter(value).nodes.find((node) => node.id === id) || null;

export function createJourney(chapterId = null) {
  const chapter = journeyChapter(chapterId);
  const start = chapter.start;
  const startAnnotation = chapter.nodes.find((node) => node.id === start)?.annotation?.id;
  return {
    chapter: chapter.id,
    current: start,
    visited: [start],
    cleared: [],
    pendingRecruit: null,
    activeBattle: null,
    wavesInBattle: 0,
    complete: false,
    history: [],
    ending: null,
    flags: {},
    annotations: startAnnotation ? [startAnnotation] : [],
    refuge: { arrived: false, survivors: 0, morale: 0, ally: null, defenses: 0 },
  };
}

function chapterRecord(journey) {
  return {
    chapter: journey.chapter,
    current: journey.current,
    visited: [...journey.visited],
    cleared: [...journey.cleared],
    complete: !!journey.complete,
  };
}

/* The campaign changes chapter data, not the player's accumulated run state.
 * Party growth, castle, gold, statistics, and RNG remain on the same state. */
export function advanceJourneyChapter(state) {
  const journey = state?.journey;
  if (!journey || state.phase !== 'journey') return { ok: false, reason: 'phase' };
  if (!journey.complete || journey.pendingRecruit || journey.activeBattle) return { ok: false, reason: 'incomplete' };
  const chapter = journeyChapter(journey);
  const next = D.JOURNEY_CHAPTERS.find((entry) => entry.id === chapter.nextChapter);
  if (!next) return { ok: false, reason: 'final' };
  const replacement = createJourney(next.id);
  replacement.history = [...(journey.history || []).map((record) => ({ ...record,
    visited: [...record.visited], cleared: [...record.cleared] })), chapterRecord(journey)];
  state.journey = replacement;
  state.phase = 'journey';
  state.pendingWave = null;
  return { ok: true, from: chapter, chapter: next, journey: replacement };
}

export function chooseJourneyEnding(state, key) {
  const journey = state?.journey;
  if (!journey || state.phase !== 'journey') return { ok: false, reason: 'phase' };
  const chapter = journeyChapter(journey);
  const ending = D.JOURNEY_ENDINGS[key];
  if (!journey.complete) return { ok: false, reason: 'incomplete' };
  if (!ending || !chapter.endings?.includes(key)) return { ok: false, reason: 'ending' };
  if (journey.ending) return { ok: false, reason: 'chosen', ending: D.JOURNEY_ENDINGS[journey.ending] };
  journey.ending = key;
  return { ok: true, ending, chapter };
}

export function journeyChoices(state) {
  const journey = state.journey;
  const current = journey && journeyNode(journey.current, journey);
  if (!journey || !current || journey.pendingRecruit || journey.activeBattle || journey.complete) return [];
  if (current.choices && !journey.flags[current.id]) return [];
  return current.next.map((id) => journeyNode(id, journey)).filter(Boolean);
}

/* UI and bots derive the defense number within a node from the same pure state. */
export function journeyBattleProgress(state) {
  const node = journeyNode(state?.journey?.activeBattle, state);
  if (!node || (node.kind !== 'battle' && node.kind !== 'boss')) return null;
  const total = Math.max(1, Math.round(node.waves || 1));
  const step = Math.max(1, Math.min(total, Math.round(state.journey.wavesInBattle || 0) + 1));
  return { node, step, total };
}

const findChapterChoice = (node, key) => node?.choices?.find((choice) => choice.key === key) || null;

/* A fork choice is a command, not a UI-only label. It remains visible to the
 * bot and to later refugee/blueprint rules through the public journey flags. */
export function chooseJourneyPath(state, key) {
  const journey = state?.journey;
  const node = journey && journeyNode(journey.current, journey);
  if (!journey || state.phase !== 'journey' || !node?.choices) return { ok: false, reason: 'node' };
  if (journey.flags[node.id]) return { ok: false, reason: 'chosen', key: journey.flags[node.id] };
  const choice = findChapterChoice(node, key);
  if (!choice) return { ok: false, reason: 'choice' };
  journey.flags[node.id] = key;
  return { ok: true, node, choice };
}

export function latestJourneyAnnotation(state) {
  const ids = state?.journey?.annotations || [];
  const id = ids[ids.length - 1];
  if (!id) return null;
  for (const node of journeyChapter(state).nodes) if (node.annotation?.id === id) return node.annotation;
  return null;
}

function collectAnnotation(journey, node) {
  const id = node.annotation?.id;
  if (id && !journey.annotations.includes(id)) journey.annotations.push(id);
}

function arriveRefugeeStation(state, node) {
  const refuge = state.journey.refuge;
  if (refuge.arrived) return;
  const route = state.journey.flags['alignment-hub'] || null;
  const healthRatio = state.castleMax ? state.castleHp / state.castleMax : 1;
  refuge.arrived = true;
  refuge.ally = route;
  refuge.survivors = 18 + Math.round(healthRatio * 12) + (route === 'guild' ? 8 : route === 'market' ? 4 : 0);
  refuge.morale = Math.max(1, Math.min(5, 2 + (healthRatio >= .6 ? 1 : 0) + (route ? 1 : 0)));
  refuge.defenses = 0;
  collectAnnotation(state.journey, node);
}

/* Regional pacing is patrol, commander, then finale, independently of global wave multiples. */
export function journeyEncounter(state) {
  const progress = journeyBattleProgress(state);
  if (!progress) return { kind: 'patrol', boss: false, midBoss: false, region: null, chapterFinal: false };
  const common = {
    region: progress.node.region || null,
    chapterFinal: progress.node.kind === 'boss',
    step: progress.step,
    total: progress.total,
  };
  if (progress.step === progress.total) {
    return { ...common, kind: 'regional-boss', boss: true, midBoss: true };
  }
  if (progress.total > 1 && progress.step === progress.total - 1) {
    return { ...common, kind: 'commander', boss: false, midBoss: true };
  }
  return { ...common, kind: 'patrol', boss: false, midBoss: false };
}

const markVisited = (journey, id) => {
  if (!journey.visited.includes(id)) journey.visited.push(id);
};

function applySupply(state, node) {
  const gold = Math.max(0, Math.round(node.gold || 0));
  const heal = Math.max(0, Math.round(node.heal || 0));
  state.gold += gold;
  state.castleHp = Math.min(state.castleMax, state.castleHp + heal);
  return { gold, heal };
}

export function travelJourney(state, id) {
  if (!state.journey || state.phase !== 'journey') return { ok: false, reason: 'phase' };
  const from = journeyNode(state.journey.current, state);
  const node = journeyNode(id, state);
  if (!from || !node || !from.next.includes(id)) return { ok: false, reason: 'path' };
  if (from.choices && !state.journey.flags[from.id]) return { ok: false, reason: 'choice' };

  state.journey.current = id;
  markVisited(state.journey, id);
  collectAnnotation(state.journey, node);
  if (node.kind === 'battle' || node.kind === 'boss') {
    state.journey.activeBattle = id;
    state.journey.wavesInBattle = 0;
    return { ok: true, type: 'battle', node };
  }
  if (node.kind === 'town' || node.kind === 'recruit') {
    if (node.refugeeStation) arriveRefugeeStation(state, node);
    state.journey.pendingRecruit = id;
    if (node.enterOnArrival && !(node.offers || []).length) state.journey.pendingRecruit = null;
    return { ok: true, type: node.refugeeStation ? 'town' : 'recruit', node, refuge: node.refugeeStation ? { ...state.journey.refuge } : null };
  }
  return { ok: true, type: 'supply', node, ...applySupply(state, node) };
}

export function recruitJourneyHero(state, key) {
  const journey = state.journey;
  const node = journey && journeyNode(journey.pendingRecruit, journey);
  const spec = D.squadSpec(key);
  if (!journey || !node || !spec || !node.offers?.includes(key)) return { ok: false, reason: 'offer' };
  if (state.field.some((hero) => hero.heroKey === key)) return { ok: false, reason: 'owned' };
  if (state.field.length >= D.SQUAD_MAX) return { ok: false, reason: 'full' };
  const hero = createSquadHero(state, spec);
  const used = new Set(state.field.map((entry) => entry.padIndex));
  const pad = !used.has(spec.pad) ? spec.pad : D.PADS.findIndex((_, index) => !used.has(index));
  if (pad < 0) return { ok: false, reason: 'pad' };
  hero.padIndex = pad;
  hero.x = D.PADS[pad].x;
  hero.y = D.PADS[pad].y;
  state.field.push(hero);
  journey.pendingRecruit = null;
  return { ok: true, hero, node };
}

export function beginJourneyBattle(state) {
  const node = journeyNode(state.journey?.activeBattle, state);
  if (!node || (node.kind !== 'battle' && node.kind !== 'boss')) return { ok: false, reason: 'node' };
  state.wave = node.threat;
  state.phase = 'prep';
  return { ok: true, node };
}

export function completeJourneyWave(state) {
  const journey = state.journey;
  const node = journeyNode(journey?.activeBattle, journey);
  if (!journey || !node) return { complete: false };
  journey.wavesInBattle++;
  if (journey.wavesInBattle < node.waves) return { complete: false, node };
  if (!journey.cleared.includes(node.id)) journey.cleared.push(node.id);
  if (node.protectsRefugees && journey.refuge.arrived) {
    journey.refuge.defenses++;
    journey.refuge.survivors += Math.max(1, 4 - journey.refuge.defenses);
    journey.refuge.morale = Math.min(5, journey.refuge.morale + 1);
  }
  journey.activeBattle = null;
  journey.wavesInBattle = 0;
  state.phase = 'journey';
  if (node.kind === 'boss') journey.complete = true;
  return { complete: true, chapterComplete: journey.complete, node };
}

export function serializeJourney(journey) {
  if (!journey) return null;
  return {
    chapter: journey.chapter,
    current: journey.current,
    visited: [...journey.visited],
    cleared: [...journey.cleared],
    pendingRecruit: journey.pendingRecruit,
    activeBattle: journey.activeBattle,
    wavesInBattle: journey.wavesInBattle,
    complete: !!journey.complete,
    history: (journey.history || []).map((record) => ({
      chapter: record.chapter, current: record.current,
      visited: [...record.visited], cleared: [...record.cleared], complete: !!record.complete,
    })),
    ending: journey.ending || null,
    flags: { ...(journey.flags || {}) },
    annotations: [...(journey.annotations || [])],
    refuge: { ...(journey.refuge || {}) },
  };
}

function restoreHistory(raw, currentChapter) {
  if (!Array.isArray(raw)) return [];
  const currentIndex = D.JOURNEY_CHAPTERS.findIndex((entry) => entry.id === currentChapter);
  const seen = new Set();
  const history = [];
  for (const record of raw.slice(0, 12)) {
    const index = D.JOURNEY_CHAPTERS.findIndex((entry) => entry.id === record?.chapter);
    if (index < 0 || index >= currentIndex || seen.has(record.chapter)) continue;
    const chapter = D.JOURNEY_CHAPTERS[index];
    const valid = (id) => typeof id === 'string' && chapter.nodes.some((node) => node.id === id);
    const current = valid(record.current) ? record.current : chapter.start;
    const visited = Array.isArray(record.visited) ? [...new Set(record.visited.filter(valid))] : [current];
    if (!visited.includes(current)) visited.push(current);
    history.push({
      chapter: chapter.id,
      current,
      visited,
      cleared: Array.isArray(record.cleared) ? [...new Set(record.cleared.filter(valid))] : [],
      complete: !!record.complete,
    });
    seen.add(chapter.id);
  }
  return history;
}

export function restoreJourney(raw) {
  const requested = raw && typeof raw === 'object' && typeof raw.chapter === 'string'
    ? D.JOURNEY_CHAPTERS.find((entry) => entry.id === raw.chapter)?.id
    : null;
  const fresh = createJourney(requested);
  if (!raw || typeof raw !== 'object' || raw.chapter !== fresh.chapter) return fresh;
  const valid = (id) => typeof id === 'string' && !!journeyNode(id, fresh);
  fresh.current = valid(raw.current) ? raw.current : fresh.current;
  fresh.visited = Array.isArray(raw.visited) ? [...new Set(raw.visited.filter(valid))] : [fresh.current];
  if (!fresh.visited.includes(fresh.current)) fresh.visited.push(fresh.current);
  fresh.cleared = Array.isArray(raw.cleared) ? [...new Set(raw.cleared.filter(valid))] : [];
  fresh.pendingRecruit = valid(raw.pendingRecruit) ? raw.pendingRecruit : null;
  fresh.activeBattle = valid(raw.activeBattle) ? raw.activeBattle : null;
  fresh.wavesInBattle = Math.max(0, Math.min(9, Math.round(raw.wavesInBattle || 0)));
  fresh.complete = !!raw.complete;
  fresh.history = restoreHistory(raw.history, fresh.chapter);
  fresh.ending = fresh.complete && journeyChapter(fresh).endings?.includes(raw.ending) ? raw.ending : null;
  const chapter = journeyChapter(fresh);
  fresh.flags = {};
  if (raw.flags && typeof raw.flags === 'object') {
    for (const node of chapter.nodes) {
      const choice = findChapterChoice(node, raw.flags[node.id]);
      if (choice) fresh.flags[node.id] = choice.key;
    }
  }
  const annotationIds = new Set(chapter.nodes.map((node) => node.annotation?.id).filter(Boolean));
  fresh.annotations = Array.isArray(raw.annotations)
    ? [...new Set(raw.annotations.filter((id) => typeof id === 'string' && annotationIds.has(id)))]
    : chapter.nodes.filter((node) => fresh.visited.includes(node.id) && node.annotation).map((node) => node.annotation.id);
  const refuge = raw.refuge && typeof raw.refuge === 'object' ? raw.refuge : {};
  const selectedRoute = fresh.flags['alignment-hub'] || null;
  fresh.refuge = {
    arrived: !!refuge.arrived,
    survivors: Math.max(0, Math.min(9999, Math.round(refuge.survivors || 0))),
    morale: Math.max(0, Math.min(5, Math.round(refuge.morale || 0))),
    ally: refuge.ally === selectedRoute ? refuge.ally : null,
    defenses: Math.max(0, Math.min(99, Math.round(refuge.defenses || 0))),
  };
  return fresh;
}
