# Stage 4 Game Audit — Breakout (deep audit + fix on `0.2.0`)

**Game:** `games/breakout/` · **Repinned to** `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`
**Method:** observe, don't assert. Every verdict is backed by a re-runnable repro
against a **freshly rebuilt** artifact — never a stale blob. Two harnesses, both
booting through the real `createGame` path (forked from Snake's, made
Breakout-aware):

- **Headless probe** — [`harness/breakout/probe.mts`](./harness/breakout/probe.mts)
  (`npx tsx`), deterministic seeded RNG, reads `world.state`/entities directly.
  Captures: [`harness/breakout/before.json`](./harness/breakout/before.json)
  (current source, single `main.json`) and
  [`harness/breakout/after.json`](./harness/breakout/after.json) (0.2.0 six-scene
  level flow). It adapts to whichever scene set is on disk.
- **Browser playthrough** — [`harness/breakout/play.mjs`](./harness/breakout/play.mjs)
  (puppeteer + Playwright Chrome, software GL): real keyboard paddle control,
  auto-tracking the ball, screenshots title → play → L1→L2→L3 → win in
  [`harness/breakout/shots/`](./harness/breakout/shots/) (`before-*`, `after-*`),
  console/page-error capture. Plus a live check against the republished `:3001` blob.
- **Scene generator** — [`harness/breakout/gen-scenes.mjs`](./harness/breakout/gen-scenes.mjs)
  emits the six data scenes from per-level brick masks (so the 96 brick entities
  aren't hand-maintained). **The scenes are committed data; the generator is a
  one-shot authoring tool, not a build step.**

**Scope:** Breakout only. No SDK/library/platform/other-game source changed. No
new engine bug found (the `0.1.1` `axis:"auto"` brick-reflect fix holds on a fresh
rebuild), so `games/LIBRARY-GAPS.md` is unchanged this round.

---

## TL;DR

- **Breakout's *mechanics* were already correct in source** — ball physics,
  paddle reflect/english, brick break + score tally, wall bounce all reproduce
  cleanly on a fresh rebuild (no tunnelling, ball never leaves the field).
- The headline defect is **architectural and real, not a stale-artifact mirage**:
  *Breakout had no level progression.* There was **one** brick layout, and
  clearing it ended the game via `win-lose-conditions` (`level` reaches
  `winLevel:2`). "Breakout's whole point is L1→L2→…" — and that did not exist.
  Plus the same `GameShell` debt every seed game carries (G1): the
  title/pause/game-over screens were a **305-line host state machine + HTML menu
  overlays**, not data.
- **Result (adoption, not rewrite):** the run is now **six JSON scenes wired by
  `flow.on`** — `title → level-1 → level-2 → level-3 → win/over` — with **three
  distinct brick layouts**; `level-progression` (clearTag) emits `level-cleared`
  and the scene's flow edge advances the level; `score`/`best`/`lives` carry via
  `flow.persist`; `best` persists cross-run via declarative `manifest.persist`
  (G6). The **305-line GameShell is deleted**, `main.ts` slimmed to host-only
  glue, and `win-lose-conditions` (a wrong fit for multi-level) is gone. All
  re-verified by playing — headless and in a real browser.

---

## Step 1 — Repin to `0.2.0` and the local loop (PASS)

| Change | Before | After |
|---|---|---|
| `game.json` `sdkVersion` | `0.1.1` | `0.2.0` |
| `game.json` `libraryVersion` | `0.1.1` | `0.2.0` |
| `game.json` `entryPoint` | `src/scenes/main.json` | `src/scenes/title.json` |
| `game.json` `persist` | — | `{ "keys": ["best"], "slot": "breakout" }` (G6) |
| `package.json` deps | `sdk 0.1.1`, `library 0.1.1` | both `0.2.0` |

Breakout shipped with **no** `node_modules/@gitcade` symlinks (unlike Snake), so
before repin the validator failed loudly — exactly as Snake's notes predicted:

```
[ERROR] library-version-mismatch: installed library catalog is 0.2.0 but game.json pins 0.1.1
✗ FAIL — 1 error(s)
```

Symlinking the workspace packages into the game
(`node_modules/@gitcade/{sdk,library} → packages/*`, the pattern `tower-defense`/
Snake use) made the `0.2.0` catalog resolve. No npm `[PUBLISH]` gate was needed —
local workspace resolution works once the game is repinned and symlinked.

```
$ gitcade validate games/breakout   →  ✓ PASS — publishable, smoke boot ran 60 frames
$ npm run build  --workspace gitcade-breakout  →  dist/assets/index-RSLKcexu.js (clean)
```

---

## Step 2 — Deep audit: every defect, with a repro

Classification: `[GAME-DATA]` (fix in this game) · `[ENGINE-now-fixed-in-0.2.0]`
(a gap 0.2.0 closed; adopt it) · `[NEEDS-NEW-ENGINE-WORK]` (file it).

### D-1 — No real level progression — the headline gap `[GAME-DATA]` (uses G1)
- **Repro (before):** `before.json` boots `main.json` (the only scene) with **50
  bricks in one layout**. Clearing them does not advance to a second layout — a
  focused micro-probe shows it instead ends the game:
  `clear all bricks → level 1→2, events [level-up, gameover], outcome "win"`.
  `level-progression` (clearTag) bumped `level`, then `win-lose-conditions`
  (`level >= winLevel:2`) fired the win. So Breakout was a **single-screen "clear
  the wall" game** — the README even admits *"there is no second brick layout."*
- **Why it's a defect:** Breakout's entire identity is escalating levels. Pre-0.2.0
  `loadScene` was host-only and wiped `world.state`, so a level *couldn't* be a
  data scene the run advanced into. 0.2.0's `flow.on` + `flow.persist` (G1) make
  it possible.
- **Fix:** **one JSON scene per level** (`level-1/2/3.json`), each with a distinct
  brick layout; `level-progression` emits `level-cleared`; the scene's
  `flow.on: { "level-cleared": "level-2" }` advances; the last level → `win`.
  `win-lose-conditions` removed (it modelled a single "win at level N", wrong for
  a multi-scene flow). See Step 3.

### D-2 — Screen flow is host TypeScript, not data `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** the title/pause/game-over screens live in
  `src/host/shell.ts` — a **305-line** `ScreenState` machine
  (`showTitle`/`showPause`/`showGameOver`/`startRun`/`toGameOver` + HTML `#menu`
  overlays) running its own fixed-step loop; `main.ts:49-51` resets `score` in an
  `onEnterPlay` hook. Browser before-capture
  ([`shots/before-00-title.png`](./harness/breakout/shots/before-00-title.png)):
  the title is an **HTML overlay** (`readState via:"dom", menuVisible:true`), not
  the canvas.
- **Why it's a defect:** §B-1 of the engine audit — every seed game ships this
  forbidden `GameShell`; flow couldn't be data and score couldn't cross a
  transition.
- **Fix:** `title/win/over` JSON scenes + per-scene `flow.on` edges +
  full-canvas `tap-emit` buttons; GameShell deleted (Step 3).

### D-3 — High-score persistence is the bespoke `score`-system storage path `[ENGINE-now-fixed-in-0.2.0]` (G6)
- **Repro (before):** the `score` system carried
  `highKey:"highScore", storageKey:"breakoutHigh", persist:true` and did its own
  async `world.storage.get/set`; the "Best" was assembled in a host `outcomeText`
  callback (`main.ts:39`). No declarative cross-run persistence.
- **Fix:** declarative `manifest.persist: { keys:["best"], slot:"breakout" }` + the
  library `persistence` system in every scene; `score` now only computes `best`
  (running max, `persist:false`). `after.json → persistence: { savedSlot:{best:7777},
  bestAfterReload:7777, scratchNotRestored:null }` confirms a reload restores it
  (and a non-persisted key does not) with **no host save code**.

### D-4 — Missing-favicon console 404 `[GAME-DATA]`
- **Repro (before):** the browser playthrough logged **2** `404 (Not Found)`
  console errors (`before-play.json → consoleErrors: 2`); both are `GET
  /favicon.ico` (same pattern Snake hit).
- **Fix:** an inline `data:` SVG favicon in `index.html`. After-playthrough:
  `consoleErrors: 0`.

### Re-verified (NOT defects — the mechanics hold on a fresh rebuild)
| Check | Repro | Observed (before & after) |
|---|---|---|
| **Ball physics / no tunnelling** | `probe → ballPhysics` | ball X-range `[262,782]` ⊂ `[0,800]`, Y never above the top (`120`), `everOutOfBoundsSidesTop:false`; bricks break. Holds before/after. |
| **Brick reflect (`axis:"auto"`, the 0.1.1 fix)** | `probe → ballPhysics.brokeBricks` | ball reflects off bricks and clears the wall (`bricksAfter1200f:0`). Library `reflect-on-hit` unchanged. |
| **Lives decrement + game-over** | `probe → lives` | losing the ball drops lives `3 → 2 → 1 → 0`; at 0 `lives-respawn` ends the game. Works before/after. |
| **Score tally on break** | `health-and-death` tally | `+blockScore` per brick into `world.state.score`. Unchanged library behavior. |

### Filed, not fixed — residual engine/library gap `[NEEDS-NEW-ENGINE-WORK]`
- **None this round.** No Breakout mechanic needed an engine change 0.2.0 didn't
  already provide. `games/LIBRARY-GAPS.md` is unchanged.

---

## Step 3 — Fix, rebuild, republish, re-verify

### Level / flow data layout (the choice)

**One JSON scene per level** (vs a single play scene whose brick layout the flow
rewrites). Rationale: it is the most literal, reviewable expression of "L1→L2→… as
data" — each level is a self-contained, diff-able artifact, and the advance is a
plain `flow.on` edge (the exact G1 recipe Snake established for title→play→over,
generalized to N levels). The level scenes are **identical except** for (a) their
brick layout and (b) which scene their `level-cleared` edge targets — all play
furniture (paddle, ball, killzone, HUD) and all systems are shared. A data-driven
brick *mask* per level keeps authoring terse (the generator), while the committed
output is plain data the validator/runtime consume.

```
title --start-pressed--> level-1 --level-cleared--> level-2 --level-cleared--> level-3 --level-cleared--> win
                            |  \___ gameover ___\          |  \___ gameover ___\        |  \__ gameover __\
                            v                               v                            v
                           over <----------------------- (all three) ------------------+ , retry --> level-1
```

- **L1** — solid 4-row wall (40 bricks); **L2** — hollow box + center pillar (30,
  with gaps to thread); **L3** — diamond (26, sparse/harder). Distinct so the
  progression is *visible* on screen.
- `flow.persist: ["score","best","lives"]` on every level carries the run across a
  transition. `level` is intentionally **not** carried — each scene's
  `level-progression` is a fresh internal clear-detector (its per-scene counter
  resets), so the HUD level is a static per-scene label (`LEVEL 1/2/3`) rather than
  the counter, which would otherwise display the wrong number after a hop (a bug
  caught in the browser pass and fixed).

### What 0.2.0 primitive replaced what custom code

| Custom/host code (before) | 0.2.0 primitive (after) | Deleted |
|---|---|---|
| `src/host/shell.ts` — `GameShell` screen-state machine + HTML `#menu` cards + its own loop | `title/win/over.json` scenes + per-scene `flow.on` edges + `tap-emit` buttons | **305 lines** (file removed) |
| single `main.json` "clear the wall" + `win-lose-conditions` | `level-1/2/3.json` + `level-progression` `level-cleared` edges (G1) | `win-lose-conditions` system + `winLevel` config key |
| `score` storage I/O (`storageKey`/`persist`) + host `outcomeText("Best …")` | `manifest.persist` + library `persistence` system (G6) | host save/load glue |
| host `onEnterPlay` score reset + `game.loadScene` calls | `flow.persist` state hand-off (G1) | host hooks |

**Net for `games/breakout`:** `src/host/shell.ts` **305 → 0**; `main.ts` 60 → 156
(it absorbed the audio/juice/touch/pause/keyboard-bridge glue that *was* inside
shell — same as Snake); `custom-behaviors/index.ts` stays the intentional empty
hook (0 game code). The screen flow + three levels are now **~230 + 3×~410 lines of
declarative scene JSON** instead of a 305-line host state machine + a single
`main.json`. Validated game = data + two library systems (`level-progression`,
`lives-respawn`) and zero custom parts.

### Gates (all green)

```
gitcade validate games/breakout   → ✓ PASS — publishable, smoke boot ran 60 frames
npm run build  --workspace gitcade-breakout  → dist/assets/index-RSLKcexu.js (clean)
npm test       --workspace gitcade-breakout  → 6 passed (title→L1, ball breaks bricks,
                                               L1→L2 carries score, L1→L2→L3→win,
                                               lives drain → over)
```

### Republished to MinIO `breakout/main/`

[`harness/breakout/republish.mts`](./harness/breakout/republish.mts) (reusing the
build worker's S3 client, honoring `S3_FORCE_PATH_STYLE`) cleared the stale prefix
and uploaded the fresh dist:
`{ deletedStale: 30, uploaded: 30, objectsNow: 30 }`. The **live** artifact server
confirms the fix is deployed:
- `:3001/artifacts/breakout/main/index.html` references the new bundle
  `index-RSLKcexu.js` (matches the local build);
- `grep "GameShell|showGameOver"` in the served JS = **0**;
- `grep "level-cleared|start-pressed"` in the served JS = present (flow is data).

### Re-verified by playing (after)

| What the DoD asks | Evidence |
|---|---|
| **real level progression L1→L2→… works as data** | `after.json → levels.trace`: `level-1(40 bricks) → level-2(30) → level-3(26) → win(0)`; `reachedLevel2/3:true, reachedWin:true`. Browser: `afterStart→level-1`, `afterClearL1→level-2`, `afterClearL2→level-3`, `afterClearFinal→win` — all via `window.__game.scene.id` on the **canvas** build. |
| score carries across levels | `after.json → levels.scoreCarried:true` (seeded 500, present in every later scene); browser midPlay `score:100` after real paddle play, carried to L2 (`150`). |
| lives decrement and end the game | `after.json → lives.livesSequence:[3,2,1,0]`; `winLose.loseRoutesToOver:true`. Smoke test "lives drain → over" passes. |
| score/high-score persist | `after.json → persistence: savedSlot {best:7777}, bestAfterReload:7777, scratchNotRestored:null` (reload restores `best` via declarative persist, non-persisted `score` does not). |
| win/lose fire correctly | clearing the last level → `win`; draining lives → `over`. Both observed headless + in tests. |
| no console errors | browser after-run: `consoleErrors:0, pageErrors:0` (favicon 404 fixed). |
| mobile touch works | the on-screen ◀ ▶ pad synthesizes the arrow keys `move-4dir` reads (host glue retained, same as Snake); the canvas flow buttons are `tap-emit` (pointer/touch native). |

**Before vs after, same lens:** mechanics identical (ball physics, brick break,
lives) — the change is architectural + the new level dimension.
[`shots/before-00-title.png`](./harness/breakout/shots/before-00-title.png) = HTML
`#menu` overlay; [`shots/after-00-title.png`](./harness/breakout/shots/after-00-title.png)
= data-driven canvas title;
[`shots/after-03-after-level1.png`](./harness/breakout/shots/after-03-after-level1.png)
… [`after-05-win.png`](./harness/breakout/shots/after-05-win.png) = the
canvas-rendered level-2/3/win scenes the old build could not produce.

---

## What the next game (Helicopter, #3) inherits

- **The local loop on 0.2.0 without an npm publish** (proven again): repin
  `game.json` + `package.json`, symlink `node_modules/@gitcade/{sdk,library}` → the
  workspace packages (Breakout had **none** — create them, or the validator fails
  loudly with `library-version-mismatch`), `gitcade validate` resolves the catalog.
- **The G1 flow recipe generalized to N scenes:** title/play/over is just the 2-edge
  case; Breakout shows `flow.on` chaining an arbitrary sequence
  (`level-cleared → next`) with `flow.persist` carrying the run. Helicopter's
  roadmap need is G1 (flow) + verifying `wave-spawner`'s `placement` param — the
  same `flow.on`/`flow.persist` pattern applies; use a single play scene with a
  difficulty/`level-progression` counter (scoreGte mode) if it doesn't need
  *distinct* layouts per level the way Breakout does.
- **Carry-vs-reset is a deliberate `flow.persist` choice:** carry score/lives;
  do **not** carry a per-scene system's internal counter (it resets per scene) —
  drive cumulative HUD numbers from a static per-scene label or a key you own, not
  the library counter. (The bug that bit Breakout's level HUD; caught in the
  browser pass.)
- **G6 persistence is two lines of data:** `manifest.persist.keys` + a
  `persistence` system per scene; no host save code. Reuse for any high-score/best.
- **Reusable harnesses:** [`harness/breakout/probe.mts`](./harness/breakout/probe.mts)
  (headless, scene-set-adaptive), [`harness/breakout/play.mjs`](./harness/breakout/play.mjs)
  (browser, auto-tracks the ball, screenshots), and
  [`harness/breakout/gen-scenes.mjs`](./harness/breakout/gen-scenes.mjs) (mask →
  scene generator) fork cleanly per game; `republish.mts` is the upload path.
