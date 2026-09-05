/* Wave generation, spawning, combat ticks and champion spells. Enemies choose weighted routes; attacks use data-driven multi-hit, burn, slow, splash, healing and piercing modifiers. */
import * as D from '../data.js';
import { champStats, champKillXp, gainChampXp, chargeUlt } from './champion.js';
import { heroMods } from './roster.js';
import { grantSquadWaveXp } from './squad.js';
import { damageEnemy, applyBurn, applySlow, applyStun } from './effects.js';
import { createResonance, resonanceDamageMul } from './resonance.js';
import { completeJourneyWave, journeyBattleProgress, journeyEncounter } from './journey.js';
import { updateMonsterBlueprints } from './blueprints.js';
import { updateConstellationAids } from './constellation-aid.js';

/* Wave generation. */
function pickWeighted(state, mix) {
  let total = 0;
  for (const m of mix) total += m.weight;
  let r = state.rng() * total;
  for (const m of mix) { r -= m.weight; if (r < 0) return m.type; }
  return mix[0].type;
}

function pickRoute(state) {
  let r = state.rng();
  for (let i = 0; i < D.ROUTE_WEIGHTS.length; i++) {
    r -= D.ROUTE_WEIGHTS[i];
    if (r < 0) return i;
  }
  return 0;
}

/* Create squad-based waves with bosses near the end. */
export function buildWave(state) {
  const w = state.wave;
  const encounter = journeyEncounter(state);
  /* Maintain ordinary enemy totals, but send the final three alongside the boss across three lanes to avoid a boss-only cleanup phase. */
  const formationMinions = encounter.kind === 'patrol' ? 0 : 3;
  const total = Math.max(0, Math.round(D.waveCount(w) * state.diff.countMul) - formationMinions);
  const mix = D.waveMix(w);
  const list = [];
  let t = 1.2;
  let spawned = 0;
  while (spawned < total) {
    const size = Math.min(D.squadSize(w), total - spawned);
    /* Squads usually share one enemy kind; 30% are mixed. */
    const uniform = state.rng() < 0.7;
    const squadType = pickWeighted(state, mix);
    const route = pickRoute(state);          // Squad members travel the same path together.
    for (let i = 0; i < size; i++) {
      list.push({
        t: t + i * D.SQUAD_INNER_GAP,
        type: uniform ? squadType : pickWeighted(state, mix),
        route,
      });
    }
    spawned += size;
    t += size * D.SQUAD_INNER_GAP + D.squadGap(w) * (0.8 + state.rng() * 0.4);
  }

  if (encounter.kind !== 'patrol') {
    const formationT = t + 1.6;
    const midType = D.midBossType(w);
    const warnTier = encounter.boss ? 'great' : 'mid';
    const warnType = encounter.boss ? D.greatBossType(encounter.region, w) : midType;
    list.push({ t: formationT - D.BOSS_WARN_LEAD, warnOnly: true, tier: warnTier, etype: warnType });

    /* Troops open all three lanes before the commander advances. */
    for (let route = 0; route < 3; route++) {
      list.push({ t: formationT - 0.42 + route * 0.16, type: pickWeighted(state, mix), route });
    }

    if (encounter.kind === 'commander') {
      list.push({ t: formationT, type: midType, route: w % 3 });
    } else {
      /* The main boss and commanders arrive together. The final region adds commanders on both flanks for a distinct finale silhouette. */
      const bType = D.greatBossType(encounter.region, w);
      list.push({ t: formationT, type: bType });
      const lieutenantRoutes = encounter.chapterFinal ? [0, 2] : [w % 2 ? 0 : 2];
      lieutenantRoutes.forEach((route, index) => list.push({
        t: formationT + 0.12 + index * 0.16,
        type: D.midBossType(w, index),
        route,
        lieutenant: true,
        silentBossBanner: true,
      }));
    }
  }
  return list;
}

export function waveSummary(state) {
  const counts = {};
  for (const s of (state.pendingWave || [])) {
    if (s.warnOnly) continue;
    counts[s.type] = (counts[s.type] || 0) + 1;
  }
  return counts;
}

/* Current mythic hero count drives mythic pressure in enemies.js. */
export const mythicCount = () => 0;

export function startWave(state) {
  if (state.phase !== 'prep') return { ok: false };
  state.phase = 'wave';
  /* Snapshot mythic pressure at wave start so a mid-combat combination does not unexpectedly change visible enemy health. */
  state.mythicPress = 0;
  state.spawnQueue = [...(state.pendingWave || buildWave(state))];
  state.waveT = 0;
  state.blueprintSummons = [];
  state.constellationAids = [];
  state.waveDmgTaken = 0;                  // Track damage for perfect defense; repairs do not restore eligibility.
  for (const hero of state.field) hero.activeCd = 0;
  if (state.champ) {                       // The champion starts each wave at the gate plaza.
    state.champ.x = D.CHAMP_HOME.x;
    state.champ.y = D.CHAMP_HOME.y;
    state.champ.targetId = null;
    state.champ.holdT = 0;
    state.champ.spellReadyT = 0;
  }
  const encounter = journeyEncounter(state);
  return { ok: true, boss: encounter.boss, encounter };
}

function spawnEnemy(state, type, events, presetRoute, spawn = {}) {
  const E = D.ENEMY_TYPES[type];
  const w = state.wave;
  const rampMul = E.midBoss ? D.midBossRamp(w) : 1;
  /* Some ordinary enemies spawn as elites; use one clear normal/elite distinction rather than multiple enemy tiers. */
  const elite = !E.boss && !E.midBoss && state.rng() < D.eliteChance(w);
  const press = state.mythicPress || 0;
  const loop = state.loop || 0;          // Star Trial loops increase both enemy strength and rewards.
  const lieutenant = spawn.lieutenant ? D.BOSS_LIEUTENANT : null;
  const hp = Math.round(E.hp * D.hpScale(w) * state.diff.hpMul * rampMul
    * (lieutenant?.hpMul || 1)
    * (elite ? D.ELITE.hpMul : 1) * D.mythicHpMul(press) * D.loopHpMul(loop));
  /* The main boss takes the shortcut. */
  const route = E.boss ? D.BOSS_ROUTE : (presetRoute != null ? presetRoute : pickRoute(state));
  const start = D.routePoint(route, 0);
  const e = {
    id: state.nextId++, type, route,
    hp, maxHp: hp,
    s: 0,
    off: state.ri(-10, 10),
    x: start.x, y: start.y,
    spd: E.spd * (0.92 + state.rng() * 0.16),
    gold: Math.round(E.gold * D.enemyGoldScale(w) * state.diff.goldMul
      * (lieutenant?.goldMul || 1)
      * (elite ? D.ELITE.goldMul : 1) * D.mythicGoldMul(press) * D.loopGoldMul(loop)),
    castleDmg: E.castleDmg * D.loopCastleDmgMul(loop) * (lieutenant?.castleDmgMul || 1),
    size: E.size * (elite ? D.ELITE.sizeMul : 1), boss: !!E.boss, midBoss: !!E.midBoss,
    elite,
    name: lieutenant ? `호위 ${E.name}` : (elite ? `${D.ELITE.name} ${E.name}` : E.name),
    enrageAt: E.enrageAt || 0, enrageSpd: E.enrageSpd || 1, enraged: false,
    heal: E.heal || 0, healPeriod: E.healPeriod || 0, healRange: E.healRange || 0,
    healCd: E.healPeriod || 0,
    slowT: 0, slowMul: 1, auraMul: 1, stunT: 0, stunImmuneT: 0, stunned: false,
    dead: false,
  };
  state.enemies.push(e);
  events.push({ type: 'spawn', etype: type, x: e.x, y: e.y, boss: e.boss, midBoss: e.midBoss });
  if (e.boss) events.push({ type: 'bossSpawn', tier: 'great', name: E.name, emoji: E.emoji, x: e.x, y: e.y, enemyId: e.id });
  else if (e.midBoss && !spawn.silentBossBanner) events.push({ type: 'bossSpawn', tier: 'mid', name: E.name, emoji: E.emoji, x: e.x, y: e.y, enemyId: e.id });
}

function firstInRange(state, x, y, range) {
  let target = null, best = -1;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (Math.hypot(e.x - x, e.y - y) <= range) {
      /* Compare normalized route progress because path lengths differ; prioritize enemies nearest the gate. */
      const prog = e.s / D.ROUTE_LENS[e.route];
      if (prog > best) { best = prog; target = e; }
    }
  }
  return target;
}

function meleeStrike(state, h, mods, e, events) {
  const baseDmg = Math.round(h.dmg * (state.squad ? 1 : resonanceDamageMul(state, e.route)));
  for (let k = 0; k < mods.hits; k++) {
    /* Critical strikes compensate for short attack range with burst damage. */
    const crit = mods.crit && state.rng() < mods.crit.chance;
    const dmg = crit ? Math.round(baseDmg * mods.crit.mul) : baseDmg;
    damageEnemy(state, e, dmg, events, crit ? 'crit' : 'hit', mods.healOnKill, null, h.id);
    if (e.dead) break;
  }
  if (!e.dead) {
    if (mods.burn) applyBurn(e, baseDmg, mods.burn);
    if (mods.slowOnHit) applySlow(e, mods.slowOnHit);
  }
}

function updateHeroes(state, dt, events) {
  for (const h of state.field) {
    if (h.activeCd > 0) h.activeCd = Math.max(0, h.activeCd - dt);
    const mods = heroMods(h);

    /* Shield barriers periodically stop every enemy in range. */
    if (mods.block) {
      h.blockCd = (h.blockCd == null ? mods.block.period * 0.5 : h.blockCd) - dt;
      if (h.blockCd <= 0) {
        const inRange = state.enemies.filter(e =>
          !e.dead && Math.hypot(e.x - h.x, e.y - h.y) <= mods.range);
        let stunned = 0;
        for (const e of inRange) if (applyStun(e, mods.block.dur)) stunned++;
        if (stunned) {
          h.blockCd = mods.block.period;
          events.push({
            type: 'block', x: h.x, y: h.y, heroId: h.id,
            range: mods.range, count: stunned, dur: mods.block.dur,
          });
        } else {
          h.blockCd = 0;                    // Wait when there are no targets to block.
        }
      }
    }

    h.cd -= dt;
    if (h.cd > 0) continue;
    const target = firstInRange(state, h.x, h.y, mods.range);
    if (!target) continue;
    h.cd = 1 / mods.spd;

    if (mods.atk === 'melee') {
      if (mods.cleave) {
        for (const e of [...state.enemies]) {
          if (e.dead) continue;
          if (Math.hypot(e.x - h.x, e.y - h.y) <= mods.range) meleeStrike(state, h, mods, e, events);
        }
        events.push({ type: 'meleeHit', x: h.x, y: h.y, cls: h.cls, heroId: h.id, cleave: true, tx: target.x, ty: target.y });
      } else {
        meleeStrike(state, h, mods, target, events);
        events.push({
          type: 'meleeHit', x: target.x, y: target.y, cls: h.cls, heroId: h.id,
          tx: target.x, ty: target.y,
          slow: !!mods.slowOnHit, burn: !!mods.burn, hits: mods.hits,
        });
      }
    } else {
      state.projectiles.push({
        id: state.nextId++,
        kind: mods.atk,                    // 'arrow' | 'orb'
        x: h.x, y: h.y - 22, target,
        dmg: h.dmg,
        spd: mods.atk === 'arrow' ? D.ARROW_SPEED : D.ORB_SPEED,
        dead: false,
        splash: mods.splash || 0,
        splashSlow: mods.splashSlow,
        slowOnHit: mods.slowOnHit,
        burn: mods.burn,
        pierce: mods.pierce,
        heroId: h.id,
        srcX: h.x, srcY: h.y,
      });
      events.push({ type: 'shoot', kind: mods.atk, x: h.x, y: h.y, heroId: h.id, tx: target.x, ty: target.y });
    }
  }
}

/* Champion combat. */
function champStrike(state, e, dmg, crit, S, events) {
  damageEnemy(state, e, dmg, events, crit ? 'crit' : 'hit', 0);
  if (e.dead) {
    state.champKills++;
    /* Add only the direct-kill XP bonus; damageEnemy already awarded base XP. */
    gainChampXp(state, champKillXp(e) * (D.CHAMP_XP.ownKillMul - 1), events);
    if (S.healOnKill > 0 && state.castleHp < state.castleMax) {
      state.castleHp = Math.min(state.castleMax, state.castleHp + S.healOnKill);
      events.push({ type: 'castleHeal', amount: S.healOnKill, x: e.x, y: e.y });
    }
  }
}

const enemyProg = (e) => e.s / D.ROUTE_LENS[e.route];

function updateChampion(state, dt, events) {
  const c = state.champ;
  if (!c) return;
  /* Recompute holds every tick so leaving or being knocked out cannot leave enemies stopped forever. */
  for (const e of state.enemies) e.held = false;
  if (c.ko) return;
  const S = champStats(state);
  c.maxHp = S.maxHp;
  if (c.hp > c.maxHp) c.hp = c.maxHp;
  c.cd -= dt;
  if (c.spellCd > 0) { c.spellCd = Math.max(0, c.spellCd - dt); c.spellReadyT = 0; }

  /* Prioritize the ordinary enemy closest to the gate. Engage bosses only when no ordinary targets remain, preserving the champion's spells during boss fights. Switch only for a clearly more advanced target to avoid zigzagging. */
  let cur = c.targetId != null ? state.enemies.find(e => e.id === c.targetId && !e.dead) : null;
  let bestN = null, bpN = -1, bestB = null, bpB = -1;
  for (const e of state.enemies) {
    if (e.dead) continue;
    const p = enemyProg(e);
    if (e.boss || e.midBoss) { if (p > bpB) { bpB = p; bestB = e; } }
    else if (p > bpN) { bpN = p; bestN = e; }
  }
  const best = bestN || bestB;
  const bp = bestN ? bpN : bpB;
  if (!cur) cur = best;
  else if ((cur.boss || cur.midBoss) && bestN) cur = bestN;   // Disengage the boss when ordinary enemies appear.
  else if (best && best !== cur && bp > enemyProg(cur) + 0.12) cur = best;
  c.targetId = cur ? cur.id : null;

  if (!cur) {
    /* Return to the plaza when no targets remain. */
    c.holdT = 0;
    const hx = D.CHAMP_HOME.x - c.x, hy = D.CHAMP_HOME.y - c.y;
    const hd = Math.hypot(hx, hy);
    c.moving = hd > 6;
    if (c.moving) {
      const step = Math.min(S.moveSpd * dt, hd);
      c.x += (hx / hd) * step; c.y += (hy / hd) * step;
      c.dirX = hx / hd; c.dirY = hy / hd;
    }
    return;
  }

  const dx = cur.x - c.x, dy = cur.y - c.y;
  const dist = Math.hypot(dx, dy);
  const reach = S.range + cur.size * 0.35;
  if (dist > reach) {
    const step = Math.min(S.moveSpd * dt, dist);
    c.x += (dx / dist) * step; c.y += (dy / dist) * step;
    c.dirX = dx / dist; c.dirY = dy / dist;
    c.moving = true;
    c.holdT = 0;
    return;
  }
  c.moving = false;
  c.dirX = dist > 0.01 ? dx / dist : c.dirX;
  c.dirY = dist > 0.01 ? dy / dist : c.dirY;

  /* Ordinary enemies stop while held by the champion; bosses push through. */
  if (!cur.boss && !cur.midBoss && (cur.holdImmuneT || 0) <= 0) {
    cur.held = true;
    c.holdT += dt;
    if (c.holdT >= D.CHAMP_HOLD.max) {
      cur.holdImmuneT = D.CHAMP_HOLD.immune;   // Limit hold duration to prevent stalemates.
      c.holdT = 0;
    }
  }

  /* Attack. */
  if (c.cd <= 0) {
    c.cd = 1 / S.spd;
    const crit = S.crit && state.rng() < S.crit.chance;
    const dmg = crit ? Math.round(S.dmg * S.crit.mul) : S.dmg;
    if (S.cleave) {
      for (const e of [...state.enemies]) {
        if (e.dead) continue;
        if (Math.hypot(e.x - c.x, e.y - c.y) <= S.range + e.size * 0.35) champStrike(state, e, dmg, crit, S, events);
      }
    } else {
      champStrike(state, cur, dmg, crit, S, events);
    }
    events.push({ type: 'champAttack', x: c.x, y: c.y, tx: cur.x, ty: cur.y, cleave: S.cleave, crit });
  }

  /* The engaged enemy retaliates, scaling with its castle damage at later waves. */
  if (!cur.dead) {
    const retal = cur.castleDmg * D.castleDmgScale(state.wave) * D.CHAMP.contactRatio
      * ((cur.boss || cur.midBoss) ? D.CHAMP.bossContactMul : 1);
    c.hurtAcc += retal * dt;
    const whole = Math.floor(c.hurtAcc);
    if (whole >= 1) {
      c.hurtAcc -= whole;
      c.hp -= whole;
      events.push({ type: 'champHurt', dmg: whole, x: c.x, y: c.y });
      if (c.hp <= 0) {
        c.hp = 0;
        c.ko = true;
        c.targetId = null;
        c.holdT = 0;
        for (const e of state.enemies) e.held = false;
        events.push({ type: 'champKo', x: c.x, y: c.y });
      }
    }
  }
}

/* Auto-cast Starfall after it has remained ready and unused for the configured delay. */
function champAutoCast(state, dt, events) {
  const c = state.champ;
  if (!c || c.ko || c.spellCd > 0) return;
  if (!state.enemies.some(e => !e.dead)) { c.spellReadyT = 0; return; }
  c.spellReadyT += dt;
  if (c.spellReadyT >= D.STAR.autoAfter) {
    c.spellReadyT = 0;
    const r = castStar(state);
    if (r.ok) {
      events.push({ type: 'starAuto' });
      for (const ev of r.events) events.push(ev);
    }
  }
}

/* Player-triggered champion spells. */
export function castStar(state) {
  const c = state.champ;
  if (!c || state.phase !== 'wave') return { ok: false, reason: 'phase' };
  if (c.ko) return { ok: false, reason: 'ko' };
  if (c.spellCd > 0) return { ok: false, reason: 'cd', left: c.spellCd };
  const alive = state.enemies.filter(e => !e.dead);
  if (!alive.length) return { ok: false, reason: 'none' };
  const S = champStats(state);
  /* Target priority: main boss, commander, then enemy closest to the gate. */
  const targets = alive.slice().sort((a, b) =>
    ((b.boss ? 1 : 0) - (a.boss ? 1 : 0)) ||
    ((b.midBoss ? 1 : 0) - (a.midBoss ? 1 : 0)) ||
    (enemyProg(b) - enemyProg(a))
  ).slice(0, S.starCount);
  c.spellCd = S.starCd;
  c.spellReadyT = 0;
  state.starCasts++;
  const events = [];
  for (const t of targets) {
    const dmg = S.starDmg + Math.round(t.maxHp * D.STAR.pctHp);
    events.push({ type: 'starfall', x: t.x, y: t.y, radius: D.STAR.splash });
    damageEnemy(state, t, dmg, events, 'star');
    for (const e of alive) {
      if (e.dead || e === t) continue;
      if (Math.hypot(e.x - t.x, e.y - t.y) <= D.STAR.splash) {
        damageEnemy(state, e, Math.round(dmg * D.STAR.splashRatio), events, 'star');
      }
    }
  }
  return { ok: true, events, targets: targets.length };
}

export function castUlt(state) {
  const c = state.champ;
  if (!c || state.phase !== 'wave') return { ok: false, reason: 'phase' };
  if (c.ko) return { ok: false, reason: 'ko' };
  if (c.ult < 1) return { ok: false, reason: 'charge', ult: c.ult };
  const alive = state.enemies.filter(e => !e.dead);
  if (!alive.length) return { ok: false, reason: 'none' };
  const S = champStats(state);
  c.ult = 0;
  state.ultCasts++;
  const events = [{ type: 'ultCast', hits: alive.map(e => ({ x: e.x, y: e.y })) }];
  for (const e of alive) {
    const dmg = Math.round(S.dmg * D.ULT.dmgMul + e.maxHp * D.ULT.pctHp);
    damageEnemy(state, e, dmg, events, 'star');
    if (!e.dead) applySlow(e, D.ULT.slow);
  }
  return { ok: true, events };
}

function updateTower(state, dt, events) {
  const lv = state.castle.tower;
  if (lv <= 0) return;
  state.towerCd -= dt;
  if (state.towerCd > 0) return;
  const target = firstInRange(state, D.CASTLE_POS.x, D.CASTLE_POS.y, D.TOWER_RANGE);
  if (!target) return;
  state.towerCd = D.TOWER_PERIOD(lv);
  state.projectiles.push({
    id: state.nextId++, kind: 'bolt',
    x: D.CASTLE_POS.x, y: D.CASTLE_POS.y - 20,
    target, dmg: D.TOWER_DMG(lv), spd: 420, dead: false,
    splash: 0, pierce: 1,
  });
  events.push({ type: 'shoot', kind: 'bolt', x: D.CASTLE_POS.x, y: D.CASTLE_POS.y });
}

function updateEnemies(state, dt, events) {
  /* Frost barrier aura slow. */
  const auraHeroes = [];
  for (const h of state.field) {
    const mods = heroMods(h);
    if (mods.aura) auraHeroes.push({ h, aura: mods.aura, range: mods.range });
  }
  for (const e of state.enemies) e.auraMul = 1;
  for (const g of auraHeroes) {
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - g.h.x, e.y - g.h.y) <= g.range) e.auraMul = Math.min(e.auraMul, g.aura);
    }
  }
  /* The champion's Star Barrier slows nearby enemies. */
  const champ = state.champ;
  if (champ && !champ.ko && (champ.skills.guard3 || 0) > 0) {
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - champ.x, e.y - champ.y) <= D.CHAMP_AURA.range) {
        e.auraMul = Math.min(e.auraMul, D.CHAMP_AURA.mul);
      }
    }
  }

  for (const e of state.enemies) {
    if (e.dead) continue;

    if (e.burn) {
      e.burn.t -= dt;
      e.burnAcc = (e.burnAcc || 0) + e.burn.dps * dt;
      const whole = Math.floor(e.burnAcc);
      if (whole >= 1) {
        e.burnAcc -= whole;
        damageEnemy(state, e, whole, events, 'burn');
        if (e.dead) continue;
      }
      if (e.burn && e.burn.t <= 0) delete e.burn;
    }

    if (e.heal) {
      e.healCd -= dt;
      if (e.healCd <= 0) {
        e.healCd = e.healPeriod;
        let ally = null, worst = 1;
        for (const o of state.enemies) {
          if (o.dead || o === e) continue;
          const ratio = o.hp / o.maxHp;
          if (ratio < worst && Math.hypot(o.x - e.x, o.y - e.y) <= e.healRange) { worst = ratio; ally = o; }
        }
        if (ally) {
          ally.hp = Math.min(ally.maxHp, ally.hp + e.heal);
          events.push({ type: 'heal', x: ally.x, y: ally.y, from: { x: e.x, y: e.y } });
        }
      }
    }

    /* Main bosses enrage below half health. */
    if (e.enrageAt && !e.enraged && e.hp / e.maxHp <= e.enrageAt) {
      e.enraged = true;
      e.spd *= e.enrageSpd;
      events.push({ type: 'bossEnrage', x: e.x, y: e.y, name: e.name });
    }

    if (e.slowT > 0) e.slowT -= dt;
    let mul = 1;
    if (e.slowT > 0) mul = Math.min(mul, e.slowMul);
    mul = Math.min(mul, e.auraMul);
    e.slowed = mul < 1;

    if (e.stunImmuneT > 0) e.stunImmuneT -= dt;
    if (e.holdImmuneT > 0) e.holdImmuneT -= dt;
    /* A shield block prevents movement entirely. */
    if (e.stunT > 0) {
      e.stunT -= dt;
      e.stunned = true;
      continue;
    }
    e.stunned = false;
    /* The champion holds this enemy in place; updateChampion recomputes it every tick. */
    if (e.held) continue;

    e.s += e.spd * mul * dt;
    const routeLen = D.ROUTE_LENS[e.route];
    if (e.s >= routeLen) {
      e.dead = true;
      const dmg = Math.round(e.castleDmg * D.castleDmgScale(state.wave));
      state.castleHp = Math.max(0, state.castleHp - dmg);
      state.waveDmgTaken = (state.waveDmgTaken || 0) + dmg;
      events.push({ type: 'castleHit', dmg, x: e.x, y: e.y });
      if (state.castleHp <= 0) {
        gameOver(state, events);
        return;
      }
      continue;
    }
    const p = D.routePoint(e.route, e.s);
    e.x = p.x + (-p.dy) * e.off;
    e.y = p.y + (p.dx) * e.off;
    e.dirX = p.dx; e.dirY = p.dy;
  }
}

function updateProjectiles(state, dt, events) {
  for (const p of state.projectiles) {
    if (p.dead) continue;
    let t = p.target;
    if (!t || t.dead) {
      let best = 150; t = null;
      for (const e of state.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < best) { best = d; t = e; }
      }
      if (!t) { p.dead = true; continue; }
      p.target = t;
    }
    const dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = p.spd * dt;
    if (d <= step + 14) {
      p.dead = true;
      if (p.splash > 0) {
        events.push({ type: 'explode', x: t.x, y: t.y, radius: p.splash, big: p.splash > 66, frost: !!p.splashSlow });
        for (const e of state.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - t.x, e.y - t.y) <= p.splash) {
            const dmg = Math.round(p.dmg * (state.squad ? 1 : resonanceDamageMul(state, e.route)));
            damageEnemy(state, e, dmg, events, 'hit', 0, null, p.heroId);
            if (!e.dead) {
              if (p.splashSlow) applySlow(e, p.splashSlow);
              if (p.burn) applyBurn(e, dmg, p.burn);
            }
          }
        }
      } else {
        const hitDmg = Math.round(p.dmg * (state.squad ? 1 : resonanceDamageMul(state, t.route)));
        damageEnemy(state, t, hitDmg, events, 'hit', 0, null, p.heroId);
        if (!t.dead) {
          if (p.slowOnHit) applySlow(t, p.slowOnHit);
          if (p.burn) applyBurn(t, hitDmg, p.burn);
        }
        if (p.kind === 'bolt') events.push({ type: 'boltHit', x: t.x, y: t.y });
        if (p.pierce > 1) {
          const ux = (t.x - p.srcX), uy = (t.y - p.srcY);
          const ul = Math.hypot(ux, uy) || 1;
          const nx = ux / ul, ny = uy / ul;
          let remaining = p.pierce - 1;
          const cands = state.enemies
            .filter(e => {
              if (e.dead || e === t) return false;
              const rx = e.x - t.x, ry = e.y - t.y;
              const along = rx * nx + ry * ny;
              if (along < 0 || along > 180) return false;
              const side = Math.abs(rx * -ny + ry * nx);
              return side <= D.PIERCE_WIDTH;
            })
            .sort((a, b) => {
              const da = (a.x - t.x) * nx + (a.y - t.y) * ny;
              const db = (b.x - t.x) * nx + (b.y - t.y) * ny;
              return da - db;
            });
          for (const e of cands) {
            if (remaining <= 0) break;
            const pierceDmg = Math.round(p.dmg * (state.squad ? 1 : resonanceDamageMul(state, e.route)));
            damageEnemy(state, e, pierceDmg, events, 'pierce', 0, null, p.heroId);
            if (!e.dead && p.slowOnHit) applySlow(e, p.slowOnHit);
            events.push({ type: 'pierceHit', x: e.x, y: e.y });
            remaining--;
          }
        }
      }
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }
}

function gameOver(state, events) {
  state.phase = 'over';
  state.shardsEarned = D.shardReward(state.wave, state.bossKills);
  events.push({ type: 'gameOver', shards: state.shardsEarned });
}

function endWave(state, events) {
  // A blueprint is a temporary defense asset, never a journey/prep companion.
  // Clear it at the exact combat boundary even if its normal lifetime remains.
  state.blueprintSummons = [];
  state.constellationAids = [];
  const bonus = D.WAVE_BONUS(state.wave);
  const journeyProgress = journeyBattleProgress(state);
  state.gold += bonus;
  state.goldEarned += bonus;
  state.combo.count = 0;
  state.combo.timer = 0;
  events.push({
    type: 'waveEnd', wave: state.wave, bonus,
    journey: journeyProgress && {
      nodeId: journeyProgress.node.id,
      name: journeyProgress.node.name,
      step: journeyProgress.step,
      total: journeyProgress.total,
    },
  });
  /* Revive knocked-out champions during preparation. Wave clears grant XP; perfect defense grants extra XP and one shard. */
  const c = state.champ;
  grantSquadWaveXp(state, events);
  if (c) {
    const revived = c.ko;
    c.ko = false;
    c.targetId = null;
    c.holdT = 0;
    c.hurtAcc = 0;
    const perfect = (state.waveDmgTaken || 0) === 0;
    let xp = D.CHAMP_XP.clear(state.wave);
    if (perfect) {
      xp = Math.round(xp * D.CHAMP_XP.perfectMul);
      state.perfectWaves++;
    }
    gainChampXp(state, xp, events);
    chargeUlt(state, D.ULT.wave, events);
    c.maxHp = champStats(state).maxHp;
    c.hp = c.maxHp;
    events.push({ type: 'champWave', xp, perfect, revived, shard: perfect ? 1 : 0 });
  }
  if (state.journey?.activeBattle) {
    const progress = completeJourneyWave(state);
    state.wave++;
    state.resonance = createResonance(state.wave);
    if (progress.complete) {
      state.pendingWave = null;
      events.push({ type: 'journeyReturn', node: progress.node.id, name: progress.node.name, total: progress.node.waves });
      if (progress.chapterComplete) events.push({ type: 'chapterComplete', chapter: state.journey.chapter });
      return;
    }
    state.phase = 'prep';
    state.pendingWave = buildWave(state);
    return;
  }
  /* Emit the thirtieth-dawn victory once per loop. main.js owns persistent shard rewards, presentation and starting the next loop. */
  if (state.wave === D.VICTORY_WAVE) {
    events.push({
      type: 'victory', wave: state.wave, loop: state.loop || 0,
      shards: D.victoryShards(state.loop || 0),
    });
  }
  state.wave++;
  state.phase = 'prep';
  state.resonance = createResonance(state.wave); // Kept empty for legacy save compatibility; it has no gameplay effect.
  state.pendingWave = buildWave(state);
}

/* Simulation tick. */
export function tick(state, dt) {
  const events = [];
  state.time += dt;
  if (state.phase !== 'wave') return events;

  if (state.combo.timer > 0) {
    state.combo.timer -= dt;
    if (state.combo.timer <= 0) state.combo.count = 0;
  }

  state.waveT += dt;
  while (state.spawnQueue.length && state.spawnQueue[0].t <= state.waveT) {
    const s = state.spawnQueue.shift();
    if (s.warnOnly) {
      events.push({ type: 'bossWarn', tier: s.tier, name: D.ENEMY_TYPES[s.etype].name, emoji: D.ENEMY_TYPES[s.etype].emoji });
      continue;
    }
    spawnEnemy(state, s.type, events, s.route, s);
  }

  updateHeroes(state, dt, events);
  updateMonsterBlueprints(state, dt, events);
  updateConstellationAids(state, dt, events);
  updateChampion(state, dt, events);
  champAutoCast(state, dt, events);
  updateTower(state, dt, events);
  updateEnemies(state, dt, events);
  if (state.phase !== 'wave') return events;
  updateProjectiles(state, dt, events);

  state.enemies = state.enemies.filter(e => !e.dead);
  state.projectiles = state.projectiles.filter(p => !p.dead);

  if (!state.spawnQueue.length && !state.enemies.length) endWave(state, events);
  return events;
}

export const remainingEnemies = (state) => state.spawnQueue.length + state.enemies.length;
