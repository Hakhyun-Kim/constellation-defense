/* Resonance converts combination material values into a one-wave lane bonus. These are public tactical inputs, not a progression question gate. */

/* Basic classes use values 1–4; special/mythic values are sums of their recipe materials. */
export const HERO_STAR_VALUE = {
  knight: 1, guard: 2, archer: 3, mage: 4,
  spellblade: 5, windblade: 4, paladin: 3,
  frostmage: 6, sentinel: 5, spiritarcher: 7,
  swordsaint: 9, archmage: 13, seraph: 8,
};

/* Each lane has a distinct target sum per wave: 2–8 early, with 9 and 13 introduced for later mythic combinations. */
export const RESONANCE_TARGETS = [
  [2, 5, 7], [3, 4, 6], [4, 5, 8], [2, 6, 7],
  [3, 5, 8], [4, 6, 7], [5, 8, 9], [6, 7, 13],
];

/* Resonant lanes take increased hero damage for the wave. Champion, castle and tactic effects remain unchanged. */
export const RESONANCE_DAMAGE_MUL = 1.3;
