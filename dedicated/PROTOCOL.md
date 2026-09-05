# Dedicated server protocol — v1

One WebSocket endpoint (`ws://host:8643/`), JSON text frames only. The
executable version of this contract is `scripts/dedicated-check.mjs`
(`npm run dedicated:check`), which runs in the main verification gate; if this
document and that check ever disagree, the check wins and this file has a bug.

An HTTP `GET /healthz` on the same port returns
`{ service, protocol, clients, session }` for monitors and scripts.

## Roles

| Role | How | May |
|---|---|---|
| `viewer` | `hello` with no key | receive everything; send `ping` |
| `controller` | `hello` with the boot-time control key | additionally send `command` |

A wrong key does not disconnect: the client is welcomed as a `viewer` with
`downgraded: "bad_key"` so a misconfiguration is visible instead of silent.
The key comes from `DEDICATED_CONTROL_KEY`, or is generated and printed at
boot when unset. Local launchers pin `local-demo-key` for the loopback demo;
a deployment must set its own and treat it as a secret.

## Client → server

```jsonc
{ "type": "hello", "role": "viewer" }
{ "type": "hello", "role": "controller", "key": "…" }   // must be first
{ "type": "ping", "t": 123 }                              // → pong
{ "type": "command", "op": "pause" | "resume" }
{ "type": "command", "op": "speed",   "args": { "value": 0.5 | 1 | 2 | 4 } }
{ "type": "command", "op": "restart", "args": { "seed": 41 } }  // seed optional
```

A connection that has not sent `hello` within 10 s is closed (1002). Any
non-`hello` message before `hello` gets `{"type":"error","code":"hello_first"}`.
`command` from a viewer gets `{"type":"error","code":"forbidden","op":…}`.

## Server → client

- `welcome` — `{ protocol: 1, role, downgraded?, session }`, immediately
  followed by a full `snapshot`.
- `snapshot` — authoritative render state, 20 Hz during combat, 2 Hz
  otherwise. Fields: `tick, phase, wave, gold, castleHp, castleMax, castle,
  time, combo, resonance, constellationAid, enemies[], field[], bench[],
  champ, journey, board[36], stats, viewers`. Entity ids are stable between
  snapshots; a client keys its scene objects on them.
- `events` — `{ tick, events: [...] }`, the engine's own tick events
  (spawn/hit/death/…) for VFX and sound. Presentation-only.
- `decision` — `{ tick, action, …facts }` announcing each bot decision
  (`travel`, `startWave`, `tactic`, `ult`, `heroActive`, `defeat`, …) so a
  client can caption the session without re-deriving intent.
- `session` — new authoritative session announcement (after `restart` or an
  automatic post-defeat restart): `{ session: { id, seed, difficulty,
  profile, chapterCap, startedAt } }`.
- `commandResult` — `{ op, ok, … }` for the issuing controller only.
- `error` — `{ code: "bad_json" | "hello_first" | "forbidden" | "unknown_type" }`.

## Contract rules

1. **Clients never simulate.** Between snapshots a client may interpolate
   motion for smoothness, but every field of a snapshot overwrites local
   guesses. A disconnected client shows stale truth, not invented play.
2. **Snapshots are self-sufficient.** A client joining mid-session renders
   correctly from its first snapshot; no replay is required.
3. **Version field.** `welcome.protocol` is the contract version; a client
   should refuse a version it does not know.
4. **Transport.** Text frames, UTF-8 JSON, ≤ 1 MiB. The server answers
   protocol pings and sends its own every 30 s.
