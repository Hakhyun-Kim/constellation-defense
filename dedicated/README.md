# Dedicated server and store gateway

`dedicated/` is one Node process that runs the game simulation authoritatively and broadcasts it over a WebSocket. Today it is a server-authoritative spectator broadcast plus a store gateway. The server plays a session by itself with the shared bot policy (`src/bot.js`); clients render its snapshots; store calls ride the same socket and are forwarded to the payment service. It is not yet a multiplayer game server. There is no player-action message: the only client-to-server messages are `hello`, `ping`, `command` (pause, resume, speed, restart) and `store`. The Unity and Unreal files under `clients/` are protocol smoke tests and have not been executed inside an engine.

## Files

| File | What it does |
|---|---|
| `server.mjs` | HTTP + WebSocket endpoint (default port 8643). `hello` roles and store identity, broadcast to every client, the store gateway, `GET /healthz`. |
| `host.mjs` | The authoritative session. Drives `src/engine.js` with `src/bot.js` decisions in fixed 1/60 s steps and emits `snapshot`, `events`, `decision` and `session` messages. |
| `ws.mjs` | RFC 6455 server on `node:http` upgrade. Text frames only, 1 MiB message limit, server ping every 30 s, no runtime dependencies. |
| `PROTOCOL.md` | The wire contract, v2. |
| `Dockerfile` | `node:22-alpine` image that copies `package.json`, `dedicated/`, `server/logger.mjs` and `src/`. No install or build step. |
| `../src/app/dedicated-client.js` | Browser client. Merges snapshots into the state object the existing renderer and HUD read, smooths enemy motion between snapshots, sends store calls over the socket, reconnects with backoff. Runs no game rules. |
| `../src/app/dedicated-overlay.js` | The on-screen panel: connection status, session facts, architecture diagram, command flow, code map, progress notes, pause/speed/restart controls, a store button and a "Try the game" button that switches to a local run. |
| `../scripts/dedicated-check.mjs` | Executable contract, `npm run dedicated:check`. |

## Run

Launchers (Node 22.9+, nothing else installed):

- Windows: double-click `start-dedicated.bat`.
- macOS/Linux: `./start-dedicated.command`.

Each launcher copies `.env.example` to `.env` on first run, runs `npm install` if `node_modules` is missing, runs `npm run build`, starts `node dedicated/server.mjs` with `DEDICATED_CONTROL_KEY=local-demo-key`, runs `npm run serve` in the foreground and opens `http://127.0.0.1:8642/?lang=en&dedicated=1&key=local-demo-key`.

Manual:

```bash
npm run dedicated   # ws://127.0.0.1:8643, forwards store calls to PAYMENT_API_URL
npm run serve       # http://127.0.0.1:8642, web client + payment service (mock mode)
```

Open `http://127.0.0.1:8642/?lang=en&dedicated=1`. Watching needs no key. Session control needs the controller key: set `DEDICATED_CONTROL_KEY`, or use the key the server prints at boot when it is unset, and add `&key=<key>` to the URL. `?dedicated=ws://host:port` points the viewer at another server; the page CSP allows only `ws://127.0.0.1:8643` and `ws://localhost:8643`.

Environment (`server.mjs`): `DEDICATED_PORT` (8643), `DEDICATED_HOST` (127.0.0.1; `0.0.0.0` for LAN or Docker), `DEDICATED_CONTROL_KEY`, `PAYMENT_API_URL` (`http://127.0.0.1:8642`), `DEDICATED_SEED`, `DEDICATED_SPEED`, `DEDICATED_PROFILE`, `DEDICATED_DIFFICULTY`, `DEDICATED_CHAPTER_CAP`, `LOG_FORMAT`.

Docker is optional. `compose.yaml` and `Dockerfile` have not been executed on the development machine (no Docker installed there); the launchers are the supported path.

```bash
docker compose up --build   # web (:8642, mock mode) + dedicated (:8643, PAYMENT_API_URL=http://web:8642)
docker build -f dedicated/Dockerfile -t cd-dedicated . && docker run --rm -p 8643:8643 cd-dedicated
```

## Protocol summary

`PROTOCOL.md` v2 is the contract; `scripts/dedicated-check.mjs` is its executable form, and the check wins on any disagreement.

- `hello` must be the first message, within 10 s. `role: "viewer"` needs no key. `role: "controller"` with the control key may also send `command`. A wrong key is welcomed as a viewer with `downgraded: "bad_key"`. An optional `playerToken` (36-character UUID) sets the store identity; otherwise one is minted.
- `welcome` carries `{ protocol: 2, role, downgraded?, session }` and is followed by a full `snapshot`.
- `snapshot` is sent at 20 Hz during a wave and 2 Hz otherwise (`host.mjs`: 0.05 s and 0.5 s). It includes `viewers` and `cosmetics`. Entity ids are stable between snapshots.
- `events` carries engine tick events. `decision` announces each bot action. `session` announces a new session after a restart or an automatic post-defeat restart.
- `command` ops: `pause`, `resume`, `speed` (0.5, 1, 2, 4), `restart` (optional `seed`). Answered with `commandResult`. From a viewer it returns `error: forbidden`.
- `store` `{ id, path, method, body }` is forwarded to `PAYMENT_API_URL` with `Authorization: Bearer <account>` and a per-connection cookie jar, and answered with `storeResult { id, status, data }`. `storeIdentity` announces the account. Limits: 4 requests in flight (429), 64 KiB body (413), 10 s upstream timeout (502).
- Allowlisted `STORE_PATHS`: `/api/store/catalog`, `/api/store/market`, `/api/store/entitlements`, `/api/store/checkout`, `/api/store/refund`, `/api/store/mock-complete`, `/api/store/mock-refund`, `/api/account/transfer-code`, `/api/account/claim`. Any other path is 403. `/api/webhooks/*` is refused with a written reason: webhooks travel from Neon to the payment service, never through a client connection.
- `GET /healthz` (also served at `GET /`) returns `{ service, protocol, clients, session, gateway }`.

## Rules

- Client mode is the baseline. The game (Pages, `index.html`, `npm run serve`) must run with zero servers. Without `?dedicated=1` nothing connects, no overlay appears and input is not blocked.
- `dedicated/` imports only `src/` (engine, balance, bot, tactics) and `server/logger.mjs`. It never imports payment code; it calls the payment service over HTTP only (`PAYMENT_API_URL`, default `http://127.0.0.1:8642`).
- No game rules in clients. A snapshot always overwrites local guesses.
- The gateway relays only the allowlist. A new client-facing path changes `STORE_PATHS`, `PROTOCOL.md` and `dedicated-check` in the same commit.
- Store identity is the `hello` `playerToken` (or a minted UUID) used as the bearer account. Prices, country and fulfilment are decided by the payment service; the gateway adds identity and the cookie jar only. `cosmetics` is a display union, not the ledger.
- A protocol change updates `PROTOCOL.md` and `scripts/dedicated-check.mjs` in the same commit.
- The control key is a shared demo secret. Replace it in any deployment and do not use `local-demo-key` in examples outside the docs.

## Verify

`npm run dedicated:check` runs inside the main `npm run check` gate. It boots the real server on an ephemeral port with a real in-process payment service (mock mode, temporary JSON ledger) behind it. On the success path it makes 29 assertions; a 30th reports only if the flow throws. Groups: RFC handshake vector and frame length encodings; ephemeral port and `/healthz`; viewer welcome and snapshot schema; autonomous progress to a wave, event and decision streaming, tick advance; viewer command refused and wrong-key downgrade; controller welcome, speed applied, invalid speed rejected, restart seen by every client, ping/pong; catalog forwarding, minted identity announced, supplied identity kept, market selection through the cookie jar; brokered checkout, mock fulfilment, entitlements, cosmetic broadcast to another viewer, mock refund and cosmetic removed; webhook path refused and non-store path refused.

## Status

From the decision record (2026-09-06):

| Usually expected | This build, now | Where |
|---|---|---|
| Server simulates what players do | Server simulates what **its own bot** does. `host.mjs` drives `src/bot.js`; no client input reaches the engine | `dedicated/host.mjs` |
| Clients send game actions | Client-to-server messages are `hello`, `ping`, `command` (`pause`/`resume`/`speed`/`restart`) and `store` only; there is no game-action message | `dedicated/PROTOCOL.md`, `dedicated/server.mjs` |
| "Play" happens through the server | **Try the game** disconnects from the server and starts an ordinary local client-mode game | `src/main.js` (`onTryGame`) |
| Unity/Unreal clients render the session | `clients/` holds protocol smoke tests only (connect, `welcome`, snapshot fields, forbidden `command`, `store` catalog); nothing renders, and neither file has been executed | `clients/README.md` |
| Hosted checkout returns to the server-mode view | A hosted (non-mock) return lands on the client-mode URL | `server/store-api.mjs` (`successUrl`) |

Next, as recorded in the decision record: player input through the server (a game-action message in `PROTOCOL.md`, the host gating its bot decision behind a controller's intent, validation against the same engine commands, a conformance case in `dedicated-check`); an engine viewer that renders `snapshot.enemies` and `snapshot.field` keyed on entity ids and maps `decision` to captions, executed inside an engine at least once; gateway-mode return routing for hosted checkout; per-user credentials instead of one shared key; a lobby or session manager (one session per process today).

## Links

- [`PROTOCOL.md`](./PROTOCOL.md)
- [Decision record](../docs/design/dedicated-server-architecture.md)
- [`clients/README.md`](../clients/README.md)
- [Write-up: store gateway / server mode](https://github.com/Hakhyun-Kim/neon-checkout-integration/blob/main/docs/13-dedicated-server.md)
