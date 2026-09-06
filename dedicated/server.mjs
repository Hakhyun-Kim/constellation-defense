/* Dedicated game server: the authoritative simulation host behind a
 * WebSocket protocol, and the store gateway in front of the payment
 * service. Clients — the web viewer, Unity/Unreal samples, or the
 * conformance check — connect once, authenticate a role, render what this
 * process decides, and reach the store only through it. Game rules come
 * from src/engine and src/balance; payment rules stay in the payment
 * service, which this process calls server-to-server.
 *
 *   node dedicated/server.mjs
 *
 * Environment:
 *   DEDICATED_PORT        default 8643
 *   DEDICATED_HOST        default 127.0.0.1 (set 0.0.0.0 for LAN/Docker)
 *   DEDICATED_CONTROL_KEY controller-role key; generated and printed if unset
 *   PAYMENT_API_URL       payment service origin (default http://127.0.0.1:8642)
 *   DEDICATED_SEED / DEDICATED_SPEED / DEDICATED_PROFILE / DEDICATED_DIFFICULTY
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLogger } from '../server/logger.mjs';
import { upgrade } from './ws.mjs';
import { createHost } from './host.mjs';

export const PROTOCOL_VERSION = 2;
const HELLO_TIMEOUT_MS = 10_000;
const STORE_TIMEOUT_MS = 10_000;
const STORE_INFLIGHT_LIMIT = 4;
const STORE_BODY_LIMIT = 64 * 1024;
const PLAYER_ID_RE = /^[a-f0-9-]{36}$/i;

/* The client-facing store surface, and nothing else. Webhooks are Neon→
 * payment-service traffic and never travel through a client connection. */
const STORE_PATHS = new Set([
  '/api/store/catalog',
  '/api/store/market',
  '/api/store/entitlements',
  '/api/store/checkout',
  '/api/store/refund',
  '/api/store/mock-complete',
  '/api/store/mock-refund',
  '/api/account/transfer-code',
  '/api/account/claim',
]);
/* Ops after which the ledger may hold different entitlements. */
const ENTITLEMENT_OPS = new Set(['/api/store/mock-complete', '/api/store/mock-refund', '/api/account/claim']);

export function startDedicatedServer(overrides = {}) {
  const env = { ...process.env, ...overrides };
  /* An explicit 0 asks the OS for an ephemeral port (used by the check). */
  const port = env.DEDICATED_PORT === '0' ? 0 : Number(env.DEDICATED_PORT) || 8643;
  const hostAddr = env.DEDICATED_HOST || '127.0.0.1';
  const controlKey = env.DEDICATED_CONTROL_KEY || randomBytes(9).toString('base64url');
  const paymentUrl = (env.PAYMENT_API_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
  const log = createLogger({ format: env.LOG_FORMAT || 'text', service: 'dedicated' });

  const clients = new Set();   // { conn, role, hello, storeToken, cookies, inflight }

  /* Cosmetics fulfilled through this gateway, per account, for the lifetime
   * of the process. Snapshots carry the union so every viewer sees delivery
   * on the shared castle — the ledger stays in the payment service. */
  const sessionCosmetics = new Map();
  let cosmeticsUnion = [];
  function recomputeCosmetics() {
    const union = [...new Set([...sessionCosmetics.values()].flatMap((set) => [...set]))].sort();
    const changed = union.join('|') !== cosmeticsUnion.join('|');
    cosmeticsUnion = union;
    return changed;
  }

  const gameHost = createHost({
    seed: Number(env.DEDICATED_SEED) || 3,
    speed: Number(env.DEDICATED_SPEED) || 1,
    profile: env.DEDICATED_PROFILE || '고수',
    difficulty: env.DEDICATED_DIFFICULTY || 'normal',
    chapterCap: Number(env.DEDICATED_CHAPTER_CAP) || 1,
    onBroadcast(batch) {
      if (!clients.size) return;
      const lines = batch.map((message) => JSON.stringify(
        message.type === 'snapshot' ? { ...message, viewers: clients.size, cosmetics: cosmeticsUnion } : message));
      for (const client of clients) {
        if (!client.hello) continue;
        for (const line of lines) client.conn.send(line);
      }
    },
  });

  /* Push the current truth without waiting for the next scheduled snapshot. */
  function broadcastSnapshotNow() {
    const line = JSON.stringify({ type: 'snapshot', ...gameHost.snapshot(), viewers: clients.size, cosmetics: cosmeticsUnion });
    for (const client of clients) if (client.hello) client.conn.send(line);
  }

  /* --- Store gateway ------------------------------------------------------
   * Clients never reach the payment service directly; this process forwards
   * an allowlisted path set with the connection's account identity and a
   * per-client cookie jar (explicit market selection is cookie-based). */
  function jarHeader(client) {
    return [...client.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function absorbCookies(client, response) {
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) client.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async function refreshCosmetics(client) {
    try {
      const response = await fetch(`${paymentUrl}/api/store/entitlements`, {
        headers: { authorization: `Bearer ${client.storeToken}`, cookie: jarHeader(client) },
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      sessionCosmetics.set(client.storeToken, new Set(Object.keys(data.entitlements || {})));
      if (recomputeCosmetics()) broadcastSnapshotNow();
    } catch (error) {
      log.warn(`cosmetics refresh failed: ${error.message}`);
    }
  }

  async function handleStore(client, message) {
    const respond = (status, data) => client.conn.send(JSON.stringify({ type: 'storeResult', id: message.id, status, data }));
    let pathname;
    let search;
    try {
      const parsed = new URL(String(message.path || ''), 'http://gateway.local');
      pathname = parsed.pathname;
      search = parsed.search;
    } catch { return respond(400, { error: 'malformed path' }); }
    if (pathname.startsWith('/api/webhooks/')) {
      return respond(403, { error: 'webhook paths are not client-facing; Neon delivers them to the payment service directly' });
    }
    if (!STORE_PATHS.has(pathname)) return respond(403, { error: 'path not allowed through the gateway' });
    if (client.inflight >= STORE_INFLIGHT_LIMIT) return respond(429, { error: 'too many gateway requests in flight' });
    const body = message.body === undefined ? undefined : JSON.stringify(message.body);
    if (body && body.length > STORE_BODY_LIMIT) return respond(413, { error: 'request too large' });

    client.inflight += 1;
    try {
      const response = await fetch(`${paymentUrl}${pathname}${search}`, {
        method: message.method === 'POST' ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${client.storeToken}`,
          cookie: jarHeader(client),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body,
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      });
      absorbCookies(client, response);
      const data = await response.json().catch(() => ({}));
      /* A claimed transfer code moves this connection to the claimed account,
       * exactly as the browser adopts the returned identity in client mode. */
      if (pathname === '/api/account/claim' && response.ok && PLAYER_ID_RE.test(data.accountId || '')) {
        client.storeToken = data.accountId;
        client.conn.send(JSON.stringify({ type: 'storeIdentity', playerId: client.storeToken }));
      }
      respond(response.status, data);
      if (!client.identitySent) {
        client.identitySent = true;
        client.conn.send(JSON.stringify({ type: 'storeIdentity', playerId: client.storeToken }));
      }
      if (ENTITLEMENT_OPS.has(pathname) && response.ok) await refreshCosmetics(client);
      /* A real refund revokes via the webhook seconds later; re-check the
       * ledger a few times so the shared castle sheds the cosmetic. */
      if (pathname === '/api/store/refund' && response.ok) {
        for (const delay of [2000, 5000, 12000]) {
          setTimeout(() => { refreshCosmetics(client); }, delay).unref?.();
        }
      }
      log.info(`store ${message.method || 'GET'} ${pathname} → ${response.status}`);
    } catch (error) {
      respond(502, { error: `payment service unreachable: ${error.message}` });
      log.warn(`store forward failed: ${error.message}`);
    } finally {
      client.inflight -= 1;
    }
  }

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
        gateway: { paymentApi: paymentUrl, cosmetics: cosmeticsUnion },
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
  });

  server.on('upgrade', (req, socket) => {
    const client = { conn: null, role: 'viewer', hello: false, storeToken: null, cookies: new Map(), inflight: 0, identitySent: false };
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
          /* Store identity: adopt the client's persisted account, or mint one.
           * The bearer id is the account; the payment service accepts either. */
          client.storeToken = PLAYER_ID_RE.test(message.playerToken || '') ? message.playerToken : randomUUID();
          client.hello = true;
          clearTimeout(client.helloTimer);
          conn.send(JSON.stringify({
            type: 'welcome',
            protocol: PROTOCOL_VERSION,
            role: client.role,
            downgraded: wantsControl && !keyOk ? 'bad_key' : undefined,
            session: sessionInfo(),
          }));
          conn.send(JSON.stringify({ type: 'snapshot', ...gameHost.snapshot(), viewers: clients.size, cosmetics: cosmeticsUnion }));
          log.info(`client hello role=${client.role} clients=${clients.size}`);
          return;
        }
        if (message.type === 'ping') return conn.send(JSON.stringify({ type: 'pong', t: message.t }));
        if (message.type === 'store') {
          /* Store access is identity-scoped, not session control: viewers and
           * controllers alike may buy for their own account. */
          if (!Number.isInteger(message.id)) return conn.send(JSON.stringify({ type: 'error', code: 'store_id_required' }));
          handleStore(client, message);
          return;
        }
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
        /* A viewer that never bought anything leaves nothing behind; a buyer's cosmetics stay on the shared castle
         * for the life of the process (the ledger in the payment service is the truth either way). */
        const token = client.storeToken;
        if (token && !sessionCosmetics.get(token)?.size && ![...clients].some((other) => other.storeToken === token)) {
          sessionCosmetics.delete(token);
        }
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
