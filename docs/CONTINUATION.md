# Cross-machine continuation guide

Last updated: 2026-08-14

This document is the starting point for a developer or Codex session picking
up `Constellation Defense` on another computer.

## Current handoff state

- Branch: `main`
- Latest feature/fix commit: run `git log -1 --oneline`; the current local
  follow-up adds defense pacing, bankable constellation support, and an
  embedded-GLB texture decode workaround.
- Working tree at handoff: contains that local feature/fix until it is reviewed
  and committed. Preserve it when taking the next task.
- Latest deterministic gates: `npm.cmd run check` and
  `node scripts/balance-check.mjs 60` passed locally on 2026-08-14. The
  first-expedition and full two-chapter 60-run balance policies use real
  match-3, hero-active, blueprint, and constellation-support commands.

The current campaign is an authored constellation expedition. It starts with
Arin and Luna, uses a fixed five-hero party, and connects short defense stages
with map choices and towns. The live battle loop remains real-time match-3:
Flare damages, Tide slows, and Bloom heals/pushes back enemies on the selected
road. Do not restore the former math-prototype gates, random summoning, or
rank-combination loop.

The prize-focused presentation pass now also includes:

- `?judge=1` for a direct, authored first battle and highlighted legal Flare swap.
- `?weekly=YYYY-Www` for a deterministic weekly board and compact legal-swap replay.
- Hero specializations that modify the matching Flare, Tide, or Bloom tactic.
- Cinematic five-star feedback and a saved run memory for largest constellation,
  most-defended lane, decisive recovery, and the expedition route.
- Region-owned encounter pacing: a commander with minions before each regional
  finale, then a great boss arriving in formation with mid-boss lieutenants.
- A combat-focus projection that keeps the three live lane pressures and the
  selected hero active beside the match-3 board, while growth, codex, and castle
  management automatically recede until preparation resumes.
- A Korean/English browser release plus an offline Windows desktop demo using a
  sandboxed local protocol, shared settings/key bindings, explicit save path,
  bundled fonts, and a reproducible Steam depot ZIP.

## Current play-feel implementation

The 2026-08-13 pass translated direct player feedback into six independent
commits:

- The current combat UX follow-up moves the constellation board into the right
  combat column, adds touch swipe swaps, and places all deployed hero actives
  in one quick strip below the enlarged battlefield. Flare/Tide/Bloom matches
  now return cooldown to their named linked heroes, boss arrivals focus the
  live runtime actor in a short cut-in, and demo mode opens with timed
  explanation subtitles. See
  [hero-linked-puzzle-and-cinematic-demo.md](design/hero-linked-puzzle-and-cinematic-demo.md).

- `b2206ad` keeps daily difficulty measurement, town feel, phase flow, hero
  agency, and eye comfort as persistent project priorities.
- `5fff739` eases the opening enemy curve and adds a daily GitHub Actions job
  for the deterministic, storage, and 60-seed balance gates.
- `ed530be` gives the town continuous delta-time movement, normalized diagonal
  input, axis-separated collision sliding, click-to-walk, held mobile controls,
  animated procedural characters, and camera follow.
- `48775b8` introduced automatic linked defenses; the current follow-up uses a
  visible ten-second countdown for the first and subsequent defenses. Choosing
  the map battle remains deliberate, and overlays pause the clock.
- The 2026-08-14 follow-up adds a short `VICTORY` acknowledgement before a
  completed node returns to the map. Four- and five-star matches now charge a
  save-safe Constellation Guardian that can be held for a boss; it is an
  engine-owned temporary support, not a new board rule. See
  [constellation-aid-and-defense-pacing.md](design/constellation-aid-and-defense-pacing.md).
- `2d49fd0` gives all five named heroes an engine-owned active command with
  cooldown, UI selection, bot use, deterministic tests, and localized effects.
- `03f53dc` makes reduced effects the default, respects the OS reduced-motion
  preference, persists the player's choice, disables bloom and camera shake,
  and limits particles, flashing, and repeated village/HUD motion.
- The current safety pass removes battlefield bloom, camera shake, and the
  five-match scene brightness flash in every setting. `visual:check` makes this
  an automated release gate; lively mode now changes local particle density only.
- A follow-up removes the remaining WebGL-wide boss palette/light transition,
  flash overlay elements, and periodic brightness animations on the opening
  hint, boss warning, boss bar, and whole tactics board. Boss feedback is now a
  static banner, health bar, and local world-space particles in every setting.

See [regional-boss-encounters.md](design/regional-boss-encounters.md) for the
implemented tension curve and its balance budget.

## Post-competition production direction

The next commercial-quality direction is now in its isolated P0 art pilot.
See [production-quality-and-act2-roadmap.md](design/production-quality-and-act2-roadmap.md)
for the proposed single-source low-poly asset pilot, web download/licensing
budget, recent browser/Steam comparison, and the second hunter-fiction chapter.
External assets are now allowed and encouraged when their commercial game
license and provenance are explicit. The isolated pilot still comes first:
every asset must be registered, fit the download budget, and show measured
visual, rendering, and accessibility evidence before it replaces the stable
procedural presentation.

## Fresh-machine setup

In PowerShell:

```powershell
git clone https://github.com/Hakhyun-Kim/constellation-defense.git
Set-Location constellation-defense
git switch main
git pull --ff-only origin main
npm.cmd ci
npm.cmd run check
node scripts/balance-check.mjs 60
npm.cmd run serve
```

Open the local URL printed by `npm.cmd run serve`. Use `npm.cmd`, not `npm`,
on Windows because the PowerShell execution policy may block the shim.

## Current town implementation

The most recent feature deliberately makes a town a separate visual screen:

- `src/ui.js` owns town entry, walking, proximity, dialogue, recruit actions,
  and facility actions.
- `src/app/village-layout.js` is the shared pure source for the plaza bounds,
  building collision rectangles, target locations, and proximity checks.
- `src/gfx/village.js` draws the procedural Three.js plaza only. It must not
  decide rewards, facility rules, or combat results.
- `src/main.js` frames `VillageRenderer` while a town is active; otherwise it
  frames the normal defense renderer. The defense canvas/HUD must not be shown
  in town.

See [town-only-presentation.md](design/town-only-presentation.md) for the
player-facing decision.

## Required manual smoke test

Automated checks cover the pure layout contract but not WebGL composition.
Before presenting or submitting a visual change, manually confirm:

1. Reach a town from the expedition map.
2. Confirm the defense canvas and combat HUD disappear, leaving only the town
   plaza, its header, and its interaction controls.
3. Move with WASD/arrow keys, a plaza click, and the mobile direction controls.
4. Approach a recruit NPC and a facility; Enter/the action button must only
   work inside the interaction radius.
5. Leave to the map, start a defense stage, and confirm the normal defense
   renderer returns without console errors.
6. Repeat the first swap, all three tactics, 4/5 matches, wave clear, defeat
   reset, and a town facility visit at desktop and mobile widths.

On 2026-08-12, the local judge route was visually checked at 1280×720 and
390×844. Both widths had no horizontal overflow; the direct battle opened,
the first defense advanced to 2/2, and the mobile expedition map remained
readable with secondary panels hidden. Before final release, repeat all three
tactics and a four/five-star match at mobile width, then inspect the real
game-over memory modal and downloaded PNG share card.

A subsequent novice spectate smoke traversed meadow 2/2, the town route, and
Ember Gate 5/5 using the real bot and tactic paths. It exposed and fixed two
presentation blockers: the judge target dying before the taught swap (`6862133`)
and the demo repeatedly attempting town-only specialization from battle prep
(`c165bd5`). The repaired run showed all three tactics, a five-star Bloom with
a cascade, castle recovery from 29 to 100, and a clean automatic restart.
The spectate recap now remains visible for 12 seconds (`01b3e9b`) so a judge
can read the run memory or use the share-card button before the next run.
`3e75b23` fixes the actual game-over transition so that window is guaranteed
even when the combat action timer was already exhausted, and adds `demo:check`
to the main deterministic gate.

Final local mobile evidence includes all three tactics, four- and five-star
matches, a readable wave-10 run-memory modal with no horizontal overflow, and
a successfully downloaded and visually inspected 720×960 PNG share card.

On 2026-08-13, the final local desktop judge route opened defense 1/2 directly,
advanced to defense 2/2 without another click, and allowed Arin's `성광 일섬`.
The button immediately displayed a `9.8초` cooldown. `🌙 저자극` was active by
default and the browser console had no errors. The same release gate then
passed `npm.cmd run check`, `npm.cmd run storage:check`, and
`node scripts/balance-check.mjs 60`.

The next 2026-08-13 pass replaced the global five-wave boss timer with region
position. Browser smoke showed `푸른 초원 · 방어 1/2 · 지휘관전`, a preview
containing seven normal enemies and one mid-boss, and a working WebGL battle.
The effects toggle was checked in both `저자극` and `생동감`; `#scene3d` and its
canvas had `animation: none` and `filter: none` in both. `npm.cmd run check` and
the 60-seed balance gate passed after the encounter change.

GitHub Pages build `1147977267` then published public SHA `1ae41e2`. The exact
deployed judge URL opened without authentication, exposed the two authored
opening cells, and accepted real pointer input on cells 3→4. The UI reported
`가운데 길 · 유성 폭격 발동!`, then advanced from defense 1/2 to 2/2 through
the automatic countdown. In a fresh deployed session, Arin's active changed
immediately to a `9.7초` cooldown. Reduced effects were active by default,
desktop horizontal overflow was absent, and browser console errors were empty.

## Change discipline

- Read `AGENTS.md`, this guide, and the relevant design note before changing a
  system. Preserve unrelated work in a dirty tree.
- Rules and balance belong in `src/engine/` and `src/balance/`; DOM, Three.js,
  VFX, and sound only present their output.
- Add or update a deterministic check with a behavior change. Run
  `npm.cmd run check`; rerun the 60-run balance gate whenever gameplay numbers
  or the bot policy changes.
- Run `npm.cmd run build` instead of editing `dist/game.js` directly.
- Prefer licensed external assets when they materially improve the game. Record
  each runtime file in `assets/manifest.json` and `CREDITS.md`, run
  `npm.cmd run asset:check`, and compare desktop-high/mobile-lite loading and
  rendering metrics against the same seeded scene before merging.

## Public/private boundary

This repository is public. Do not add application copy, checklist text,
recordings, credentials, or other submission material from the separate private
directory `D:\constellation-defense-submission`. If that directory is not
available on the next computer, continue game work here and leave submission
material untouched.

## Suggested next task

Run the documented human campaign/weekly playtest cohort, aggregate its local
JSON exports with `npm.cmd run playtest:report -- ...`, and then revisit P3-2 and
P3-4. All automatable P0-P3 implementation and release packaging is complete.
P3-2 and P3-4 remain open only because verified human samples are still 0; never
label bot or Codex browser runs as human data. The protocol and conservative
scope branches are in `docs/testing/campaign-duration-protocol.md` and
`docs/design/early-access-evidence-gate.md`.

For every participant, use one stable non-identifying experience profile across
both modes: `?playtest=novice|regular|expert` for campaign and
`?weekly=YYYY-Www&playtest=novice|regular|expert` for weekly. The visible header
badge and exported `experience` field prevent cohort notes from drifting away
from the measured sessions. The evidence gate requires all three profiles.
