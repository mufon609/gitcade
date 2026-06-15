# Stage 4 Game Audit — Idle Clicker (deep audit + fix on `0.2.0`)

**Game:** `games/idle-clicker/` · **Repinned to** `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`
**Method:** observe, don't assert. Every verdict is backed by a re-runnable repro
against a **freshly rebuilt** artifact — never a stale blob (see [`PARITY.md`](./PARITY.md)).
This is the **economy-heavy** game; the 0.2.0 economy/persistence/click primitives
are the point. Two harnesses, both booting through the real `createGame` path
(forked from the prior Stage-4 games, made Idle-Clicker-aware):

- **Headless probe** — [`harness/idle-clicker/probe.mts`](./harness/idle-clicker/probe.mts)
  (`npx tsx`), deterministic seeded RNG, reads `world.state`. Drives the **real G2
  click edge** (pushes a `justReleased()` tap, then steps). Captures
  [`before.json`](./harness/idle-clicker/before.json) (legacy single `main.json` +
  `GameShell` + host click/save/prestige) and [`after.json`](./harness/idle-clicker/after.json)
  (the 0.2.0 `title→play` data flow + data economy). Scene-set-adaptive.
- **Browser playthrough** — [`harness/idle-clicker/play.mjs`](./harness/idle-clicker/play.mjs)
  (puppeteer + Playwright Chrome, software GL): real pointer taps on the coin + shop
  buttons, screenshots title → play → clicked → bought → prestiged → offline in
  [`shots/`](./harness/idle-clicker/shots/) (`after-*`, `after-live-*`), console/page-error
  capture. Plus a **live** check against the republished `:3001` blob
  ([`after-live-play.json`](./harness/idle-clicker/after-live-play.json)).

**Scope:** Idle Clicker only. No SDK/library/platform/other-game source changed. One
engine-shaped finding (the **persistence-vs-system-seeding race**, G6) is **filed,
not fixed** in [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#6**, with the
scene-flow workaround documented.

---

## TL;DR

- Idle Clicker's **economy was already correct** on a fresh rebuild — click income,
  auto-income, growth-scaled upgrade purchases, the periodic bonus, prestige math, and
  big-number safety all held in the re-baseline ([`before.json`](./harness/idle-clicker/before.json)).
  The real defects were **architectural**: the click, the save/load, the screen flow,
  and the prestige economics were all **host TypeScript** (the forbidden `GameShell`
  every seed game carries — G1 — plus a host `pointerdown` listener for G2 and hand-
  rolled storage glue for G6) instead of the data the 0.2.0 primitives now provide.
- 0.2.0 closes those gaps, so the fix is **adoption**: click-to-earn now reads the SDK
  **click EDGE** (`input.justReleased()` + `entityAt`) on the coin — the host
  `pointerdown` listener is **deleted** (G2); purchases route through the library
  `upgrade-tree` (afford→deduct→effect, the G5 fixed-catalog economy primitive) and
  prestige is a small data `prestige` system; values persist across reload via
  **declarative `manifest.persist` + the library `persistence` system** — the host
  save/load/autosave is **deleted** (G6); and the run is **data** (`title→play` JSON
  scenes wired by a `tap-emit` `flow.on` edge), so the **305-line `GameShell` is
  deleted** (G1).
- **Offline progress (OQ-4 — OUT of 0.2.0 scope)** stays a **small, clearly-commented
  host shim**: on resume it reads the saved `lastSeen`/`autoRate`/`prestigeMult`,
  credits `autoRate × elapsed × mult` (capped at `offlineCapSeconds`) once, and
  heartbeats `lastSeen = Date.now()` so the next save records the away-point — all
  through `world.storage`, never raw browser storage. ~30 lines, on top of G6's value
  persistence. The generic engine primitive was NOT built; the feature was NOT dropped.
- **Result, all re-verified by playing** — headless, in a real browser, and against the
  live republished `:3001` artifact: tapping the coin earns (12 taps → 12 coins, no
  host listener); auto-income ticks while idle; buying deducts and raises power/rate;
  prestige resets the run and bumps the multiplier (1 → 1.25); coins/clickPower/
  autoRate/upgrades/prestigeMult **survive a reload**; the offline shim credits
  **+30,000** coins for a simulated 5-minute gap; **0 console / 0 page errors**.

---

## Step 1 — Repin to `0.2.0` and the local loop (PASS)

| Change | Before | After |
|---|---|---|
| `game.json` `sdkVersion` | `0.1.0` | `0.2.0` |
| `game.json` `libraryVersion` | `0.1.0` | `0.2.0` |
| `game.json` `entryPoint` | `src/scenes/main.json` | `src/scenes/title.json` |
| `game.json` `persist` | — | `{ keys:[coins,clickPower,autoRate,upgrades,prestigeMult,lastSeen], slot:"idle-clicker", everySeconds:5 }` (G6) |
| `package.json` deps | `sdk 0.1.0`, `library 0.1.0` | both `0.2.0` |

Idle Clicker shipped with an **empty** `node_modules/@gitcade/` dir (no symlinks, like
Breakout/Helicopter/Survival Arena). Symlinking the workspace packages
(`node_modules/@gitcade/{sdk,library} → packages/*`) made the `0.2.0` catalog resolve;
the validator fails **loudly** otherwise (library/version mismatch). No npm `[PUBLISH]`
gate needed — local workspace resolution works once repinned and symlinked.

```
$ gitcade validate games/idle-clicker  →  ✓ PASS — publishable, smoke boot ran 60 frames
$ npm run build  --workspace gitcade-idle-clicker  →  dist/assets/index-C34Ybbn4.js (clean)
```

---

## Step 2 — Deep audit: every defect, with a repro

Classification: `[GAME-DATA]` (fix in this game) · `[ENGINE-now-fixed-in-0.2.0]` (a
gap 0.2.0 closed; adopt it) · `[NEEDS-NEW-ENGINE-WORK]` (file it).

### D-1 — Click-to-earn is a host `pointerdown` listener, not data `[ENGINE-now-fixed-in-0.2.0]` (G2)
- **Repro (before):** `main.ts:85-90` added `canvas.addEventListener("pointerdown", …)`
  that incremented `world.state.clicks`; the `click-to-earn` system polled that
  counter. [`before.json → click`] shows `method:"clicks-counter"` — the only way to
  earn was a host-populated key, invisible to data.
- **Why it's a defect:** §G2 of the design — the click that drives the whole game lived
  in host JS; a fork couldn't move/retarget it as data.
- **Fix:** `click-to-earn` now reads the SDK click **edge** directly
  (`world.input.justReleased()`), pays `clickPower` per tap whose `world.entityAt`
  pick is tagged `coin-button`, and the host listener is **deleted**. A full-field
  invisible `coin-button` target preserves "tap anywhere on the field." [`after.json →
  click`]: `method:"tap-edge"`, 5 taps → 5 coins.

### D-2 — Screen flow + prestige economics + chrome are a 305-line `GameShell` `[ENGINE-now-fixed-in-0.2.0]` (G1)
- **Repro (before):** the title/pause/game-over screens + their own fixed-step loop
  lived in `src/host/shell.ts` (**305 lines**); `main.ts` wired `onEnterPlay` (seed
  state) and `beforeFrame` (HUD) into it, and the **prestige economics** (bank +
  multiplier + reset) lived in a host `prestige-btn` listener (`main.ts:135-148`).
  [`before.json → prestige`]: `prestigeFired:false`, `multRose:false` — the data path
  `prestigeRequest` did nothing; prestige was host-only.
- **Why it's a defect:** §B-1 / §G1 — every seed game ships this forbidden `GameShell`;
  flow and prestige couldn't be data, and the shell ran its **own** loop (so it never
  called `input.endFrame()` — the G2 click edge would never even work under it).
- **Fix:** `title/play` JSON scenes + a `tap-emit` `flow.on:{start-pressed:"play"}`
  edge; a data **`prestige`** system (request-flag driven, like `upgrade-tree`) owns
  the bank/multiplier/reset; the game runs on the real **`game.start()`** loop (which
  drains the scene queue and clears the click edge). **`GameShell` deleted** (Step 3).
  [`after.json → prestige`]: `prestigeFired:true`, `multBefore 1 → multAfter 1.25`,
  `coinsResetToZero:true`, `upgradesResetToEmpty:true`.

### D-3 — Persistence is host save/load/autosave, not declarative `[ENGINE-now-fixed-in-0.2.0]` (G6)
- **Repro (before):** `main.ts:47-82` hand-rolled the whole save lifecycle over the
  storage bridge — an up-front async `storage.get`, a `snapshot()`/`save()` pair, a
  `setInterval(5000)` autosave, and `visibilitychange`/`pagehide` flushes — plus the
  `onEnterPlay` load/seed. [`before.json → persistence`]: `skipped` (single-scene,
  host-only path; no declarative cross-run save).
- **Why it's a defect:** §G6 — coins/upgrades/prestige round-tripping through the
  bridge is exactly what declarative `manifest.persist` + the `persistence` system now
  do without host JS.
- **Fix:** `manifest.persist` (the six save keys) + a `persistence` system in every
  scene; the host save/load/autosave is **deleted**. [`after.json → persistence`]: a
  reboot with shared storage restores `coins 12362→12366`, `clickPower 7`, `autoRate
  42`, `upgrades {click:6,cursor:3}`, `prestigeMult 2.5` — **no host save code**. (The
  +4 on coins is correct: a few ticks of auto-income at rate 42 ran during the restore.)

### D-4 — Missing-favicon console 404 `[GAME-DATA]`
- **Repro (before):** no favicon link — the `GET /favicon.ico` 404 every seed game hits.
- **Fix:** an inline `data:` SVG favicon (a gold coin) in `index.html`. After-playthrough
  (served-dist + **live** `:3001`): `consoleErrors:0`, `pageErrors:0`.

### Re-verified (NOT defects — the economy holds on a fresh rebuild)
| Check | Repro | Observed |
|---|---|---|
| **Auto-income + prestige scaling** | `probe → auto` | rate 10 for 1s → 10 coins; at `prestigeMult 3` → 30 (`scalesWithPrestige:true`). |
| **Purchases (afford/deduct/scaling)** | `probe → buy` | broke → `upgrade-denied` (`coinsUnchangedWhenBroke`, `powerUnchanged`); buying twice: cost `25 → 30` (`costScalesUp`), `clickPower` rises. |
| **Generator prereq + effect** | `probe → buy` | `cursor` raises `autoRate 0→1`; `factory` (requires `cursor`) raises it `1→9` (`factoryRequiresCursorAndApplies`). |
| **Interval bonus** | `probe → bonus` | a `bonus` event fires after one period; coins +50 (`paysOut:true`). |
| **Big-number safety** | `probe → format` | a 120-frame run at rate 1e6 × mult 1000 stays finite (`coinsAfterBigRun ≈ 2e9`, `finite:true`). |
| **IC-1 prestige scales ALL income** | smoke test | clicks AND auto-income both triple at mult 3 (the canonical fix held through the repin). |

### Filed, not fixed — residual engine/library gap `[NEEDS-NEW-ENGINE-WORK]`
- **Persistence vs. system-seeding RACE (G6).** The library `persistence` system
  restores a saved key only if it is **absent** ("live value wins"), but `currency`
  (and the seed-once economy systems) seed `coins`/`clickPower`/`autoRate`
  **synchronously on tick 1**, while `persistence` issues an **async** `storage.get`
  that resolves a microtask later — so on a scene where those systems run, the save is
  clobbered before it loads (verified: a naive reboot showed `coins:0` instead of the
  saved value). **Game-side workaround (no engine change):** run `persistence` on the
  **title** scene (which seeds none of the economy keys), let the async restore land
  during the title dwell, then carry the restored keys into `play` via the title's
  `flow.persist`. By the time `play` loads, `coins` is present, so `currency` skips its
  seed. Extends [`../games/LIBRARY-GAPS.md`](../games/LIBRARY-GAPS.md) **#6** with the
  recipe + the two clean engine fixes (hydrate-before-first-tick, or a restore-wins
  mode). **Not fixed here** (SDK/library out of scope this session). The trio +
  `prestige` are also logged there as promotion candidates.

---

## Step 3 — Fix, rebuild, republish, re-verify

### What 0.2.0 primitive replaced what custom/host code

| Custom/host code (before) | 0.2.0 primitive (after) | Deleted |
|---|---|---|
| `src/host/shell.ts` — `GameShell` screen-state machine + its own loop + HTML `#menu`/pause chrome | `title/play.json` scenes + a `tap-emit` `flow.on` edge + `game.start()` | **305 lines** (file removed) |
| host `canvas.addEventListener("pointerdown", … world.state.clicks++)` (`main.ts:85-90`) | `click-to-earn` reads `input.justReleased()` + `entityAt(targetTag)` (G2) | host click listener |
| host save/load/autosave: `storage.get` up front + `snapshot`/`save` + `setInterval` + `visibilitychange`/`pagehide` (`main.ts:47-82`) | `manifest.persist` + the library `persistence` system (G6) | host storage lifecycle |
| host prestige economics: bank + multiplier + reset in the `prestige-btn` listener (`main.ts:135-148`) | a small data `prestige` system (request-flag driven, like `upgrade-tree`) | host prestige math |
| host `onEnterPlay` seed + `beforeFrame` HUD hook (shell callbacks) | scene `flow` + `flow.persist` + a thin `requestAnimationFrame` HUD mirror | shell callbacks |
| inline upgrade buy already on `upgrade-tree` (G5) | unchanged — already the right primitive (afford→deduct→effect) | — |

**Net for `games/idle-clicker`:** host **TypeScript** dropped from **636 → 377 lines**
(`shell.ts` 305 → 0; `main.ts` 217 → 209, now only the HTML shop-bar wiring, HUD
mirrors, screen-FX juice, and the tiny offline shim; `custom-behaviors` 90 → 144,
absorbing the data `click-to-earn` edge-reader + the new `prestige` system; `storage.ts`
unchanged). The legacy `main.json` (61 lines) became `title.json` (47) + `play.json`
(94) of declarative scene JSON. The validated game = data + library systems
(`currency`, `upgrade-tree`, `persistence`, `tap-emit`, `sprite-animate`) + **four**
custom economy systems (`click-to-earn`, `auto-income`, `interval-bonus`, `prestige`),
all logged as generalization candidates (#6) — the action library doesn't cover the
idle loop.

### The minimized offline-credit shim (OQ-4 — OUT of 0.2.0 scope)

Computing earnings-while-away needs a saved wall-clock timestamp + a game-specific
credit formula — **not** a generic engine primitive. G6 handles the **value**
round-trip (incl. `lastSeen`); the shim (`main.ts`, `applyOfflineCredit` + a `lastSeen`
heartbeat, ~30 commented lines) does only the two things G6 can't:

```
on resume:  saved = world.storage.get("idle-clicker")            // the SDK bridge
            elapsed = min((now - saved.lastSeen)/1000, offlineCapSeconds)
            gain    = floor(saved.autoRate * elapsed * saved.prestigeMult)
            // applied once, after the persistence restore lands:
            world.state.coins += gain; world.state.hint = "Welcome back! +N…"
each frame: world.state.lastSeen = Date.now()                    // started AFTER the read
```

No generic primitive was built; the feature was not dropped. It sits entirely on top of
G6's value persistence, talks only to `world.storage`, and the formula/cap are `$cfg`.

### Gates (all green)

```
gitcade validate games/idle-clicker  → ✓ PASS — publishable, smoke boot ran 60 frames
npm run build  --workspace gitcade-idle-clicker  → dist/assets/index-C34Ybbn4.js (clean)
npm test       --workspace gitcade-idle-clicker  → 5 passed (title→play + tap-earn on the
                                                   click edge; upgrade-tree buy deduct+effect;
                                                   prestige bank/bump/reset; IC-1 prestige
                                                   scales click AND auto income; G6 reload
                                                   restores coins/upgrades/prestige)
```

### Republished to MinIO `idle-clicker/main/`

[`harness/idle-clicker/republish.mts`](./harness/idle-clicker/republish.mts) (reusing
the build worker's S3 client, honoring `S3_FORCE_PATH_STYLE`) cleared the stale prefix
and uploaded the fresh dist: `{ deletedStale: 30, uploaded: 30, objectsNow: 30 }`. The
artifact server was started **ephemerally** for the live check and **stopped**
afterwards (`:3001` was free — the user had NOT bound it — and is left free; no server
orphaned; the user's `:3000` platform is untouched). The **live** artifact confirms the
fix is deployed:
- `:3001/artifacts/idle-clicker/main/index.html` references the new bundle
  `index-C34Ybbn4.js` (matches the local build);
- `grep "GameShell|showGameOver|showTitle"` in the served JS = **0**;
- `grep "start-pressed|prestigeRequest|coin-button|Welcome back"` in the served JS =
  present (flow + prestige + click target + offline shim are deployed);
- live puppeteer drive ([`after-live-play.json`](./harness/idle-clicker/after-live-play.json)):
  tap-earn 12, buy deducts + raises power/rate, auto-income ticks, prestige 1→1.25,
  offline +30,000, **0 console / 0 page errors**.

### Re-verified by playing (after)

| What the DoD asks | Evidence |
|---|---|
| **click-to-earn is data-driven** | `after.json → click.method:"tap-edge"` (real `justReleased()` edge on the `coin-button` pick); browser `clickEarn.earnedByTapping:true` (12 taps → 12 coins) with the host listener gone (`grep` in served JS). |
| **purchases route through the transaction/upgrade primitive** | `after.json → buy`: `upgrade-tree` denies when broke, deducts + scales cost `25→30`, raises `clickPower`, and `factory` requires `cursor`; browser `buy.deducted:true`, `autoRate 0→1`, `clickPower 1→2`. |
| **values persist across reload** | `after.json → persistence`: a reboot with shared storage restores coins/clickPower/autoRate/upgrades/prestigeMult; smoke test G6 case asserts `coins 9999`, `prestigeMult 1.5`, `upgrades.click 4` after reload. |
| **offline credit works via a minimized shim** | `after.json → offline`: `lastSeenRestoredByPersistence:true`, `formulaCreditForThisGap:12000`; browser/live `offline.offlineGain:30000`, `creditApplied:true`, hint `"Welcome back! +30,000 coins while away"`. |
| **prestige works** | `after.json → prestige`: `prestigeFired`, `multBefore 1 → 1.25`, `coinsResetToZero`, `upgradesResetToEmpty`; browser confirms the same. |
| **auto-income ticks** | browser `autoIncome.tickedWhileIdle:true` (coins climb with no interaction). |
| **GameShell removed** | `src/host/shell.ts` deleted; served JS `grep GameShell/showTitle/showGameOver = 0`; the title/play screens are **canvas** scenes via `window.__game`. |
| **no console errors / touch** | browser + live: `consoleErrors:0, pageErrors:0` (favicon 404 fixed); the coin/shop are pointer-native — pointer taps drive the whole run with no host touch glue. |

**Before vs after, same lens:** the economy is identical (click, auto, buy, bonus,
prestige math, big-number safety) — the change is architectural + the click/save/
prestige/flow are now data. [`shots/after-00-title.png`](./harness/idle-clicker/shots/after-00-title.png)
= data-driven canvas title; [`after-02-clicked.png`](./harness/idle-clicker/shots/after-02-clicked.png)
= coins earned by tapping the coin (no host listener); [`after-05-offline-credit.png`](./harness/idle-clicker/shots/after-05-offline-credit.png)
= the "Welcome back! +30,000" the minimized shim produces on resume.

---

## What the next game (Tower Defense, #6 — the heaviest, last) inherits

- **The local loop on 0.2.0 without an npm publish** (proven a fifth time): repin
  `game.json` + `package.json`, symlink `node_modules/@gitcade/{sdk,library}` → the
  workspace packages (Idle Clicker had **none** — create them, or the validator fails
  loudly), `gitcade validate` resolves the catalog.
- **The full 0.2.0 primitive set is now battle-tested across five games.** TD needs
  **all** of them: **G2** click-place (the same `input.justReleased()` + `world.entityAt`
  edge Idle Clicker now uses for the coin — reuse the pick-on-tap pattern), **G3**
  tilemap road (`world.isBuildable` / `tileAt`, and the renderer now draws the tilemap),
  **G4** grid-snap (`snapToGrid` / `randomFreeCell`), **G5** buy (the `transaction`
  buy-and-place system — Idle Clicker validated the request-flag economy shape via
  `upgrade-tree`; TD's `transaction` is its place-a-thing sibling), and **G1** flow
  (`tap-emit` + `flow.on` + the real `game.start()` loop — never a host loop, or the
  click edge never clears).
- **G6 persistence has a real seeding RACE** (now documented, #6): the `persistence`
  system loads **async** and only restores **absent** keys, but systems seed
  synchronously on tick 1. If TD persists anything a system seeds (e.g. a high score a
  `score` system seeds), use Idle Clicker's **title-load-then-`flow.persist`-carry**
  recipe — restore on a scene that doesn't seed the key, then carry it forward. Keys no
  system seeds (Survival Arena's `best`) don't hit it.
- **Offline/elapsed-time and any other host-specific mechanic stays a small commented
  shim** on top of the data primitives — don't reach for an engine change (OQ-4
  precedent). Keep it through `world.storage`, balance in `$cfg`.
- **Reusable harnesses:** [`harness/idle-clicker/probe.mts`](./harness/idle-clicker/probe.mts)
  (headless, scene-set-adaptive, injects the real click edge),
  [`harness/idle-clicker/play.mjs`](./harness/idle-clicker/play.mjs) (browser; serves a
  dist OR drives a live `:3001` URL — pass the base as argv[4]; drives pointer taps +
  shop buttons + the offline shim), and
  [`harness/idle-clicker/republish.mts`](./harness/idle-clicker/republish.mts) (the
  upload path) fork cleanly per game.
