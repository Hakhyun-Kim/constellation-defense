/* Champion progression supports the legacy army mode beyond collection completion. The champion pursues leading enemies, temporarily holds ordinary units, revives after a wave when knocked out, and cannot cast while down. Kills and wave clears grant XP; perfect defense also grants shards. */

export const CHAMP = {
  name: '별지기 루나', short: '루나', emoji: '🌠',
  baseHp: 70, hpPerLv: 12,
  baseDmg: 9, dmgPerLv: 2.4,
  spd: 1.15,                    // Attacks per second.
  range: 48,                    // Melee engagement range.
  moveSpd: 95,                  // Movement speed in logical pixels per second, slightly faster than most enemies.
  crit: { chance: 0.2, mul: 2.0 },
  /* Retaliation damage per second is enemy castleDmg times this ratio and the castle-damage scaling curve. */
  contactRatio: 0.5,
  bossContactMul: 1.3,          // Boss engagement deals substantially more retaliation damage.
};
export const CHAMP_HOME = { x: 350, y: 96 };        // Wave-start position in the plaza before the gate.
/* Hold one ordinary enemy for at most six seconds, followed by four seconds of hold immunity. This prevents indefinite stalemates; bosses cannot be held. */
export const CHAMP_HOLD = { max: 6, immune: 4 };
export const CHAMP_AURA = { range: 95, mul: 0.8 };  // Guardian skill: Star Barrier.

/* Every kill grants champion XP, doubled for direct kills. Wave clears grant a bonus; perfect defense adds more XP and one shard. */
export const CHAMP_XP = {
  kill: 1, elite: 3, midBoss: 6, boss: 14,
  ownKillMul: 2,
  clear: (w) => 8 + w * 2,
  perfectMul: 1.6,
  maxLevel: 30,
};
export const champXpNeed = (lv) => Math.round(26 * Math.pow(1.18, lv - 1));

/* Starfall is free with a cooldown and targets a boss or the enemy closest to the gate. Damage combines a flat amount, champion damage and 5% target max HP. Galaxy charges through kills, then hits and freezes all enemies. Idle-ready Starfall eventually auto-casts. */
export const STAR = {
  base: 26, dmgMul: 3.2, pctHp: 0.035,
  splash: 66, splashRatio: 0.5,
  cd: 9,
  autoAfter: 12,                // Auto-cast after this much time ready.
};
export const ULT = {
  dmgMul: 8, pctHp: 0.09,
  slow: { mul: 0.5, dur: 3.5 },
  /* Charge gained per kill. */
  kill: 0.012, elite: 0.02, mid: 0.06, boss: 0.12, wave: 0.15,
};

/* Three constellations with three skills each. need counts points already spent in the same constellation. Numeric improvements lead toward a behavior-changing final skill. */
export const CHAMP_BRANCHES = {
  blade: { name: '별빛 검술', emoji: '⚔️' },
  star:  { name: '별똥별',   emoji: '☄️' },
  guard: { name: '수호 별자리', emoji: '🛡️' },
};
export const CHAMP_SKILLS = {
  blade1: { branch: 'blade', name: '별빛 검격', emoji: '⚔️', max: 3, need: 0, per: '공격력 +25%',        desc: '검이 별빛으로 벼려진다' },
  blade2: { branch: 'blade', name: '유성 검무', emoji: '💨', max: 2, need: 1, per: '공격속도 +18%',      desc: '유성처럼 빠르게 벤다' },
  blade3: { branch: 'blade', name: '회전 베기', emoji: '🌀', max: 1, need: 3, per: '주변 전체 타격',     desc: '한 번 벨 때 주변 모두를 벤다!' },
  star1:  { branch: 'star',  name: '큰 별똥별', emoji: '☄️', max: 3, need: 0, per: '별똥별 피해 +35%',   desc: '더 크고 뜨거운 별이 떨어진다' },
  star2:  { branch: 'star',  name: '빠른 부름', emoji: '⏱️', max: 2, need: 1, per: '별똥별 쿨다운 -20%', desc: '별이 부름에 빨리 응답한다' },
  star3:  { branch: 'star',  name: '세쌍둥이 별', emoji: '✨', max: 1, need: 3, per: '별똥별 3개',        desc: '별똥별이 세 개씩 떨어진다!' },
  guard1: { branch: 'guard', name: '별의 갑옷', emoji: '💖', max: 3, need: 0, per: '체력 +30%',          desc: '별빛이 갑옷이 된다' },
  guard2: { branch: 'guard', name: '수호의 빛', emoji: '🕯️', max: 2, need: 1, per: '처치 시 성 +1 회복', desc: '별지기의 승리가 성을 치유한다' },
  guard3: { branch: 'guard', name: '별의 결계', emoji: '❄️', max: 1, need: 3, per: '주변 적 20% 감속',   desc: '별지기 곁에서 적이 느려진다' },
};
/* Shared bot/demo skill order provides one representative progression policy. */
export const SKILL_PLAN = ['blade1', 'guard1', 'star1', 'blade2', 'star2', 'blade3', 'guard2', 'star3', 'guard3'];

/* Champion blessings extend permanent shard spending; economy.js reuses these apply functions. */
export const champHpMul  = (lv) => 1 + 0.12 * (lv || 0);
export const champDmgMul = (lv) => 1 + 0.10 * (lv || 0);
export const champUltMul = (lv) => 1 + 0.12 * (lv || 0);

/* Procedural wardrobe data selects colors and model parts without affecting stats. Device-local name and appearance survive individual runs. */
export const CHAMP_DEFAULT_NAME = '루나';
export const CHAMP_WARDROBE = {
  hair: {
    name: '머리', emoji: '💇',
    options: {
      silver: { name: '은빛', color: 0xe8e4f4 },
      gold:   { name: '금빛', color: 0xf2d98a },
      brown:  { name: '밤색', color: 0x7a5230 },
      pink:   { name: '분홍', color: 0xf5a8c8 },
      sky:    { name: '하늘', color: 0x9fd0f0 },
    },
  },
  outfit: {
    name: '옷', emoji: '🧥',
    options: {
      night:  { name: '별밤', tunic: 0x3b4a8f, sleeve: 0x2d3a74, pants: 0x252f5a, cape: 0x1e2a5e },
      rose:   { name: '장미', tunic: 0xb84a6e, sleeve: 0x963a58, pants: 0x5a2438, cape: 0x7a2c48 },
      forest: { name: '숲',   tunic: 0x3f8f57, sleeve: 0x2f7044, pants: 0x24462e, cape: 0x1e3a28 },
      sunset: { name: '노을', tunic: 0xd97a3d, sleeve: 0xb85f2c, pants: 0x6e3a1e, cape: 0x8a4426 },
      snow:   { name: '눈꽃', tunic: 0xe8ecf4, sleeve: 0xc8d2e2, pants: 0x8a94ac, cape: 0xaab6cc },
    },
  },
  weapon: {
    name: '무기', emoji: '⚔️',
    options: {
      sword: { name: '별빛 검' },
      dual:  { name: '쌍검' },
      staff: { name: '별 지팡이' },
    },
  },
  star: {
    name: '별빛', emoji: '✨',
    options: {
      gold:   { name: '금빛', color: 0xffe27a },
      pink:   { name: '분홍', color: 0xff9ecb },
      sky:    { name: '하늘', color: 0x9fe8ff },
      violet: { name: '보라', color: 0xd8b4ff },
      lime:   { name: '연두', color: 0xb6f09a },
    },
  },
};
export const CHAMP_LOOK_DEFAULT = { hair: 'silver', outfit: 'night', weapon: 'sword', star: 'gold' };

/* Unknown or removed saved appearance options fall back to defaults. */
export function champLookOf(raw) {
  const look = { ...CHAMP_LOOK_DEFAULT };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(CHAMP_LOOK_DEFAULT)) {
      if (raw[k] && CHAMP_WARDROBE[k].options[raw[k]]) look[k] = raw[k];
    }
  }
  return look;
}
export function champNameOf(raw) {
  const name = (typeof raw === 'string' ? raw : '').trim().slice(0, 8);
  return name || CHAMP_DEFAULT_NAME;
}
