/* Castle: defense target, upgrades and magic turret. */

export const CASTLE_HP = 100;
export const CASTLE_POS = { x: 350, y: 58 };
export const CASTLE_UPGRADES = {
  repair:  { name: '성 수리',    emoji: '🔨', cost: () => 40,             desc: '성 체력을 25 회복해요' },
  fortify: { name: '성벽 강화',  emoji: '🧱', cost: (n) => 60 + n * 40,   desc: '성 최대 체력 +30', max: 5 },
  tower:   { name: '마법 포탑',  emoji: '🗼', cost: (n) => 120 + n * 100, desc: '성이 스스로 마법 공격!', max: 3 },
};
export const TOWER_DMG = (lv) => 12 + lv * 10;
export const TOWER_PERIOD = (lv) => Math.max(0.8, 1.6 - lv * 0.25);
export const TOWER_RANGE = 300;
