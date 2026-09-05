/* Dedicated-server conformance check. This is the executable contract that
 * the web viewer and the Unity/Unreal client samples are written against:
 * hello/welcome roles, snapshot schema, event flow, and the auth boundary
 * between viewers and controllers. Runs the real server in-process on an
 * ephemeral port with an accelerated clock. Usage: node scripts/dedicated-check.mjs */
import { startDedicatedServer } from '../dedicated/server.mjs';
import { acceptKey, encodeFrame } from '../dedicated/ws.mjs';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} dedicated: ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Collect a client's messages so assertions can await specific types. */
function connectClient(port, hello) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  const received = [];
  const waiters = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    received.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => { socket.send(JSON.stringify(hello)); resolve(); });
    socket.addEventListener('error', () => reject(new Error('socket error')));
  });
  return {
    socket,
    received,
    opened,
    next(match, timeoutMs = 8000) {
      const found = received.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
        waiters.push({ match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    send(message) { socket.send(JSON.stringify(message)); },
    close() { try { socket.close(); } catch { /* closed */ } },
  };
}

/* RFC 6455 handshake vector. */
check('Sec-WebSocket-Accept matches the RFC example',
  acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');

/* Frame length encodings: 7-bit, 16-bit and 64-bit paths. */
{
  const small = encodeFrame(0x1, Buffer.alloc(125));
  const medium = encodeFrame(0x1, Buffer.alloc(126));
  const large = encodeFrame(0x1, Buffer.alloc(70000));
  check('frame length encodings',
    small[1] === 125 && medium[1] === 126 && medium.readUInt16BE(2) === 126
    && large[1] === 127 && Number(large.readBigUInt64BE(2)) === 70000);
}

const service = startDedicatedServer({
  DEDICATED_PORT: '0',
  DEDICATED_HOST: '127.0.0.1',
  DEDICATED_CONTROL_KEY: 'check-key',
  DEDICATED_SPEED: '8',
  DEDICATED_SEED: '3',
  LOG_FORMAT: 'json',
});
await wait(200);
const port = service.port();
check('server binds an ephemeral port', Number.isInteger(port) && port > 0);

try {
  /* Health endpoint reports the session. */
  const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  check('healthz reports protocol and session', health.protocol === 1 && health.session?.seed === 3);

  /* A viewer is welcomed, gets an immediate snapshot, and sees ticks advance. */
  const viewer = connectClient(port, { type: 'hello', role: 'viewer' });
  await viewer.opened;
  const welcome = await viewer.next((m) => m.type === 'welcome');
  check('viewer welcome carries role and protocol', welcome.role === 'viewer' && welcome.protocol === 1);
  const first = await viewer.next((m) => m.type === 'snapshot');
  const schemaOk = ['tick', 'phase', 'wave', 'gold', 'castleHp', 'castleMax', 'enemies', 'field', 'board', 'journey']
    .every((key) => key in first);
  check('snapshot carries the documented schema', schemaOk, JSON.stringify(Object.keys(first)));

  /* The authoritative session reaches combat and streams engine events. */
  const combat = await viewer.next((m) => m.type === 'snapshot' && m.phase === 'wave', 30000);
  check('session reaches a wave on its own', combat.phase === 'wave' && combat.enemies.length >= 0);
  const eventBatch = await viewer.next((m) => m.type === 'events' && m.events.length > 0, 30000);
  check('engine events stream to viewers', eventBatch.events.every((e) => typeof e.type === 'string'));
  const decision = await viewer.next((m) => m.type === 'decision' && ['tactic', 'ult', 'star', 'heroActive', 'constellationAid', 'blueprint'].includes(m.action), 30000);
  check('bot decisions are announced', typeof decision.action === 'string');
  const later = await viewer.next((m) => m.type === 'snapshot' && m.tick > combat.tick, 10000);
  check('ticks advance', later.tick > combat.tick);

  /* Viewer commands are refused: watching is public, steering is not. */
  viewer.send({ type: 'command', op: 'pause' });
  const refused = await viewer.next((m) => m.type === 'error' && m.code === 'forbidden');
  check('viewer command is forbidden', refused.op === 'pause');

  /* A wrong key downgrades to viewer explicitly. */
  const impostor = connectClient(port, { type: 'hello', role: 'controller', key: 'wrong' });
  await impostor.opened;
  const downgraded = await impostor.next((m) => m.type === 'welcome');
  check('wrong key downgrades to viewer', downgraded.role === 'viewer' && downgraded.downgraded === 'bad_key');
  impostor.close();

  /* The real key controls the session: speed, pause, restart. */
  const controller = connectClient(port, { type: 'hello', role: 'controller', key: 'check-key' });
  await controller.opened;
  const control = await controller.next((m) => m.type === 'welcome');
  check('controller welcome', control.role === 'controller');
  controller.send({ type: 'command', op: 'speed', args: { value: 2 } });
  const speedResult = await controller.next((m) => m.type === 'commandResult' && m.op === 'speed');
  check('speed command applies', speedResult.ok === true && speedResult.speed === 2);
  controller.send({ type: 'command', op: 'speed', args: { value: 99 } });
  const badSpeed = await controller.next((m) => m.type === 'commandResult' && m.op === 'speed' && m.ok === false);
  check('invalid speed is rejected', typeof badSpeed.error === 'string');
  controller.send({ type: 'command', op: 'restart', args: { seed: 41 } });
  const restarted = await controller.next((m) => m.type === 'commandResult' && m.op === 'restart');
  const fresh = await viewer.next((m) => m.type === 'session' && m.session.seed === 41, 8000);
  check('restart starts a new session for every client', restarted.ok === true && fresh.session.seed === 41);

  /* Application-level ping. */
  controller.send({ type: 'ping', t: 123 });
  const pong = await controller.next((m) => m.type === 'pong');
  check('ping answers pong', pong.t === 123);

  viewer.close();
  controller.close();
} catch (error) {
  check('conformance flow completes', false, error.message);
}

service.close();
await wait(100);
console.log(failures ? `\n❌ dedicated-check: ${failures} failure(s)` : '\n✅ dedicated-check passed');
process.exit(failures ? 1 : 0);
