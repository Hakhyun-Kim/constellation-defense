/* Device-level localStorage: shards, blessings, records, presentation settings, autosave and champion appearance; these outlive a single run. */
import * as D from '../data.js';

const PREFIX = 'constellation-defense.';
const LEGACY_PREFIX = 'mathdef_';
const key = (name) => PREFIX + name;

/* Migrate old combat records once. The retired math prototype's records do not belong to this game and are intentionally excluded. */
function migrate(name, legacyName = name) {
  const next = key(name);
  if (localStorage.getItem(next) != null) return;
  const legacy = LEGACY_PREFIX + legacyName;
  const value = localStorage.getItem(legacy);
  if (value == null) return;
  localStorage.setItem(next, value);
  localStorage.removeItem(legacy);
}
[
  'shards', 'meta', 'diff', 'gfx', 'decor_off', 'story_off', 'effects_reduced', 'autosave', 'champ',
  'victories', 'trial_clears', 'codex', 'achievements', 'coach', 'key_bindings', 'language',
].forEach(name => migrate(name));
['easy', 'normal', 'hard'].forEach(diff => migrate(`best.${diff}`, `best_${diff}`));
localStorage.removeItem(`${LEGACY_PREFIX}mathlog`);

const text = (name, fallback = null) => localStorage.getItem(key(name)) ?? fallback;
const number = (name) => Number(text(name, '0')) || 0;
const json = (name, fallback) => {
  try { return JSON.parse(text(name, 'null')) || fallback; } catch { return fallback; }
};

export const store = {
  get shards() { return number('shards'); },
  set shards(v) { localStorage.setItem(key('shards'), String(v)); },
  get meta() { return json('meta', {}); },
  set meta(v) { localStorage.setItem(key('meta'), JSON.stringify(v)); },
  get diff() { return text('diff', 'normal'); },
  set diff(v) { localStorage.setItem(key('diff'), v); },
  best(diff) { return number(`best.${diff}`); },
  setBest(diff, w) { localStorage.setItem(key(`best.${diff}`), String(w)); },
  get gfx() { return text('gfx'); },
  set gfx(v) { localStorage.setItem(key('gfx'), v); },
  /* Persist a fallback that disables expensive scenery on slow devices. Apply it next launch because terrain and camera construction depend on it. */
  get decorOff() { return text('decor_off') === '1'; },
  set decorOff(v) { localStorage.setItem(key('decor_off'), v ? '1' : '0'); },
  get storyOff() { return text('story_off') === '1'; },
  set storyOff(v) { localStorage.setItem(key('story_off'), v ? '1' : '0'); },
  get effectsReduced() {
    const value = text('effects_reduced');
    return value == null ? null : value === '1';
  },
  set effectsReduced(v) { localStorage.setItem(key('effects_reduced'), v ? '1' : '0'); },
  get keyBindings() { return json('key_bindings', {}); },
  set keyBindings(v) { localStorage.setItem(key('key_bindings'), JSON.stringify(v)); },
  get language() { return text('language', 'ko'); },
  set language(v) { localStorage.setItem(key('language'), v === 'en' ? 'en' : 'ko'); },
  /* Autosave updates after waves and clears on defeat. */
  get autosave() { return json('autosave', null); },
  set autosave(v) {
    if (v == null) localStorage.removeItem(key('autosave'));
    else localStorage.setItem(key('autosave'), JSON.stringify(v));
  },
  /* Champion name and wardrobe belong to the device and survive a run ending. */
  get champCfg() { return json('champ', {}); },
  set champCfg(v) { localStorage.setItem(key('champ'), JSON.stringify(v)); },
  /* Count total thirtieth-dawn victories, not a per-loop array. */
  get victories() { return number('victories'); },
  set victories(v) { localStorage.setItem(key('victories'), String(v)); },
  get trialClears() { return number('trial_clears'); },
  set trialClears(v) { localStorage.setItem(key('trial_clears'), String(v)); },
};

/* Current champion name used by toasts and story text. */
export const heroName = () => D.champNameOf(store.champCfg.name);

/* Device-level codex and achievements. Batch writes in memory and flush alongside autosave or on pagehide instead of writing on every kill. */
const load = (name, dflt) => {
  try { return Object.assign(dflt, JSON.parse(text(name, 'null')) || {}); }
  catch { return dflt; }
};

/* Codex tracks created hero class/tier counts and defeated enemy kinds. */
export const codex = load('codex', { heroes: {}, kills: {} });
/* Achievement keys remain unlocked once earned. */
export const earned = load('achievements', {});

let dirty = false;
export function markDirty() { dirty = true; }
export function flushRecords() {
  if (!dirty) return;
  dirty = false;
  localStorage.setItem(key('codex'), JSON.stringify(codex));
  localStorage.setItem(key('achievements'), JSON.stringify(earned));
}

export function codexAddHero(cls, tier) {
  const key = `${cls}:${tier}`;
  codex.heroes[key] = (codex.heroes[key] || 0) + 1;
  dirty = true;
}
export function codexAddKill(type) {
  codex.kills[type] = (codex.kills[type] || 0) + 1;
  dirty = true;
}
