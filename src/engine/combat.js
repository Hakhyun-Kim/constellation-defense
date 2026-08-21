/* =====================================================
 * 웨이브와 전투 — 웨이브 생성 · 스폰 · 매 틱 시뮬레이션 · 별지기 마법
 *  - 몬스터는 무게 추첨으로 길을 골라 아래→위로 행진
 *  - 공격은 데이터 주도 수정자(다단타/화상/감속/폭발/성회복/관통)
 * ===================================================== */
import * as D from '../data.js';
import { champStats, champKillXp, gainChampXp, chargeUlt } from './champion.js';
import { heroMods } from './roster.js';
import { grantSquadWaveXp } from './squad.js';
import { damageEnemy, applyBurn, applySlow, applyStun } from './effects.js';
import { createResonance, resonanceDamageMul } from './resonance.js';
import { completeJourneyWave, journeyBattleProgress, journeyEncounter } from './journey.js';
import { updateMonsterBlueprints } from './blueprints.js';
import { updateConstellationAids } from './constellation-aid.js';

/* ---------- 웨이브 생성 ---------- */
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

/* 분대 단위로 몰려오는 웨이브를 만든다 (+ 웨이브 말미의 보스들) */
export function buildWave(state) {
  const w = state.wave;
  const encounter = journeyEncounter(state);
  /* 지휘관/결전에서도 일반 몬스터 총량은 유지하되, 마지막 세 마리를
   * 보스와 동시에 세 갈래로 붙여 '보스만 남는 청소 시간'을 없앤다. */
  const formationMinions = encounter.kind === 'patrol' ? 0 : 3;
  const total = Math.max(0, Math.round(D.waveCount(w) * state.diff.countMul) - formationMinions);
  const mix = D.waveMix(w);
  const list = [];
  let t = 1.2;
  let spawned = 0;
  while (spawned < total) {
    const size = Math.min(D.squadSize(w), total - spawned);
    /* 분대는 같은 종류가 뭉쳐 나오되, 30%는 섞인 혼성 분대 */
    const uniform = state.rng() < 0.7;
    const squadType = pickWeighted(state, mix);
    const route = pickRoute(state);          // 분대는 같은 길로 함께 진군
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

    /* 졸개가 먼저 세 길을 열고 지휘관이 그 틈을 파고든다. */
    for (let route = 0; route < 3; route++) {
      list.push({ t: formationT - 0.42 + route * 0.16, type: pickWeighted(state, mix), route });
    }

    if (encounter.kind === 'commander') {
      list.push({ t: formationT, type: midType, route: w % 3 });
    } else {
      /* 대보스와 중간보스가 한 편대로 도착한다. 최종 지역은 좌우에
       * 두 지휘관을 세워 마지막 결전의 실루엣을 확실히 다르게 만든다. */
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

/* 지금 데리고 있는 신화 용사 수 — 몬스터가 여기에 반응한다 (enemies.js의 신화의 압력) */
export const mythicCount = () => 0;

export function startWave(state) {
  if (state.phase !== 'prep') return { ok: false };
  state.phase = 'wave';
  /* 웨이브가 시작될 때 한 번만 센다 — 전투 중 조합으로 몬스터가 갑자기 단단해지면
   * 방금 본 체력바와 어긋나서 "버그처럼" 보인다 */
  state.mythicPress = 0;
  state.spawnQueue = [...(state.pendingWave || buildWave(state))];
  state.waveT = 0;
  state.blueprintSummons = [];
  state.constellationAids = [];
  state.waveDmgTaken = 0;                  // 완벽 방어 판정 재료 (수리로 되돌려도 완벽은 아니다)
  for (const hero of state.field) hero.activeCd = 0;
  if (state.champ) {                       // 별지기는 성문 앞에서 웨이브를 맞는다
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
  /* 엘리트 — 일반 몬스터 중 일부가 "성난" 개체로 나온다.
   * 등급을 여러 단계로 쪼개는 대신 보통/특별 두 가지로만 나눠 한눈에 읽히게 했다. */
  const elite = !E.boss && !E.midBoss && state.rng() < D.eliteChance(w);
  const press = state.mythicPress || 0;
  const loop = state.loop || 0;          // 별의 시련 — 회차만큼 세지고, 그만큼 더 준다
  const lieutenant = spawn.lieutenant ? D.BOSS_LIEUTENANT : null;
  const hp = Math.round(E.hp * D.hpScale(w) * state.diff.hpMul * rampMul
    * (lieutenant?.hpMul || 1)
    * (elite ? D.ELITE.hpMul : 1) * D.mythicHpMul(press) * D.loopHpMul(loop));
  /* 대보스는 지름길로 돌진 */
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
      /* 루트 길이가 달라 진행률(%)로 비교 — 성문에 가까운 적 우선 */
      const prog = e.s / D.ROUTE_LENS[e.route];
      if (prog > best) { best = prog; target = e; }
    }
  }
  return target;
}

function meleeStrike(state, h, mods, e, events) {
  const baseDmg = Math.round(h.dmg * (state.squad ? 1 : resonanceDamageMul(state, e.route)));
  for (let k = 0; k < mods.hits; k++) {
    /* 치명타: 짧은 사거리를 보상하는 한 방 */
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

    /* 방패 장벽: 주기적으로 사거리 안 모든 적을 잠시 멈춘다 */
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
          h.blockCd = 0;                    // 멈출 대상이 없으면 대기
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

/* ---------- 별지기 전투 ---------- */
function champStrike(state, e, dmg, crit, S, events) {
  damageEnemy(state, e, dmg, events, crit ? 'crit' : 'hit', 0);
  if (e.dead) {
    state.champKills++;
    /* 직접 처치 보너스 — damageEnemy가 이미 기본 경험치를 줬으니 차액만 */
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
  /* 붙잡기는 매 틱 다시 계산한다 — 별지기가 쓰러지든 자리를 뜨든 남은 held가 적을 영원히 세워 두면 안 된다 */
  for (const e of state.enemies) e.held = false;
  if (c.ko) return;
  const S = champStats(state);
  c.maxHp = S.maxHp;
  if (c.hp > c.maxHp) c.hp = c.maxHp;
  c.cd -= dt;
  if (c.spellCd > 0) { c.spellCd = Math.max(0, c.spellCd - dt); c.spellReadyT = 0; }

  /* 목표: 성문에 가장 가까운(진행률 최고) **일반** 몬스터.
   * 보스는 다른 적이 없을 때만 맞붙는다 — 보스에게 달려들면 반격에 순삭당해
   * 정작 마법이 필요한 보스전에 마법이 잠긴다. 보스전은 별똥별·은하수의 몫이고,
   * 별지기의 일은 그 동안 잡졸이 성문에 닿지 않게 막는 것이다.
   * 자주 갈아타면 지그재그만 하다 끝나므로 "확실히 더 앞선" 적이 나타날 때만 바꾼다. */
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
  else if ((cur.boss || cur.midBoss) && bestN) cur = bestN;   // 잡졸이 나타나면 보스에게서 물러난다
  else if (best && best !== cur && bp > enemyProg(cur) + 0.12) cur = best;
  c.targetId = cur ? cur.id : null;

  if (!cur) {
    /* 적이 없으면 광장으로 돌아간다 */
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

  /* 붙잡기 — 일반 몬스터는 별지기와 싸우는 동안 멈춘다 (보스는 밀고 지나간다) */
  if (!cur.boss && !cur.midBoss && (cur.holdImmuneT || 0) <= 0) {
    cur.held = true;
    c.holdT += dt;
    if (c.holdT >= D.CHAMP_HOLD.max) {
      cur.holdImmuneT = D.CHAMP_HOLD.immune;   // 너무 오래는 못 잡는다 — 교착 방지
      c.holdT = 0;
    }
  }

  /* 공격 */
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

  /* 반격 — 맞붙은 상대가 별지기를 때린다. 후반 몬스터일수록(성 피해 곡선) 아프다 */
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

/* 별똥별 준비 완료 후 한참 안 쓰면 별지기가 알아서 던진다 — 버튼을 잊어도 별은 떨어진다 */
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

/* ---------- 별지기 마법 (사람이 누른다) ---------- */
export function castStar(state) {
  const c = state.champ;
  if (!c || state.phase !== 'wave') return { ok: false, reason: 'phase' };
  if (c.ko) return { ok: false, reason: 'ko' };
  if (c.spellCd > 0) return { ok: false, reason: 'cd', left: c.spellCd };
  const alive = state.enemies.filter(e => !e.dead);
  if (!alive.length) return { ok: false, reason: 'none' };
  const S = champStats(state);
  /* 보스 > 중간보스 > 성문에 가장 가까운 적 순서로 떨어진다 */
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
  /* 서리 결계(오라) 감속 */
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
  /* 별의 결계 (별지기 수호 스킬) — 별지기 곁의 적이 느려진다 */
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

    /* 대보스 분노: 체력이 절반 아래로 떨어지면 폭주 */
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
    /* 정지(방패 장벽)에 걸리면 아예 못 움직인다 */
    if (e.stunT > 0) {
      e.stunT -= dt;
      e.stunned = true;
      continue;
    }
    e.stunned = false;
    /* 별지기에게 붙잡혔다 — 그 자리에서 맞붙는다 (updateChampion이 매 틱 다시 정한다) */
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
  /* 별지기 — 쓰러졌어도 다음 준비 단계엔 다시 일어난다.
   * 클리어 보너스 경험치, 성이 무피해였으면(완벽 방어) 더 크게 + 별조각 1. */
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
  /* 서른 번째 아침 — 30웨이브를 버텨 냈다. 회차당 한 번만 울린다(웨이브는 되돌아가지 않으므로).
   * 엔진은 알리기만 한다: 별조각 지급·연출·다음 회차 시작은 main의 몫이다. */
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

/* ---------- 틱 ---------- */
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
