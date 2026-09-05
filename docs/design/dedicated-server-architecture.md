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

## Direction — a single client-facing edge

The intended next step is for the dedicated server to become the only surface
clients talk to: store operations travel over the same WebSocket, and the
dedicated server brokers them to the payment service server-to-server with
the player's identity. Payment features then become server-side changes —
engine clients need no HTTP store client, cookies or per-engine CSP work —
and entitlements land in the authoritative state every viewer already
renders. The payment service deliberately stays a separate internal process
(webhook delivery retried for 36 hours must not depend on game-session
lifecycle, and payment credentials stay out of the game-server process), and
Hosted checkout still opens Neon's page in the player's browser. The
current-vs-target topology is drawn in the companion documentation
(neon-checkout-integration, doc 13). None of the store messages exist in the
protocol yet; what exists and is verified are the pieces the migration
composes — role auth at hello, the command/result path, snapshot broadcast,
and the payment service's bearer identity.

## Current limits, stated plainly

- **Viewers watch; they do not play through the server yet.** Player input
  over the protocol (client sends intents, host validates against the same
  engine commands) is the designed next milestone — the command/role
  plumbing it needs is what `pause`/`speed`/`restart` already exercise.
- The controller key is a single shared secret suited to a demo; real
  deployments should issue per-user credentials (the payment service's bearer
  identity is the natural source).
- Town/village interiors are shown as map state, not as the walkable scene.
- The Unity/Unreal samples verify the protocol from engine runtimes but have
  not been executed here (neither engine is installed on this machine); the
  Node conformance check is the enforced contract.
- One session per process; a lobby/session manager is future work.

## Verification

`npm run dedicated:check` (in the main gate) boots the real server on an
ephemeral port and asserts: RFC handshake vector, frame length encodings,
health endpoint, viewer welcome + snapshot schema, autonomous progress to
combat, event/decision streaming, tick advancement, viewer command refusal,
wrong-key downgrade, controller speed/pause/restart including invalid-input
rejection, and restart announcement to all clients. A manual browser pass
verified the live viewer, captions, VFX from streamed events, the role badge,
the forbidden-path message, speed-up via the controller key, "try the game"
switching to a local run, and returning to the same server session — with an
empty console.
