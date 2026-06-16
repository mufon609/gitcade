# Audit Summary — tower-defense (0.3.0 engine)

**Counts:** 7 applied (localized) · 3 queued (engine-root) · 5 deferred (depth).
No commit, no push, no MinIO republish — working tree only, awaiting PM review.

---

## Review

The game's *logic* was sound (placement, economy, wave/win derivation, pause, mute,
persistence wiring all worked), but its *presentation* was the problem the user
named. Towers were drawn with `enemy-shooter.png` — a purple monster face with eyes
— while creeps were tiny orange blobs, so the player's turrets read as enemies and
the enemies barely read at all (no friend/foe legibility). Every tower placement
fired a **full-screen green flash** (the reported headline), and every denied mis-tap
a full-screen orange flash — routine high-frequency actions abusing a screen-wide
effect. The HUD collided with itself ("Gold…" ran under the mute button; "Wave 1/10"
overlapped "Leaked 0/15"), and the build-hint line was rendered *behind* the HTML
upgrade bar, so it was never visible. There was no way to see a tower's range or
whether a cell was buildable before committing. And the title/over "Tap anywhere to
start" overlay was mis-authored (`position:{400,300}` with top-left semantics → it
covered only the off-screen bottom-right, and sat *below* the instruction text in
layer order) so most taps did nothing — only the keyboard Space/Enter reliably
started a run.

After this pass: blue square turrets vs red circle creeps read instantly; placement
gives a **local** green sparkle at the cell (no screen flash); a denied build gives a
**local** red ring + cell + puff; a live **range ring + cell preview** follows the
desktop cursor and turns green/red by buildability + affordability *before* you
click; the HUD is collision-free and the build hint is visible; and "tap anywhere"
genuinely works on title and over. Pause overlay, mute gate, `persist:{bestWave}`,
controls metadata, and sharp pointer input were confirmed working and left as-is.
All balance stays 100% in `config.json` — no new balance keys were added; the new FX
and the preview are presentation/structural only.

## Actions taken (localized fixes applied)

- **`src/main.ts`** — Removed the two routine full-screen `ScreenEffects.flash`
  binds (`tower-placed` green, `build-denied` orange) from `fx.bindToEvents`; kept
  only screen-wide/low-frequency effects (`creep-leaked` brief red vignette,
  `gameover` shake, and the tiny 3px `creep-killed` shake that punches the local
  death burst). Added a **desktop hover bridge**: a `pointermove`/`pointerleave`
  listener on the canvas writes the cursor's world-space position to
  `world.state.buildHover` during play (the SDK `Input` tracks pressed pointers for
  the click edge, not a button-less hover), feeding the new `build-preview` system.
- **`src/scenes/play.json`** —
  - Tower sprite → `shape rect #3b5dc9 / stroke #41a6f6` (blue structure); creep
    sprite → `shape circle #b13e53 / stroke #ffcd75` (red creature); bullet →
    `shape circle #ffcd75` (yellow tracer). No image assets needed; clean friend/foe.
  - HUD de-collided: `hud-gold` x 12→56 (clears the mute button); `hud-leak` x
    568→744 (clears "Wave" and the pause button); `hud-buildhint` y 566→40 (was
    occluded by the HTML upgrade bar; now a visible top subtitle).
  - Added two preview entities (`build-range-preview` circle, `build-cell-preview`
    rect, layer 2, parked off-screen) driven by the new system.
  - Added data FX systems: `sparkle@1.0.0` on `tower-placed` (green local pop),
    `explosion@1.0.0` on `build-denied` (small red puff, `size:3`), and the
    `build-preview` system (params: `tileSize`, `rangeKey`, `currencyKey`,
    `towerCost:$cfg.towerCost`, `towerTag`, `hoverKey`, `ringTag`, `cellTag`).
- **`src/custom-behaviors/index.ts`** — Added the `buildPreview` SystemFn and
  registered it. It reads `world.state[hoverKey]`, snaps to the grid, and positions
  the range ring + cell highlight, recoloring green (buildable tile, cell free, gold
  ≥ cost) vs red, sized to the live `towerRange` (so range upgrades grow it). Owns no
  game state; idle/off-screen on touch and headless.
- **`src/scenes/title.json` / `src/scenes/over.json`** — Fixed the tap target:
  `position` {400,300}→{0,0} and `layer` 1→999, matching the convention the other
  four games already use (breakout/helicopter/snake/survival-arena), so "tap
  anywhere" truly covers the screen and is the topmost pick.

## Decisions made

- **Kept `creep-leaked` as a brief full-screen flash.** A creep leak is a
  low-frequency, screen-wide "you lost a life" event — the legitimate use of
  `flash`, not the routine-action anti-pattern. Judged appropriate in-browser.
- **Shapes over the existing PNGs.** The library art that's synced in is mismatched
  (enemy sprites) and `public/assets` is wiped+recopied from `@gitcade/library` on
  every build (`sync-assets.mjs`), so a custom game-local PNG can't persist. Palette
  shapes give clean, asset-free, scale-crisp friend/foe and are the "intentional
  shapes" the brief calls for.
- **Did NOT improve the lane/buildable tilemap art beyond actor legibility.** The
  library tilesets are 16px and incompatible with this 40px map, and the renderer's
  no-tileset fallback uses a fixed drab palette with no gridlines — neither fixable
  inside the game. Logged as engine-root (td-09/td-10). The bright actors + range
  preview carry playfield legibility for now.
- **Hover preview instead of persistent per-tower rings.** A single cursor-following
  ring answers "what range/cost before I commit?" (the brief's priority) with zero
  clutter; N persistent rings would stack into noise. Range is a global upgrade here,
  so one ring sized to `towerRange` is always accurate.
- **No `config.json` changes.** FX use string color arrays + defaults (+ the
  whitelisted `size`), and the preview references `$cfg.towerCost`; nothing new is a
  balance number, so the 35-key governance config is untouched (no magic-number
  violations — `validate` exit 0).
- **No MinIO republish.** Verified against the real built `/dist` in headless Chrome
  (the exact bundle the worker uploads), so the live platform stays on the reviewed
  0.3.0 bundle until the human commits. Republish is available
  (`node audit/harness/republish.mjs tower-defense`) if the PM wants it live.
- **Confirmed, not rebuilt:** pause overlay (freezes sim mid-wave), mute gate (M +
  button + visibility/pause gating), `persist:{bestWave}` + `persistence` + flow
  persist, `controls` metadata, sharp pointer placement. Persistence survives reload
  only under the GitCade bridge host; standalone uses `MemoryStorage` by design.

## Findings (machine-readable)

```
- id: td-01
  title: Full-screen green flash on every tower placement (the reported headline)
  area: fx-juice
  symptom: Whole screen flashes palette-green on every build — a routine, high-frequency action
  rootCause: main.ts bound "tower-placed" → ScreenEffects.flash("#a7f070",0.08)
  category: localized
  contractImpact: n/a
  proposedFix: Drop the flash; emit a LOCAL green sparkle at the placed cell via a data sparkle@1.0.0 system bound to tower-placed (event carries {x,y})
  filesTouched: [games/tower-defense/src/main.ts, games/tower-defense/src/scenes/play.json]
  otherGamesLikelyAffected: []
  status: applied
  verified: real-browser (after-7-place-sparkle.png — local pop, no screen flash); tests 7/7; validate exit 0

- id: td-02
  title: Full-screen orange flash on routine denied build (mis-tap)
  area: fx-juice
  symptom: Whole screen flashes orange when a tap can't build (road / occupied / too poor)
  rootCause: main.ts bound "build-denied" → ScreenEffects.flash("#ef7d57",0.14)
  category: localized
  contractImpact: n/a
  proposedFix: Drop the flash; LOCAL feedback at the cell — red explosion@1.0.0 puff (size:3) on build-denied PLUS the red build-preview ring/cell already at the cursor
  filesTouched: [games/tower-defense/src/main.ts, games/tower-defense/src/scenes/play.json]
  otherGamesLikelyAffected: []
  status: applied
  verified: real-browser (after-4-denied.png — red ring+cell+puff at the road cell, no flash)

- id: td-03
  title: Friend/foe confusion — towers drawn as enemy sprites
  area: layering-ui
  symptom: Towers were a purple monster face with eyes (enemy-shooter.png); creeps tiny orange blobs — turrets read as enemies
  rootCause: prototype sprites used mismatched library enemy PNGs
  category: localized
  contractImpact: n/a
  proposedFix: Palette shapes — tower blue rect (structure), creep red circle (creature), bullet yellow circle (tracer); asset-free, scale-crisp
  filesTouched: [games/tower-defense/src/scenes/play.json]
  otherGamesLikelyAffected: []
  status: applied
  verified: real-browser (after-2-built.png, after-3-combat.png — instant friend/foe read)

- id: td-04
  title: HUD self-collision (gold under mute button; wave overlaps leak)
  area: layering-ui
  symptom: "Gold…" ran under the top-left mute button; "Wave 1/10" overlapped "Leaked 0/15" mid-screen
  rootCause: hud-gold x=12 (mute button spans 8–48); hud-leak right-aligned at x=568 collided with centered wave text
  category: localized
  contractImpact: n/a
  proposedFix: hud-gold x→56; hud-leak x→744 (clears wave and the pause button)
  filesTouched: [games/tower-defense/src/scenes/play.json]
  otherGamesLikelyAffected: []
  status: applied
  verified: real-browser (after-2-built.png — three stats clear of each other and the corner buttons)

- id: td-05
  title: Build-hint text rendered behind the upgrade bar (never visible)
  area: layering-ui
  symptom: The "Click open ground to build a turret" hint was invisible
  rootCause: hud-buildhint at y=566 sat under the HTML #tdbar (bottom ~68px of the canvas)
  category: localized
  contractImpact: n/a
  proposedFix: Move the hint to y=40 (visible top subtitle)
  filesTouched: [games/tower-defense/src/scenes/play.json]
  otherGamesLikelyAffected: []
  status: applied
  verified: real-browser (after-2/3/6 — hint visible at top center)

- id: td-06
  title: No placement affordance — range/buildability invisible before committing
  area: capability-gap
  symptom: No way to see a tower's reach or whether a cell is buildable/affordable before clicking
  rootCause: nothing visualized range; SDK Input tracks pressed pointers, not button-less hover
  category: localized
  contractImpact: n/a
  proposedFix: New data build-preview system + two preview entities + a host pointermove→world.state.buildHover bridge; a range ring + cell highlight follow the cursor, green (buildable+free+affordable) vs red, sized to live towerRange
  filesTouched: [games/tower-defense/src/custom-behaviors/index.ts, games/tower-defense/src/scenes/play.json, games/tower-defense/src/main.ts]
  otherGamesLikelyAffected: []
  status: applied
  verified: real-browser (after-6-preview-green.png valid/green; after-4-denied.png blocked/red); tsc clean; validate exit 0

- id: td-07
  title: Title/over "Tap anywhere to start" had large dead zones
  area: input
  symptom: Taps on the title/over TEXT, and on the whole left/top of the screen, did nothing; only Space/Enter reliably started a run
  rootCause: start-target/retry-target used position {400,300} (top-left semantics → covers only the off-screen bottom-right) and layer 1 (BELOW the layer-100 text, which tap-emit's topmost-pick rule lets swallow the tap)
  category: localized
  contractImpact: n/a
  proposedFix: position→{0,0}, layer→999 (the convention breakout/helicopter/snake/survival-arena already use)
  filesTouched: [games/tower-defense/src/scenes/title.json, games/tower-defense/src/scenes/over.json]
  otherGamesLikelyAffected: [idle-clicker]   # NOTE: idle-clicker/title has the IDENTICAL authoring bug (start-target pos {400,300}, layer 1) — a per-game localized fix there too, not an engine root
  status: applied
  verified: real-browser (td-shot2: clicking the "TOWER DEFENSE" heading text now starts the game — startedByTextTap:true)

- id: td-08
  title: Routine-action full-screen flash is a cross-game anti-pattern
  area: fx-juice
  symptom: Multiple games flash the WHOLE screen on routine, high-frequency actions (place tower, eat food, click)
  rootCause: ScreenEffects.flash is the easy reach; there's no first-class "local FX at an event position" idiom, so games over-use the screen-wide effect
  category: engine-root
  contractImpact: none   # additive: an FX convention + a thin localized-FX helper/part (sparkle/explosion already exist and are the fix — promote/ document the pattern)
  proposedFix: Document that screen flash is for screen-wide/low-frequency events only; standardize a "burst-at-event-position" recipe (sparkle/explosion bound to the action event, payload {x,y}) as the routine-feedback idiom
  filesTouched: []
  otherGamesLikelyAffected: [idle-clicker, snake]   # idle-clicker flashes ~#ffcd75 on click; snake flashes ~#ffcd75 on eat; tower-defense did green-on-place (now fixed)
  status: queued-for-synthesis

- id: td-09
  title: Tilemap no-tileset fallback is drab and illegible (no gridlines, fixed muddy palette)
  area: layering-ui
  symptom: A data tilemap with no tileset image renders as flat, near-identical dark fills (buildable #2a2f3a vs lane #3a3030) with no per-cell borders, so the build grid and lane read poorly
  rootCause: Renderer.drawTilemap uses a fixed 6-color TILE_FALLBACK_COLORS and draws solid cells with no borders/tint; tile properties carry no color hook
  category: engine-root
  contractImpact: none   # additive: honor an optional per-tile `color`/tint in tilemap.properties (catchall already allows the key — renderer just needs to read it), and/or draw a subtle cell border for buildable tiles
  proposedFix: Let properties[idx].color override the fallback fill, or render a thin gridline per cell; keeps tilemap the single source of truth while making it legible without a bespoke tileset
  filesTouched: []
  otherGamesLikelyAffected: [snake]   # any game leaning on a tilemap without a matched tileset image
  status: queued-for-synthesis

- id: td-10
  title: Tileset cells aren't scaled to tileSize — 16px library tilesets unusable at 40px
  area: layering-ui
  symptom: The shipped library tilesets are 80x16 (16px tiles); this map uses tileSize 40, so a tileset can't be applied (renderer would blit a 40px region from a 16px-tall sheet) — forcing the drab fallback in td-09
  rootCause: Renderer.drawTilemap blits a tileSize×tileSize source rect from the sheet with NO scaling, assuming sheet tile size == map tileSize
  category: engine-root
  contractImpact: none   # additive: scale each sheet cell to tileSize on blit (drawImage already supports differing src/dst rects), or ship multi-resolution tilesets in @gitcade/library
  proposedFix: Decouple sheet tile size from map tileSize (a `sheetTileSize`/auto-detect + scaled blit), or add 40px tilesets to the library
  filesTouched: []
  otherGamesLikelyAffected: []   # any game wanting tileset art at a non-16px tileSize
  status: queued-for-synthesis

- id: td-11
  title: Multiple tower types (e.g. splash/slow/sniper)
  area: depth
  symptom: One turret archetype; no build choice
  rootCause: single prototype in play.json
  category: localized
  contractImpact: n/a
  proposedFix: Add tower archetypes (config-driven costs/stats) + a build-type selector; defer
  filesTouched: []
  otherGamesLikelyAffected: []
  status: deferred

- id: td-12
  title: Sell / refund a placed tower
  area: depth
  symptom: Placement is irreversible; no economy recovery
  rootCause: tower-build has no sell path
  category: localized
  contractImpact: n/a
  proposedFix: Click-own-tower → refund a config % via the transaction system; defer
  filesTouched: []
  otherGamesLikelyAffected: []
  status: deferred

- id: td-13
  title: Enemy variety (fast / armored / boss)
  area: depth
  symptom: One creep archetype; flat threat curve
  rootCause: single creep prototype in the wave-spawner
  category: localized
  contractImpact: n/a
  proposedFix: Per-wave creep mixes (hp/speed/armor in config); defer
  filesTouched: []
  otherGamesLikelyAffected: []
  status: deferred

- id: td-14
  title: Wave preview / next-wave countdown
  area: depth
  symptom: No telegraph of incoming wave size/timing
  rootCause: no preview UI
  category: localized
  contractImpact: n/a
  proposedFix: HUD readout of next wave + countdown (reads wave-spawner timing); defer
  filesTouched: []
  otherGamesLikelyAffected: []
  status: deferred

- id: td-15
  title: Lives/leak economy tuning (variable leak cost, partial damage)
  area: depth
  symptom: Every leak costs exactly 1 of 15, flat
  rootCause: creep-accounting bumps leaked by 1 unconditionally
  category: localized
  contractImpact: n/a
  proposedFix: Per-creep leak weight / boss multi-leak (config); defer
  filesTouched: []
  otherGamesLikelyAffected: []
  status: deferred
```

## Verification (real output)

```
TESTS (npm --prefix games/tower-defense test):
 ✓ tests/smoke.test.ts (7 tests) 194ms
 Test Files  1 passed (1)
      Tests  7 passed (7)

VALIDATE (npx gitcade validate games/tower-defense):
  tier: ecosystem
  ✓ PASS — publishable, smoke boot ran 60 frames
  exit: 0

TYPECHECK (tsc --noEmit, strict): exit 0
```

Browser (headless Chrome on the built `/dist`, real `main.ts` + chrome, real input):
- before/after-2-built, before/after-3-combat — friend/foe shapes, fixed HUD, no green flash
- after-4-denied — local red ring/cell/puff on a road tap (no screen flash)
- after-5-pause — pause overlay freezes the sim
- after-6-preview-green — green range ring + cell on a valid empty cell
- after-7-place-sparkle — local green sparkle on placement
- td-shot2 — clicking the title heading text now starts the game (startedByTextTap:true)
- page errors / failed requests across all runs: none

Working tree: 5 files changed (custom-behaviors/index.ts, main.ts, scenes/{play,title,over}.json),
+134/−17. No commit, no push, no republish.
