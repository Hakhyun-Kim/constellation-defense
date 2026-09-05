/* Persistent goals for the fixed four-hero squad.  They intentionally track
 * play decisions and milestones, not retired summon/combine rarity cells. */
import { ENEMY_TYPES } from './enemies.js';
import { SQUAD } from './squad.js';

export const CODEX_HERO_CELLS = SQUAD.length;
export const CODEX_ENEMY_CELLS = Object.keys(ENEMY_TYPES).length;

const squad = (c) => c.state?.field || [];
const anyHero = (c, predicate) => squad(c).some(predicate);
const everyHero = (c, predicate) => squad(c).length === SQUAD.length && squad(c).every(predicate);

export const ACHIEVEMENTS = [
  { key: 'firstLevel', emoji: '✦', name: '첫 성장',
    desc: '수호 영웅 한 명을 Lv 2로 성장시키기', shards: 2,
    check: (c) => anyHero(c, (hero) => hero.level >= 2) },
  { key: 'firstSpecialization', emoji: '✧', name: '전문화의 시작',
    desc: '수호 영웅의 전문화를 처음 선택하기', shards: 3,
    check: (c) => anyHero(c, (hero) => Object.values(hero.skills || {}).some((rank) => rank > 0)) },
  { key: 'squadLevel5', emoji: '🛡️', name: '함께 강해진다',
    desc: '네 수호 영웅을 모두 Lv 5로 성장시키기', shards: 8,
    unlocks: { axis: 'hair', key: 'pink' },
    check: (c) => everyHero(c, (hero) => hero.level >= 5) },

  { key: 'wave10', emoji: '🌊', name: '첫 번째 방벽',
    desc: '10 웨이브에 도달하기', shards: 5,
    check: (c) => c.bestWave >= 10 },
  { key: 'wave20', emoji: '🌊', name: '스무 번째 파도',
    desc: '20 웨이브에 도달하기', shards: 10,
    unlocks: { axis: 'hair', key: 'sky' },
    check: (c) => c.bestWave >= 20 },
  { key: 'victory', emoji: '🏰', name: '성의 수호자',
    desc: '30 웨이브를 막아 첫 승리를 달성하기', shards: 20,
    unlocks: { axis: 'outfit', key: 'sunset' },
    check: (c) => c.victories >= 1 },
  { key: 'trial', emoji: '⚔️', name: '별의 시련',
    desc: '시련에서 다시 30 웨이브를 막아내기', shards: 30,
    unlocks: { axis: 'star', key: 'lime' },
    check: (c) => c.trialClears >= 1 },

  { key: 'perfect3', emoji: '✨', name: '흔들림 없는 방패',
    desc: '성 피해 없이 웨이브를 3번 막아내기', shards: 6,
    check: (c) => !!c.state && c.state.perfectWaves >= 3 },
  { key: 'tactic10', emoji: '☄️', name: '별자리 지휘관',
    desc: 'Flare, Tide, Bloom 전술을 10번 발동하기', shards: 5,
    unlocks: { axis: 'hair', key: 'gold' },
    check: (c) => !!c.state && (c.state.tacticCasts || 0) >= 10 },
  { key: 'boss3', emoji: '👾', name: '성문 파괴자',
    /* Keep the historical achievement key for compatibility; the actual target is the first chapter's two regional bosses. */
    desc: '한 게임에서 지역 보스 2마리를 처치하기', shards: 8,
    check: (c) => !!c.state && c.state.bossKills >= 2 },
  { key: 'luna10', emoji: '🌟', name: '빛나는 루나',
    desc: '루나를 Lv 10으로 성장시키기', shards: 6,
    unlocks: { axis: 'weapon', key: 'dual' },
    check: (c) => !!c.state && squad(c).some((hero) => hero.heroKey === 'luna' && hero.level >= 10) },
  { key: 'tactic40', emoji: '☀️', name: '별자리의 숙련자',
    desc: '한 게임에서 전술을 40번 발동하기', shards: 10,
    unlocks: { axis: 'weapon', key: 'staff' },
    check: (c) => !!c.state && (c.state.tacticCasts || 0) >= 40 },
  { key: 'monsterDoc', emoji: '📚', name: '성문 기록관',
    desc: '모든 종류의 적을 한 번 이상 만나기', shards: 8,
    unlocks: { axis: 'star', key: 'sky' },
    check: (c) => Object.keys(ENEMY_TYPES).every((type) => (c.codex.kills[type] || 0) > 0) },
];

export const WARDROBE_LOCKS = {};
for (const achievement of ACHIEVEMENTS) {
  if (!achievement.unlocks) continue;
  (WARDROBE_LOCKS[achievement.unlocks.axis] || (WARDROBE_LOCKS[achievement.unlocks.axis] = {}))[achievement.unlocks.key] = achievement;
}
