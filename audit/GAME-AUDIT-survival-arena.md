# Stage 4 Game Audit — Survival Arena (deep audit + fix on `0.2.0`)

**Game:** `games/survival-arena/` · **Repinned to** `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`
**Method:** observe, don't assert. Every verdict is backed by a re-runnable repro
against a **freshly rebuilt** artifact — never a stale blob (see [`PARITY.md`](./PARITY.md)).
Two harnesses, both booting through the real `createGame` path (forked from
Snake/Breakout/Helicopter, made Survival-Arena-aware):

- **Headless probe** — [`harness/survival-arena/probe.mts`](./harness/survival-arena/probe.mts)
  (`npx tsx`), deterministic seeded RNG, reads `world.state`/entities directly.
  Captures: [`before.json`](./harness/survival-arena/before.json) (the legacy single
  `main.json` + GameShell) and [`after.json`](./harness/survival-arena/after.json)
  (the 0.2.0 three-scene flow + scaling). Scene-set-adaptive.
- **Browser playthrough** — [`harness/survival-arena/play.mjs`](./harness/survival-arena/play.mjs)
  (puppeteer + Playwright Chrome, software GL): real arrow-key movement, screenshots
  title → play → swarm → over → reload in [`shots/`](./harness/survival-arena/shots/)
  (`before-*`, `after-*`, `after-live-*`), console/page-error + worst-frame capture.
  Plus a **live** check against the republished `:3001` blob
  ([`after-live-play.json`](./harness/survival-arena/after-live-play.json)).

**Scope:** Survival Arena only. No SDK/library/platform/other-game source changed.
The one engine-shaped finding (no data path to scale a live value by a difficulty
level) is **filed, not fixed** in [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#8**.

---

## TL;DR

- Survival Arena's **mechanics were already correct** on a fresh rebuild — movement,
  aimed auto-fire, ai-chase swarms, contact damage, health/death, win (survive the
  clock) / lose (one death), score, and the `explosion` FX all held in the
  re-baseline. The real defects were **architectural** (the same forbidden
  `GameShell` every seed game carries — G1) and **a thin, flat-difficulty swarm**:
  the run grew the wave *count* (`waveSizeGrowth`) but enemies never got **faster or
  tougher**, the swarm only ever reached ~6 concurrent (vs a 40 cap), and there was
  no `level` ramp.
- 0.2.0 closes the architectural gap, so the fix is *adoption*: the run is now
  **data** (title/play/over JSON scenes wired by `flow.on` + `tap-emit`; the 305-line
  GameShell is **deleted**), high score is **declarative** (`manifest.persist` +
  `persistence`), and the difficulty is a **data-driven ramp** — `level-progression`
  (scoreGte) advancing a `level` counter that drives (a) the swarm count via
  `wave-spawner` `waveSizeGrowth` and (b) enemy speed/hp via one tiny custom
  `swarm-scale` behavior (the Helicopter `scroll-ramp` shape applied to a swarm). The
  swarm is also **scattered** across the arena now (`wave-spawner`
  `placement:"free-cell"`, 0.2.0) instead of pinned to six corners.
- **FX showcase delivered:** kill burst + a bigger **death burst** + a **level-up
  sparkle** (all library FX, sizes in `$cfg`) + screen-shake on every kill, a bigger
  shake + red flash on death, and a blue flash on level-up. Verified firing in a real
  browser (peak **79** live particles).
- **Result, all re-verified by playing** — headless, in a real browser, and against
  the live republished `:3001` artifact: level ramps **1 → 8**, enemy speed **95 →
  188** and hp **80 → 203** at level 8; **0 console/page errors**; the swarm caps at
  **40** with no runaway growth and **no perf cliff** (avg step **0.02 ms**, worst
  **0.51 ms** at a full level-8 swarm of 40).

---

## Step 1 — Repin to `0.2.0` and the local loop (PASS)

| Change | Before | After |
|---|---|---|
| `game.json` `sdkVersion` | `0.1.0` | `0.2.0` |
| `game.json` `libraryVersion` | `0.1.1` | `0.2.0` |
| `game.json` `entryPoint` | `src/scenes/main.json` | `src/scenes/title.json` |
| `game.json` `persist` | — | `{ "keys": ["best"], "slot": "survival-arena" }` (G6) |
| `package.json` deps | `sdk 0.1.0`, `library 0.1.1` | both `0.2.0` |

Survival Arena shipped with an **empty** `node_modules/@gitcade/` dir (no symlinks,
like Breakout/Helicopter). Symlinking the workspace packages
(`node_modules/@gitcade/{sdk,library} → packages/*`) made the `0.2.0` catalog
resolve; the validator fails **loudly** otherwise (`library-version-mismatch:
installed catalog is 0.2.0 but game.json pins 0.1.1` — captured on the pre-repin
run). No npm `[PUBLISH]` gate needed — local workspace resolution works once repinned
and symlinked.

```
$ gitcade validate games/survival-arena  →  ✓ PASS — publishable, smoke boot ran 60 frames
$ npm run build  --workspace gitcade-survival-arena  →  dist/assets/index-Dk-QBqs-.js (clean)
```

---

## Step 2 — Deep audit: every defect, with a repro

Classification: `[GAME-DATA]` (fix in this game) · `[ENGINE-now-fixed-in-0.2.0]`
(a gap 0.2.0 closed; adopt it) · `[NEEDS-NEW-ENGINE-WORK]` (file it).

### D-1 — Flat, thin difficulty — the swarm grows in COUNT only, never in toughness `[GAME-DATA]` (+ #8)
- **Repro (before):** [`before.json → waveScaling`] over 4000 frames: the `wave`
  number climbs `1→8` (good), but `maxEnemySpeedSeen: 95` and `maxEnemyHpSeen: 100`
  are **flat across every wave** — enemies are exactly as fast and tanky at wave 8 as
  wave 1 — and there is **no `level`** (`levelsObserved: []`). Worse, `maxConcurrentEnemies:
  6` against a `maxAlive: 40` cap: with `spawnInterval 0.7` + `advanceOnClear:false`
  and bullets mowing them, the swarm never actually gets dense. The core promise —
  "survive *escalating* waves" — barely escalated.
- **Why it's a defect:** an arena survivor's whole arc is escalation; growing only the
  count (and barely that) reads as a flat difficulty with a wave label.
- **Fix:** a `level-progression` (`scoreGte`) counter (1→`maxLevel`), tuned spawn
  cadence (`spawnInterval 0.7→0.45`, `waveSize 4→5`, `waveSizeGrowth 2→3`, `waveDelay
  3→1.6`), and a custom **`swarm-scale`** behavior that reads the live `level` to bump
  each enemy's hp (`hpPerLevel`) at spawn and rescale its chase velocity
  (`speedPerLevel`) each tick. `after.json → waveScaling`: `levelsObserved [1..8]`,
  `maxEnemySpeedSeen 188`, `maxEnemyHpSeen 203.2`, `maxConcurrentEnemies 11` (and 40
  when bullets are removed — see the perf check). All balance in `$cfg`.

### D-2 — Screen flow is host TypeScript, not data `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** the title/pause/game-over screens lived in
  `src/host/shell.ts` — a **305-line** `ScreenState` machine
  (`showTitle`/`showPause`/`showGameOver`/`startRun`/`toGameOver` + HTML `#menu`
  overlays) running its own fixed-step loop; `main.ts` reset score and seeded
  HUD keys in `onEnterPlay` and mirrored HP in `beforeFrame`. Browser before-capture
  ([`before-play.json`](./harness/survival-arena/before-play.json)): every state is an
  **HTML overlay** (`via:"dom", menuVisible:true`, no `window.__game`); the title,
  play, and game-over are all the same `#menu` card.
- **Why it's a defect:** §B-1 of the engine audit — every seed game ships this
  forbidden `GameShell`; flow couldn't be data and score couldn't cross a transition.
- **Fix:** `title/play/over` JSON scenes + per-scene `flow.on` edges (`start-pressed`,
  `gameover`, `retry`) + full-canvas `tap-emit` buttons; **GameShell deleted** (Step 3).

### D-3 — High-score persistence is the bespoke `score`-system storage path `[ENGINE-now-fixed-in-0.2.0]` (G6)
- **Repro (before):** the `score` system carried `highKey:"highScore",
  storageKey:"arenaHigh", persist:true` and did its own async `world.storage.get/set`;
  "Best" was assembled in a host `outcomeText` callback. No declarative cross-run
  persistence; `before.json → persistence` is skipped (single-scene host-only path).
- **Fix:** declarative `manifest.persist: { keys:["best"], slot:"survival-arena" }` +
  the library `persistence` system in every scene; `score` now only computes `best`
  (running max, `persist:false`). `after.json → persistence: { savedSlot:{best:7777},
  bestAfterReload:7777, scratchNotRestored:null }` confirms a reload restores `best`
  (and a non-persisted scratch key does not) with **no host save code**.

### D-4 — Missing-favicon console 404 `[GAME-DATA]`
- **Repro (before):** the browser playthrough logged **2** `404 (Not Found)` console
  errors (`before-play.json → consoleErrors: 2`) — the `GET /favicon.ico` pattern
  every seed game hits.
- **Fix:** an inline `data:` SVG favicon in `index.html`. After-playthrough (both the
  served-dist and the **live** `:3001` runs): `consoleErrors: 0`, `pageErrors: 0`.

### D-5 — The swarm spawned from six fixed corners, not scattered `[GAME-DATA]` (uses G4)
- **Repro (before):** `wave-spawner` used the default `placement:"literal"` round-robin
  over six `spawnPoints` (four corners + top/bottom mid) — every enemy entered from one
  of six pixels, so the "swarm" arrived in tidy streams.
- **Fix:** `placement:"free-cell"` + `tileSize:$cfg.enemyTileSize` (40px → a 20×15
  grid) with `occupiedTag:"enemy"` (0.2.0's `randomFreeCell`, G4) — enemies now scatter
  across the whole arena on verified-free cells. The `spawnPoints` are kept as the
  documented `literal` fallback for forks.

### Re-verified (NOT defects — the mechanics hold on a fresh rebuild)
| Check | Repro | Observed |
|---|---|---|
| **Twin-stick movement** | `probe → movement` | idle = no drift (`idleDriftsWithNoInput:false`, rests at 385,285); ArrowRight → +x only; ArrowUp → −y only (`movedRight/movedUp:true`). |
| **Aimed auto-fire** | `probe → shooting` | bullets spawn, move, and head toward a live enemy (`anyBulletMoving`, `bulletAimedAtEnemy`). |
| **ai-chase swarm** | `probe → chase` | with the player pinned, mean enemy distance closes and reaches 0 (`closedIn:true, closestMeanReached:0`). |
| **Contact damage** | `probe → contactDamage` | an enemy on the player drops hp `100→73`, `damage` event fires. |
| **Kill → score + explosion** | `probe → killScoreFx` | zeroing enemy hp accrues `score` (+`killScore`), fires `enemy-died`, and spawns particles (`maxParticlesAlive:52`). |
| **Win / Lose → over** | `probe → winLose` | killing the player → `outcome:"lose"` + `gameover` → scene `over`; running the clock to 0 → `outcome:"win"` → scene `over`. |

### Filed, not fixed — residual engine/library gap `[NEEDS-NEW-ENGINE-WORK]`
- **No data path to scale a LIVE value by a difficulty level.** `wave-spawner` scales
  the swarm *count* as data (`waveSizeGrowth`) but bakes the `prototype`'s `$cfg` refs
  in **once at scene load**, so `ai-chase` speed and `health-and-death` hp cannot
  follow the live `level`. This is the **same gap** Helicopter hit for scroll speed
  (`scroll-ramp`). Survival Arena keeps a tiny `swarm-scale` custom behavior and
  extends [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#8** (now with two
  games demanding it). **Not fixed here** (library is out of scope this session).
- *(Checked, not a defect: the `contact-damage __dmgCd` micro-leak noted in the prompt
  does not bite here — each enemy's `__dmgCd` map only ever tracks the single `player`
  target, so it cannot grow.)*

---

## Step 3 — Fix, rebuild, republish, re-verify

### Progression / difficulty: the choice (single play scene + ramp, the Helicopter shape)

**One play scene whose difficulty a counter ramps** — the Helicopter shape, not
discrete level scenes (Breakout's shape). Survival Arena has no distinct per-level
*layouts*; the only thing that changes between level 1 and level 8 is balance
(spawn count, enemy speed, enemy hp). The literal, reviewable expression is one
scene + one counter:

```
title --start-pressed--> play --gameover--> over --retry--> play
                          |
                          ├─ level-progression (scoreGte, thresholds in $cfg)
                          │     ratchets world.state.level 1→maxLevel
                          ├─ wave-spawner waveSizeGrowth → swarm COUNT scales (data)
                          └─ swarm-scale (per enemy) reads level → speed + hp scale
                                (the #8 gap; all balance in $cfg)
```

- `level-progression` (`mode:"scoreGte"`, `threshold/thresholdGrowth/maxLevel` from
  `$cfg`) owns the `level` counter; the HUD binds to it (`LVL n`), and a `level-up`
  event drives a sparkle burst + a blue screen flash.
- `swarm-scale` on the enemy prototype reads `world.state.level` and (a) bumps the
  enemy's seeded hp once at spawn by `hpPerLevel`, (b) rescales the post-`ai-chase`
  velocity each tick by `speedPerLevel` — it **adds** the toughness/speed dimension
  the library can't (the swap that `wave-spawner` could only do for count).
- **Carry-vs-reset (the Breakout/Helicopter lesson):** `play.flow.persist` carries
  `score`/`best`/`outcome` into `over`. On **retry**, `over.flow.persist` carries only
  `best`/`bestDisplay` — so `score` resets to 0 and the per-scene `level`/`wave`
  counters restart at 1 (verified: `retry routes over → play and resets the run`).

### What 0.2.0 primitive replaced what custom/host code

| Custom/host code (before) | 0.2.0 primitive (after) | Deleted |
|---|---|---|
| `src/host/shell.ts` — `GameShell` screen-state machine + HTML `#menu` cards + its own loop | `title/play/over.json` scenes + per-scene `flow.on` edges + `tap-emit` buttons | **305 lines** (file removed) |
| single `main.json` "spawn-fixed waves forever, flat difficulty" | a play scene + library `level-progression` (scoreGte) + custom `swarm-scale` ramp (G1 + #8) | `main.json` (103 lines) |
| `score` storage I/O (`storageKey`/`highKey`/`persist`) + host `outcomeText("Best …")` | `manifest.persist` + library `persistence` system (G6) | host save/load glue |
| host `onEnterPlay` score/HUD reset + `game.loadScene` calls | scene `flow` + `flow.persist` state hand-off (G1) | host hooks |
| `wave-spawner` `placement:"literal"` (six fixed corners) | `placement:"free-cell"` (`randomFreeCell`, G4) — scattered spawns | — (swap, not a deletion) |
| enemy `ai-chase`/`health-and-death` static `$cfg` speed/hp (no escalation) | custom `swarm-scale` (live `level` multiplier) — logged as a gap (#8) | — (new behavior) |

**Net for `games/survival-arena`:** host/custom **TypeScript** dropped from **413 →
221 lines** (`shell.ts` 305→0; `main.ts` 72→132, absorbing the FX/screen-juice/audio/
pause/keyboard-bridge/HUD-mirror glue that *was* inside shell; `custom-behaviors`
12→65, +`swarm-scale`; `storage.ts` unchanged). The screen flow + the ramp are now
**305 lines of declarative scene JSON** (title 85 + play 143 + over 77) instead of a
305-line host state machine + a 103-line `main.json`. The validated game = data +
library systems (`wave-spawner`, `score`, `level-progression`, `timer-countdown`,
`win-lose-conditions`, `persistence`, `explosion`×2, `sparkle`, `hud-bar`,
`tap-emit`) + **one** custom behavior (`swarm-scale`), logged as a generalization
candidate. `swarm-scale` is new custom code only because no library part can scale a
spawned entity's stats by a live state key (#8).

### Gates (all green)

```
gitcade validate games/survival-arena  → ✓ PASS — publishable, smoke boot ran 60 frames
npm run build  --workspace gitcade-survival-arena  → dist/assets/index-Dk-QBqs-.js (clean)
npm test       --workspace gitcade-survival-arena  → 6 passed (title boot; title→play +
                                                     chasers/auto-fire/score; swarm cap holds;
                                                     difficulty ramp toughens the swarm;
                                                     death→over + score handoff; retry→play reset)
```

### Republished to MinIO `survival-arena/main/`

[`harness/survival-arena/republish.mts`](./harness/survival-arena/republish.mts)
(reusing the build worker's S3 client, honoring `S3_FORCE_PATH_STYLE`) cleared the
stale prefix and uploaded the fresh dist: `{ deletedStale: 30, uploaded: 30,
objectsNow: 30 }`. The artifact server was started **ephemerally** for the live check
and **stopped** afterwards (`:3001` left free; no server orphaned — the user's
long-lived servers are untouched). The **live** artifact confirms the fix is deployed:
- `:3001/artifacts/survival-arena/main/index.html` references the new bundle
  `index-Dk-QBqs-.js` (matches the local build);
- `grep "GameShell|showGameOver|showTitle"` in the served JS = **0**;
- `grep "start-pressed|swarm-scale|level-up"` in the served JS = present (flow + ramp
  are data);
- live puppeteer drive ([`after-live-play.json`](./harness/survival-arena/after-live-play.json)):
  `title → play → over`, `level 1→8`, enemy speed **188** / hp **203** at level 8,
  peak **79** particles, **0 console errors**.

### Re-verified by playing (after)

| What the DoD asks | Evidence |
|---|---|
| **difficulty scaling works as data** | `after.json → waveScaling`: `levelsObserved [1..8]`, `maxEnemySpeedSeen 95→188`, `maxEnemyHpSeen 80→203.2`; browser `rampSample {level:8, maxEnemySpeed:188, maxEnemyHp:203}` ([`after-03-swarm.png`](./harness/survival-arena/shots/after-03-swarm.png), HUD reads `LVL 8`). |
| **FX showcase fires + feels good** | `after.json → killScoreFx.maxParticlesAlive:52`; browser/live `maxParticlesSeen 77/79`; kill burst, death burst, level-up sparkle (all `enemy-died`/`player-died`/`level-up` driven), + screen shake/flash bound in `main.ts`. |
| **GameShell removed** | `src/host/shell.ts` deleted; served JS `grep GameShell/showTitle/showGameOver = 0`; browser title/play/over are **canvas** scenes via `window.__game` (no `#menu` overlay). |
| title→play→over flows as data | `after.json → scenes [title,play,over]`; `winLose.sceneAfterLose/Win:"over"`; browser scene ids `title→play→over`. |
| health / death / restart work | `contactDamage` drops hp + fires `damage`; `winLose` death→`over` (`outcome:"lose"`); the `retry→play reset` test returns to a fresh run (score 0). |
| **high score persists** | `after.json → persistence.bestAfterReload:7777` (saved → fresh boot with shared storage → restored; scratch not restored). *(Browser reload uses `MemoryStorage` standalone, which by design does not survive a reload — the cross-run path is the storage bridge, exercised by the headless shared-storage probe, exactly as Snake/Breakout/Helicopter verified G6.)* |
| **no perf cliff / no runaway growth** | swarm caps at `maxAlive 40` (`capHeld:true`; the cap-holds test peaks ≤40); a 2400-frame stress at a full level-8 swarm of 40: **avg step 0.02 ms, worst 0.51 ms** (≪ 16.7 ms budget). |
| no console errors | browser + live after-runs: `consoleErrors:0, pageErrors:0` (favicon 404 fixed). |
| touch works | `move-topdown-360 pointerFollow:true` steers toward a held pointer (the README's "drag toward where you want to go"); the canvas flow buttons are `tap-emit` (pointer/touch native) — no host touch glue needed. |

**Before vs after, same lens:** mechanics identical (movement, aimed fire, chase,
contact damage, win/lose) — the change is architectural + the new escalation
dimension. [`before-00-title.png`](./harness/survival-arena/shots/before-00-title.png)
= HTML `#menu` overlay; [`after-00-title.png`](./harness/survival-arena/shots/after-00-title.png)
= data-driven canvas title; [`after-03-swarm.png`](./harness/survival-arena/shots/after-03-swarm.png)
= the LVL-8 scaled swarm the old build (flat speed/hp) could not produce.

---

## What the next game (Idle Clicker, #5) inherits

- **The local loop on 0.2.0 without an npm publish** (proven a fourth time): repin
  `game.json` + `package.json`, symlink `node_modules/@gitcade/{sdk,library}` → the
  workspace packages (Survival Arena had **none** — create them, or the validator
  fails loudly with a catalog/version mismatch), `gitcade validate` resolves the catalog.
- **Three progression shapes are now proven as data:** Breakout = discrete
  `level-N.json` scenes; Helicopter = single scene + `level-progression` + a
  live-reading ramp; Survival Arena = the **same single-scene ramp applied to a
  swarm** (`waveSizeGrowth` for count + `swarm-scale` for stats). Idle Clicker's
  progression is *cumulative numbers*, not scenes — but the `level-progression` /
  `currency` / `upgrade-tree` data parts and the carry-vs-reset `flow.persist`
  discipline are the same toolkit.
- **The library can't scale a live value by a level (#8) — now two games deep:** any
  game that needs speed/stats (not just count) to climb hits it; reuse the
  `scroll-ramp`/`swarm-scale` one-behavior pattern. Idle Clicker's own gaps are the
  **economy** trio (`click-to-earn`/`auto-income`/`interval-bonus`, #6) — expect
  custom behaviors there, not a pure-library composition.
- **G6 persistence is two lines of data:** `manifest.persist.keys` + a `persistence`
  system per scene; no host save code. Idle Clicker (which leans hard on saved
  progress + offline gain) inherits this directly — though offline progress itself
  still needs `Date.now()` host glue (noted in #6).
- **FX are now fully data + a thin screen-juice host hook:** `explosion`/`sparkle`
  systems keyed to game events (sizes in `$cfg`) + a `ScreenEffects` bind in `main.ts`
  for shake/flash. Reuse the pattern for any juice.
- **Reusable harnesses:** [`harness/survival-arena/probe.mts`](./harness/survival-arena/probe.mts)
  (headless, scene-set-adaptive), [`harness/survival-arena/play.mjs`](./harness/survival-arena/play.mjs)
  (browser; serves a dist OR drives a live `:3001` URL — pass the base as argv[4]; now
  also measures worst-frame for a perf-cliff watch), and
  [`harness/survival-arena/republish.mts`](./harness/survival-arena/republish.mts)
  (the upload path) fork cleanly per game.
