/* Champion stats, progression and skills. Combat actions live in combat.js. */
import * as D from '../data.js';

/* Combine level, skill and blessing modifiers; the calculation is cheap enough per tick. */
export function champStats(state) {
  const c = state.champ;
  const sk = c.skills;
  const dmg = Math.round(
    (D.CHAMP.baseDmg + D.CHAMP.dmgPerLv * (c.level - 1))
    * (1 + 0.25 * (sk.blade1 || 0)) * D.champDmgMul(state.meta.champDmg));
  const maxHp = Math.round(
    (D.CHAMP.baseHp + D.CHAMP.hpPerLv * (c.level - 1))
    * (1 + 0.3 * (sk.guard1 || 0)) * D.champHpMul(state.meta.champHp));
  return {
    dmg, maxHp,
    spd: D.CHAMP.spd * (1 + 0.18 * (sk.blade2 || 0)),
    range: D.CHAMP.range, moveSpd: D.CHAMP.moveSpd, crit: D.CHAMP.crit,
    cleave: (sk.blade3 || 0) > 0,
    starDmg: Math.round((D.STAR.base + dmg * D.STAR.dmgMul) * (1 + 0.35 * (sk.star1 || 0))),
    starCd: D.STAR.cd * Math.max(0.5, 1 - 0.2 * (sk.star2 || 0)),
    starCount: (sk.star3 || 0) > 0 ? 3 : 1,
    healOnKill: sk.guard2 || 0,
    aura: (sk.guard3 || 0) > 0 ? D.CHAMP_AURA : null,
  };
}

export const champKillXp = (e) =>
  e.boss ? D.CHAMP_XP.boss : e.midBoss ? D.CHAMP_XP.midBoss : e.elite ? D.CHAMP_XP.elite : D.CHAMP_XP.kill;

export function gainChampXp(state, amount, events = []) {
  const c = state.champ;
  if (!c || !(amount > 0) || c.level >= D.CHAMP_XP.maxLevel) return;
  c.xp += amount;
  let need = D.champXpNeed(c.level);
  while (c.xp >= need && c.level < D.CHAMP_XP.maxLevel) {
    c.xp -= need;
    c.level++;
    c.sp++;
    const grown = champStats(state).maxHp;
    /* Level-ups heal the max-HP increase plus one quarter of maximum health to provide mid-combat recovery. */
    if (!c.ko) c.hp = Math.min(grown, c.hp + (grown - c.maxHp) + Math.round(grown * 0.25));
    c.maxHp = grown;
    events.push({ type: 'champLevel', level: c.level, x: c.x, y: c.y });
    need = D.champXpNeed(c.level);
  }
}

export function chargeUlt(state, amount, events) {
  const c = state.champ;
  if (!c || c.ult >= 1) return;
  c.ult = Math.min(1, c.ult + amount * (state.champUltMul || 1));
  if (c.ult >= 1) events.push({ type: 'ultReady' });
}

/* Count points already spent in the same constellation for prerequisites. */
export const branchSpent = (c, branch) =>
  Object.entries(c.skills).reduce((s, [k, v]) =>
    s + (D.CHAMP_SKILLS[k] && D.CHAMP_SKILLS[k].branch === branch ? v : 0), 0);

export function takeSkill(state, key) {
  const c = state.champ;
  const SK = D.CHAMP_SKILLS[key];
  if (!c || !SK) return { ok: false };
  const cur = c.skills[key] || 0;
  if (cur >= SK.max) return { ok: false, reason: 'max' };
  if (c.sp < 1) return { ok: false, reason: 'sp' };
  const spent = branchSpent(c, SK.branch);
  if (spent < SK.need) return { ok: false, reason: 'need', need: SK.need, spent };
  c.sp--;
  c.skills[key] = cur + 1;
  /* Health skills immediately heal their max-HP increase. */
  const S = champStats(state);
  if (S.maxHp > c.maxHp && !c.ko) c.hp += S.maxHp - c.maxHp;
  c.maxHp = S.maxHp;
  c.hp = Math.min(c.hp, c.maxHp);
  return { ok: true, rank: cur + 1, skill: SK };
}
