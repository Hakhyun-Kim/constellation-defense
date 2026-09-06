# Dedicated server architecture — decision record

Date: 2026-09-05 · Status: implemented (first milestone) · Gate: `npm run dedicated:check`

## Context

Constellation Defense is a browser game whose simulation (`src/engine/`,
`src/balance/`, `src/tactics/`) is deliberately pure: no DOM, no renderer, no
timers. That purity already pays for deterministic Node tests and a 540-run
balance gate. Two pressures pushed toward a dedicated server:

1. **One simulation, several screens.** A hosted demo should be watchable from
   a browser today and from Unity/Unreal clients later, without porting game
   rules into each engine.
2. **Authority.** The payment integration already established the pattern that
   the server owns the truth (prices, entitlements, webhooks). The game itself
   still ran wholly client-side; anything the client computes, the client can
   fake.

## Decision

Run the simulation in one authoritative Node process — `dedicated/host.mjs`
inside `dedicated/server.mjs` — and make every client a renderer of its
broadcasts:

- **State replication, not lockstep.** The server streams full render
  snapshots (20 Hz in combat, 2 Hz otherwise) plus the engine's own tick
  events and a `decision` narration channel. Clients merge snapshots into
  their scene and interpolate motion between them; they run no game rules.
- **Roles at hello.** Watching is public: any client is welcomed as a
  `viewer`. Steering (`pause`, `speed`, `restart`) requires the boot-time
  controller key; a wrong key downgrades to viewer *visibly* rather than
  failing silently. The conformance check locks both paths.
- **Zero-dependency transport.** `dedicated/ws.mjs` implements the needed
  slice of RFC 6455 (~150 lines: masked client frames, fragmentation,
  ping/pong, close). WebSocket is the one transport that browsers, Unity
  (`ClientWebSocket`) and Unreal (`FWebSocketsModule`) all speak natively.
- **Shared policy.** The hosted demo plays through the same bot policy as the
  balance gate (`src/bot.js`, `scripts/balance-bot.mjs`), so what a viewer
  watches is the same play the balance numbers are measured on.

The web client joins with `?dedicated=1`: the local engine stays idle, the
existing renderer/HUD read the merged state, and an overlay explains the
architecture, code map and progress on the game screen — with a button that
stops watching and starts an ordinary local game.

## Why not deterministic lockstep mirroring

The first design streamed only commands, expecting seeded determinism to keep
a client-side replica identical. Reading the client killed it honestly:

- The tactic board and the engine share one RNG stream, and the board consumes
  it inside animation timers (`src/app/tacticflow.js` refills on wall-clock
  callbacks). Command-identical runs still interleave RNG draws differently.
- Browser engines differ in transcendental-function bit-patterns (V8 vs
  JavaScriptCore), so long float chains drift across devices.
- The save format intentionally serializes preparation snapshots only — there
  is no mid-wave state to rebase a diverged mirror onto.

Snapshot replication removes the whole class: the server's numbers are the
only numbers. The cost — bandwidth and interpolation — is trivial at this
game's entity counts (snapshots are a few KB).

## Boundaries kept

- `dedicated/` imports `src/engine`, `src/balance`, `src/bot`, the shared
  bot-policy helpers, and the logger. It does not touch the payment code, and
  `server/` does not know the dedicated server exists.
- The static Pages build is unaffected: without `?dedicated=1` nothing
  connects, and the page's CSP allowlists exactly the loopback dedicated
  origin (deploying elsewhere means widening that list on purpose).
- The engine remains presentation-free; the host drives it with the same
  public commands a player uses.

## Operations

`start-dedicated.bat` / `start-dedicated.command` run both processes and open
the viewer (Node 22.9+, no other install). Docker is optional on purpose:
reviewers need Node anyway for the web build, and Docker Desktop is a heavier
ask on macOS than `node dedicated/server.mjs`; `dedicated/Dockerfile` and
`compose.yaml` exist for container-shaped deployments and are marked as not
yet executed on the development machine.

## A single client-facing edge — shipped (protocol v2)

The dedicated server is now also the store gateway: store operations travel
over the same WebSocket, and this process brokers them to the payment
service server-to-server with the connection's account identity. A client
therefore needs no HTTP store client, cookies or payment-origin
configuration — the wire is the socket it already has — and the store UI
itself did not change: it swaps its transport function and cannot tell which
wire it is on.

Mechanics, deliberately narrow:

- **Allowlisted forwarding.** Only the client-facing store surface passes
  (`/api/store/catalog · market · entitlements · checkout · mock-complete ·
  mock-refund`, `/api/account/transfer-code · claim`). `/api/webhooks/*` is
  refused with a written reason — webhooks are Neon→payment-service traffic
  and never travel through a client connection. Per-connection limits: four
  requests in flight, 64 KiB bodies, a 10 s upstream timeout.
- **Identity is the bearer account.** The connection adopts the
  `playerToken` from `hello` or mints a UUID, sends it as
  `Authorization: Bearer`, and announces it in `storeIdentity` so the client
  persists continuity with client-mode purchases. A claimed transfer code
  switches the connection's account, exactly as the browser does. Explicit
  market selection is cookie-based upstream, so the gateway keeps a
  per-connection cookie jar — which incidentally fixes the documented
  cookie-only market limitation for cross-origin clients.
- **Entitlements join the authoritative state.** After a fulfilment, refund
  or account claim, the gateway re-reads that account's entitlements from
  the ledger and broadcasts the per-account union in every snapshot
  (`cosmetics`); each viewer's castle wears what the session delivered, and
  a refund removes it for everyone. The ledger stays in the payment service;
  the gateway holds only this display union, for the process lifetime.

The payment service stays a separate internal process on purpose: webhook
delivery (retried up to 36 hours) must not depend on game-session lifecycle,
and payment credentials stay out of the game-server process. Hosted checkout
still opens Neon's page in the player's browser — the redirect is the point
of Hosted checkout — and a hosted-mode return currently lands on the
client-mode URL, which is the recorded next seam for gateway-mode returns.

## What "dedicated server" means here today (2026-09-06 review)

The phrase usually means an authoritative process that simulates *the
players'* inputs and that engine clients render as a scene. That is the
target, not the current build. What runs today, by file:

| Usually expected | This build, now | Where |
|---|---|---|
| Server simulates what players do | Server simulates what **its own bot** does — `host.mjs` drives `src/bot.js`; no client input reaches the engine | `dedicated/host.mjs` |
| Clients send game actions | Client→server messages are `hello`, `ping`, `command` (`pause`/`resume`/`speed`/`restart`) and `store` only — there is no game-action message | `dedicated/PROTOCOL.md`, `dedicated/server.mjs` |
| "Play" happens through the server | **Try the game** disconnects from the server and starts an ordinary local client-mode game | `src/main.js` (`onTryGame`) |
| Unity/Unreal clients render the session | `clients/` holds protocol smoke tests only (connect → `welcome` → snapshot fields → forbidden `command` → `store` catalog); nothing renders, and neither file has been executed | `clients/README.md` |
| Hosted checkout returns to the server-mode view | A hosted (non-mock) return lands on the client-mode URL | `server/store-api.mjs` (`successUrl`) |

What *is* real and gated by `npm run dedicated:check`: one authoritative
simulation broadcasting snapshots/events/decisions, key-authenticated
session control, and the store gateway (catalog, checkout, fulfil, refund,
shared cosmetics) against a real in-process payment service. In short: a
**server-authoritative spectator broadcast plus a store gateway**, not yet a
dedicated game server in the multiplayer sense.

## Current limits, stated plainly

- **Viewers watch; they do not play through the server yet.** Player input
  over the protocol (client sends intents, host validates against the same
  engine commands) is the designed next milestone — the command/role
  plumbing it needs is what `pause`/`speed`/`restart` already exercise.
  Concretely, this requires: a client→server game-action message in
  `PROTOCOL.md`, the host replacing (or gating) its bot decision with the
  controller's intent, validation against the same engine commands, and a
  conformance case in `scripts/dedicated-check.mjs`. None of that exists
  yet.
- The controller key is a single shared secret suited to a demo; real
  deployments should issue per-user credentials (the store identity the
  gateway already brokers per connection is the natural source).
- A hosted (non-mock) checkout opened through the gateway returns the player
  to the client-mode URL after payment; gateway-mode return routing is the
  next seam. The mock lifecycle runs entirely in-modal and is unaffected.
- Town/village interiors are shown as map state, not as the walkable scene.
- The Unity/Unreal samples verify the protocol from engine runtimes but have
  not been executed here (neither engine is installed on this machine); the
  Node conformance check is the enforced contract. They do not render
  anything — an engine *viewer* (snapshot → scene objects keyed on entity
  id, `decision` → captions) is still to be written on top of them.
- One session per process; a lobby/session manager is future work.

## Verification

`npm run dedicated:check` (in the main gate) boots the real server on an
ephemeral port and asserts: RFC handshake vector, frame length encodings,
health endpoint, viewer welcome + snapshot schema, autonomous progress to
combat, event/decision streaming, tick advancement, viewer command refusal,
wrong-key downgrade, controller speed/pause/restart including invalid-input
rejection, and restart announcement to all clients. The gateway suite runs a
**real in-process payment service** (mock mode, temporary JSON ledger) behind
the server and asserts: catalog forwarding, minted-identity announcement,
supplied-identity continuity, market selection through the cookie jar,
brokered checkout/fulfilment/refund, the delivered cosmetic appearing in —
and after refund disappearing from — another viewer's snapshots, webhook
paths refused with a written reason, and non-store paths refused.

A manual browser pass verified the live viewer, captions, VFX from streamed
events, the role badge, the forbidden-path message, speed-up via the
controller key, "try the game" switching to a local run, and returning to the
same server session; a second pass bought and refunded a cosmetic through the
panel's store button and confirmed, via a second keyless viewer tab, that the
shared castle gained and lost the decoration on both screens — consoles empty
throughout.
