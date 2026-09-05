/* Enemy kinds, boss cycles and difficulty curves. hpScale, waveCount and squadSize determine pressure relative to player growth; changes here alter the game's difficulty profile. */

/* Three encounter layers: ordinary enemies, regional commanders and regional bosses. */
export const ENEMY_TYPES = {
  goblin:  { name: '고블린',     emoji: '👺', hp: 40,   spd: 62,  gold: 8,   castleDmg: 5,  size: 30 },
  wolf:    { name: '늑대',       emoji: '🐺', hp: 26,   spd: 105, gold: 10,  castleDmg: 4,  size: 30 },
  orc:     { name: '오크',       emoji: '👹', hp: 115,  spd: 44,  gold: 16,  castleDmg: 8,  size: 34 },
  troll:   { name: '트롤',       emoji: '🧌', hp: 270,  spd: 32,  gold: 32,  castleDmg: 12, size: 40 },
  shaman:  { name: '주술사',     emoji: '🧙', hp: 90,   spd: 38,  gold: 24,  castleDmg: 8,  size: 32, heal: 18, healPeriod: 1.6, healRange: 130 },
  /* Add two enemy behaviors that challenge placement rather than only increasing existing enemy stats. */
  bat:     { name: '박쥐떼',     emoji: '🦇', hp: 34,   spd: 150, gold: 12,  castleDmg: 3,  size: 26 },
  golem:   { name: '바위골렘',   emoji: '🗿', hp: 330,  spd: 22,  gold: 40,  castleDmg: 15, size: 42 },

  /* Commanders lead troops before the regional finale and escort the boss during it. */
  ogrelord:    { name: '오우거 군주', emoji: '👿', hp: 780, spd: 30, gold: 90, castleDmg: 22, size: 50, midBoss: true },
  bonelord:    { name: '해골 장군',   emoji: '💀', hp: 600, spd: 42, gold: 85, castleDmg: 18, size: 47, midBoss: true },
  spiderqueen: { name: '거미 여왕',   emoji: '🕷️', hp: 680, spd: 36, gold: 95, castleDmg: 20, size: 48, midBoss: true,
                 heal: 22, healPeriod: 1.8, healRange: 160 },

  /* Regional bosses appear in the last defense and enrage at half health. */
  boss:  { name: '보스 드래곤',   emoji: '🐉', hp: 2000, spd: 26, gold: 260, castleDmg: 45, size: 58, boss: true,
           enrageAt: 0.5, enrageSpd: 1.45 },
  boss2: { name: '고대 파괴자',   emoji: '🦖', hp: 2350, spd: 23, gold: 300, castleDmg: 50, size: 60, boss: true,
           enrageAt: 0.5, enrageSpd: 1.4 },
};

/* Commanders rotate by threat level; each region has its own main boss. */
export const MIDBOSS_CYCLE = ['ogrelord', 'bonelord', 'spiderqueen'];
export const midBossType = (w, offset = 0) => MIDBOSS_CYCLE[(w - 1 + offset) % MIDBOSS_CYCLE.length];
export const GREAT_BOSS_CYCLE = ['boss', 'boss2'];
export const REGION_BOSS_TYPES = {
  'verdant-dawn': 'boss',
  'ember-gate': 'boss2',
  'neon-ruins': 'boss',
  'ashen-margin': 'boss2',
  'manuscript-core': 'boss2',
};
export const greatBossType = (region, fallback = 1) =>
  REGION_BOSS_TYPES[region] || GREAT_BOSS_CYCLE[(Math.max(1, fallback) - 1) % GREAT_BOSS_CYCLE.length];
/* Seconds of warning before a boss spawns. */
export const BOSS_WARN_LEAD = 2.6;
/* Early commanders ramp toward full strength by wave five to ease onboarding. */
export const midBossRamp = (w) => Math.min(1, 0.45 + w * 0.12);
/* Finale commanders provide side-lane pressure as escorts, not separate boss encounters. */
export const BOSS_LIEUTENANT = { hpMul: 0.58, goldMul: 0.65, castleDmgMul: 0.72 };

/* Difficulty settings. */
export const DIFFICULTIES = {
  easy:   { name: '쉬움',   emoji: '🌱', hpMul: 0.55, countMul: 0.65, goldMul: 1.25 },
  normal: { name: '보통',   emoji: '⚔️', hpMul: 0.62, countMul: 0.72, goldMul: 1.2 },
  hard:   { name: '어려움', emoji: '🔥', hpMul: 0.82, countMul: 0.9,  goldMul: 1.1 },
};

/* Lower per-unit health scaling to compensate for larger crowds; acceleration after wave 12 tightens long runs without changing the opening. */
export const hpScale = (w) =>
  1 + 0.18 * (w - 1) + 0.04 * (w - 1) * (w - 1) + 0.075 * Math.pow(Math.max(0, w - 12), 2);
export const enemyGoldScale = (w) => 1 + 0.03 * w;
/* Enemy counts start substantial and grow to increase pressure and impact density. */
export const waveCount = (w) => 8 + Math.round(w * 1.9);
export const castleDmgScale = (w) => 1 + Math.max(0, w - 15) * 0.08;

/* Spawn squads of two to six instead of isolated units, with tight 0.18-second internal spacing and recovery gaps between squads. */
export const squadSize = (w) => {
  const base = 3 + Math.floor(w / 3);              // w1~2:3, w3~5:4, w6~8:5 …
  return Math.min(7, base);
};
export const SQUAD_INNER_GAP = 0.18;               // Within-squad interval in seconds.
export const squadGap = (w) => Math.max(2.5, 4.6 - w * 0.1);   // Between-squad interval in seconds.

export function waveMix(w) {
  const mix = [{ type: 'goblin', weight: 10 }];
  if (w >= 2) mix.push({ type: 'orc', weight: Math.min(3 + w * 0.5, 9) });
  if (w >= 3) mix.push({ type: 'wolf', weight: Math.min(2 + w * 0.4, 6) });
  if (w >= 4) mix.push({ type: 'troll', weight: Math.min(1 + w * 0.35, 6) });
  if (w >= 6) mix.push({ type: 'shaman', weight: Math.min(1 + w * 0.25, 4) });
  if (w >= 8) mix.push({ type: 'bat', weight: Math.min(1.5 + w * 0.2, 4) });
  if (w >= 11) mix.push({ type: 'golem', weight: Math.min(0.8 + (w - 10) * 0.2, 3) });
  return mix;
}
/* Use ordinary versus elite enemies, with a gold outline, instead of another four-tier vocabulary competing with hero tiers. */
export const eliteChance = (w) => Math.min(0.11, Math.max(0, (w - 5) * 0.015));
export const ELITE = { hpMul: 2.2, goldMul: 2.5, sizeMul: 1.15, name: '성난' };

/* Mythic pressure raises enemy health and rewards in response to mythic heroes, keeping the endgame active. Cap the response at four mythics: +48% HP and +40% gold. */
export const MYTHIC_PRESSURE_CAP = 4;
export const mythicHpMul = (n) => 1 + 0.12 * Math.min(MYTHIC_PRESSURE_CAP, Math.max(0, n));
export const mythicGoldMul = (n) => 1 + 0.10 * Math.min(MYTHIC_PRESSURE_CAP, Math.max(0, n));

/* Star Trials unlock after wave 30. Preserve champion growth while resetting army, gold and castle; raise both enemy strength and gold per loop. */
export const VICTORY_WAVE = 30;
export const loopHpMul = (n) => Math.pow(1.45, Math.max(0, n || 0));
export const loopGoldMul = (n) => Math.pow(1.12, Math.max(0, n || 0));
export const loopCastleDmgMul = (n) => Math.pow(1.15, Math.max(0, n || 0));
/* Thirtieth-dawn rewards grow with loop depth. */
export const victoryShards = (loop) => 30 + (loop || 0) * 20;
