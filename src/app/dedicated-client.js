/* Viewer/controller client for the dedicated game server.
 * The server owns the simulation; this module merges its snapshots into the
 * local state object that the existing renderer and HUD already read, and
 * smooths enemy motion between snapshots. It never runs game rules locally:
 * with the socket closed the picture simply freezes at the last known truth. */
import * as D from '../data.js';

const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 8000;

export function initDedicatedClient({ url, key = null, playerToken = null, api }) {
  let socket = null;
  let closedByUs = false;
  let attempts = 0;
  let pendingCommand = null;
  /* Store calls brokered over this socket: id-matched, queued until welcome. */
  let storeSequence = 0;
  const storeWaiters = new Map();
  const storeQueue = [];
  let welcomed = false;
  const status = {
    connected: false, role: null, downgraded: null,
    session: null, viewers: 0, tick: 0, lastSnapshotAt: 0,
  };

  function notify() { api.onStatus({ ...status }); }

  /* Replace the volatile simulation data wholesale; ids stay stable so the
   * renderer's per-id views survive. Engine internals (rng, tables) are never
   * touched, which is what keeps this a view and not a second simulation. */
  function applySnapshot(snapshot) {
    const state = api.getState();
    const previousPhase = state.phase;
    state.phase = snapshot.phase;
    state.wave = snapshot.wave;
    state.gold = snapshot.gold;
    state.castleHp = snapshot.castleHp;
    state.castleMax = snapshot.castleMax;
    state.time = snapshot.time;
    Object.assign(state.castle, snapshot.castle || {});
    if (snapshot.combo && state.combo) Object.assign(state.combo, snapshot.combo);
    if (snapshot.resonance && state.resonance) state.resonance.active = snapshot.resonance.active;
    if (snapshot.constellationAid && state.constellationAid) state.constellationAid.charge = snapshot.constellationAid.charge;
    state.enemies = snapshot.enemies;
    state.field = snapshot.field;
    state.bench = snapshot.bench;
    state.champ = snapshot.champ;
    state.journey = snapshot.journey;
    Object.assign(state, snapshot.stats || {});
    status.tick = snapshot.tick;
    status.viewers = snapshot.viewers || 0;
    status.lastSnapshotAt = performance.now();
    api.onBoard?.(snapshot.board);
    if (previousPhase !== snapshot.phase) api.onPhase?.(previousPhase, snapshot.phase);
    api.onSnapshot?.(snapshot);
  }

  function handleMessage(message) {
    if (message.type === 'welcome') {
      status.connected = true;
      status.role = message.role;
      status.downgraded = message.downgraded || null;
      status.session = message.session;
      attempts = 0;
      welcomed = true;
      while (storeQueue.length) socket.send(storeQueue.shift());
      notify();
      return;
    }
    if (message.type === 'storeResult') {
      const waiter = storeWaiters.get(message.id);
      if (waiter) {
        storeWaiters.delete(message.id);
        waiter.resolve({ status: message.status, ok: message.status >= 200 && message.status < 300, data: message.data ?? {} });
      }
      return;
    }
    if (message.type === 'storeIdentity') {
      api.onStoreIdentity?.(message.playerId);
      return;
    }
    if (message.type === 'snapshot') { applySnapshot(message); notify(); return; }
    if (message.type === 'events') { api.onEvents?.(message.events); return; }
    if (message.type === 'decision') { api.onDecision?.(message); return; }
    if (message.type === 'session') { status.session = message.session; api.onSession?.(message.session); notify(); return; }
    if (message.type === 'commandResult') {
      pendingCommand?.resolve(message);
      pendingCommand = null;
      return;
    }
    if (message.type === 'error') {
      if (message.code === 'forbidden' && pendingCommand) {
        pendingCommand.resolve({ ok: false, error: 'forbidden', op: message.op });
        pendingCommand = null;
      }
    }
  }

  function connect() {
    closedByUs = false;
    welcomed = false;
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      const hello = key
        ? { type: 'hello', role: 'controller', key }
        : { type: 'hello', role: 'viewer' };
      /* Reusing the client-mode store identity keeps purchases on one account. */
      if (playerToken) hello.playerToken = playerToken;
      socket.send(JSON.stringify(hello));
    });
    socket.addEventListener('message', (event) => {
      try { handleMessage(JSON.parse(event.data)); } catch { /* Ignore malformed frames. */ }
    });
    socket.addEventListener('close', () => {
      status.connected = false;
      status.role = null;
      welcomed = false;
      for (const waiter of storeWaiters.values()) waiter.resolve({ status: 0, ok: false, data: { error: 'gateway disconnected' } });
      storeWaiters.clear();
      notify();
      if (closedByUs) return;
      attempts += 1;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS);
      setTimeout(() => { if (!closedByUs) connect(); }, delay);
    });
  }

  connect();

  return {
    get status() { return { ...status }; },
    /* Advance visible enemies between snapshots so 20 Hz truth still reads as
     * continuous motion. The server overwrites these guesses on every snapshot. */
    smooth(dt) {
      const state = api.getState();
      if (state.phase !== 'wave') return;
      for (const enemy of state.enemies) {
        if (enemy.dead || enemy.stunned) continue;
        const slow = (enemy.slowT || 0) > 0 ? (enemy.slowMul || 1) : 1;
        const speed = (enemy.spd || 0) * slow * (enemy.auraMul || 1) * (enemy.enraged ? (enemy.enrageSpd || 1) : 1);
        enemy.s = Math.min(enemy.s + speed * dt, D.ROUTE_LENS[enemy.route] || enemy.s);
        /* Same lateral offset formula as the engine's movement step. */
        const point = D.routePoint(enemy.route, enemy.s);
        enemy.x = point.x + (-point.dy) * enemy.off;
        enemy.y = point.y + point.dx * enemy.off;
      }
    },
    /* Store transport for src/app/neon-store.js: same shape as its HTTP
     * transport, so the store UI cannot tell which wire it is on. */
    store(path, options = {}) {
      return new Promise((resolve) => {
        const id = ++storeSequence;
        storeWaiters.set(id, { resolve });
        const line = JSON.stringify({
          type: 'store', id, path,
          method: options.method || 'GET',
          body: options.body === undefined ? undefined : JSON.parse(options.body),
        });
        if (welcomed && socket?.readyState === WebSocket.OPEN) socket.send(line);
        else storeQueue.push(line);
        setTimeout(() => {
          if (storeWaiters.delete(id)) resolve({ status: 0, ok: false, data: { error: 'gateway timeout' } });
        }, 15000);
      });
    },
    command(op, args = {}) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: 'disconnected' });
      if (pendingCommand) pendingCommand.resolve({ ok: false, error: 'superseded' });
      return new Promise((resolve) => {
        pendingCommand = { resolve };
        socket.send(JSON.stringify({ type: 'command', op, args }));
        setTimeout(() => {
          if (pendingCommand && pendingCommand.resolve === resolve) {
            pendingCommand = null;
            resolve({ ok: false, error: 'timeout' });
          }
        }, 4000);
      });
    },
    disconnect() {
      closedByUs = true;
      try { socket?.close(1000, 'viewer left'); } catch { /* Already closed. */ }
    },
  };
}
