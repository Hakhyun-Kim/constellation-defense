# Constellation Defense

**A real-time match-3 tactics defense game.**

Constellation Defense is a 3D kingdom-defense game framed as a compact constellation expedition. Every run begins with Arin the knight and Luna the constellation mage. The player follows an authored star-map, clears short defense encounters, and chooses which towns and companions to pursue. Doyun, Sera, and Yuna can join the party; a party holds up to five heroes and each hero gains experience and specializations.

During battle, tap two neighboring stars or swipe one toward a neighbor on the
6×6 board. Each match targets the matching road and advances the named heroes
linked to that color:

- **Flare** damages enemies on that road and charges Arin/Sera actives.
- **Tide** slows that road's enemy line and charges Luna/Yuna actives.
- **Bloom** restores the citadel, pushes danger back, and charges Doyun's active.
- A straight five-star line keeps the existing large tactic. A five-star
  corner, T, or cross becomes a **Hero Sigil**: it sharply advances the linked
  hero actives and completes all three constellation marks at once.
- Four-star matches add one constellation mark and straight five-star matches
  add two. Complete three marks, then bank the **Constellation Guardian** until
  a boss or critical lane needs its focused support fire.

The player’s choices are deliberately focused: choose a route and companions on the expedition, position the recruited heroes, select their specializations and castle upgrades between battles, then react with tactical swaps during the fight. Random summoning, duplicate heroes, rank combinations, and rarity collection are not part of the current game.

The redesign decisions and verification gates are recorded in [docs/design/journey-campaign-redesign.md](docs/design/journey-campaign-redesign.md).
The current pacing and bankable-constellation rule is documented in
[docs/design/constellation-aid-and-defense-pacing.md](docs/design/constellation-aid-and-defense-pacing.md).
The touch layout, hero-link rule, live-actor boss cut-in, puzzle prototypes, and
guided live-demo subtitles are documented in
[docs/design/hero-linked-puzzle-and-cinematic-demo.md](docs/design/hero-linked-puzzle-and-cinematic-demo.md).
For a fresh setup or handoff to another computer, start with [docs/CONTINUATION.md](docs/CONTINUATION.md).

## Play

[Play in the browser](https://hakhyun-kim.github.io/constellation-defense/)

[Watch the guided live demo](https://hakhyun-kim.github.io/constellation-defense/?demo=1)
— a real deterministic bot run with two-line explanations for lane/color
mapping, Hero Sigils, linked hero actives, held Guardian timing, phase flow,
boss cut-ins, and expedition growth. The teaching Hero Sigil is still made by
a legal adjacent swap and resolved through the normal combat engine.

Use `?lang=en` for the English build, or change **Language** from the in-game ⚙️ settings panel.

```bash
npm install
npm run build
npm run serve
npm run check
npm run balance:check
```

## Optional store — Neon checkout

The **별빛 상점 / Celestial Store** sells permanent, cosmetic-only castle
decorations. Pricing and fulfillment are server-owned (`server/`), and the game
engine knows nothing about payments. The hosted Pages build above is the static
game only — with no payment server present, the store hides itself and nothing
else changes.

Run the full local flow, no credentials needed:

- **Windows** — double-click `start-demo.bat`
- **macOS / Linux** — run `./start-demo.command`

Both create a mock-mode `.env`, install, build, start the local server, and open
the checkout inspector at
`http://127.0.0.1:8642/?lang=en&demo=expert&tour=neon&mute` — a panel on the game
screen that observes the real store: source excerpts from this build, live
redacted HTTP evidence, purchases delivered on the 3D castle, and per-item test
refunds. Manual equivalent on any platform with Node 22.9+:

```bash
cp .env.example .env    # NEON_MOCK_CHECKOUT=1 is already set
npm install && npm run build && npm run serve
```

`npm run store:check` runs the focused integration suite. The full design
record — architecture, decisions, verification, open questions — lives in the
companion [neon-checkout-integration](https://github.com/Hakhyun-Kim/neon-checkout-integration)
repository.

## Dedicated server demo

The simulation can also run in an authoritative server process, with every
client — this web build, and the Unity/Unreal samples in `clients/` — acting
as a renderer of its snapshots. No game rule runs client-side in that mode.

- **Windows** — double-click `start-dedicated.bat`
- **macOS / Linux** — run `./start-dedicated.command`

Both start the dedicated server (`ws://127.0.0.1:8643`) and the web client
(`http://127.0.0.1:8642`), then open the live viewer, where a server-side bot
plays immediately. The on-screen panel shows the architecture, command flow,
code map and progress, and a **Try the game** button switches to an ordinary
local run. Watching is public; pausing, changing speed, and restarting the
session require the controller key (the launcher passes a loopback demo key).

Manual equivalent: `npm run dedicated` in one terminal, `npm run serve` in
another, then open `http://127.0.0.1:8642/?lang=en&dedicated=1`. The wire
contract is [`dedicated/PROTOCOL.md`](dedicated/PROTOCOL.md), enforced by
`npm run dedicated:check`; the decision record is
[`docs/design/dedicated-server-architecture.md`](docs/design/dedicated-server-architecture.md).
A `compose.yaml`/`dedicated/Dockerfile` container path exists for
deployment-shaped review (not executed on the development machine).

## Built with Codex

Codex was used as a development collaborator to evolve an existing 3D defense foundation into a focused match-3 tactics game. It helped separate deterministic simulation rules from presentation, add the tactical board, create the fixed-squad growth system, automate balance runs with real match-3 actions, and retain procedural 3D visuals and synthesized audio.

The design decisions were human-led: matching must map to a visible road, each tactic must have a distinct role, and hero growth must create commitment without competing with the live board.

## Technical notes

- Browser-only static build with esbuild.
- `src/engine/` is DOM- and renderer-free, enabling deterministic Node checks.
- `src/balance/` is the single source for tactical and squad-growth numbers.
- `src/app/tacticflow.js` owns board input and cascades; `src/engine/tactics.js` resolves their commands into combat events.
- Hero-Sigil geometry remains pure in `src/tactics/board.js`; it promotes a
  corner/T/cross group to semantic tactic tier 6 without exposing board shape
  to the defense engine.
- The release uses a single CC0 Quaternius character/monster family and compact CC0 Kenney combat samples, with procedural terrain, VFX, and synthesized fallbacks.
- `?art=procedural` runs without requesting the external-asset manifest. Every bundled asset has recorded provenance and must pass the initial-download, integrity, and rendering-performance gates.
- The 📊 toolbar button exports up to 40 locally stored play-session records for duration testing. No identifier or play telemetry is sent over the network.
- The ⚙️ panel shares graphics, reduced-effects, audio, and remappable physical-key preferences across browser and desktop builds. Reserved navigation keys remain fixed and shortcut conflicts swap safely.
- Korean and English share stable game/save IDs; localization changes presentation only. The active bilingual interludes follow the hunter-fiction gate story rather than the retired math prototype.

See [CREDITS.md](CREDITS.md) for asset and font credits.
