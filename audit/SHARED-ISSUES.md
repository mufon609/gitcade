# SHARED-ISSUES.md — cross-game issues found in the pre-publish tightening pass

**Date:** 2026-06-15 · **Scope:** issues shared across ≥2 of the six games, living
in `packages/sdk`, `packages/library`, the per-game `src/main.ts` host glue, or
`platform/web`. Found by a five-dimension parallel audit (input/focus, loop/lifecycle,
rendering, audio/persistence, config/data) triggered by the "Space scrolls the page
instead of playing" report.

**Method:** code-grounded reading of the shared runtime + all six games, plus a real
headless-Chrome (CDP, trusted input) check of the input/scroll path. The validator
(`gitcade validate`) passes on all six — every issue here is a runtime/UX defect the
validator does not catch.

This doc is the **backlog**. Batch 1 (the playability cluster that fixed the reported
bug) is already implemented; it is summarized below for context, then Batch 2 and
Batch 3 are the open work.

---

## Batch 1 — DONE (playability), for context

Implemented + verified this pass (SDK 57/57, library 92/92, four games build +
validate, platform typechecks, CDP scroll check green):

- **Reported bug, layer 1 — iframe never focused** → keyboard went to the parent
  page and scrolled it. Fixed in `platform/web/src/components/PlayPane.tsx` (focus the
  iframe `onLoad`/`onMouseEnter`, `preventScroll`).
- **Reported bug, layer 2 — no `preventDefault`** on scroll keys. Fixed in
  `packages/sdk/src/runtime/input.ts` (Space/arrows/PageUp-Down/Home/End, modifier-safe).
- **Stuck keys on blur** — `input.ts` now clears the held set on `blur`.
- **Tab-return catch-up burst** — `game.ts` now auto-pauses on `visibilitychange`.
- **Held-key-safe pause + music-on-pause** — new `Game.pause()/resume()/isPaused()`;
  the four pausable games switched off `stop()/start()` and mute audio while paused.

> **Version note:** the SDK working tree is at `0.2.2`. Batch 1 added new public
> methods (`pause/resume/isPaused`) — additive (breaks no pinned consumer) but arguably
> a `0.3.0` minor. The number is a decision for the gated publish/repin step, which
> also covers the six standalone game repos and the `@gitcade/library` dep range.

---

## Batch 2 — quality (recommended next)

### 2.1 No `devicePixelRatio` handling — blurry render on every HiDPI screen — HIGH — ✅ DONE
- **Where:** `packages/sdk/src/runtime/game.ts` (canvas backing store was set to the
  scene size: `canvas.width = scene.size.width; canvas.height = scene.size.height`) + all
  six `games/*/index.html` (`#game { width:100% }` CSS-scales the buffer up to fill
  `#stage`).
- **Why real:** the backing store was never multiplied by `window.devicePixelRatio`, so
  on any 2×/3× display the browser upsampled an 800×600 bitmap — every shape and all
  on-canvas text (16–64px monospace) rendered soft. Biggest single visual-quality hit.
- **Affected:** all six.
- **Fixed:** `game.ts` now sizes the backing store to `scene.size * devicePixelRatio` and
  applies `ctx.scale(dpr, dpr)` once (after the `canvas.width` assignment, which resets the
  transform). The world stays in LOGICAL coordinates; CSS display size is left to the page,
  so layout and the rect-based pointer→world mapping are unchanged. *Verified* in headless
  Chrome with `--force-device-scale-factor=2`: backing store became 400 (= 200×2), context
  transform = 2, and rendered text measured **2.73× the gradient energy** (i.e. sharper
  edges) vs the old logical-size backing. SDK 57/57, all six rebuild + validate.
- **Contract note:** this changes how the SDK drives the canvas/context. It alters no
  schema/type/signature/message/header and the headless (`canvas: null`) path is untouched,
  so it's contract-safe — but it IS a visible render-behavior change to every pinned game,
  so ship it as a deliberate version bump, not a silent patch.

### 2.2 `image-rendering: pixelated` — NO ACTION (audit premise was wrong)
- **Where:** all six `games/*/index.html` `#game` rule.
- **Correction:** the original finding assumed the sprites were all `shape`/`text`. They
  are not — the games render `image` (×7) and `sheet` (×5) **pixel-art** sprites
  (helicopter, snake, idle-clicker, tower-defense, survival-arena). For pixel-art,
  `image-rendering: pixelated` is the *correct* choice; removing it would blur those
  sprites.
- **Why moot now:** the blurry culprits were the vector shapes + text, which 2.1 already
  fixed by rendering at device resolution. Post-2.1 the canvas backing store ≈ the display
  size (`#stage` is capped at the logical 800px wide), so the CSS `image-rendering` rule
  has negligible effect on the overall canvas anyway.
- **Decision:** leave `image-rendering: pixelated` as-is.

### 2.3 Pointer never released off-canvas (no `setPointerCapture`) — MED — ✅ DONE
- **Where:** `packages/sdk/src/runtime/input.ts` pointer block — listened for
  `pointerdown/move/up/cancel` on the canvas but had no `setPointerCapture`. A pointer
  that went down on the canvas and released *off* it never delivered `pointerup` to the
  canvas, so it stayed in `this.pointers` with `down:true`.
- **Why real (concrete):** survival-arena `move-topdown-360` with `pointerFollow:true`
  — the player auto-walked toward the last drag point forever.
- **Affected:** survival-arena (only `pointerFollow` consumer); any tap/click-edge
  consumer expecting a release.
- **Fixed:** `onPDown` now calls `pointerTarget.setPointerCapture?.(e.pointerId)` (guarded
  in try/catch — the method is optional and can throw if the pointer is already gone), so
  the canvas keeps receiving that pointer's move/up events off-element and the release
  clears the held pointer. Contract-safe (optional method on the pointer target;
  headless/test path unaffected). *Verified* in headless Chrome: press inside the canvas →
  1 held, drag far off-canvas → still 1 (capture tracking), release off-canvas → 0 (no
  stuck pointer). SDK 58/58, all six rebuild + validate.

### 2.4 Screen-shake reveals page background + desyncs the FX overlay — MED — ✅ DONE
- **Where:** `packages/library/src/fx/screen-effects.ts` (`attachScreenEffects` applied
  `transform: translate(...)` to the canvas only) + all six `games/*/index.html` (`#stage`
  had **no `overflow:hidden`** and no background; `#fx-overlay` is an untransformed sibling).
- **Why real:** during a shake the canvas translated up to ±12px past `#stage`, flashing
  the body background `#07060c` at the edges; and the flash/fade overlay did **not** get
  the transform, so a full-screen flash visibly detached from the shaking play-field.
- **Affected:** all six (all call `fx.shake`).
- **Fixed (two parts):**
  1. **Library** — `attachScreenEffects` now applies the same `translate` to the overlay
     as the canvas, so flash/fade stays locked to the play-field (one change, all games,
     no per-game churn). Unit-tested (stubbed rAF clock asserts `overlay.transform ===
     canvas.transform`, non-zero).
  2. **Per-game CSS** — `#stage` gains `overflow: hidden` (clips the canvas overhang) and
     `background: #0b0b16` (matches the canvas, so the thin gap a shake exposes blends in
     instead of flashing the near-black body color). Low-risk: no zoom/crop, pointer→world
     mapping untouched.
- **Note (not the chosen fix):** fully eliminating the residual ≤12px gap would need
  overscanning the canvas (scale/inset), which crops edge content and shifts the pointer
  view — rejected as worse than the thin, now-color-matched gap. *Verified* in a built
  artifact: computed `#stage` = `overflow:hidden`, `rgb(11,11,22)`, with `#game`/`#fx-overlay`
  siblings under it. Library 93/93, all six rebuild + validate.

### 2.5 Touch-pad parity gaps + duplicated `synthKey` glue — MED — ✅ DONE (mostly a false alarm)
- **Where:** `games/survival-arena/index.html` had **no `#touch` element**;
  `games/tower-defense/index.html` shipped an **empty `#touch` div** with dead
  `#touch{display:none}` CSS. Three games hand-roll a `synthKey()` DOM shim in `main.ts`.
- **Investigation outcome — the "gap" was mostly wrong.** The six games split into **two
  intentional, correct control paradigms**, not an inconsistency:
  1. **Keyboard games with an on-screen pad** — helicopter (Space button), snake (4-way
     d-pad), breakout (left/right). These read keys, so they synthesize them from a
     `#touch` pad shown via `@media (pointer: coarse)`. Correct.
  2. **Pointer-native games** — idle-clicker (tap the canvas), tower-defense (tap to place
     + HTML upgrade bar), survival-arena (`pointerFollow` drag-to-move + a `shoot` part
     with `aimTag:"enemy"`, i.e. auto-aim/auto-fire). These work on touch with no
     synthetic pad. survival-arena's title even documents "drag toward where you want to
     go." Correct — no pad needed.
- **Fixed:** removed tower-defense's **dead `#touch` scaffolding** (the empty div + the
  `#touch{display:none}` CSS rule) — it was never populated or referenced in JS. All six
  rebuild + validate.
- **Deferred (noted non-issue):** the `synthKey` shim is duplicated across the three
  keyboard games, but each builds a *different* pad (1 button / 4-way / 2-way), so only the
  ~6-line helper is common. Consolidating it would require a shared module in
  `@gitcade/library` (separate consumers) — i.e. adopting the library's currently-unused
  `touch-dpad`/`touch-button` behaviors (`packages/library/src/ui/touch.ts`). That's a
  refactor touching the frozen library contract and exercising untested-in-practice code,
  with low payoff — out of scope for a polish pass. Left as-is.

---

## Batch 3 — data / polish

### 3.1 No machine-readable `controls` metadata — platform can't show "Press Space" — MED
- **Where:** `packages/sdk/src/schema/manifest.ts` (`GameManifestSchema` has no
  `controls` field); all six `games/*/game.json`. Controls live only as prose inside the
  title scene.
- **Why real:** the marketplace/game-card/detail page has no programmatic way to render
  a control hint — directly relevant to the reported "how do I play this" confusion.
- **Affected:** all six.
- **Fix direction:** add an optional `controls` field to the manifest schema (e.g.
  `[{ input: "Space", action: "Rise" }]`) — **additive, MINOR SDK bump** — and populate
  each `game.json`.

### 3.2 idle-clicker offline-credit races the bridge restore → coins silently lost — MED — ✅ DONE
- **Where:** `games/idle-clicker/src/main.ts` — `applyOfflineCredit` ran at module load
  (during the *title* scene, before play's persistence even exists), did its own second
  `storage.get`, and applied the gain on a fixed `setTimeout(credit, 60)`, while
  `packages/library/src/systems/persistence.ts` restores `coins` authoritatively when its
  async `storage.get` resolves.
- **Why real:** in production the restore is a postMessage round-trip; whenever it landed
  after 60 ms it overwrote `coins`, silently DROPPING the credited earnings. Only this
  game corrupts user-visible state.
- **Affected:** idle-clicker.
- **Fixed:** the credit now piggybacks on the restore instead of racing it. It stays
  host-side (it needs `Date.now()`, which must not enter the deterministic sim), driven
  from the existing `mirror()` loop. `coins` is a claimed persist key, so it waits until
  `world.isPersistPending("coins")` has been observed pending (claim placed) and then
  resolved (restore landed), then adds the away-gain on TOP of the restored `coins` —
  reading the restored `autoRate`/`prestigeMult`/`lastSeen` straight from `world.state`
  (the second `storage.get` is gone too). *Verified* with two new library integration
  tests against the REAL persistence system: a late restore now yields `500 + 36000`
  (nothing lost), and the old early-apply path is shown clobbering back to `500`. Library
  95/95, idle-clicker builds + validates.
- **Bonus:** fixed a pre-existing `tsc` error (3→0) in idle-clicker AND tower-defense —
  both passed `attachScreenEffects` a raw `getElementById` where the other four games cast
  it to the library's structural overlay type; now consistent.

### 3.3 snake hardcodes `tileSize: 20` — the one balance number a vote can't touch — MED — ✅ DONE
- **Where:** `games/snake/src/scenes/play.json` (`tileSize: 20` as a param 4×);
  `games/snake/config.json` had no `tileSize`.
- **Why real:** in snake `tileSize` IS the load-bearing balance number (movement
  granularity, food grid, self-collision cells), yet it was the one snake tunable a
  governance vote couldn't touch.
- **Fixed:** added `tileSize: 20` to `games/snake/config.json` and replaced the 4
  `tileSize` PARAMS (`move-grid-step`, `snake-guard`, `place-on-free-cell`, `snake-body`)
  with `$cfg.tileSize`. These flow through `resolveParams` (deep-resolves `$cfg`,
  including nested prototypes). Builds + validates (the smoke boot resolves `$cfg`, so a
  bad ref would fail the gate).
- **Left literal (deliberate):** the entity *render* `size: {w:20,h:20}` (head/food/
  segment sprite dimensions). Top-level entity `size` is read by `buildEntity` directly
  and does NOT resolve `$cfg` (only system/behavior params do), so these can't reference
  `$cfg` without an SDK change. They stay at the default 20 and match `tileSize`'s default;
  a vote to a very different `tileSize` changes the gameplay grid but not sprite size (a
  cosmetic gap) — acceptable vs. a frozen-contract SDK change.
- **tower-defense — NO action (the audit was wrong to lump it in):** its `tileSize: 40`
  is **structural**, not a balance lever. Line 7 is `tilemap.tileSize` (the fixed 20×15
  map with a hardcoded `tiles` array), and the `tower-build` param must MATCH it for
  placement to align with the map. Externalizing one without the other would desync
  placement from the map — worse than leaving it. snake differs: it has no tilemap, so
  its grid is a free parameter. Left hardcoded.

### 3.4 No mute / volume control surfaced from config — LOW — ✅ DONE
- **Where:** `packages/library/src/audio/library-audio-player.ts` has
  `setMuted`/`setVolume`, but no game called them and no `config.json` exposed a volume/
  mute key; master volume was hardcoded `0.6`.
- **Fixed (all six):**
  - **Config-driven volume** — each `config.json` gained `"volume": 0.6`, and each game now
    calls `audio.setVolume($cfg.volume)` so the level is data (governance-tunable).
  - **Mute toggle** — a top-left 🔊/🔇 button (plus the **M** key) in every game. Audio
    state is centralized in one `syncAudio()` per game: `off = userMuted || game.isPaused()
    || document.hidden`. Using the SDK's `game.isPaused()` (Batch 1) means manual pause,
    the tab-hide auto-pause, and the mute button can't fight over the gain — and it
    collapses the Batch-1 per-game pause/visibility audio blocks into one source of truth.
- **Verified:** all six typecheck + build + validate; a browser check confirmed the mute
  button and M key toggle the icon 🔊→🔇→🔊 in a built artifact.

### 3.5 Misc / dead surface — LOW
- **Stale `Input.axis()` doc** (`input.ts`) — ✅ DONE. The JSDoc promised touch-zone
  folding (`negZone`/`posZone`) the implementation never had. Corrected to state it's
  keyboard-only and that touch goes through synthesized key events. Doc-only.
- **`gamepad` permission, no handler** — ACCEPTED as-is. `PlayPane.tsx` sets
  `allow="autoplay; gamepad"` but nothing uses the Gamepad API. It's an invisible iframe
  capability (no user-facing effect) and harmless forward-compat; removing it buys nothing.
  Left.
- **Pause absent in two games** — ✅ DONE (tower-defense). Added a pause button +
  P/Esc handler to tower-defense using the Batch-1 `pause()/resume()` glue (held input
  survives the pause; music mutes via `syncAudio`). idle-clicker intentionally stays
  without pause (an idle game keeps accruing by design).
- **Config coverage is uneven** — PARTLY ADDRESSED. snake gained `tileSize` (3.3). The
  remaining thin spots (snake start-direction vector, helicopter gap-height geometry) are
  structural entity fields that don't resolve `$cfg` without an SDK change; left as-is.

---

## Verified clean (don't re-chase)

- Pointer→world mapping stays correct under CSS scaling (`toWorld()` re-reads the live
  rect per event).
- No game touches raw `localStorage`/`sessionStorage`/`indexedDB` — all persistence
  flows through the bridge (validator-enforced); safe in the opaque-origin sandbox.
- Autoplay policy is handled: all six call `audio.resume()` from a user-gesture handler.
- Bridge handshake identity model, nonce/session correlation, and JSON-parse safety are
  sound; boot-load failure degrades gracefully.
- No spiral-of-death (the `MAX_FRAME_SECONDS` clamp bounds it); determinism intact
  (`update()` reads only `dt` + `world.rng`); scene/flow teardown leaks no listeners.
- All six pass `gitcade validate`; version pins are consistent (all `0.2.1` pre-bump);
  part refs all resolve.
