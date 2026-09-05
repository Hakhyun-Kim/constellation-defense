# Dedicated server protocol — v2

One WebSocket endpoint (`ws://host:8643/`), JSON text frames only. The
executable version of this contract is `scripts/dedicated-check.mjs`
(`npm run dedicated:check`), which runs in the main verification gate; if this
document and that check ever disagree, the check wins and this file has a bug.

An HTTP `GET /healthz` on the same port returns
`{ service, protocol, clients, session, gateway }` for monitors and scripts.

v2 adds the **store gateway**: store traffic rides the same socket and this
server brokers it to the payment service server-to-server, so a client needs
no HTTP store client, cookies or payment-origin configuration. v1 messages
are unchanged.

## Roles and identity

| Role | How | May |
|---|---|---|
| `viewer` | `hello` with no key | receive everything; send `ping` and `store` |
| `controller` | `hello` with the boot-time control key | additionally send `command` |

A wrong key does not disconnect: the client is welcomed as a `viewer` with
`downgraded: "bad_key"` so a misconfiguration is visible instead of silent.
The key comes from `DEDICATED_CONTROL_KEY`, or is generated and printed at
boot when unset. Local launchers pin `local-demo-key` for the loopback demo;
a deployment must set its own and treat it as a secret.

**Store identity is separate from the role.** Buying is identity-scoped, not
session control, so viewers and controllers alike may use `store`. The
connection's account is the `playerToken` supplied in `hello` (a 36-char
UUID, the same bearer identity the payment service uses), or a freshly minted
one; the server announces it in `storeIdentity` so the client can persist it.
A successfully claimed transfer code switches the connection to the claimed
account and re-announces.

## Client → server

```jsonc
{ "type": "hello", "role": "viewer", "playerToken": "…"? }        // must be first
{ "type": "hello", "role": "controller", "key": "…", "playerToken": "…"? }
{ "type": "ping", "t": 123 }                                        // → pong
{ "type": "command", "op": "pause" | "resume" }
{ "type": "command", "op": "speed",   "args": { "value": 0.5 | 1 | 2 | 4 } }
{ "type": "command", "op": "restart", "args": { "seed": 41 } }      // seed optional
{ "type": "store", "id": 7, "path": "/api/store/catalog?locale=en",
  "method": "GET" | "POST", "body": { … }? }
```

A connection that has not sent `hello` within 10 s is closed (1002). Any
non-`hello` message before `hello` gets `{"type":"error","code":"hello_first"}`.
`command` from a viewer gets `{"type":"error","code":"forbidden","op":…}`.

### The store surface

`store.path` must be one of the client-facing payment paths — currently
`/api/store/catalog · market · entitlements · checkout · refund ·
mock-complete · mock-refund` and `/api/account/transfer-code · claim`. The gateway forwards
the request to `PAYMENT_API_URL` with `Authorization: Bearer <account>` and a
per-connection cookie jar (explicit market selection is cookie-based and
works through it). Everything else is refused with status 403 — including,
deliberately, `/api/webhooks/*`: webhooks are Neon→payment-service traffic
and never travel through a client connection. Limits: 4 requests in flight
per connection (429), 64 KiB body (413), 10 s upstream timeout (502).

## Server → client

- `welcome` — `{ protocol: 2, role, downgraded?, session }`, immediately
  followed by a full `snapshot`.
- `snapshot` — authoritative render state, 20 Hz during combat, 2 Hz
  otherwise. Fields: `tick, phase, wave, gold, castleHp, castleMax, castle,
  time, combo, resonance, constellationAid, enemies[], field[], bench[],
  champ, journey, board[36], stats, viewers, cosmetics[]`. Entity ids are
  stable between snapshots; a client keys its scene objects on them.
  `cosmetics` is the union of entitlement keys fulfilled through this
  gateway (per account, kept for the server-process lifetime) — the shared
  castle decoration every viewer renders.
- `events` — `{ tick, events: [...] }`, the engine's own tick events
  (spawn/hit/death/…) for VFX and sound. Presentation-only.
- `decision` — `{ tick, action, …facts }` announcing each bot decision
  (`travel`, `startWave`, `tactic`, `ult`, `heroActive`, `defeat`, …) so a
  client can caption the session without re-deriving intent.
- `session` — new authoritative session announcement (after `restart` or an
  automatic post-defeat restart): `{ session: { id, seed, difficulty,
  profile, chapterCap, startedAt } }`.
- `commandResult` — `{ op, ok, … }` for the issuing controller only.
- `storeResult` — `{ id, status, data }` for the issuing client only: the
  payment service's HTTP status and JSON body, verbatim.
- `storeIdentity` — `{ playerId }`: the account this connection's store
  calls run as (announced after the first store call, and again after a
  claimed transfer code).
- `error` — `{ code: "bad_json" | "hello_first" | "forbidden" |
  "store_id_required" | "unknown_type" }`.

## Contract rules

1. **Clients never simulate.** Between snapshots a client may interpolate
   motion for smoothness, but every field of a snapshot overwrites local
   guesses. A disconnected client shows stale truth, not invented play.
2. **Clients never price or grant.** Store calls carry a SKU and a locale at
   most; prices, currency, country and fulfillment live in the payment
   service, and the gateway adds only identity. `storeResult` is the payment
   service's answer, not the gateway's opinion.
3. **Snapshots are self-sufficient.** A client joining mid-session renders
   correctly — including the shared cosmetics — from its first snapshot; no
   replay is required.
4. **Version field.** `welcome.protocol` is the contract version; a client
   should refuse a version it does not know. v2 is additive over v1.
5. **Transport.** Text frames, UTF-8 JSON, ≤ 1 MiB. The server answers
   protocol pings and sends its own every 30 s.
