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

## Neon checkout demo

The optional **별빛 상점 / Celestial Store** sells one permanent, cosmetic-only
banner. Pricing and fulfillment are server-owned: the browser sends only a SKU and
a display language, the server creates a hosted Neon checkout, and the cosmetic is
granted only after a signed `purchase.completed` webhook. The client polls the
entitlement endpoint after returning from checkout because the redirect can arrive
before the webhook.

Run the complete local flow without credentials. On Windows, double-clicking
`start-demo.bat` does all of it — copies `.env`, installs, builds, starts the
server, and opens the guided tour in your browser. By hand, on any platform:

```bash
cp .env.example .env    # NEON_MOCK_CHECKOUT=1 is already set
npm run serve
```

Open `http://127.0.0.1:8642`, choose **별빛 상점**, and buy the banner. Mock mode
uses the same checkout ledger and the same idempotent fulfillment path, but never
contacts Neon. For a real sandbox checkout, set the credentials in `.env`:

```ini
NEON_MOCK_CHECKOUT=0
NEON_API_KEY=your-sandbox-api-key
NEON_WEBHOOK_SECRET=the-shared-listener-secret
NEON_ENVIRONMENT=sandbox
PUBLIC_URL=https://your-public-tunnel.example
```

`npm run serve` loads `.env` through Node's own `--env-file-if-exists`, and warns
at startup about the configurations that silently break a checkout (no API key, no
webhook secret, a `PUBLIC_URL` Neon cannot reach).

Register `https://your-public-tunnel.example/api/webhooks/neon` for version 2
`purchase.completed` events in the Neon sandbox Console. The listener validates the
raw request body with the `x-neon-digest` HMAC-SHA256 signature. Runtime checkout
and entitlement data is written to the ignored `.data/neon-store.json` file. That
ledger is deliberately small and readable; a multi-instance deployment should
replace it with a transactional database while preserving the interface in
`server/repository.mjs`.

Three details are worth calling out because they are where this kind of
integration usually goes wrong:

- **Prices are Neon's 100× integers, formatted by `Intl`, never hand-written.**
  ₩4,900 is sent as `490000` and $4.99 as `499`. The won has no circulating
  subunit, so the trailing zeros look like a bug to Korean eyes — the multiplier
  lives in exactly one frozen table and the display string is derived from it.
- **Billing country is never inferred from the game's language.** It comes from an
  explicit player choice, then a platform geo header, then the browser's
  `Accept-Language` region — never from the ko/en toggle, because Neon binds
  currency to `playerCountry` and a Korean player reading English is still in KR.
- **Only failures that a retry could fix return a non-2xx.** Neon retries non-2xx
  responses for up to 36 hours, so unknown references, unhandled event types, and
  sandbox/production mismatches are acknowledged with `200 {ignored}` and logged.
  An invalid signature stays a `403` on purpose: that is a misconfiguration that
  should stay noisy.

Relevant implementation files:

- `server/store-api.mjs` — HTTP routes, session cookie, country resolution, webhook verification.
- `server/catalog.mjs` — allowlisted SKU, market table, server-owned prices.
- `server/repository.mjs` — pending checkout, purchase and entitlement ledger.
- `src/app/neon-store.js` — hosted checkout launch, billing-region picker, post-return polling.
- `scripts/store-server-check.mjs` — signature, replay, tampering, environment and rate-limit tests.

## Guided tour — the integration explained on the game screen

```bash
cp .env.example .env    # NEON_MOCK_CHECKOUT=1 is already set
npm run serve
```

Then open one of:

- `http://127.0.0.1:8642/?lang=en&demo=expert&tour=neon&mute`
- `http://127.0.0.1:8642/?demo=%EA%B3%A0%EC%88%98&tour=neon&mute` (Korean)

A bot plays the game through the same inputs a person uses, while a panel walks
through the integration in ten steps. It is not a slideshow: most steps send a
real request and print the response, so the price, the entitlement and the refund
on screen are what the server just returned. The purchase and the refund go
through the same `repository.fulfill` and `repository.revoke` a signed webhook
reaches.

The tour refunds its own purchase when it starts, so reloading replays it cleanly
rather than stopping at the duplicate-purchase guard.

Run `npm run store:check` for the focused integration test. The implementation
follows Neon's official [hosted checkout](https://docs.neonpay.com/docs/creating-a-checkout),
[fulfillment](https://docs.neonpay.com/docs/fulfillment), and
[webhook](https://docs.neonpay.com/docs/webhooks-and-callbacks) documentation.
Design notes, decisions, and open questions are collected in the companion
[neon-checkout-integration](https://github.com/Hakhyun-Kim/neon-checkout-integration) repository.

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
