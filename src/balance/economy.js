/* Economy: income, summoning, selling, combination costs and persistent progression. Combination costs determine access to higher tiers alongside enemy health scaling. */

import { CASTLE_HP } from './castle.js';
import { champHpMul, champDmgMul, champUltMul } from './champion.js';

/* Selling recovers less than summoning costs: a common hero sells for 12 against a 50 summon cost. Combined tiers recover at most half the invested gold. */
export const START_GOLD = 150;
export const SUMMON_COST = 50;
export const BENCH_MAX = 12;
export const SELL_PRICE = [12, 30, 70, 160];
/* Combat rewards fund summons, combinations and castle upgrades during the next preparation. */
export const WAVE_BONUS = (w) => 30 + w * 9;

/* Consecutive-kill combo gold multiplier. */
export const COMBO = { window: 3, x2At: 6, x3At: 12 };

/* Combination cost rises with result tier; array index is the result tier. */
export const COMBINE_COST = [0, 60, 300, 1200, 2800];
/* Special recipes cost a 25% premium. */
export const RECIPE_COST_MUL = 1.25;
export const combineCost = (resultTier, isRecipe) =>
  Math.round(COMBINE_COST[resultTier] * (isRecipe ? RECIPE_COST_MUL : 1));

/* Feast spends excess gold once per preparation to promote a random hero, weighted toward lower tiers. Ordinary combination is cheaper and lets the player choose the material. */
export const feastCost = (w) => 300 + w * 35;
export const feastTierWeight = (tier) => 1 / (1 + tier * tier);
export const feastChampXp = (w) => 15 + w * 2;

/* Persistent progression. */
export const shardReward = (wave, bossKills) => Math.max(1, (wave - 1) * 2 + bossKills * 5);
export const META_UPGRADES = {
  startGold: { name: '시작 골드',   emoji: '💰', max: 5,  cost: (lv) => 8 + lv * 6,  per: '+30G', apply: (lv) => START_GOLD + lv * 30 },
  castleHp:  { name: '성 체력',     emoji: '🏰', max: 5,  cost: (lv) => 8 + lv * 6,  per: '+20',  apply: (lv) => CASTLE_HP + lv * 20 },
  heroDmg:   { name: '용사 공격력', emoji: '⚔️', max: 10, cost: (lv) => 10 + lv * 8, per: '+5%',  apply: (lv) => 1 + lv * 0.05 },
  /* Perfect-defense shards fund champion blessings, completing the progression loop. */
  champHp:   { name: '별지기 체력',   emoji: '💖', max: 5, cost: (lv) => 7 + lv * 5, per: '+12%', apply: champHpMul, legacy: true },
  champDmg:  { name: '별지기 공격력', emoji: '🌠', max: 5, cost: (lv) => 7 + lv * 5, per: '+10%', apply: champDmgMul, legacy: true },
  champUlt:  { name: '은하수 충전',   emoji: '🌌', max: 3, cost: (lv) => 8 + lv * 6, per: '+12%', apply: champUltMul, legacy: true },
};
