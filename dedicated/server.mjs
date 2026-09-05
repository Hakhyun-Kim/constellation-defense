/* Dedicated game server: the authoritative simulation host behind a
 * WebSocket protocol. Clients — the web viewer, Unity/Unreal samples,
 * or the conformance check — connect, authenticate a role, and render
 * what this process decides. It shares nothing with the payment service
 * except the logger; game rules come from src/engine and src/balance.
 *
 *   node dedicated/server.mjs
 *
 * Environment:
 *   DEDICATED_PORT        default 8643
 *   DEDICATED_HOST        default 127.0.0.1 (set 0.0.0.0 for LAN/Docker)
 *   DEDICATED_CONTROL_KEY controller-role key; generated and printed if unset
 *   DEDICATED_SEED / DEDICATED_SPEED / DEDICATED_PROFILE / DEDICATED_DIFFICULTY
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../server/logger.mjs';
import { upgrade } from './ws.mjs';
import { createHost } from './host.mjs';

export const PROTOCOL_VERSION = 1;
const HELLO_TIMEOUT_MS = 10_000;

export function startDedicatedServer(overrides = {}) {
  const env = { ...process.env, ...overrides };
  /* An explicit 0 asks the OS for an ephemeral port (used by the check). */
  const port = env.DEDICATED_PORT === '0' ? 0 : Number(env.DEDICATED_PORT) || 8643;
  const hostAddr = env.DEDICATED_HOST || '127.0.0.1';
  const controlKey = env.DEDICATED_CONTROL_KEY || randomBytes(9).toString('base64url');
  const log = createLogger({ format: env.LOG_FORMAT || 'text', service: 'dedicated' });

  const clients = new Set();   // { conn, role, hello: boolean }

  const gameHost = createHost({
    seed: Number(env.DEDICATED_SEED) || 3,
    speed: Number(env.DEDICATED_SPEED) || 1,
    profile: env.DEDICATED_PROFILE || '고수',
    difficulty: env.DEDICATED_DIFFICULTY || 'normal',
    chapterCap: Number(env.DEDICATED_CHAPTER_CAP) || 1,
    onBroadcast(batch) {
      if (!clients.size) return;
      const lines = batch.map((message) => JSON.stringify(
        message.type === 'snapshot' ? { ...message, viewers: clients.size } : message));
      for (const client of clients) {
        if (!client.hello) continue;
        for (const line of lines) client.conn.send(line);
      }
    },
  });

  function sessionInfo() {
    return {
      id: gameHost.sessionId,
      seed: gameHost.seed,
      difficulty: gameHost.difficulty,
      profile: gameHost.profileName,
      speed: gameHost.speed,
      paused: gameHost.paused,
      tick: gameHost.tick,
      phase: gameHost.state?.phase,
      wave: gameHost.state?.wave,
    };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        service: 'constellation-defense-dedicated',
        protocol: PROTOCOL_VERSION,
        clients: clients.size,
        session: sessionInfo(),
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
  });

  server.on('upgrade', (req, socket) => {
    const client = { conn: null, role: 'viewer', hello: false };
    const conn = upgrade(req, socket, {
      onMessage(text) {
        let message;
        try { message = JSON.parse(text); } catch {
          return conn.send(JSON.stringify({ type: 'error', code: 'bad_json' }));
        }
        if (!client.hello) {
          if (message.type !== 'hello') {
            return conn.send(JSON.stringify({ type: 'error', code: 'hello_first' }));
          }
          /* Role assignment is the auth boundary: anyone may watch, only the
           * control key may steer. A wrong key still becomes a viewer so a
           * misconfigured client sees the stream and the explicit downgrade. */
          const wantsControl = message.role === 'controller';
          const keyOk = wantsControl && typeof message.key === 'string' && message.key === controlKey;
          client.role = keyOk ? 'controller' : 'viewer';
          client.hello = true;
          clearTimeout(client.helloTimer);
          conn.send(JSON.stringify({
            type: 'welcome',
            protocol: PROTOCOL_VERSION,
            role: client.role,
            downgraded: wantsControl && !keyOk ? 'bad_key' : undefined,
            session: sessionInfo(),
          }));
          conn.send(JSON.stringify({ type: 'snapshot', ...gameHost.snapshot(), viewers: clients.size }));
          log.info(`client hello role=${client.role} clients=${clients.size}`);
          return;
        }
        if (message.type === 'ping') return conn.send(JSON.stringify({ type: 'pong', t: message.t }));
        if (message.type === 'command') {
          if (client.role !== 'controller') {
            return conn.send(JSON.stringify({ type: 'error', code: 'forbidden', op: message.op }));
          }
          const result = gameHost.control(message.op, message.args || {});
          conn.send(JSON.stringify({ type: 'commandResult', op: message.op, ...result }));
          if (result.ok) log.info(`command ${message.op} ${JSON.stringify(message.args || {})}`);
          return;
        }
        conn.send(JSON.stringify({ type: 'error', code: 'unknown_type' }));
      },
      onClose() {
        clearTimeout(client.helloTimer);
        clients.delete(client);
      },
    });
    if (!conn) return;
    client.conn = conn;
    client.helloTimer = setTimeout(() => conn.close(1002, 'hello timeout'), HELLO_TIMEOUT_MS);
    client.helloTimer.unref?.();
    clients.add(client);
  });

  /* The wall loop drives the simulation at a fixed cadence; the host
   * converts wall time to fixed sim steps internally. */
  let last = process.hrtime.bigint();
  const loop = setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Math.min(Number(now - last) / 1e9, 0.5);
    last = now;
    gameHost.advance(dt);
  }, 50);

  server.listen(port, hostAddr, () => {
    log.info(`Dedicated server → ws://${hostAddr}:${server.address().port}/  (protocol v${PROTOCOL_VERSION})`);
    log.info(`Controller key: ${controlKey}${env.DEDICATED_CONTROL_KEY ? ' (from env)' : ' (generated for this boot)'}`);
  });

  return {
    server,
    gameHost,
    controlKey,
    port: () => server.address()?.port,
    close() {
      clearInterval(loop);
      for (const client of clients) client.conn.close(1001, 'server shutdown');
      clients.clear();
      server.close();
    },
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) startDedicatedServer();
