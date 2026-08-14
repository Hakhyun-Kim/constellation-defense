/* A bankable four/five-match reward. This module deliberately knows nothing
 * about the match board or presentation: callers only receive engine events
 * and a standard projectile. */
import * as D from '../data.js';

const aliveOnRoute = (state, route) => state.enemies
  .filter((enemy) => !enemy.dead && enemy.route === route);

const enemyPriority = (enemy) => 1 + (enemy.s / D.ROUTE_LENS[enemy.route]) * 2.5
  + (enemy.boss ? 9 : enemy.midBoss ? 4.5 : enemy.elite ? .6 : 0);

export function constellationAidTargetRoute(state) {
  let best = null;
  for (let route = 0; route < D.ROUTES.length; route++) {
    const enemies = aliveOnRoute(state, route);
    if (!enemies.length) continue;
    const score = enemies.reduce((sum, enemy) => sum + enemyPriority(enemy), 0);
    if (!best || score > best.score || (score === best.score && route < best.route)) best = { route, score };
  }
  return best;
}

export function chargeConstellationAid(state, size) {
  const spec = D.TACTICS.constellationAid;
  const gained = spec.marks[Math.min(5, Math.max(3, Math.round(size)))] || 0;
  const aid = state.constellationAid || (state.constellationAid = { charge: 0 });
  const before = aid.charge || 0;
  aid.charge = Math.min(spec.chargeNeeded, before + gained);
  return {
    gained: aid.charge - before,
    charge: aid.charge,
    ready: aid.charge >= spec.chargeNeeded,
    becameReady: before < spec.chargeNeeded && aid.charge >= spec.chargeNeeded,
  };
}

export function canCastConstellationAid(state) {
  const spec = D.TACTICS.constellationAid;
  if (state.phase !== 'wave') return { ok: false, reason: 'phase', spec };
  if ((state.constellationAids || []).length) return { ok: false, reason: 'active', spec };
  if ((state.constellationAid?.charge || 0) < spec.chargeNeeded) {
    return { ok: false, reason: 'charge', spec, charge: state.constellationAid?.charge || 0 };
  }
  const target = constellationAidTargetRoute(state);
  if (!target) return { ok: false, reason: 'none', spec };
  return { ok: true, spec, target };
}

export function castConstellationAid(state, route = null) {
  const available = canCastConstellationAid(state);
  if (!available.ok) return available;
  const target = route == null ? available.target : { route };
  if (!Number.isInteger(target.route) || target.route < 0 || target.route >= D.ROUTES.length) {
    return { ok: false, reason: 'route', spec: available.spec };
  }
  if (!aliveOnRoute(state, target.route).length) return { ok: false, reason: 'none', spec: available.spec };
  const point = D.routePoint(target.route, D.ROUTE_LENS[target.route] * available.spec.deployProgress);
  const summon = {
    id: state.nextId++, route: target.route, x: point.x, y: point.y,
    life: available.spec.duration, attackCd: .1, attacks: 0,
  };
  state.constellationAids.push(summon);
  state.constellationAid.charge = 0;
  state.constellationAidCasts = (state.constellationAidCasts || 0) + 1;
  return {
    ok: true, spec: available.spec, summon,
    events: [{ type: 'constellationAidSummon', summonId: summon.id, route: summon.route, x: summon.x, y: summon.y }],
  };
}

export function updateConstellationAids(state, dt, events) {
  const spec = D.TACTICS.constellationAid;
  for (const summon of state.constellationAids || []) {
    summon.life -= dt;
    summon.attackCd -= dt;
    if (summon.life <= 0) {
      events.push({ type: 'constellationAidDismiss', summonId: summon.id, x: summon.x, y: summon.y });
      continue;
    }
    if (summon.attackCd > 0) continue;
    const target = aliveOnRoute(state, summon.route)
      .sort((a, b) => enemyPriority(b) - enemyPriority(a) || a.id - b.id)[0];
    if (!target) { summon.attackCd = .2; continue; }
    const dmg = Math.round(spec.damage * (target.boss ? spec.bossDamageMul : 1));
    summon.attackCd = spec.attackPeriod;
    summon.attacks++;
    state.projectiles.push({
      id: state.nextId++, kind: 'constellation', x: summon.x, y: summon.y,
      srcX: summon.x, srcY: summon.y, target, dmg, spd: spec.projectileSpeed,
      dead: false, splash: 0, pierce: 1,
    });
    events.push({
      type: 'constellationAidAttack', summonId: summon.id, route: summon.route,
      x: summon.x, y: summon.y, tx: target.x, ty: target.y, dmg, boss: !!target.boss,
    });
  }
  state.constellationAids = (state.constellationAids || []).filter((summon) => summon.life > 0);
}
