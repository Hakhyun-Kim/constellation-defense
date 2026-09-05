/* Defense-side tactic numbers remain reusable independently of match-3 presentation; board rules live elsewhere. */

export const TACTICS = {
  flare: {
    baseDamage: 46,
    waveDamage: 8,
    targetCount: { 3: 3, 4: 5, 5: Infinity, 6: Infinity },
    impactRadius: { 3: 38, 4: 64, 5: 64, 6: 76 },
  },
  tide: {
    slow: {
      3: { mul: 0.52, dur: 2.7 },
      4: { mul: 0.35, dur: 2.7 },
      5: { mul: 0.18, dur: 4.5 },
      6: { mul: 0.12, dur: 5.5 },
    },
  },
  bloom: {
    baseHeal: 5,
    healPerStar: 2,
    pushCount: { 3: 2, 4: 4, 5: 4, 6: Infinity },
    pushDistance: { 3: 48, 4: 48, 5: 100, 6: 120 },
  },
  /* Four- and five-star matches leave a persistent constellation mark.  The
   * player can bank a completed set for an upcoming boss rather than having
   * every large match resolve as immediate power. */
  constellationAid: {
    chargeNeeded: 3,
    marks: { 4: 1, 5: 2, 6: 3 },
    duration: 12,
    attackPeriod: .8,
    damage: 46,
    bossDamageMul: 1.75,
    projectileSpeed: 520,
    deployProgress: .7,
  },
};

export const tacticPower = (size) => (size >= 6 ? 2.35 : size === 5 ? 1.9 : size === 4 ? 1.35 : 1);

/* Puzzle colors belong to named heroes instead of floating above the cast.
 * A successful match advances the linked heroes' active timing; larger shapes
 * are worth holding because they return a signature skill much sooner. */
export const TACTIC_HERO_LINKS = Object.freeze({
  flare: Object.freeze(['arin', 'sera']),
  tide: Object.freeze(['luna', 'yuna']),
  bloom: Object.freeze(['doyun']),
});
export const TACTIC_LINK_COOLDOWN = Object.freeze({ 3: .8, 4: 2, 5: 4, 6: 8 });
