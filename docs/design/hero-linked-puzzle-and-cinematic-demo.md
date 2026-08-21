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
| Flare | Arin, Sera | focused damage | 0.8 / 2 / 4 seconds |
| Tide | Luna, Yuna | lane-wide slow | 0.8 / 2 / 4 seconds |
| Bloom | Doyun | heal and push | 0.8 / 2 / 4 seconds |

The three values correspond to 3-, 4-, and 5-star matches. The pure defense
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

## Puzzle directions considered

The hero link is the smallest safe first improvement because it uses the real
combat command and existing balance bot. The following variants are good
follow-ups, in this order:

1. **Hero sigils** — a short encounter asks for a line, corner, or cross in a
   hero's color. Completing it empowers that named active; ordinary matches
   remain valid. This reuses the current connected-match groups and is the best
   next prototype.
2. **Orbit rings** — rotate one of three concentric constellation rings to align
   stars with the three lanes. It is visually distinctive, but needs a new
   legal-move search and a bot before replacing match-3.
3. **Route drawing** — connect stars without crossing an enemy corruption line.
   This is strong for boss armor phases but is slower under real-time pressure,
   so it should appear as a short boss sub-puzzle rather than the permanent
   board.
4. **Hold-and-release constellations** — bank one completed hero sigil and fire
   it at the chosen boss phase. The existing Constellation Guardian already
   covers this strategic timing, so another stored meter should not be added
   until playtests show the guardian is insufficient.

The next prototype should be Hero sigils. It adds pattern recognition while
preserving touch, bot, save, and lane contracts; Orbit rings should remain an
isolated experiment until it can pass the same deterministic gates.

## Video demo

Demo mode begins with three timed explanation subtitles, then continues through
the real bot input path. Its action captions describe actual swaps and skills;
boss spawn replaces the current caption with a cut-in explanation. This makes a
continuous screen recording understandable without a separate voice track and
does not create demo-only combat rules.

