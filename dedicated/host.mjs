/* Authoritative real-time game session for the dedicated server.
 * The simulation, decisions and tactic board all live here; clients only
 * render what this host broadcasts. Decisions reuse the shared bot policy
 * (src/bot.js + scripts/balance-bot.mjs) so the hosted demo plays by the
 * same public information and command paths as a player or the balance gate. */
import * as E from '../src/engine.js';
import * as D from '../src/data.js';
import * as Bot from '../src/bot.js';
import { createStableBoard } from '../src/tactics/board.js';
import { choosePolicySwap, resolveTacticSwap } from '../scripts/balance-bot.mjs';

const STEP = 1 / 60;                  // Same fixed timestep as the browser client.
const WAVE_DECISION_SECONDS = 2.0;    // Watchable pacing, matching the browser demo.
const PREP_ACTION_SECONDS = 0.55;
const JOURNEY_ACTION_SECONDS = 1.05;
const RESTART_HOLD_SECONDS = 9;
const SNAPSHOT_WAVE_SECONDS = 0.05;   // 20 Hz while combat is visible.
const SNAPSHOT_IDLE_SECONDS = 0.5;

/* Fields cloned into every snapshot. The clone keeps engine internals
 * (rng functions, difficulty tables) out of the wire format. */
function buildSnapshot(host) {
  const { state } = host;
  return {
    tick: host.tick,
    phase: state.phase,
    wave: state.wave,
    gold: Math.round(state.gold),
    castleHp: state.castleHp,
    castleMax: state.castleMax,
    castle: { ...state.castle },
    time: state.time,
    combo: state.combo ? { count: state.combo.count, t: state.combo.t } : null,
    resonance: { active: [...(state.resonance?.active || [])] },
    constellationAid: { charge: state.constellationAid?.charge || 0 },
    enemies: JSON.parse(JSON.stringify(state.enemies || [])),
    field: JSON.parse(JSON.stringify(state.field || [])),
    bench: JSON.parse(JSON.stringify(state.bench || [])),
    champ: state.champ ? JSON.parse(JSON.stringify(state.champ)) : null,
    journey: state.journey ? JSON.parse(JSON.stringify(state.journey)) : null,
    board: [...host.board],
    stats: {
      kills: state.kills, tacticCasts: state.tacticCasts,
      heroActiveCasts: state.heroActiveCasts, ultCasts: state.ultCasts,
      blueprintCasts: state.blueprintCasts || 0,
      constellationAidCasts: state.constellationAidCasts || 0,
    },
  };
}

export function createHost(options = {}) {
  const host = {
    seed: Number.isFinite(options.seed) ? options.seed : 3,
    difficulty: options.difficulty || 'normal',
    profileName: options.profile || '고수',
    chapterCap: options.chapterCap ?? 1,
    speed: options.speed || 1,
    paused: false,
    tick: 0,
    sessionId: 0,
    state: null,
    board: [],
    outbox: [],                        // Events and decisions since the last flush.
    onBroadcast: options.onBroadcast || (() => {}),
    /* Sim-time counters that pace visible decisions. */
    timers: { decision: 0, snapshot: 0, hold: 0 },
  };

  function emit(message) { host.outbox.push(message); }

  function emitDecision(action, detail = {}) {
    emit({ type: 'decision', tick: host.tick, action, ...detail });
  }

  function startSession(seed) {
    host.seed = seed;
    host.sessionId += 1;
    host.tick = 0;
    host.timers = { decision: 0, snapshot: 0, hold: 0 };
    host.state = E.createGame({ rng: Bot.mulberry32(seed), difficulty: host.difficulty });
    host.board = createStableBoard(host.state.rng);
    emit({
      type: 'session',
      session: {
        id: host.sessionId, seed, difficulty: host.difficulty,
        profile: host.profileName, chapterCap: host.chapterCap,
        startedAt: new Date().toISOString(),
      },
    });
    emitDecision('start', { seed });
  }

  function profile() { return Bot.PROFILES[host.profileName]; }

  /* One paced decision on the journey map, mirroring scripts/balance-bot.mjs. */
  function journeyDecision(state) {
    const node = E.journeyNode(state.journey?.current, state);
    if (state.phase === 'journey' && node?.kind === 'town' && !state.journey.pendingRecruit) {
      const choice = Bot.nextJourneyHeroSkill(state);
      if (choice && E.takeHeroSkill(state, choice.heroId, choice.key).ok) {
        return emitDecision('heroSkill', { heroKey: choice.hero.heroKey, skill: choice.key });
      }
    }
    if (state.journey?.complete) {
      const chapterIndex = D.JOURNEY_CHAPTERS.findIndex((chapter) => chapter.id === state.journey.chapter);
      if (chapterIndex >= 0 && chapterIndex + 1 < host.chapterCap) {
        if (E.advanceJourneyChapter(state).ok) return emitDecision('chapter', { chapter: state.journey.chapter });
      }
      host.timers.hold = RESTART_HOLD_SECONDS;
      emitDecision('complete', { wave: state.wave });
      return;
    }
    if (state.journey?.pendingRecruit) {
      const key = Bot.nextJourneyRecruit(state);
      if (key && E.recruitJourneyHero(state, key).ok) return emitDecision('recruit', { heroKey: key });
      host.timers.hold = RESTART_HOLD_SECONDS;
      return emitDecision('stalled', { at: 'recruit' });
    }
    const path = Bot.nextJourneyPath(state);
    if (path) {
      if (E.chooseJourneyPath(state, path.key).ok) return emitDecision('path', { key: path.key, name: path.name });
    }
    const target = Bot.nextJourneyNode(state);
    if (!target) { host.timers.hold = RESTART_HOLD_SECONDS; return emitDecision('stalled', { at: 'travel' }); }
    const move = E.travelJourney(state, target.id);
    if (!move.ok) { host.timers.hold = RESTART_HOLD_SECONDS; return emitDecision('stalled', { at: target.id }); }
    emitDecision('travel', { node: target.id, kind: target.kind, name: target.name });
    if (move.type === 'battle' && !E.prepareJourneyBattle(state).ok) {
      host.timers.hold = RESTART_HOLD_SECONDS;
      emitDecision('stalled', { at: 'battle-prep' });
    }
  }

  function prepDecision(state) {
    const act = Bot.nextPrepAction(state, profile(), state.rng);
    if (!act) {
      E.startWave(state);
      return emitDecision('startWave', { wave: state.wave });
    }
    switch (act.type) {
      case 'skill': E.takeSkill(state, act.key); return emitDecision('skill', { key: act.key });
      case 'castle': E.castleUpgrade(state, act.key); return emitDecision('castle', { key: act.key });
      case 'summon': E.summon(state); return emitDecision('summon', {});
      case 'combine': {
        const result = act.action.kind === 'recipe'
          ? E.combineRecipe(state, act.action.result)
          : E.combineRankUp(state, act.action.cls, act.action.tier);
        if (result.ok) return emitDecision('combine', {});
        return;
      }
      case 'place': E.placeHero(state, act.heroId, act.pad); return emitDecision('place', { pad: act.pad });
      case 'heroSkill': E.takeHeroSkill(state, act.heroId, act.key); return emitDecision('heroSkill', { skill: act.key });
      case 'feast': E.holdFeast(state); return emitDecision('feast', {});
      default: return;
    }
  }

  function waveDecision(state) {
    const P = profile();
    const swap = choosePolicySwap('threat', state, host.board, P, state.rng);
    if (swap) {
      const casts = [];
      host.board = resolveTacticSwap(state, swap, (cast) => casts.push(cast)).cells;
      emitDecision('tactic', {
        from: swap.from, to: swap.to,
        casts: casts.map(({ kind, route, size, ok }) => ({ kind, route, size, ok })),
      });
      return;
    }
    if (Bot.wantsUlt(state, P)) { E.castUlt(state); return emitDecision('ult', {}); }
    if (Bot.wantsStar(state, P)) { E.castStar(state); return emitDecision('star', {}); }
    const aid = Bot.nextConstellationAid(state, P, state.rng);
    if (aid) { E.castConstellationAid(state, aid.route); return emitDecision('constellationAid', { route: aid.route }); }
    const blueprint = Bot.nextMonsterBlueprint(state, P, state.rng);
    if (blueprint) { E.castMonsterBlueprint(state, blueprint.route); return emitDecision('blueprint', { route: blueprint.route }); }
    const active = Bot.nextHeroActive(state, P, state.rng);
    if (active) { E.castHeroActive(state, active.heroId); return emitDecision('heroActive', { heroKey: active.hero.heroKey }); }
  }

  /* Advance the authoritative simulation by wall-clock seconds. */
  function advance(wallSeconds) {
    if (host.paused) return flush(wallSeconds);
    let remaining = wallSeconds * host.speed;
    const events = [];
    while (remaining > 1e-9) {
      const dt = Math.min(STEP, remaining);
      remaining -= dt;
      const state = host.state;

      if (host.timers.hold > 0) {
        host.timers.hold -= dt;
        if (host.timers.hold <= 0) startSession(host.seed + 1);
        continue;
      }

      if (state.phase === 'over') {
        host.timers.hold = RESTART_HOLD_SECONDS;
        emitDecision('defeat', { wave: state.wave });
        continue;
      }

      host.timers.decision -= dt;
      if (state.phase === 'journey') {
        if (host.timers.decision <= 0) { host.timers.decision = JOURNEY_ACTION_SECONDS; journeyDecision(state); }
        continue;
      }
      if (state.phase === 'prep') {
        if (host.timers.decision <= 0) { host.timers.decision = PREP_ACTION_SECONDS; prepDecision(state); }
        continue;
      }
      if (state.phase === 'wave') {
        host.tick += 1;
        const stepEvents = E.tick(state, STEP);
        if (stepEvents.length) events.push(...stepEvents);
        if (host.timers.decision <= 0) { host.timers.decision = WAVE_DECISION_SECONDS; waveDecision(state); }
      }
    }
    if (events.length) emit({ type: 'events', tick: host.tick, events: JSON.parse(JSON.stringify(events)) });
    flush(wallSeconds);
  }

  /* Push queued messages and due snapshots to the transport. */
  function flush(wallSeconds) {
    host.timers.snapshot -= wallSeconds;
    if (host.timers.snapshot <= 0) {
      host.timers.snapshot = host.state?.phase === 'wave' ? SNAPSHOT_WAVE_SECONDS : SNAPSHOT_IDLE_SECONDS;
      emit({ type: 'snapshot', ...buildSnapshot(host) });
    }
    if (host.outbox.length) {
      const batch = host.outbox;
      host.outbox = [];
      host.onBroadcast(batch);
    }
  }

  startSession(host.seed);

  return {
    get state() { return host.state; },
    get tick() { return host.tick; },
    get sessionId() { return host.sessionId; },
    get paused() { return host.paused; },
    get speed() { return host.speed; },
    get seed() { return host.seed; },
    get profileName() { return host.profileName; },
    get difficulty() { return host.difficulty; },
    advance,
    snapshot: () => buildSnapshot(host),
    control(op, args = {}) {
      if (op === 'pause') { host.paused = true; return { ok: true, paused: true }; }
      if (op === 'resume') { host.paused = false; return { ok: true, paused: false }; }
      if (op === 'speed') {
        const value = Number(args.value);
        if (![0.5, 1, 2, 4].includes(value)) return { ok: false, error: 'speed must be 0.5, 1, 2 or 4' };
        host.speed = value;
        return { ok: true, speed: value };
      }
      if (op === 'restart') {
        const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : host.seed + 1;
        startSession(seed);
        host.timers.snapshot = 0;
        flush(0);
        return { ok: true, seed };
      }
      return { ok: false, error: `unknown op ${op}` };
    },
  };
}
