const KINDS = ['flare', 'tide', 'bloom'];

export function createRunMemory() {
  return {
    byLane: [0, 0, 0],
    byKind: { flare: 0, tide: 0, bloom: 0 },
    largest: { size: 0, kind: null, lane: null },
    biggestHeal: 0,
    biggestPush: 0,
    lowestCastleHp: null,
  };
}

export function recordTacticMemory(state, { route, kind, size, heal = 0, pushes = 0, castleHp = null }) {
  const memory = state.runMemory || createRunMemory();
  state.runMemory = memory;
  memory.byLane[route] = (memory.byLane[route] || 0) + 1;
  memory.byKind[kind] = (memory.byKind[kind] || 0) + 1;
  if (size > memory.largest.size) memory.largest = { size, kind, lane: route };
  memory.biggestHeal = Math.max(memory.biggestHeal || 0, Math.max(0, Math.round(heal)));
  memory.biggestPush = Math.max(memory.biggestPush || 0, Math.max(0, Math.round(pushes)));
  if (Number.isFinite(castleHp)) {
    memory.lowestCastleHp = memory.lowestCastleHp == null
      ? Math.round(castleHp)
      : Math.min(memory.lowestCastleHp, Math.round(castleHp));
  }
  return memory;
}

export function restoreRunMemory(raw) {
  const memory = createRunMemory();
  if (!raw || typeof raw !== 'object') return memory;
  const count = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1e9, Math.round(value))) : 0;
  memory.byLane = [0, 1, 2].map((lane) => count(raw.byLane?.[lane]));
  for (const kind of KINDS) memory.byKind[kind] = count(raw.byKind?.[kind]);
  const size = count(raw.largest?.size);
  const kind = KINDS.includes(raw.largest?.kind) ? raw.largest.kind : null;
  const lane = [0, 1, 2].includes(raw.largest?.lane) ? raw.largest.lane : null;
  if (size >= 3 && kind && lane != null) memory.largest = { size: Math.min(6, size), kind, lane };
  memory.biggestHeal = count(raw.biggestHeal);
  memory.biggestPush = count(raw.biggestPush);
  memory.lowestCastleHp = Number.isFinite(raw.lowestCastleHp) ? count(raw.lowestCastleHp) : null;
  return memory;
}

export function summarizeRun(state) {
  const memory = restoreRunMemory(state?.runMemory);
  const highest = Math.max(...memory.byLane);
  const favoriteLane = highest > 0 ? memory.byLane.indexOf(highest) : null;
  return {
    casts: memory.byLane.reduce((sum, count) => sum + count, 0),
    favoriteLane,
    favoriteCasts: highest,
    largest: { ...memory.largest },
    biggestHeal: memory.biggestHeal,
    biggestPush: memory.biggestPush,
    lowestCastleHp: memory.lowestCastleHp,
  };
}
