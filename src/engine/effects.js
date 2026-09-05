/* Shared damage, status and kill-reward rules for ordinary combat, champions and tactics. Keep this layer below combat.js so tactics need not import combat internals. */
import * as D from '../data.js';
import { champKillXp, gainChampXp, chargeUlt } from './champion.js';
import { gainHeroXp, heroKillXp } from './squad.js';

export function damageEnemy(state, enemy, dmg, events, kind = 'hit', healOnKill = 0, visual = null, heroId = null) {
  if (enemy.dead) return;
  enemy.hp -= dmg;
  events.push({ type: 'enemyHit', x: enemy.x, y: enemy.y - enemy.size / 2, dmg, kind, ...(visual || {}) });
  if (enemy.hp > 0) return;

  enemy.dead = true;
  state.kills++;
  if (enemy.boss) state.bossKills++;
  if (enemy.midBoss) state.midBossKills++;
  state.combo.count++;
  state.combo.timer = D.COMBO.window;
  const mul = state.combo.count >= D.COMBO.x3At ? 3 : state.combo.count >= D.COMBO.x2At ? 2 : 1;
  const gold = enemy.gold * mul;
  state.gold += gold;
  state.goldEarned += gold;
  events.push({
    type: 'kill', x: enemy.x, y: enemy.y, gold, etype: enemy.type,
    boss: enemy.boss, midBoss: enemy.midBoss, name: enemy.name,
    combo: state.combo.count, mul,
  });
  if (healOnKill > 0 && state.castleHp < state.castleMax) {
    state.castleHp = Math.min(state.castleMax, state.castleHp + healOnKill);
    events.push({ type: 'castleHeal', amount: healOnKill, x: enemy.x, y: enemy.y });
  }
  if (state.champ) {
    gainChampXp(state, champKillXp(enemy), events);
    chargeUlt(state,
      enemy.boss ? D.ULT.boss : enemy.midBoss ? D.ULT.mid : enemy.elite ? D.ULT.elite : D.ULT.kill, events);
  }
  if (heroId != null) gainHeroXp(state, state.field.find((hero) => hero.id === heroId), heroKillXp(enemy), events);
}

export function applyBurn(enemy, dmg, ratio) {
  enemy.burn = { dps: Math.max(1, Math.round(dmg * ratio)), t: D.BURN_DUR };
}

export function applySlow(enemy, slow) {
  if (enemy.slowT > 0) enemy.slowMul = Math.min(enemy.slowMul, slow.mul);
  else enemy.slowMul = slow.mul;
  enemy.slowT = Math.max(enemy.slowT, slow.dur);
}

export function applyStun(enemy, dur) {
  if (enemy.stunImmuneT > 0) return false;
  const actual = dur * ((enemy.boss || enemy.midBoss) ? D.STUN_BOSS_MUL : 1);
  enemy.stunT = actual;
  enemy.stunImmuneT = actual + D.STUN_IMMUNE;
  return true;
}
