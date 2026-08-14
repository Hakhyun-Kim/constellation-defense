/* Real-time pacing between completed defenses. This stays outside the engine:
 * it never decides combat results and only asks main to press the same start
 * action available to the player. */

export const AUTO_PHASE_DELAY = 10;

export function autoPhaseKey(state) {
  if (!state || state.phase !== 'prep') return null;
  if (state.journey?.activeBattle) {
    /* Choosing a battle node is the deliberate action. Once its preparation
     * screen is visible, every defense (including the first) uses the same
     * readable countdown and the same manual start override. */
    return `journey:${state.journey.activeBattle}:${state.journey.wavesInBattle}`;
  }
  return `wave:${state.loop || 0}:${state.wave || 1}`;
}

export function createAutoPhaseClock() {
  return { key: null, remaining: AUTO_PHASE_DELAY, ready: false };
}

export function advanceAutoPhase(clock, state, dt, blocked = false) {
  const key = autoPhaseKey(state);
  if (!key) return createAutoPhaseClock();
  const current = clock?.key === key
    ? clock
    : { key, remaining: AUTO_PHASE_DELAY, ready: false };
  if (blocked || !Number.isFinite(dt) || dt <= 0) return { ...current, ready: false };
  const remaining = Math.max(0, current.remaining - dt);
  return { key, remaining, ready: remaining === 0 };
}
