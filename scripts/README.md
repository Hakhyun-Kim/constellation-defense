# scripts/

Every file in this directory, what it does, and whether `npm run check` runs it. The "npm" column is the `package.json` script name. "via X" means the file is imported or invoked by X and so runs inside the gate. `serve.mjs` (`npm run serve`) is the development static server with the payment API mounted on the same origin, `PORT` default 8642; it is not a check.

## Engine, tactics, balance

| File | npm | What it does | In `check` |
|---|---|---|---|
| `engine-check.mjs` | `engine:check` | Engine invariants: pad contract (bench is -1, field is a valid integer), hero combining, skills. | yes |
| `tactic-board-check.mjs` | `tactics:check` | Pure match-3 board rules, tactic move descriptions, judge-run opening wave. | yes |
| `act2-content-check.mjs` | `act2:check` | Act 2 chapter: eight unique reachable nodes, three regions with renderer themes and boss mappings, fork choices, refugee station. | yes |
| `balance-report-check.mjs` | `balance:report:check` | Policy set is `none`/`random`/`threat`, each policy picks a legal swap, traced runs record lanes, casts and sizes. | yes |
| `balance-bot.mjs` | `balance` | Plays full runs with the real engine per difficulty and profile. With `check` it compares each cell's median wave to `balance-baseline.json`. Default 150 runs when run directly. | no |
| `balance-check.mjs` | `balance:check` | The balance gate. See below. | no |
| `balance-baseline.json` | | Median waves, tolerance and completion minimums per difficulty/profile that `balance-bot.mjs check` compares against. | data |
| `balance-report.mjs` | `balance:report` | Compares no tactics, random legal swaps and threat-based swaps on identical seeds. `--json` for machine output. | no |
| `campaign-balance-check.mjs` | `campaign:balance:check` | Two-chapter campaign bot, 20 seeds per difficulty/profile cell, Act 2 reach and completion minimums. | no |
| `diag-density.mjs` | | Diagnostic: maximum and average simultaneous enemies per wave. | no |

`node scripts/balance-check.mjs 60` is a separate gate. The `60` is runs per cell. The script spawns `balance-bot.mjs` in check mode once for each of 3 difficulties (`easy`, `normal`, `hard`) times 3 profiles (`초보`, `보통`, `고수`: beginner, average, expert), so 9 processes and 540 runs. A process that crashes is retried; the code default is 6 tries (the header comment says 4). It exits 1 if any cell misses its baseline or crashes on every try. It is not in `npm run check`; CI runs it on a schedule.

## UI and app

| File | npm | What it does | In `check` |
|---|---|---|---|
| `hero-card-check.mjs` | `ui:check` | Hero card markup carries art, role, ability, damage, DPS, range and growth tokens for every hero. | yes |
| `combat-focus-check.mjs` | `combat:ui:check` | `combatLanePressure` on a fixed enemy set. | yes |
| `village-check.mjs` | `village:check` | Village bounds, buildings, walk points, target proximity. | yes |
| `phase-flow-check.mjs` | `phase:check` | Automatic phase countdown keys and clock. | yes |
| `weekly-check.mjs` | `weekly:check` | Weekly challenge ids, seeded opening boards, swap replay. | yes |
| `session-metrics-check.mjs` | `session:check` | Local session meter: active/wall/phase timing, checkpoints, retries, bounded export. | yes |
| `playtest-analysis-check.mjs` | `playtest:check` | Playtest aggregation, quantiles, conversion, Early Access evidence gate. | yes |
| `playtest-report.mjs` | `playtest:report` | Prints a report from exported playtest JSON files. `--participants=N`, `--json`. | no |
| `preferences-check.mjs` | `preferences:check` | Key bindings: defaults, physical-key lookup, reserved keys, conflict swapping, repair. | yes |
| `i18n-check.mjs` | `i18n:check` | ko/en locale normalization, critical translations, language selector. | yes |
| `demo-check.mjs` | `demo:check` | Demo bot and guided tour flow; every demo timer holds while the store is open. | yes |
| `storage-check.mjs` | `storage:check` | Migration of legacy `mathdef_*` localStorage keys. | yes |

## Payment

| File | npm | What it does | In `check` |
|---|---|---|---|
| `store-server-check.mjs` | `store:check` | Store API over real HTTP on an ephemeral port: forged signatures, replay, client prices, environment mismatch, other accounts, retry codes, refunds, return addresses. Always runs against the JSON ledger; also against Firestore when `FIRESTORE_EMULATOR_HOST` is set. | yes |
| `store-regression-check.mjs` | | Neon client timeout and response handling; a failed disk commit stays retryable; a restart preserves the grant. | via `store:check` |
| `service-check.mjs` | `service:check` | `server/index.mjs` contract: bad configuration refuses to start, health and readiness are truthful, in-flight work drains on shutdown, no game files are served. | yes |
| `serve-check.mjs` | | Spawns `serve.mjs` on `PORT=0`; public assets load; credentials, ledger and source are blocked. | via `service:check` |
| `tour-check.mjs` | `tour:check` | Castle cosmetics per entitlement survive refresh and refund removes only one item; redacted events; inspector DOM contract; the bot keeps playing under `?demo=expert&tour=neon`. | yes |
| `payment-excerpts.mjs` | (first step of `build`) | Generates `src/app/neon-excerpts.generated.js` from six fixed source windows. `--check` fails if the file is stale. | via `build` |
| `secrets.mjs` | | Encrypts or decrypts an `.env` file (scrypt, AES-256-GCM) for private hand-off. Passphrase from `SECRETS_PASSPHRASE` or a prompt. | no |

## Dedicated server

| File | npm | What it does | In `check` |
|---|---|---|---|
| `dedicated-check.mjs` | `dedicated:check` | Conformance check for `dedicated/server.mjs`: hello/welcome roles, snapshot schema, event flow, the viewer/controller auth boundary, and the store gateway in front of an in-process payment service (mock mode, temporary JSON ledger). Runs the real server on an ephemeral port with an accelerated clock. | yes |

## Assets and performance

| File | npm | What it does | In `check` |
|---|---|---|---|
| `asset-budget-check.mjs` | `asset:check` | `assets/manifest.json` against budgets: initial 12 MiB, total 60 MiB, single file 8 MiB. Runs last, after `build`. | yes |
| `asset-loader-check.mjs` | `asset:runtime:check` | Runtime asset loader and per-profile asset support. | yes |
| `art-pilot-check.mjs` | `asset:pilot:check` | Art pilot region and hero/enemy/landmark slot mapping. | yes |
| `glb-check.mjs` | `asset:model:check` | GLB structure, embedded resources, required animation clips per model. | yes |
| `audio-pilot-check.mjs` | `audio:pilot:check` | Ten audio assets in the manifest: unique roles, preload, gain between -18 and -3 dB, cue fallbacks. | yes |
| `art-evidence-check.mjs` | `evidence:check` | `docs/evidence/art-v2`: JPEG stills and WebM videos exist, are non-trivial, and are referenced from its `index.html`. | yes |
| `visual-safety-check.mjs` | `visual:check` | No battlefield-wide flashing, brightness pulses or camera shake in CSS, renderer, fx and ui. | yes |
| `visual-capture-check.mjs` | `capture:check` | Capture file names and WebM mime fallback. | yes |
| `perf-probe-check.mjs` | `perf:check` | Frame duration summary: average FPS and p95. | yes |
| `pack-embedded-gltf.mjs` | | Packs a glTF with embedded data-URI buffers into one GLB. | no |
| `pack-web-gltf.mjs` | | Packs a glTF with external buffers and textures into a compact GLB; base color reduced to a 512 px JPEG through a supplied `sharp` module. | no |

## Desktop

| File | npm | What it does | In `check` |
|---|---|---|---|
| `desktop-check.mjs` | `desktop:check` | Electron `main.cjs`, `preload.cjs` and `forge.config.cjs`: privileged scheme, protocol handler, `nodeIntegration` off, `contextIsolation` on, offline CSP and fonts, Forge ZIP, icons. | yes |

## Build and CI

`npm run build` runs `payment-excerpts.mjs`, then esbuild for `src/main.js` and `src/rafshim.js` into `dist/`. `npm run check` runs every "yes" row above in order, then `build`, then `asset:check`.

`.github/workflows/pr-check.yml` runs on pull requests, pushes to `main`, and manual dispatch on `ubuntu-latest` with Node 22: `npm ci`, `npm run check`, then `git diff --exit-code -- dist/`. `dist/game.js` is committed so `index.html` opens without a build; if the fresh build differs, the committed bundle is stale and the job fails. `.github/workflows/balance-check.yml` runs daily at 21:17 UTC and on manual dispatch on `windows-latest`: `npm.cmd ci`, `npm.cmd run check`, `npm.cmd run storage:check`, then `node scripts/balance-check.mjs 60`.
