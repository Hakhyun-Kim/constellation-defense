/* Pure resonance rules determine material sums, targets and bonuses without DOM or rendering. */
import * as D from '../data.js';

export const laneName = (lane) => ['왼쪽', '가운데', '오른쪽'][lane] || '알 수 없는';

export function createResonance(wave) {
  const patterns = D.RESONANCE_TARGETS;
  const index = Math.max(0, Math.floor(wave || 1) - 1) % patterns.length;
  return { targets: [...patterns[index]], active: [false, false, false] };
}

export const heroStarValue = (cls) => D.HERO_STAR_VALUE[cls] || 0;

/* Compute sums only from public listCombos information. */
export function comboStarValue(combo) {
  if (!combo) return 0;
  if (combo.kind === 'rankup') return heroStarValue(combo.cls) * 2;
  return heroStarValue(combo.a) + heroStarValue(combo.b);
}

export function matchingResonanceLanes(state, comboOrValue) {
  const value = typeof comboOrValue === 'number' ? comboOrValue : comboStarValue(comboOrValue);
  const targets = state?.resonance?.targets || [];
  return targets.reduce((lanes, target, lane) => {
    if (target === value) lanes.push(lane);
    return lanes;
  }, []);
}

/* Always create the normal combination result; an exact sum additionally activates one inactive lane. */
export function activateResonance(state, value) {
  if (!state.resonance) state.resonance = createResonance(state.wave);
  const lanes = matchingResonanceLanes(state, value);
  const lane = lanes.find(index => !state.resonance.active[index]);
  if (lane == null) return { matched: lanes.length > 0, activated: false, value, lane: lanes[0] };
  state.resonance.active[lane] = true;
  state.resonanceCasts = (state.resonanceCasts || 0) + 1;
  return { matched: true, activated: true, value, lane };
}

export function resonanceDamageMul(state, lane) {
  return state?.resonance?.active?.[lane] ? D.RESONANCE_DAMAGE_MUL : 1;
}

/* Saves are preparation-only. Regenerate targets deterministically from the wave and restore activated lanes so edited saves cannot change targets. */
export function restoreResonance(state, record) {
  state.resonance = createResonance(state.wave);
  if (!record || !Array.isArray(record.active)) return;
  state.resonance.active = state.resonance.active.map((_, lane) => record.active[lane] === true);
}
