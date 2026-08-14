/* =====================================================
 * 방어선 전술 해소 — 3매치 구현을 모르는 순수 디펜스 어댑터
 *
 * 입력 계약: { route, kind, size }. 어떤 퍼즐·카드·단축키가 이 명령을 만들었는지는
 * 이 계층의 관심사가 아니다. 따라서 3매치 보드를 교체해도 전투 규칙은 유지된다.
 * ===================================================== */
import * as D from '../data.js';
import { damageEnemy, applySlow } from './effects.js';
import { squadTacticMods } from './squad.js';
import { recordTacticMemory } from './run-memory.js';
import { chargeConstellationAid } from './constellation-aid.js';

const validSize = (size) => (size >= 5 ? 5 : size === 4 ? 4 : 3);

export function castTactic(state, route, kind, size = 3) {
  if (state.phase !== 'wave') return { ok: false, reason: 'phase' };
  const rule = D.TACTICS[kind];
  if (!rule || !Number.isInteger(route) || route < 0 || route >= D.ROUTES.length) return { ok: false, reason: 'tactic' };
  const stars = validSize(size);
  const targets = state.enemies.filter(enemy => !enemy.dead && enemy.route === route)
    .sort((a, b) => (b.s / D.ROUTE_LENS[b.route]) - (a.s / D.ROUTE_LENS[a.route]));
  if (!targets.length) return { ok: false, reason: 'none' };

  const events = [];
  const castleBefore = state.castleHp;
  const power = D.tacticPower(stars);
  const mods = squadTacticMods(state);
  if (kind === 'flare') {
    const baseCount = rule.targetCount[stars];
    const count = Number.isFinite(baseCount) ? baseCount + mods.flareTargetBonus : baseCount;
    for (const enemy of targets.slice(0, count)) {
      const dmg = Math.round((rule.baseDamage + state.wave * rule.waveDamage) * power * mods.flareDamageMul);
      events.push({
        type: 'starfall', x: enemy.x, y: enemy.y, radius: rule.impactRadius[stars],
        tactic: 'flare', stars, dmg, lethal: enemy.hp <= dmg,
      });
      damageEnemy(state, enemy, dmg, events, 'star', 0, { tactic: 'flare' });
    }
  } else if (kind === 'tide') {
    const baseSlow = rule.slow[stars];
    const slow = { ...baseSlow, dur: baseSlow.dur * mods.tideDurationMul };
    for (const enemy of targets) {
      applySlow(enemy, slow);
      events.push({ type: 'enemyHit', x: enemy.x, y: enemy.y - enemy.size / 2, dmg: 0, kind: 'slow' });
    }
  } else if (kind === 'bloom') {
    const amount = Math.round((rule.baseHeal + stars * rule.healPerStar) * power + mods.bloomHealBonus);
    state.castleHp = Math.min(state.castleMax, state.castleHp + amount);
    const near = targets[0];
    events.push({ type: 'castleHeal', amount, x: near.x, y: near.y });
    for (const enemy of targets.slice(0, rule.pushCount[stars])) {
      const from = { x: enemy.x, y: enemy.y };
      enemy.s = Math.max(0, enemy.s - rule.pushDistance[stars] - mods.bloomPushBonus);
      const point = D.routePoint(enemy.route, enemy.s);
      enemy.x = point.x; enemy.y = point.y;
      events.push({ type: 'tacticPush', fromX: from.x, fromY: from.y, x: enemy.x, y: enemy.y });
    }
  }
  state.tacticCasts = (state.tacticCasts || 0) + 1;
  const aid = chargeConstellationAid(state, stars);
  if (aid.gained) {
    events.push({ type: 'constellationCharge', gained: aid.gained, charge: aid.charge, needed: D.TACTICS.constellationAid.chargeNeeded });
    if (aid.becameReady) events.push({ type: 'constellationReady', charge: aid.charge, needed: D.TACTICS.constellationAid.chargeNeeded });
  }
  recordTacticMemory(state, {
    route, kind, size: stars,
    heal: Math.max(0, state.castleHp - castleBefore),
    pushes: events.filter((event) => event.type === 'tacticPush').length,
    castleHp: kind === 'bloom' ? castleBefore : null,
  });
  return { ok: true, events, targets: targets.length };
}
