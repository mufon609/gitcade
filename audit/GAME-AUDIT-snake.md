# Stage 4 Game Audit — Snake (deep audit + fix on `0.2.0`)

**Game:** `games/snake/` · **Repinned to** `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`
**Method:** observe, don't assert. Every verdict below is backed by a re-runnable
repro against a **freshly rebuilt** artifact — never a stale blob (see
[`PARITY.md`](./PARITY.md)). Two harnesses, both booting through the real
`createGame` path:
- **Headless probe** — [`harness/snake/probe.mts`](./harness/snake/probe.mts)
  (`npx tsx`), deterministic seeded RNG, reads `world.state`/entities directly.
  Captures: [`harness/snake/before.json`](./harness/snake/before.json) (current
  source, single `main.json`) and [`after.json`](./harness/snake/after.json) (0.2.0
  three-scene flow).
- **Browser playthrough** — [`harness/snake/play.mjs`](./harness/snake/play.mjs)
  (puppeteer + the Playwright Chrome, software GL), real keyboard/pointer, console
  capture, screenshots in [`harness/snake/shots/`](./harness/snake/shots/)
  (`before-*`, `after-*`). Plus a live check against the republished `:3001` blob.

**Scope:** Snake only. No SDK/library/platform/other-game source changed. The one
engine-shaped finding (a residual `place-on-free-cell` edge) is **filed, not fixed**
in [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) #2.

---

## TL;DR

- **Snake's *mechanics* were already correct in source** — the S2/S3/S4 fixes hold.
  The headline B-4 symptom ("first food spawns against a wall / on the snake") is
  **REFUTED on a fresh rebuild** (0 on-snake, 0 out-of-bounds across 60 respawns),
  the same stale-artifact pattern PARITY.md flagged for the helicopter round-robin.
- The real defects were **architectural** — the gaps the engine audit catalogued
  (G1/G4/G6), papered over by **600+ lines of host/custom code**. 0.2.0 closes
  them, so the fix is *adoption*: the run is now **data**, and the hand-rolled
  layers are deleted.
- **Result:** food placement → library `place-on-free-cell`; title→play→over →
  JSON scenes wired by `flow.on`; `best` → declarative `manifest.persist`. The
  **305-line GameShell screen-state machine + HTML menu overlays are gone**, and
  Snake's ~60-line `spawnFood` is gone — all re-verified by playing.

---

## Step 1 — Repin to `0.2.0` and the local loop (PASS)

| Change | Before | After |
|---|---|---|
| `game.json` `sdkVersion` | `0.1.0` | `0.2.0` |
| `game.json` `libraryVersion` | `0.1.1` | `0.2.0` |
| `game.json` `entryPoint` | `src/scenes/main.json` | `src/scenes/title.json` |
| `game.json` `persist` | — | `{ "keys": ["best"], "slot": "snake" }` (G6) |
| `package.json` deps | `sdk 0.1.0`, `library 0.1.1` | both `0.2.0` |

The validator resolves the catalog **only** from the game's own
`node_modules/@gitcade/library/CATALOG.json`. Before repin it failed loudly —
`catalog-unavailable: @gitcade/library@0.1.1 catalog was not found` — exactly the
condition the build notes predicted. Symlinking the workspace packages into the
game (the same pattern `tower-defense` already has) made the `0.2.0` catalog (85
parts) resolve:

```
$ gitcade validate games/snake
✓ PASS — publishable, smoke boot ran 60 frames
$ npm run build --workspace gitcade-snake   →  dist/assets/index-*.js built clean
```

No npm `[PUBLISH]` gate was needed — local workspace resolution works once the
game is repinned and the package is symlinked.

---

## Step 2 — Deep audit: every defect, with a repro

Classification: `[GAME-DATA]` (fix in this game) · `[ENGINE-now-fixed-in-0.2.0]`
(a gap 0.2.0 closed; adopt it) · `[NEEDS-NEW-ENGINE-WORK]` (file it).

### D-1 — Screen flow is host TypeScript, not data `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** the title/pause/game-over screens live in
  `src/host/shell.ts` — a 305-line `ScreenState` machine
  (`showTitle`/`showPause`/`showGameOver`/`startRun`/`toGameOver` + HTML `#menu`
  overlays) running its own loop; `main.ts:47-49` resets `score` in an `onEnterPlay`
  host hook. The validated scene (`main.json`) is a single play screen with no flow.
  Browser before-capture: [`shots/before-03-gameover.png`](./harness/snake/shots/before-03-gameover.png)
  — the game-over card is an **HTML overlay**, not the canvas.
- **Why it's a defect:** §B-1 of the engine audit — `loadScene` was host-only and
  wiped all `world.state`, so flow *couldn't* be data and score *couldn't* cross a
  transition. Every seed game shipped this forbidden `GameShell`.
- **Fix:** three JSON scenes + per-scene `flow.on` edges; GameShell deleted (see
  Step 3).

### D-2 — Score is lost across the title→play→over transition `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** in 0.1.x `loadScene` deletes every `world.state` key, so the
  game-over card could only show a score the *host* stashed before switching
  screens (it never switched SDK scenes at all — it re-ran the one scene). A
  data-driven over-scene reading `world.state.score` would see nothing.
- **Fix:** `play.flow.persist: ["score","best"]` carries the run's score to the
  game-over scene; `after.json → flow.scoreOnOver: 50` confirms the handoff.

### D-3 — Food placement is ~60 lines of hand-rolled free-cell logic `[ENGINE-now-fixed-in-0.2.0]` (G4)
- **Repro (before):** `custom-behaviors/index.ts:213-273` — a `spawnFood` helper
  building an occupancy set, 64 random retries, and a deterministic scan fallback,
  with the comment *"the one mechanic Snake needs that no @gitcade/library part
  provides."*
- **Observed symptom check (before, fresh rebuild):**
  `before.json → foodPlacement: { onSnakeCount: 0, outOfBoundsCount: 0, distinctPositions: 59 }`.
  **The B-4 "first food on the wall / on the snake" symptom does NOT reproduce in
  current source** — the hand-rolled code is correct; it's the *code-smell/gap*
  (a whole game re-implementing placement) that's the real finding. (The 11/60
  "flush against a boundary" placements are benign — those are valid play cells.)
- **Fix:** the library `place-on-free-cell` system (G4). `spawnFood` deleted.

### D-4 — High-score persistence is bespoke storage code `[ENGINE-now-fixed-in-0.2.0]` (G6)
- **Repro (before):** the `score` system carried `storageKey:"snakeHigh", persist:true`
  and did its own async `world.storage.get/set` for the high score; the "Best"
  display was assembled in a host `outcomeText` callback (`main.ts:39`).
- **Fix:** declarative `manifest.persist: { keys:["best"], slot:"snake" }` + the
  library `persistence` system; `score` now only computes `best` (running max,
  `persist:false`). `after.json → persistence: { savedSlot:{best:4242}, bestAfterReload:4242 }`
  confirms a reload restores it with no host JS.

### D-5 — Missing-favicon console 404 `[GAME-DATA]`
- **Repro (before):** the browser playthrough logged two `404 (Not Found)` console
  errors; isolating responses showed both were `GET /favicon.ico`.
- **Fix:** an inline `data:` SVG favicon in `index.html`. After-playthrough:
  `consoleErrors: 0`.

### Re-verified (NOT defects — the earlier fixes hold on a fresh rebuild)
| Check | Repro | Observed (before & after) |
|---|---|---|
| **Death timing + on-screen clamp** (S3, `snake-guard`) | `probe → wallDeath` | head dies at the wall cell (`x:780`, right edge = bounds 800), **never renders off-field**, clamped to last on-screen cell. Holds identically before/after. |
| **Self-collision** | `probe → selfCollision` | a tight box folds the body onto itself → death. Works before/after. |
| **Two-tap 180° guard** (S2/B-2) | library `move-grid-step` (`__gridStep` committed-heading guard) | unchanged library code; the snake cannot fold into its neck. |
| **Growth on eat** | `probe → growth` | `+1` segment per `foodValue` (10). Works before/after. |

### Filed, not fixed — residual engine/library gap `[NEEDS-NEW-ENGINE-WORK]`
- **`place-on-free-cell` can't exclude a predicted/imminent cell.** Snake's old
  `spawnFood` also excluded the single cell the head will step into next tick (the
  S2 guard). The library helper excludes only *live* `occupiedTag` entities at
  placement time. At a 40×30 grid (~1198 free cells) the odds of a coin landing on
  that one cell are ~0.08% and the only effect is a harmless instant re-eat, so
  Snake accepts it. Logged in [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md)
  #2 with a proposed `excludeCells`/`excludeTags[]` param. **Not fixed here** (SDK/
  library are out of scope this session).

---

## Step 3 — Fix, rebuild, republish, re-verify

### What 0.2.0 primitive replaced what custom code

| Custom/host code (before) | 0.2.0 primitive (after) | Deleted |
|---|---|---|
| `src/host/shell.ts` — `GameShell` screen-state machine + HTML `#menu` cards | `title/play/over.json` scenes + per-scene `flow.on` edges + `tap-emit` buttons | **305 lines** (file removed) |
| `custom-behaviors` `spawnFood` free-cell logic | library `place-on-free-cell` (G4) + a shared `snake-cell` tag | **~60 lines** |
| `score` storage I/O + host `outcomeText("Best …")` | `manifest.persist` + library `persistence` system (G6) | host save/load glue |
| host `onEnterPlay` score reset + `game.loadScene` calls | `flow.persist` state hand-off (G1) | host hooks |

**Net for `games/snake`:** `+260 / −538` lines (`git diff --stat`). Host/custom
**TypeScript** dropped from 654 → 383 lines (main 60→144 absorbing the audio/juice/
touch/pause glue that *was* in shell; shell 305→0; custom-behaviors 289→239). The
screen flow is now **236 lines of declarative scene JSON** instead of a 305-line
host state machine. The validated game is data + two custom parts (`snake-body`
follower, `snake-guard` death/clamp), both logged as generalization candidates.

`snake-body` was **slimmed**, not dropped (the trailing body is unique to Snake);
`snake-guard` was **kept** (0.2.0 added no primitive for same-tick death/clamp).

### Gates (all green)

```
gitcade validate games/snake   → ✓ PASS — publishable, smoke boot ran 60 frames
npm run build  --workspace gitcade-snake   → dist/assets/index-DbYsM5qg.js (clean)
npm test       --workspace gitcade-snake   → 4 passed (title→play→over→play flow)
```

### Republished to MinIO `snake/main/`

`harness/snake/republish.mts` (reusing the build worker's S3 client, honoring
`S3_FORCE_PATH_STYLE`) cleared the stale prefix and uploaded the fresh dist:
`{ deletedStale: 30, uploaded: 30, objectsNow: 30 }`. The **live** artifact server
confirms the fix is deployed:
- `:3001/.../index.html` references the new bundle `index-DbYsM5qg.js`;
  `grep "GameShell|showGameOver"` in the served JS = **0**.
- Live puppeteer drive: boots to `title`, Enter → `play` (food spawned),
  **0 console errors**.

### Re-verified by playing (after)

| What the DoD asks | Evidence |
|---|---|
| food never on the wall or the body | `after.json → foodPlacement: onSnakeCount 0, outOfBoundsCount 0` (60 respawns) |
| title→play→game-over flows as data | `after.json → flow: title → play → over → (retry) → play`; browser [`shots/after-00-title.png`](./harness/snake/shots/after-00-title.png), [`after-03-gameover.png`](./harness/snake/shots/after-03-gameover.png) — both **canvas-rendered**, no HTML overlay |
| `score` shows on the game-over card | browser game-over card shows **SCORE 20 / BEST 20** after eating two coins; `flow.scoreOnOver: 50` headless |
| `best` survives a reload | `persistence.bestAfterReload: 4242` (saved → fresh boot with same storage → restored) |
| no console errors | browser after-run: `consoleErrors: 0, pageErrors: 0` (favicon 404 fixed) |
| mobile touch works | the on-screen d-pad synthesizes the arrow keys `move-grid-step` reads (host glue retained); the canvas flow buttons are `tap-emit` (pointer/touch native) |

**Before vs after, same lens:** mechanics identical (food valid, death clamped,
growth) — the change is purely architectural. `before-03-gameover.png` = HTML
overlay card; `after-03-gameover.png` = data-driven canvas scene.

---

## What the next game (Breakout) inherits

- **The local loop works on 0.2.0 without an npm publish:** repin `game.json` +
  `package.json`, symlink `node_modules/@gitcade/{sdk,library}` → the workspace
  packages, and `gitcade validate` resolves the 0.2.0 catalog. If the symlink is
  missing you get a loud `catalog-unavailable`, not a silent pass.
- **The G1 flow recipe, proven end-to-end:** split the run into `title/play/over`
  JSON scenes, drive transitions with per-scene `flow.on` edges, make buttons
  `tap-emit` entities (full-canvas, topmost `layer` so `entityAt` always picks
  them), carry state with `flow.persist`, and delete the per-game `GameShell`
  screen-state machine + HTML overlays. A small host keeps only what has no data
  primitive (audio, juice, touch, pause) + an Enter/Space → flow-event bridge.
- **G6 persistence is two lines of data:** `manifest.persist.keys` + a `persistence`
  system; no host save code. Breakout's levels/high-score ride the same path.
- **Reusable harnesses:** [`harness/snake/probe.mts`](./harness/snake/probe.mts)
  (headless, deterministic) and [`harness/snake/play.mjs`](./harness/snake/play.mjs)
  (browser, screenshots) are game-agnostic enough to fork per game; `republish.mts`
  is the upload path.
- **Breakout's G1 need is levels/flow** (per the roadmap) — exactly the flow recipe
  above, with `flow.on` edges advancing L1→L2 and `flow.persist` carrying score
  across levels.
