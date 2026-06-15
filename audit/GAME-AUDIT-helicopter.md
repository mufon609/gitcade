# Stage 4 Game Audit — Helicopter (deep audit + fix on `0.2.0`)

**Game:** `games/helicopter/` · **Repinned to** `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`
**Method:** observe, don't assert. Every verdict is backed by a re-runnable repro
against a **freshly rebuilt** artifact — never a stale blob (see [`PARITY.md`](./PARITY.md)).
Two harnesses, both booting through the real `createGame` path (forked from
Snake/Breakout, made Helicopter-aware):

- **Headless probe** — [`harness/helicopter/probe.mts`](./harness/helicopter/probe.mts)
  (`npx tsx`), deterministic seeded RNG, reads `world.state`/entities directly.
  Captures: [`harness/helicopter/before.json`](./harness/helicopter/before.json)
  (current source, single `main.json`) and
  [`harness/helicopter/after.json`](./harness/helicopter/after.json) (0.2.0
  three-scene flow + ramp). Adapts to whichever scene set is on disk.
- **Browser playthrough** — [`harness/helicopter/play.mjs`](./harness/helicopter/play.mjs)
  (puppeteer + the Playwright Chrome, software GL): real Space-thrust + pointer input,
  screenshots title → play → ramp → crash/over → reload in
  [`harness/helicopter/shots/`](./harness/helicopter/shots/) (`before-*`, `after-*`,
  `after-live-*`), console/page-error capture. Plus a live check against the
  republished `:3001` blob ([`after-live-play.json`](./harness/helicopter/after-live-play.json)).

**Scope:** Helicopter only. No SDK/library/platform/other-game source changed. The
two engine-shaped findings (the `flagKey` simplification of the custom lift, and the
state-driven scroll ramp the library can't express) are **filed, not fixed** in
[`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) #3 and **#8**.

---

## TL;DR

- **The headline "obstacles only at the top" report is REFUTED on a fresh rebuild.**
  The `wave-spawner` `spawnCursor` round-robin (library B-1) has been live since the
  re-baseline; on the fresh 0.2.0 build obstacles spawn across **all five** configured
  heights (`y = 60, 90, 220, 360, 420`), both headless and in the real browser — the
  exact stale-blob ghost [`PARITY.md`](./PARITY.md) predicted. One-button thrust feel,
  auto-scroll, `trigger-zone` crashes, and the survival score were all already correct
  in source too.
- The real defects were **architectural** (the same `GameShell` debt every seed game
  carries — G1) and **a missing sense of progression**: an endless auto-scroller at a
  *fixed* speed forever, with no ramp. 0.2.0 closes the architectural gap, so the fix
  is *adoption*: the run is now **data** and the hand-rolled layers are deleted; the
  progression is a **data-driven difficulty ramp**.
- **Result:** title→play→over → JSON scenes wired by `flow.on` + `tap-emit`; high
  score → declarative `manifest.persist`; difficulty → library `level-progression`
  (scoreGte) advancing a `level` counter that a tiny `scroll-ramp` behavior reads live
  to speed the world up (1→8, scroll 230→455 px/s). The **305-line GameShell is
  deleted**, `main.json` is gone, and the custom `thrust-lift` was **simplified** (dead
  `flagKey` path dropped). All re-verified by playing — headless, in a real browser,
  and against the live republished `:3001` artifact.

---

## Step 1 — Repin to `0.2.0` and the local loop (PASS)

| Change | Before | After |
|---|---|---|
| `game.json` `sdkVersion` | `0.1.0` | `0.2.0` |
| `game.json` `libraryVersion` | `0.1.1` | `0.2.0` |
| `game.json` `entryPoint` | `src/scenes/main.json` | `src/scenes/title.json` |
| `game.json` `persist` | — | `{ "keys": ["best"], "slot": "helicopter" }` (G6) |
| `package.json` deps | `sdk 0.1.0`, `library 0.1.1` | both `0.2.0` |

Helicopter shipped with an **empty** `node_modules/@gitcade/` dir (no symlinks, like
Breakout). Symlinking the workspace packages
(`node_modules/@gitcade/{sdk,library} → packages/*`, the pattern tower-defense /
Snake / Breakout use) made the `0.2.0` catalog (85 parts) resolve. No npm `[PUBLISH]`
gate was needed — local workspace resolution works once the game is repinned and
symlinked.

```
$ gitcade validate games/helicopter   →  ✓ PASS — publishable, smoke boot ran 60 frames
$ npm run build  --workspace gitcade-helicopter  →  dist/assets/index-DHd5RxHy.js (clean)
```

---

## Step 2 — Deep audit: every defect, with a repro

Classification: `[GAME-DATA]` (fix in this game) · `[ENGINE-now-fixed-in-0.2.0]`
(a gap 0.2.0 closed; adopt it) · `[NEEDS-NEW-ENGINE-WORK]` (file it).

### D-1 — No sense of progression — fixed difficulty forever `[GAME-DATA]` (uses G1 + a custom ramp)
- **Repro (before):** `before.json` boots `main.json` (the only scene). The
  `wave-spawner` (interval/speed) and the obstacle `auto-scroll` velocity are all
  resolved **once** from `$cfg` at scene load; nothing reads a level counter. A run
  is the same speed at second 5 and second 60 — `before.json → ramp: { multiScene:
  false, levelsObserved: [], levelRamped: false }`. There is no `level-progression`,
  no level key, no escalation. An endless flyer with no ramp has no arc.
- **Why it's a defect:** an auto-scroller's *only* progression is a difficulty ramp
  (Helicopter has no discrete levels to scene-flow between, unlike Breakout). Pre-0.2.0
  there was no clean data path for it.
- **Fix:** a **single play scene** (NOT discrete level scenes — see Step 3) with the
  library `level-progression` in `scoreGte` mode advancing a `level` counter from
  `$cfg` thresholds, and a tiny custom `scroll-ramp` behavior reading that counter live
  to scale the obstacle scroll speed. `after.json → ramp: { levelRamped: true,
  levelsObserved: [2..8], obstacleSpeedLevel1: 230, obstacleSpeedHigh: 455,
  speedRamped: true }`.

### D-2 — Screen flow is host TypeScript, not data `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** the title/pause/game-over screens live in
  `src/host/shell.ts` — a **305-line** `ScreenState` machine
  (`showTitle`/`showPause`/`showGameOver`/`startRun`/`toGameOver` + HTML `#menu`
  overlays) running its own fixed-step loop; `main.ts:45-49` resets `scoreDisplay` in
  an `onEnterPlay` hook and mirrors the float score in `beforeFrame`. Browser
  before-capture ([`shots/before-00-title.png`](./harness/helicopter/shots/before-00-title.png)):
  the title is an **HTML overlay** (`via:"dom", menuVisible:true`), and the game-over
  card ([`before-04-gameover.png`](./harness/helicopter/shots/before-04-gameover.png))
  is an HTML card reading "Score 18 • Best 18" — neither is the canvas.
- **Why it's a defect:** §B-1 of the engine audit — every seed game ships this
  forbidden `GameShell`; flow couldn't be data and score couldn't cross a transition.
- **Fix:** `title/play/over` JSON scenes + per-scene `flow.on` edges + full-canvas
  `tap-emit` buttons; GameShell deleted (Step 3).

### D-3 — High-score persistence is the bespoke `score`-system storage path `[ENGINE-now-fixed-in-0.2.0]` (G6)
- **Repro (before):** the `score` system carried `highKey:"highScore",
  storageKey:"helicopterHigh", persist:true` and did its own async
  `world.storage.get/set`; the "Best" was assembled in a host `outcomeText` callback
  (`main.ts:38`). No declarative cross-run persistence.
- **Fix:** declarative `manifest.persist: { keys:["best"], slot:"helicopter" }` + the
  library `persistence` system in every scene; `score` now only computes `best`
  (running max, `persist:false`). `after.json → persistence: { savedSlot:{best:4242…},
  bestAfterReload:4242…, scratchNotRestored:null }` confirms a reload restores `best`
  (and a non-persisted key does not) with **no host save code**.

### D-4 — Missing-favicon console 404 `[GAME-DATA]`
- **Repro (before):** the browser playthrough logged **2** `404 (Not Found)` console
  errors (`before-play.json → consoleErrors: 2`); both are `GET /favicon.ico` (the
  same pattern Snake/Breakout hit).
- **Fix:** an inline `data:` SVG favicon in `index.html`. After-playthrough:
  `consoleErrors: 0`.

### D-5 — The `thrust-lift` custom behavior carried a dead code path `[GAME-DATA]`
- **Repro (before):** `custom-behaviors/index.ts` `thrust-lift` lifted on a key OR on
  a `flagKey` `world.state` boolean — a touch fallback. But the touch button (host
  glue) synthesizes the same `Space` keydown/keyup the key path reads, so the
  `flagKey` branch was never exercised on any device.
- **Fix:** dropped the `flagKey` param and branch (one fewer code path, identical
  feel). Logged the simplification in [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md)
  #3. The behavior is otherwise unchanged and still the right custom part (no library
  part covers one-axis hold-thrust).

### Re-verified (NOT defects — the mechanics hold on a fresh rebuild)
| Check | Repro | Observed (before & after) |
|---|---|---|
| **OBSTACLE-HEIGHT VARIATION** (the headline stale-blob ghost) | `probe → obstacleHeights` | spawns across **all five** configured heights `y ∈ {60, 90, 220, 360, 420}` cycling round-robin (B-1 `spawnCursor`), `distinctCount:5`. Browser confirms the same set on the real render path ([`after-02-playing.png`](./harness/helicopter/shots/after-02-playing.png)). **REFUTED — not pinned to the top.** |
| **One-button thrust feel** | `probe → thrust` | holding rises (y↓), `vy` clamps to `-maxUp (-360)`; releasing falls, clamps to `+maxDown (430)`. Holds before/after (`thrust-lift` math unchanged). |
| **Auto-scroll** | `probe → scrollAndCrash` | a pillar drifts left `dx ≈ -115` over 30 frames (`driftsLeft:true`). |
| **Crash / collision / death** | `probe → scrollAndCrash` | driving into the bottom wall fires `crash`; the play scene's `flow.on` routes it to `over`. |
| **Survival score** | `probe → ramp / after.json` | `currency` accrues `pointsPerSec` into a float `score`; floored into an integer `scoreDisplay` for the HUD. |

### Filed, not fixed — residual engine/library gaps `[NEEDS-NEW-ENGINE-WORK]`
- **`scroll-ramp` — state-driven (ramping) auto-scroll.** The library `auto-scroll`
  forces a static `$cfg` `vx` every tick and cannot read a counter; `wave-spawner` /
  `level-progression` resolve their `$cfg` params *once* at scene load. So 0.2.0 has
  **no data path** to make a single play scene scroll FASTER as difficulty climbs.
  Helicopter keeps a tiny `scroll-ramp` custom behavior (`vx * (1 + (level-1)*perLevel)`,
  reading the library-maintained `level`) and logs the gap in
  [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#8** (proposal: an optional
  `levelKey`/`perLevel`/`scaleByStateKey` on the existing `auto-scroll`). **Not fixed
  here** (library is out of scope this session).
- **`thrust-lift` generalization** still stands as #3 (now with the `flagKey`
  simplification noted).

---

## Step 3 — Fix, rebuild, republish, re-verify

### Progression / difficulty: the choice (single play scene + ramp, NOT level scenes)

**One play scene whose difficulty a counter ramps**, *not* discrete level scenes
(the deliberate contrast with Breakout). Rationale: Helicopter has no distinct
per-level *layouts* to flow between — the obstacles are a procedural endless stream,
so the only thing that changes between "level 1" and "level 8" is a balance multiplier.
Modelling that as separate scenes would be six near-identical files differing only by
a number; the literal, reviewable expression is **one scene + one counter**:

```
title --start-pressed--> play --crash--> over --retry--> play
                          |
                          └─ level-progression (scoreGte, thresholds in $cfg)
                             ratchets world.state.level 1→…→maxLevel; scroll-ramp
                             reads it live → obstacles speed up. ALL balance in config.
```

- `level-progression` (`mode:"scoreGte"`, `threshold:$cfg.levelThreshold`,
  `thresholdGrowth:$cfg.levelThresholdGrowth`, `maxLevel:$cfg.maxLevel`) owns the
  `level` counter; the HUD binds to it (`LVL n`).
- `scroll-ramp` on the obstacle prototype reads `world.state.level` and sets
  `vx = $cfg.scrollVx * (1 + (level-1) * $cfg.speedRampPerLevel)` — it **replaces**
  the library `auto-scroll` (which could only force a static vx).
- **Carry-vs-reset (the Breakout lesson):** `play.flow.persist` carries
  `score`/`best`/`scoreDisplay`/`bestDisplay`/`level`. On **retry** the over scene
  carries only `best`/`bestDisplay` — so `score` resets (currency `startAmount:0`) and
  `level` resets (the per-scene `level-progression` counter restarts at 1). We do
  **not** persist a library counter across a fresh run; `level` is the live counter
  during play and a reset-on-retry value, exactly the carry-vs-reset discipline
  Breakout established.

### What 0.2.0 primitive replaced what custom code

| Custom/host code (before) | 0.2.0 primitive (after) | Deleted |
|---|---|---|
| `src/host/shell.ts` — `GameShell` screen-state machine + HTML `#menu` cards + its own loop | `title/play/over.json` scenes + per-scene `flow.on` edges + `tap-emit` buttons | **305 lines** (file removed) |
| single `main.json` "fly forever at one speed" | a play scene + library `level-progression` (scoreGte) + `scroll-ramp` ramp (G1 + #8) | `main.json` (73 lines) |
| `score` storage I/O (`storageKey`/`highKey`/`persist`) + host `outcomeText("Best …")` | `manifest.persist` + library `persistence` system (G6) | host save/load glue |
| host `onEnterPlay` `scoreDisplay` reset + `game.loadScene` calls | `flow.persist` state hand-off (G1) | host hooks |
| obstacle `auto-scroll` (static `$cfg` vx) | custom `scroll-ramp` (live `level` multiplier) — logged as a gap (#8) | — (swap, not a deletion) |
| `thrust-lift` `flagKey` touch-fallback branch | the touch button already synthesizes `Space` (host glue) | dead param + branch |

**Net for `games/helicopter`:** host/custom **TypeScript** dropped from **423 → 248
lines** (`shell.ts` 305→0; `main.ts` 56→152, absorbing the audio/juice/touch/pause/
keyboard-bridge/HUD-mirror glue that *was* inside shell — same pattern as
Snake/Breakout; `custom-behaviors` 38→72, +`scroll-ramp`; `storage.ts` unchanged).
The screen flow + the ramp are now **255 lines of declarative scene JSON** (title 85 +
play 101 + over 69) instead of a 305-line host state machine + a single `main.json`.
The validated game = data + library systems (`wave-spawner`, `currency`, `score`,
`level-progression`, `persistence`, `explosion`, `trigger-zone`) + **two** custom
behaviors (`thrust-lift`, `scroll-ramp`), both logged as generalization candidates.

`thrust-lift` was **kept and slimmed** (0.2.0 added no one-axis-thrust primitive);
`scroll-ramp` is **new custom code** only because no library part can scale a scroll
by a live state key (#8).

### Gates (all green)

```
gitcade validate games/helicopter  → ✓ PASS — publishable, smoke boot ran 60 frames
npm run build  --workspace gitcade-helicopter  → dist/assets/index-DHd5RxHy.js (clean)
npm test       --workspace gitcade-helicopter  → 5 passed (title boot; title→play +
                                                 pillars/score; difficulty ramp;
                                                 crash→over + score handoff; retry→play reset)
```

### Republished to MinIO `helicopter/main/`

[`harness/helicopter/republish.mts`](./harness/helicopter/republish.mts) (reusing the
build worker's S3 client, honoring `S3_FORCE_PATH_STYLE`) cleared the stale prefix and
uploaded the fresh dist: `{ deletedStale: 30, uploaded: 30, objectsNow: 30 }`. The
artifact server was started **ephemerally** for the live check and **stopped**
afterwards (the port is left free; no server orphaned). The **live** artifact confirms
the fix is deployed:
- `:3001/artifacts/helicopter/main/index.html` references the new bundle
  `index-DHd5RxHy.js` (matches the local build);
- `grep "GameShell|showGameOver|showTitle"` in the served JS = **0**;
- `grep "start-pressed|scroll-ramp|level-up"` in the served JS = present (flow + ramp
  are data);
- live puppeteer drive ([`after-live-play.json`](./harness/helicopter/after-live-play.json)):
  `title → play → over`, obstacle Ys `{60, 90, 220, 420}`, ramp `level 1→8 / speed
  230→455`, **0 console errors**.

### Re-verified by playing (after)

| What the DoD asks | Evidence |
|---|---|
| **obstacles vary in height** | `after.json → obstacleHeights.distinctSpawnYs: [60,90,220,360,420]` (5 distinct); browser `after-play.json → distinctObstacleYsSeen` cycles the same set ([`after-02-playing.png`](./harness/helicopter/shots/after-02-playing.png)). The "only at the top" ghost stays refuted. |
| one-button control feels right | `after.json → thrust`: rises while held, `vy` clamps `-360`/`+430`; real Space input drives the craft in the browser run. |
| **difficulty ramps** | `after.json → ramp: levelsObserved [2..8], obstacleSpeedLevel1 230 → obstacleSpeedHigh 455`; browser `rampBefore {level:1,speed:230} → rampAfter {level:8,speed:455}` ([`after-03-ramped.png`](./harness/helicopter/shots/after-03-ramped.png), HUD reads `LVL 8`). |
| title→play→over flows as data | `after.json → scenes [title,play,over]`, `scrollAndCrash.sceneAfterCrash:"over"`; browser title→play→over via `window.__game.scene.id`; [`after-00-title.png`](./harness/helicopter/shots/after-00-title.png) + [`after-04-gameover.png`](./harness/helicopter/shots/after-04-gameover.png) are **canvas** scenes (no HTML overlay). |
| `score` shows on the game-over card | `after-04-gameover.png` shows **SCORE 100014 / BEST 100014** (floored integer display keys, carried by `flow.persist`). |
| high score persists across reload | `after.json → persistence.bestAfterReload: 4242…` (saved → fresh boot with shared storage → restored; scratch `score` not restored). *(Browser reload uses `MemoryStorage` standalone, which by design does not survive a reload — the cross-run path is the storage bridge, which the headless shared-storage probe exercises, identical to how Snake/Breakout verified G6.)* |
| no console errors | browser after-run: `consoleErrors:0, pageErrors:0` (favicon 404 fixed). |
| mobile touch works | the on-screen "HOLD TO FLY" button synthesizes the `Space` key `thrust-lift` reads (host glue retained); the canvas flow buttons are `tap-emit` (pointer/touch native). |

**Before vs after, same lens:** mechanics identical (thrust feel, varied spawns,
auto-scroll, crash) — the change is architectural + the new difficulty-ramp dimension.
[`before-00-title.png`](./harness/helicopter/shots/before-00-title.png) = HTML `#menu`
overlay; [`after-00-title.png`](./harness/helicopter/shots/after-00-title.png) =
data-driven canvas title; [`after-03-ramped.png`](./harness/helicopter/shots/after-03-ramped.png)
= the LVL-8 ramped play the old build (one fixed speed) could not produce.

---

## What the next game (Survival Arena, #4) inherits

- **The local loop on 0.2.0 without an npm publish** (proven a third time): repin
  `game.json` + `package.json`, symlink `node_modules/@gitcade/{sdk,library}` → the
  workspace packages (Helicopter had **none** — create them, or the validator fails
  loudly with a catalog/version mismatch), `gitcade validate` resolves the catalog.
- **Two progression shapes are now both proven as data:** Breakout = discrete
  `level-N.json` scenes flowed by `level-cleared` edges (distinct layouts); Helicopter
  = a **single scene + `level-progression` (scoreGte) counter + a live-reading ramp**
  (no distinct layouts). Survival Arena's scaling swarm is the Helicopter shape — one
  arena scene, `wave-spawner` (`waveSizeGrowth`) and/or `level-progression` escalating
  difficulty in place — not separate scenes.
- **Carry-vs-reset is a deliberate `flow.persist` choice:** carry `best`/display keys;
  do **not** carry a per-scene library counter (it resets per scene) — `level` resets
  on retry by design. Drive cumulative HUD numbers from the live counter during play,
  the reset value on restart.
- **A continuous (float) score needs an integer display key:** the renderer's text
  `bind` has no formatter and no library part floors a value, so Helicopter keeps a
  one-line presentation-only host mirror (`scoreDisplay = floor(score)`); reuse it for
  any time/float-accrual score.
- **G6 persistence is two lines of data:** `manifest.persist.keys` + a `persistence`
  system per scene; no host save code.
- **The library can't scale a scroll/spawn by a live state key (#8):** if Survival
  Arena needs world *speed* (not just *count*) to climb with difficulty, it will hit
  the same gap — reuse Helicopter's `scroll-ramp` pattern or `wave-spawner`'s built-in
  `waveSizeGrowth` (which IS data-driven for count).
- **Reusable harnesses:** [`harness/helicopter/probe.mts`](./harness/helicopter/probe.mts)
  (headless, scene-set-adaptive), [`harness/helicopter/play.mjs`](./harness/helicopter/play.mjs)
  (browser; serves a dist OR drives a live `:3001` URL — pass the base as argv[4]),
  and [`harness/helicopter/republish.mts`](./harness/helicopter/republish.mts) (the
  upload path) fork cleanly per game.
