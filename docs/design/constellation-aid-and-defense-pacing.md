# Defense pacing and constellation guardian

Updated: 2026-08-14

## Player-facing goal

A defense should resolve with enough acknowledgement to make the return to the
star map feel earned. Between defenses, the player needs a readable warning
and a genuine chance to prepare, without converting routine progress into a
confirmation dialog. The match-3 board also needs one delayed, strategic
choice in addition to its immediate Flare, Tide, and Bloom effects.

## Completed-defense flow

When the final defense of a map node ends, a short local `VICTORY` interstitial
names the defended place, confirms `Defense N/N`, shows current citadel HP, and
then leaves the player at the star map. It dismisses automatically after 2.6
seconds and introduces no screen flash, camera shake, or palette change.

For a multi-defense encounter, the next defense remains automatic but now has
a visible ten-second countdown. The stage message displays the whole seconds
remaining and the start button repeats that number. `Space` remains an
immediate start. The timer pauses behind a story, start screen, management
modal, pause condition, or hidden tab. The first defense begins the same
countdown as soon as the player has deliberately chosen its battle node.

## Bankable constellation support

The familiar match rules remain intact. A successful match additionally gives:

| Match size | Constellation marks |
| --- | ---: |
| 3 | 0 |
| 4 | 1 |
| 5+ | 2 |

At three marks, **Constellation Guardian** is ready. The ready state is saved
at preparation/map boundaries, so a player can intentionally hold it for a
boss. During an active defense, the support button selects the lane with the
highest visible pressure (bosses weigh first) and summons one guardian there.
It stays for 12 seconds, attacks every 0.8 seconds for 46 damage, and deals
1.75× damage to a great boss. Only one guardian may be active at a time. It
uses the ordinary tracked-projectile and damage path; it has no hidden board
information or special damage bypass.

The values live in `src/balance/tactics.js`, the persistent charge and the
summon command live in `src/engine/constellation-aid.js`, and the UI/3D helper
only presents engine events. The balance bot uses the same public command and
holds a completed constellation until a boss appears or the citadel is
critical.

## Verification

- `scripts/engine-check.mjs` covers four/five mark gain, save/load retention,
  boss multiplier, and temporary-summon cleanup.
- `scripts/phase-flow-check.mjs` requires a ten-second whole-number countdown
  and verifies that overlays pause it.
- `scripts/glb-check.mjs` now validates each embedded GLB PNG/JPEG buffer view
  and its file signature. This guards the direct embedded-image decode path
  used when a WebView rejects Three.js's intermediate `blob:` texture fetch.
- Before release, manually check a multi-defense node at desktop and mobile
  widths: 10→9 countdown, manual `Space` start, 4/5 mark feedback, saved ready
  guardian, boss-lane summon, and final-node victory return.
