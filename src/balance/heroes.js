/* Hero tier ladder, class definitions and three-generation recipe graph define the legacy army structure. Individual damage, speed and range values are balance-bot inputs. */

/* Fixed summon probabilities. Legendary heroes normally come from combining rather than summoning. */
export const SUMMON_PROBS = [64, 26.5, 8, 1.5];

/* Legacy army tier ladder: combining provides progression; fixed-party hero levels are handled separately. */
export const TIERS = [
  { name: '일반', color: '#8a97a8', mult: 1 },
  { name: '희귀', color: '#3b82f6', mult: 2.8 },
  { name: '영웅', color: '#a855f7', mult: 7.2 },
  { name: '전설', color: '#f59e0b', mult: 13 },
  { name: '신화', color: '#ff4d9d', mult: 14 },
];
export const MAX_TIER = 4;
/* All classes share the mythic tier ceiling. Two same-tier heroes rank up, preventing surplus legendary cards from becoming unusable. Mythic classes retain substantially higher base stats than ordinary classes of the same tier. */
export const maxTierOf = () => MAX_TIER;
/* Lowest possible birth tier determines codex bounds: special classes start at tier 1 and mythic classes at tier 2 through their recipes. */
export const minTierOf = (cls) => CLASSES[cls].mythic ? 2 : CLASSES[cls].special ? 1 : 0;

/* Four basic summonable classes and six recipe-only special classes. Attack kinds are melee, arrow and orb; modifiers include hits, burn, slowOnHit, splash, splashSlow, healOnKill and pierce. */
/* Short-range classes gain strong mechanics: knights deal critical bursts, guardians temporarily block enemies, and paladins combine both. */
export const CLASSES = {
  /* Basic classes. */
  knight: {
    name: '검사', emoji: '⚔️', atk: 'melee', dmg: 15, spd: 1.1, range: 100,
    crit: { chance: 0.3, mul: 2.5 },
    desc: '짧은 사거리 대신 압도적 한 방! 치명타로 크게 벱니다',
  },
  guard: {
    name: '수호병', emoji: '🛡️', atk: 'melee', dmg: 8, spd: 0.9, range: 105,
    slowOnHit: { mul: 0.55, dur: 1.6 },
    block: { period: 5.5, dur: 1.3 },
    desc: '방패 장벽으로 적을 잠시 멈춰 세워요! 때린 적은 느려집니다',
  },
  archer: { name: '궁수',   emoji: '🏹', atk: 'arrow', dmg: 9,  spd: 1.6, range: 200, desc: '멀리까지 화살을 쏘아요' },
  mage:   { name: '마법사', emoji: '🔮', atk: 'orb',   dmg: 14, spd: 0.7, range: 155, splash: 62, desc: '폭발 마법으로 여럿을 공격해요' },

  /* Special classes, available through recipes. */
  spellblade: {
    name: '마검사', emoji: '🗡️', special: true, recipe: ['knight', 'mage'],
    atk: 'melee', dmg: 15, spd: 1.0, range: 105, burn: 0.22,
    crit: { chance: 0.22, mul: 2.2 },
    desc: '불타는 검! 벤 적이 계속 불타고, 치명타도 터져요',
  },
  windblade: {
    name: '질풍검객', emoji: '🌪️', special: true, recipe: ['knight', 'archer'],
    atk: 'melee', dmg: 8, spd: 1.4, range: 105, hits: 2,
    crit: { chance: 0.25, mul: 2.0 },
    desc: '2연속 베기! 각 타격마다 치명타 기회',
  },
  paladin: {
    name: '성기사', emoji: '⚜️', special: true, recipe: ['knight', 'guard'],
    atk: 'melee', dmg: 12, spd: 0.95, range: 105, healOnKill: 1,
    crit: { chance: 0.25, mul: 2.2 },
    block: { period: 7, dur: 1.0 },
    desc: '치명타 + 방패 장벽 + 처치 시 성 회복까지! 최강 근접',
  },
  frostmage: {
    name: '빙결사', emoji: '❄️', special: true, recipe: ['guard', 'mage'],
    atk: 'orb', dmg: 10, spd: 0.6, range: 150, splash: 62, splashSlow: { mul: 0.6, dur: 1.3 },
    desc: '얼음 폭발로 여럿을 얼려요',
  },
  sentinel: {
    name: '파수꾼', emoji: '🎯', special: true, recipe: ['guard', 'archer'],
    atk: 'arrow', dmg: 13, spd: 0.8, range: 260, slowOnHit: { mul: 0.65, dur: 1.2 },
    desc: '아주 멀리서 저격! 맞은 적은 느려져요',
  },
  spiritarcher: {
    name: '정령궁수', emoji: '💫', special: true, recipe: ['archer', 'mage'],
    atk: 'arrow', dmg: 10, spd: 1.4, range: 190, splash: 40,
    desc: '화살이 별빛으로 폭발해요',
  },

  /* Mythic classes: the third generation combines two special classes. */
  swordsaint: {
    name: '검성', emoji: '⚡', mythic: true, recipe: ['spellblade', 'windblade'],
    atk: 'melee', dmg: 20, spd: 1.3, range: 115, hits: 2, burn: 0.3,
    crit: { chance: 0.35, mul: 2.6 }, cleave: true,
    desc: '사거리 안 모든 적을 2번씩 베고 불태운다! 치명타 35%',
  },
  archmage: {
    name: '대마도사', emoji: '🌌', mythic: true, recipe: ['frostmage', 'spiritarcher'],
    atk: 'orb', dmg: 22, spd: 0.85, range: 205, splash: 95,
    splashSlow: { mul: 0.5, dur: 1.8 }, burn: 0.2,
    desc: '거대한 별의 폭발 — 얼리고 불태우며 광범위를 쓸어버린다',
  },
  seraph: {
    name: '수호천사', emoji: '😇', mythic: true, recipe: ['paladin', 'sentinel'],
    atk: 'arrow', dmg: 24, spd: 0.95, range: 250,
    slowOnHit: { mul: 0.55, dur: 1.5 }, block: { period: 4.5, dur: 1.5 },
    healOnKill: 2, crit: { chance: 0.25, mul: 2.2 },
    desc: '초장거리 저격 + 방패 장벽 + 처치마다 성 회복 2 — 완전체',
  },
};

/* Enemy blocking rules. */
export const STUN_BOSS_MUL = 0.35;      // Bosses strongly resist blocking.
/* Temporary immunity after a block prevents stacked guardians from stopping enemies permanently. */
export const STUN_IMMUNE = 2.6;
export const RANGE_MAX = 260;           // Maximum value used to scale the UI range bar.
export const CLASS_KEYS = Object.keys(CLASSES);
/* Only four basic classes are summonable; special and mythic classes require recipes. */
export const GACHA_KEYS = CLASS_KEYS.filter(k => !CLASSES[k].special && !CLASSES[k].mythic);

/* Recipe list shared by codex and bots. Generation 2 is special; generation 3 is mythic. */
export const RECIPES = CLASS_KEYS
  .filter(k => CLASSES[k].recipe)
  .map(k => ({
    result: k,
    a: CLASSES[k].recipe[0],
    b: CLASSES[k].recipe[1],
    gen: CLASSES[k].mythic ? 3 : 2,
  }));

/* Legendary abilities change behavior, not only numbers. */
export const LEGEND_ABILITIES = {
  knight:       { name: '회전베기',   desc: '사거리 안 모든 적을 한 번에 벤다! 치명타 40%·3배' },
  guard:        { name: '서리 결계',  desc: '주변이 계속 느려지고, 방패 장벽이 더 자주·더 길게!' },
  archer:       { name: '관통 화살',  desc: '화살이 일직선의 적 3명을 꿰뚫는다!' },
  mage:         { name: '화염 폭발',  desc: '폭발이 커지고 적을 3초간 불태운다!' },
  spellblade:   { name: '화염 폭풍',  desc: '화상이 두 배로 강해진다!' },
  windblade:    { name: '삼연격',     desc: '한 번에 3번 벤다!' },
  paladin:      { name: '축복',       desc: '처치할 때마다 성이 3 회복! 장벽도 더 강하게' },
  frostmage:    { name: '절대영도',   desc: '폭발이 커지고 더 강하게 얼린다!' },
  sentinel:     { name: '이중 저격',  desc: '화살이 2명을 꿰뚫는다!' },
  spiritarcher: { name: '유성우',     desc: '폭발이 커지고 적을 불태운다!' },
};

/* Modifiers applied at legendary tier. */
export const LEGEND_OVERRIDES = {
  knight:       { cleave: true, crit: { chance: 0.4, mul: 3 } },
  guard:        { aura: 0.5, block: { period: 4, dur: 1.9 } },
  archer:       { pierce: 3 },
  mage:         { splashMul: 1.5, burn: 0.25 },
  spellblade:   { burn: 0.45 },
  windblade:    { hits: 3 },
  paladin:      { healOnKill: 3, block: { period: 5, dur: 1.5 } },
  frostmage:    { splashMul: 1.3, splashSlow: { mul: 0.45, dur: 2.0 } },
  sentinel:     { pierce: 2 },
  spiritarcher: { splashMul: 1.6, burn: 0.15 },
  /* Mythic classes at legendary tier, one step before mythic tier. */
  swordsaint:   { crit: { chance: 0.4, mul: 2.8 } },
  archmage:     { splashMul: 1.15 },
  seraph:       { pierce: 2 },
};

/* Additional modifiers applied at mythic tier. */
export const MYTHIC_OVERRIDES = {
  knight:       { crit: { chance: 0.45, mul: 3.4 } },
  guard:        { aura: 0.42, block: { period: 3.4, dur: 2.2 } },
  archer:       { pierce: 4 },
  mage:         { splashMul: 1.8, burn: 0.32 },
  spellblade:   { burn: 0.6, cleave: true },
  windblade:    { hits: 4 },
  paladin:      { healOnKill: 5, block: { period: 4, dur: 1.9 } },
  frostmage:    { splashMul: 1.6, splashSlow: { mul: 0.38, dur: 2.4 } },
  sentinel:     { pierce: 3 },
  spiritarcher: { splashMul: 1.9, burn: 0.25 },
  swordsaint:   { hits: 3, crit: { chance: 0.45, mul: 3 }, burn: 0.45 },
  archmage:     { splashMul: 1.35, burn: 0.3, splashSlow: { mul: 0.4, dur: 2.2 } },
  seraph:       { pierce: 3, healOnKill: 4, block: { period: 3.8, dur: 1.9 } },
};

/* Every class has a mythic ability name; descriptions must accurately reflect MYTHIC_OVERRIDES. */
export const MYTHIC_ABILITIES = {
  knight:       { name: '섬광 회전베기', desc: '사거리 안 전부 베고, 치명타 45%·3.4배!' },
  guard:        { name: '절대 결계',     desc: '결계가 더 짙어지고 장벽이 더 자주·더 길게!' },
  archer:       { name: '폭풍 관통',     desc: '화살이 일직선의 적 4명을 꿰뚫는다!' },
  mage:         { name: '초신성',        desc: '폭발이 최대로 커지고 더 뜨겁게 불태운다!' },
  spellblade:   { name: '겁화의 검무',   desc: '화상이 극에 달하고, 주변 전부를 벤다!' },
  windblade:    { name: '사연격',        desc: '한 번에 4번 벤다!' },
  paladin:      { name: '성역',          desc: '처치마다 성이 5 회복! 장벽도 더 강하게' },
  frostmage:    { name: '영겁의 빙하',   desc: '폭발이 커지고 적이 거의 멈출 만큼 얼린다!' },
  sentinel:     { name: '삼중 저격',     desc: '화살이 3명을 꿰뚫는다!' },
  spiritarcher: { name: '별의 폭우',     desc: '폭발이 최대로 커지고 적을 불태운다!' },
  swordsaint:   { name: '천검난무',   desc: '사거리 안 모든 적을 3번씩 베고 강하게 불태운다!' },
  archmage:     { name: '별의 종말',  desc: '폭발이 최대로 커지고 얼리며 불태운다!' },
  seraph:       { name: '천상의 심판', desc: '적 3명 관통 + 장벽 + 처치마다 성 회복 4!' },
};

export const PIERCE_WIDTH = 46;
export const BURN_DUR = 3;
/* Lucky rank-ups can jump two tiers, inspired by Lucky Defense, but cannot skip legendary costs. */
export const LUCKY_JUMP = 0.05;
export const LUCKY_MAX_TIER = 2;

/* Legacy army stats scale through tier and class combinations; fixed-party levels are handled separately. */
export function heroStats(cls, tier) {
  const C = CLASSES[cls];
  return { dmg: Math.round(C.dmg * TIERS[tier].mult) };
}

/* Projectile speed. */
export const ARROW_SPEED = 540;
export const ORB_SPEED = 300;
