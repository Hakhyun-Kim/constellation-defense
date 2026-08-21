# Hero-linked puzzle and cinematic demo

## Player problem

The 6×6 constellation board, the named squad, and the 3D defense were readable
separately but did not feel like one action. The board also occupied the height
below the battlefield, touch play required two taps, and the selected-card
active button hid the other heroes' timing. Boss arrival copy used a separate
banner, so it could not prove that the newly loaded runtime model was the actor
entering combat.

## Implemented interaction

- The constellation board lives in the right combat column on desktop. The 3D
  battlefield therefore keeps the left column height. On narrow screens the
  existing ordered single-column flow still places it directly after combat.
- A tap selects two neighbouring stars. A 14px dominant-axis swipe exchanges a
  star with the neighbour in that direction. Both inputs call the same legal
  swap and match-resolution path.
- All deployed named heroes appear in one quick-skill strip immediately below
  the battlefield. Desktop and mobile use the same stable order. Skills are not
  scattered over four edges: that would increase gaze travel, cover targeting
  information, and make landscape/portrait layouts disagree.

## Hero link

Every successful puzzle color now belongs to squad members:

| Puzzle | Heroes | Defense effect | Active cooldown returned |
| --- | --- | --- | --- |
| Flare | Arin, Sera | focused damage | 0.8 / 2 / 4 / 8 seconds |
| Tide | Luna, Yuna | lane-wide slow | 0.8 / 2 / 4 / 8 seconds |
| Bloom | Doyun | heal and push | 0.8 / 2 / 4 / 8 seconds |

The first three values correspond to 3-, 4-, and straight 5-star matches; the
fourth is the Hero-Sigil tier described below. The pure defense
engine changes cooldown state and emits `tacticHeroLink`; the board only emits
`{ route, kind, size }`. The renderer shows a local effect on the linked hero,
and the tactic HUD reports the hero and the returned cooldown. This keeps a
large match strategically valuable without adding a second hidden resource.

## Boss cut-in and art consistency

`bossSpawn` includes the live actor position. The renderer briefly eases the
camera toward that position while the stage adds a short letterbox/title card.
The cut-in therefore shows the same GLB or procedural fallback instance that
continues walking in combat; there is no separate boss portrait to become
stale. Reduced-effects mode limits the camera displacement.

The Quaternius hero models author their forward axis opposite the logical
route-facing axis. Every hero slot now declares a `Math.PI` yaw correction, and
the art selection check locks that contract.

## Implemented puzzle follow-up: Hero Sigils

A connected group of at least five matched stars becomes a Hero Sigil when its
valid horizontal and vertical runs meet at a junction. This covers corner, T,
and cross silhouettes. A straight group remains the existing five-star tactic,
so ordinary match goals and learned controls do not change.

The pure board helper classifies the geometry and promotes a sigil to semantic
size 6. The defense engine still receives only `{ route, kind, size }`; it does
not import board cells or shape names. Tier 6 has four visible rewards:

- eight seconds returned to the linked named heroes' active cooldowns;
- a stronger color-specific lane effect than the straight five-star tactic;
- all three Constellation Guardian marks completed at once, which the player
  can still hold for the chosen boss moment;
- a local `HERO SIGIL` board/HUD/world hit treatment and a distinct short audio
  phrase, without a battlefield-wide flash or camera-palette change.

The real legal-swap test includes a T-shaped sigil. The browser demo and
headless balance bot both call the same geometry helper, so this reward cannot
exist only in presentation or use information unavailable to a player.
Across the 2026-08-21 60-seed gate, the nine difficulty/profile cohorts made an
average of 1.8–13.5 sigils per first expedition (roughly 12–17% of their tactic
casts), while every completion-rate and median-wave baseline still passed.

## Remaining puzzle directions considered

1. **Orbit rings** — rotate one of three concentric constellation rings to align
   stars with the three lanes. It is visually distinctive, but needs a new
   legal-move search and a bot before replacing match-3.
2. **Route drawing** — connect stars without crossing an enemy corruption line.
   This is strong for boss armor phases but is slower under real-time pressure,
   so it should appear as a short boss sub-puzzle rather than the permanent
   board.
3. **Hold-and-release constellations** — bank one completed hero sigil and fire
   it at the chosen boss phase. The existing Constellation Guardian already
   covers this strategic timing, so another stored meter should not be added
   until playtests show the guardian is insufficient.

Orbit rings should remain an isolated boss-encounter experiment until it has a
deterministic legal-move search and balance-bot policy. It should not replace
the permanent board on concept appeal alone.

## Video demo

The `?demo=1` live route now uses a deterministic presentation seed. Its first
stable board contains a legal T-shaped Hero Sigil opportunity. The teaching
policy preserves that opportunity until its mapped lane has a living enemy,
then performs the same adjacent swap and `{ route, kind, size }` command as a
player. Once the Sigil has been shown, the normal threat-scored tactic policy
resumes. No enemy, cooldown, mark, or board state is granted directly.

The opening has four short two-line cards: battlefield/board continuity,
lane-and-color mapping, hero links, and the Hero-Sigil reward. During play,
milestone cards appear once and remain readable while combat continues:

- expedition route and fixed-party growth;
- preparation and the automatic defense transition;
- the first real tactic and the first Hero Sigil;
- a named hero active and a strategically held Guardian summon;
- the live-actor boss cut-in and the run-memory recap.

Normal action captions still identify the actual lane, color, effect, linked
heroes, active cooldown return, and cascade count. Important explanations have
a short hold priority so rapid bot actions cannot replace them immediately.
The bottom overlay stays local to the battlefield and uses tone-specific border
and copy colors; it does not flash, shake, or recolor the whole scene.

The demo now calls `nextConstellationAid()` just like the balance bot, so a
Sigil-completed Guardian is held for a boss or critical castle state and then
summoned through the public command. The deterministic check locks the opening
legal Sigil, rich card fields, caption hold behavior, and all mid-run guide
milestones.
