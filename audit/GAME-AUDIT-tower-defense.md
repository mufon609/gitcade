# Stage 4 Game Audit — Tower Defense (deep audit + fix on `0.2.0`)

**Game:** `games/tower-defense/` · **Repinned to** `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`
**Method:** observe, don't assert. Every verdict is backed by a re-runnable repro
against a **freshly rebuilt** artifact — never a stale blob (see [`PARITY.md`](./PARITY.md)).
This is the **flagship governance demo and the heaviest game** — it exercises *every*
new 0.2.0 primitive (G1 flow, G2 click-edge, G3 tilemap, G4 grid-snap, G5
transaction, G6 persistence) — and it carries the **three original user complaints**
that motivated this whole audit. Two harnesses, both booting through the real
`createGame` path (forked from the prior five Stage-4 games, made TD-aware):

- **Headless probe** — [`harness/tower-defense/probe.mts`](./harness/tower-defense/probe.mts)
  (`npx tsx`), deterministic seeded RNG, reads `world.state` / `world.tilemap` /
  entities. Drives the **real G2 click edge** (pushes a `justReleased()` tap, then
  steps). Captures [`before.json`](./harness/tower-defense/before.json) (legacy single
  `main.json` + `GameShell` + host `placeRequest`) and
  [`after.json`](./harness/tower-defense/after.json) (the 0.2.0 `title→play→over` data
  flow + tilemap road + transaction buy). Scene-set-adaptive.
- **Browser playthrough** — [`harness/tower-defense/play.mjs`](./harness/tower-defense/play.mjs)
  (puppeteer + Playwright Chrome, software GL): real pointer clicks on the road, on
  open ground, and on the `#tdbar` upgrade buttons; screenshots title → built → road
  → upgraded → combat in [`shots/`](./harness/tower-defense/shots/); console/page-error
  capture. Plus a **live** check against the republished `:3001` blob
  ([`after-live-play.json`](./harness/tower-defense/after-live-play.json)).

**Scope:** Tower Defense only. No SDK/library/platform/other-game source changed. The
one real library gap hit (the library's `snapToGrid` G4 helper is **not re-exported**
from the frozen `@gitcade/library` index) is **filed, not fixed** in
[`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#4** (the game inlines the
3-line formula with a comment).

---

## TL;DR — the three user complaints, before → after (verified by playing)

| # | Complaint | Before (`before.json` / `Broken_Tower_Defense.png`) | After (`after.json` + browser `after-play.json`) |
|---|---|---|---|
| **1** | **Towers can be built ON the road** | `tilemapPresent:false`, `isBuildable(onRoad):true`, **`towerPlacedOnRoad:true`**. The road was five rectangle `path` entities; `tower-build` checked only tower-vs-tower occupancy — nothing to query the tile type — so the screenshot shows turrets sitting on the lane. | The road is now **one data tilemap** (lane tiles `{lane:true,walkable:true,buildable:false}`), drawn by the renderer (OQ-3) and queried via `world.isBuildable`. `isBuildable(onRoad):false`, **`towerPlacedOnRoad:false`**, `VERDICT_towersBlockedOnRoad:true`. Browser: clicking the lane builds **no tower and charges no gold** (`VERDICT_roadBuildImpossible:true`). **Towers on the road are impossible by construction.** |
| **2** | **Towers feel free / the economy is broken** | Placement *did* deduct (`placementDeductedGold:40`) and deny when poor — but **`freeTowersBeforeAnyKill:5`** (start 220 / cost 40), so you could blanket the map before a single kill. That's why it "felt free." The afford/deduct was also inline host-ish logic in `tower-build`. | Re-tuned in `config.json` (the governance flagship — 100% of balance stays there): **start 120 / cost 60 → exactly 2 towers** before any kill, `creepBounty 7` so the rest are *earned* over waves. Cost now routes through the library **`transaction`** primitive (afford → `world.spend` → emit). Browser: a click deducts **120→60**; a broke click is denied (`deniedWhenTooPoor:true`). HUD reads **"Gold N (tower 60g)"** — the price is legible. |
| **3** | **No store / can't upgrade** | The upgrade logic worked when driven directly (`upgrade-tree` deducts + applies), but the **`#tdbar` buttons appeared unwired**: the GameShell ran its OWN fixed-step loop (never `game.start()`), and on a host loop the request flag's tick ordering + the screen-state machine made the UI feel dead. | The `#tdbar` store/upgrade bar is **wired and visible** during play (toggled to the play scene), with **live cost labels** (`Range +·L1 113g`) and affordability dimming. Browser: clicking Range/Fire-rate/Bounty deducts gold (**100000→99735**) and raises the stats (range **135→163**, cooldown **0.7→0.62**, bounty **0→4**); `uiWired:true`. The real cause was the GameShell loop, fixed by running the **real `game.start()` loop** (the Idle Clicker lesson). |

Plus the architecture caught up to 0.2.0: the **305-line `GameShell` is deleted**,
flow is `title→play→over` **data** scenes, placement is the **G2 click edge** (the
host `pointerdown→placeRequest` listener is gone), grid-snap is **G4**, and best-wave
**persists** declaratively (G6). **0 console / 0 page errors**, headless + browser +
**live `:3001`**.

---

## Step 1 — Repin to `0.2.0` and the local loop (PASS)

| Change | Before | After |
|---|---|---|
| `game.json` `sdkVersion` | `0.1.0` | `0.2.0` |
| `game.json` `libraryVersion` | `0.1.1` | `0.2.0` |
| `game.json` `entryPoint` | `src/scenes/main.json` | `src/scenes/title.json` |
| `game.json` `persist` | — | `{ "keys": ["bestWave"], "slot": "tower-defense" }` (G6) |
| `package.json` deps | `sdk 0.1.0`, `library 0.1.1` | both `0.2.0` |

Tower Defense shipped **with** the `node_modules/@gitcade/{sdk,library}` symlinks
already in place (unlike the prior five, which had none) — the `0.2.0` catalog
resolved immediately. No npm `[PUBLISH]` gate needed.

```
$ gitcade validate games/tower-defense  →  ✓ PASS — publishable, smoke boot ran 60 frames
$ npm run build  --workspace gitcade-tower-defense  →  dist/assets/index-BGiwzOx2.js (clean)
```

---

## Step 2 — Deep audit: every defect, with a repro

Classification: `[GAME-DATA]` (fix in this game) · `[ENGINE-now-fixed-in-0.2.0]` (a
gap 0.2.0 closed; adopt it) · `[NEEDS-NEW-ENGINE-WORK]` (file it).

### D-1 — Towers buildable on the road (USER COMPLAINT 1) `[ENGINE-now-fixed-in-0.2.0]` (G3) — the headline
- **Repro (before):** [`before.json → complaint1_towersOnRoad`]: `tilemapPresent:false`,
  `isBuildable_onRoad:true`, **`towerPlacedOnRoad:true`**. Root cause is engine
  defect **B-3** (ENGINE-AUDIT): the scene tilemap was parsed but never stored on
  `World`, so `tower-build` (`custom-behaviors/index.ts`) snapped to a grid and
  checked *tower-vs-tower* occupancy only — it had **nothing to query the tile type
  with** — and the road itself was five rectangle `path` entities. Visible in
  `Broken_Tower_Defense.png` (turrets sitting on the lane).
- **Fix:** the road is moved from rectangle entities to **one data tilemap** in
  `play.json` (`tileSize:40`, a 20×15 grid; lane tiles flagged
  `{lane:true,walkable:true,buildable:false}`, ground `{buildable:true}`). The 0.2.0
  renderer **draws** the tilemap (OQ-3), so the road is one source of truth — drawn
  AND queried — with no entity/tilemap double-encoding. `tower-build` now refuses a
  build on a non-buildable tile: `if (!world.isBuildable(x,y)) { deny }`. Creeps still
  follow the same lane (the `follow-path` waypoints are aligned to the lane-cell
  centers). `after.json`: `isBuildable_onRoad:false`, `towerPlacedOnRoad:false`,
  `VERDICT_towersBlockedOnRoad:true`; browser `VERDICT_roadBuildImpossible:true`.

### D-2 — Towers feel free / broken economy (USER COMPLAINT 2) `[GAME-DATA]` + (G5)
- **Repro (before):** [`before.json → complaint2_economy`]: placement *did* deduct
  (`placementDeductedGold:40`, `deniedWhenTooPoor:true`) — the economy LOGIC was
  fine — but **`freeTowersBeforeAnyKill:5`** (start 220 / cost 40). Five turrets up
  front before earning anything reads as "free." The afford/deduct also lived inline
  in `tower-build`.
- **Fix:** **(a)** re-tune `config.json` (the governance flagship — 100% of balance is
  there): `startGold 220→120`, `towerCost 40→60` (**2 towers to start**),
  `creepBounty 8→7` (the rest are earned). **(b)** route the cost through the library
  **`transaction`** system (G5): `tower-build` sets a `buyRequest:{id:"tower",cost}`,
  `transaction` audits affordability + `world.spend`s + emits `tower-bought`, and the
  tower is spawned on that event — one audited part owns the money. `after.json`:
  `freeTowersBeforeAnyKill:2`, `placementDeductedGold:60`, `placementWasFree:false`,
  `deniedWhenTooPoor:true`. The gold HUD reads **"Gold N (tower 60g)"** for legibility.

### D-3 — No working store / can't upgrade (USER COMPLAINT 3) `[ENGINE-now-fixed-in-0.2.0]` (G1 root)
- **Repro (before):** [`before.json → complaint3_upgrades`] shows the `upgrade-tree`
  deducts + applies all three upgrades (range +28, cooldown −0.08, bounty +4) and
  denies when broke **when driven directly** — so the logic was never the bug. The
  prior audit suspected the `#tdbar` buttons "may not be wired." The real cause: the
  **`GameShell` ran its own fixed-step loop** (it explicitly did NOT call
  `game.start()`), and the screen-state machine + the bottom-bar-under-overlay made
  the upgrade affordances feel dead (and on a host loop the click edge never clears —
  the Idle Clicker lesson).
- **Fix:** delete `GameShell`, run the **real `game.start()` loop**, and keep the
  `#tdbar` bar as host chrome that only SETS `world.state.upgradeRequest` (the data
  `upgrade-tree` consumes it every tick). The bar is shown with the play scene, with
  **live growth-scaled cost labels** + affordability dimming. Browser
  [`after-play.json → complaint3_upgradeUI`]: clicking the buttons deducts gold
  (100000→99735) and raises range 135→163, cooldown 0.7→0.62, bounty 0→4 —
  `uiWired:true`. **The store/upgrade UI works.**

### D-4 — Screen flow + chrome are a 305-line `GameShell` `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** the title/pause/game-over screens + their own fixed-step loop
  lived in `src/host/shell.ts` (**305 lines**); `main.ts` wired `onEnterPlay`/`screenFx`
  into it. Every seed game shipped this forbidden shell.
- **Fix:** `title/play/over` JSON scenes + `tap-emit` full-canvas buttons + per-scene
  `flow.on` edges (`start-pressed`→play, `gameover`→over, `retry`→play); **`GameShell`
  deleted**. `after.json → winLose`: `sceneAfterLose:"over"`, `sceneAfterWin:"over"`.
  Carry-vs-reset via `play.flow.persist` (`bestWave`/`outcome`/`winner`/`wave`/`leaked`
  …); a new run resets `gold`/`wave`/`leaked` because the play scene re-seeds them.

### D-5 — Host `pointerdown → placeRequest` listener, not data `[ENGINE-now-fixed-in-0.2.0]` (G2)
- **Repro (before):** `main.ts` added `canvas.addEventListener("pointerdown", … world.
  state.placeRequest = {x,y})`; `tower-build` consumed that host-populated key.
- **Fix:** `tower-build` reads the SDK click EDGE directly
  (`world.input.justReleased()`), grid-snaps via the G4 formula, checks the buildable
  tile, and issues the transaction. The host listener is **deleted** — placement is
  pure data (same shape Idle Clicker used for the coin).

### D-6 — Best-wave not persisted `[ENGINE-now-fixed-in-0.2.0]` (G6)
- **Repro (before):** no `manifest.persist`; nothing survived a reload
  (`before.json → persistence.bestAfterReload:null`).
- **Fix:** `manifest.persist:{keys:["bestWave"],slot:"tower-defense"}` + a `persistence`
  system in every scene; `creep-accounting` ratchets `bestWave`. `bestWave` is a key
  **no system seeds on tick 1**, so it does NOT hit the G6 seeding-race (#6) — it
  restores cleanly on the title scene. `after.json → persistence`: saved `7` →
  `bestAfterReload:7`.

### D-7 — Missing-favicon console 404 `[GAME-DATA]`
- **Fix:** an inline `data:` SVG favicon (a turret) in `index.html`. Browser + live
  after-runs: `consoleErrors:0`, `pageErrors:0`.

### Re-verified (NOT defects — the mechanics hold on a fresh rebuild)
| Check | Repro | Observed |
|---|---|---|
| **Creeps follow the lane** | `probe → combat`, browser | creeps spawn and walk the L-path; `creepMovedAlongLane:true`. |
| **Towers acquire + shoot** | `probe → combat`, browser | `towersShoot:true`, bullets spawn and damage creeps. |
| **Kill → bounty + explosion** | `probe → combat` | `resolved` climbs, gold accrues, `creep-killed` fires the burst. |
| **Win / Lose → over** | `probe → winLose`, smoke | leak ≥ `maxLeak` → `outcome:"lose"` → scene `over`; all waves cleared + field empty → `outcome:"win"` → `over`. |
| **TD2 win-derivation invariant** | smoke (3 cases) | the win is derived from the spawner's own `waves-complete` + live creep count, never a duplicated total — rebalancing waves up/down can neither win early nor softlock. |

### Filed, not fixed — residual library gap `[NEEDS-NEW-ENGINE-WORK]`
- **`snapToGrid` (G4) is not re-exported from `@gitcade/library`.** The grid-snap
  helper exists (`packages/library/src/util.ts`) but the package index re-exports only
  the registries + UI helpers, so a game can't import it. Tower Defense inlines the
  3-line formula (commented). A one-line additive re-export would close it. Logged in
  [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#4** (which also records the
  build-on-request 0.2.0 shape: click-edge + buildable-gate + transaction). **Not
  fixed here** (library is frozen/out of scope this session).

---

## Step 3 — Fix, rebuild, republish, re-verify

### What 0.2.0 primitive replaced what custom/host code

| Custom/host code (before) | 0.2.0 primitive (after) | Deleted |
|---|---|---|
| `src/host/shell.ts` — `GameShell` screen-state machine + its OWN fixed-step loop + HTML `#menu`/pause chrome | `title/play/over.json` scenes + `tap-emit` + per-scene `flow.on` edges + the real `game.start()` loop | **305 lines** (file removed) |
| single `main.json` w/ five rectangle `path` entities encoding the road | a **data tilemap** in `play.json` (lane `buildable:false`), drawn (OQ-3) + queried (`world.isBuildable`, G3) | `main.json` (491 lines) |
| host `canvas.addEventListener("pointerdown", … state.placeRequest)` | `tower-build` reads `world.input.justReleased()` (G2 click edge) | host click listener |
| inline grid-snap + tower-vs-tower-only occupancy in `tower-build` | grid-snap (G4 formula) **+** the G3 buildable gate (refuses the road) | — (swap) |
| inline afford/deduct in `tower-build` | the library **`transaction`** system (G5): afford → `world.spend` → `tower-bought` | inline economy |
| host `GameShell` `outcomeText`/`onEnterPlay`/`screenFx` callbacks | scene `flow` + `flow.persist` + a thin `requestAnimationFrame` HUD mirror + a `ScreenEffects` bind in `main.ts` | shell callbacks |
| (no persistence) | `manifest.persist` + the library `persistence` system (G6) for `bestWave` | — (new) |

**Net for `games/tower-defense`:** host/custom **TypeScript** changed from
**592 lines** (`shell.ts` 305 + `main.ts` 78 + `custom-behaviors` 209 + `storage.ts`
unchanged) to **443** (`shell.ts` 305→0; `main.ts` 78→164, now the upgrade-bar wiring
+ HUD mirrors + screen-FX + audio + keyboard-flow bridge that *was* inside shell;
`custom-behaviors` 209→255, absorbing the G2 click-edge reader + the transaction
routing; `storage.ts` unchanged). The legacy `main.json` (491 lines) became
`play.json` (229) + `title.json` (59) + `over.json` (43) of declarative scene JSON.
The validated game = a **data tilemap** + library systems (`currency`, `transaction`,
`upgrade-tree`, `wave-spawner`, `win-lose-conditions`, `persistence`, `explosion`,
`trigger-zone`, `ai-aim-and-fire`, `follow-path`, `contact-damage`, `health-and-death`,
`tap-emit`) + **two** custom systems (`tower-build`, `creep-accounting`), both logged
as generalization candidates (#4, #5).

### Gates (all green)

```
gitcade validate games/tower-defense  → ✓ PASS — publishable, smoke boot ran 60 frames
npm run build  --workspace gitcade-tower-defense  → dist/assets/index-BGiwzOx2.js (clean)
npm test       --workspace gitcade-tower-defense  → 7 passed
   (enter play + place on a CLICK (G2) deducts gold; REFUSES to build on the road
    (G3) — no tower, no charge — but builds on adjacent ground; TD2 no-duplicate-total;
    WIN clears every wave the spawner makes; rebalance-UP no premature win;
    rebalance-DOWN no softlock; LOSE fires on leak → over)
```

### Republished to MinIO `tower-defense/main/`

[`harness/tower-defense/republish.mts`](./harness/tower-defense/republish.mts) (reusing
the build worker's S3 client, honoring `S3_FORCE_PATH_STYLE`) cleared the stale prefix
and uploaded the fresh dist: `{ deletedStale: 30, uploaded: 30, objectsNow: 30 }`. The
artifact server was started **ephemerally** for the live check and **stopped**
afterwards (`:3001` was free — the user had NOT bound it — and is left free; no server
orphaned; the user's `:3000` platform is untouched). The **live** artifact confirms the
fix is deployed:
- `:3001/artifacts/tower-defense/main/index.html` references the new bundle
  `index-BGiwzOx2.js` (matches the local build);
- `grep "GameShell|showGameOver|showTitle"` in the served JS = **0**;
- `grep "isBuildable|start-pressed|tower-bought|buyRequest"` in the served JS =
  present (tilemap gate + flow + transaction are deployed);
- live puppeteer drive ([`after-live-play.json`](./harness/tower-defense/after-live-play.json)):
  road-build impossible, ground-build costs 60 gold, the `#tdbar` upgrade UI deducts +
  raises stats, towers shoot, **0 console / 0 page errors**.

### Re-verified by playing (after)

| What the DoD asks | Evidence |
|---|---|
| **towers on the road are IMPOSSIBLE** | `after.json → complaint1.VERDICT_towersBlockedOnRoad:true`; browser/live `complaint1_clickRoad.VERDICT_roadBuildImpossible:true` (no tower, no gold charged on a lane click); `world.isBuildable(onRoad):false`; smoke "REFUSES to build on the road" test. `Broken_Tower_Defense.png` (turrets on the lane) vs [`shots/after-03-built-tower.png`](./harness/tower-defense/shots/after-03-built-tower.png) (tower on open ground beside the drawn road) + [`after-05-combat.png`](./harness/tower-defense/shots/after-05-combat.png) (three towers all off the road). |
| **economy real + legible** | `after.json → complaint2`: `placementDeductedGold:60`, `freeTowersBeforeAnyKill:2`, `deniedWhenTooPoor:true`; browser `complaint2_clickGround.goldDeducted:60` (120→60); HUD "Gold N (tower 60g)". Cost routed through `transaction` (G5). |
| **store / upgrade UI works** | browser/live `complaint3_upgradeUI.uiWired:true` — `#tdbar` clicks deduct 100000→99735 and raise range 135→163 / cooldown 0.7→0.62 / bounty 0→4, with live cost labels; `tdbarVisible:"flex"` during play. |
| **placement is the G2 click edge** | host `pointerdown→placeRequest` deleted; `tower-build` reads `world.input.justReleased()`; smoke "places on a CLICK" test. |
| **flow is data; GameShell removed** | `shell.ts` deleted; served JS `grep GameShell/showTitle/showGameOver = 0`; title/play/over are **canvas** scenes via `tap-emit` + `flow.on`; [`shots/after-00-title.png`](./harness/tower-defense/shots/after-00-title.png) is a data-driven canvas title. |
| **creeps path / win / lose** | `after.json → combat.creepMovedAlongLane:true`, `towersShoot:true`; `winLose` lose→over / win→over; smoke win/lose tests + TD2 invariant. |
| **best wave persists (G6)** | `after.json → persistence.bestAfterReload:7` (saved → fresh boot with shared storage → restored). |
| **no console errors / touch** | browser + live: `consoleErrors:0, pageErrors:0` (favicon 404 fixed); the map + upgrade bar are pointer-native — pointer clicks drive the whole run, no host touch glue. |

**Before vs after, same lens:** the *mechanics* are identical (creeps path, towers
shoot, kills pay bounty, win/lose), and the *economy logic* (afford/deduct/deny,
upgrade tree) was already correct — the changes are: the **road is a queryable
tilemap** (towers-on-road now impossible), the **balance is re-tuned** (towers are
earned, not free), the **store UI runs on the real loop** (upgrades work), and the
**flow/placement/persistence are data**. `Broken_Tower_Defense.png` → the after-shots.

---

## Stage 4 is COMPLETE

All **six** seed games (Snake, Breakout, Helicopter, Survival Arena, Idle Clicker,
Tower Defense) are now deep-audited, fixed, repinned to `0.2.0`, validated, built,
republished to MinIO `…/main/`, and verified by playing. **Stage 5** is next: publish
`0.2.0` (the npm `[PUBLISH]` step), the worker-faithful republish path, and a full
regression across all six.

### Reusable harnesses (fork cleanly per game)
- [`harness/tower-defense/probe.mts`](./harness/tower-defense/probe.mts) — headless,
  scene-set-adaptive, injects the real G2 click edge; asserts the three complaints.
- [`harness/tower-defense/play.mjs`](./harness/tower-defense/play.mjs) — browser; serves
  a dist OR drives a live `:3001` URL (`argv[4]`); clicks road/ground/upgrade-bar.
- [`harness/tower-defense/republish.mts`](./harness/tower-defense/republish.mts) — the
  S3 upload path.
