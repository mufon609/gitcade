# Audit Summary — helicopter (0.3.0 engine)

**Counts:** 3 applied (localized) · 2 queued (engine-root) · 4 deferred (depth).
No commit made (per protocol). Republished the changed build to MinIO (`helicopter/main/`, 30 objects); the artifact server at `:3001` now serves it.

---

## Review

Helicopter is mechanically sound — the one-button `thrust-lift`, the data-driven
title→play→over flow, persistence (`best`), mute gate, pause overlay, controls
metadata, and the per-level `scale-by-state` speed ramp all work and verified clean.
The death FX (`shake(16,0.55,34)+flash("#b13e53",0.4)` + the `explosion` particle on
the terminal `crash` event) is proportionate — it fires once, at run end, not on a
routine action — so this game is **clean on the shared full-screen-flash anti-pattern**;
left as-is.

Two real problems showed up in-browser. (1) **The score HUD overlapped the mute
button** — `hud-score` sat at canvas x:12, directly behind the 40px `🔊` DOM button
pinned at top-left, so the leading digits were unreadable. (2) **The playfield was
dead-flat black** — for an auto-scroller, the only motion cue was pillars sliding past;
between them the screen was static, killing the sense of speed this genre lives on.

State now: the score HUD is clear of the button and readable; a **seamless scrolling
starfield backdrop** (verified 0.00px wrap gap over a full cycle in the real renderer)
gives constant motion and parallax depth (stars drift at ~0.3× pillar speed). Build,
5/5 tests, and `gitcade validate` (exit 0) all pass; no console/page errors across
every browser run.

---

## Actions taken (localized fixes applied)

1. **Scrolling starfield backdrop (sense-of-speed / depth).**
   `games/helicopter/src/scenes/play.json` — added two full-field `image` entities
   (`bg-stars-a` at x:0, `bg-stars-b` at x:800 = world width), `tags:["decor"]`,
   `layer:0`, each running the library `auto-scroll`(`wrap:true`) + SDK `velocity`.
   The two tiles laid end-to-end wrap into a seamless infinite loop; they drift slower
   than the pillars so distant stars vs fast foreground pillars read as parallax depth.
   `games/helicopter/config.json` — added `bgScrollVx: -70` (the backdrop speed,
   ≈0.3× `scrollVx`), so the feel stays 100% governance-tunable.
   *Deliberately did NOT use declarative `background.layers`* — the 0.3.0 renderer
   ignores it (engine-root `snake-05`, re-confirmed below); this image-entity pattern
   is snake's working alternative, extended to *scroll* via the existing `auto-scroll`
   part (no engine change needed).

2. **HUD score clear of the corner button (layering fix).**
   `games/helicopter/src/scenes/play.json` — moved `hud-score` from x:12 → **x:60**,
   clearing the 40px `#mute-btn` (pinned `left:8`, spans ~8–48px). Matches breakout's
   audit fix exactly (its `hud-score` is at x:60). The right-side `LVL` HUD already
   cleared the pause button, so it was left untouched.

3. **README accuracy fix (doc matched to code).**
   `games/helicopter/README.md` — the parts table claimed `auto-scroll@1.0.0` "drives
   the pillars," but the code actually uses `scale-by-state` for pillar motion and
   `auto-scroll` was unused. Repointed the `auto-scroll` row to the new scrolling
   backdrop, added a `scale-by-state` row for the pillars (leftward + per-level ramp),
   and documented the `bgScrollVx` knob in the config example.

---

## Decisions made (judgment calls / not-done, with why)

- **Death FX left as-is.** Proportionate for a one-time, run-ending event; consistent
  with survival-arena's death FX (`shake 18/0.6 + flash 0.45`). No routine full-screen
  flash anywhere → clean on the shared anti-pattern.
- **Single scrolling star layer, not two.** True multi-layer parallax from one texture
  (the only coherent backdrop here) would mean two copies of the same 800-wide tile at
  different speeds, which reads as a doubled-image glitch, not depth. The two coherent
  depth planes (slow stars `layer:0` vs fast pillars `layer:3`) already deliver parallax.
- **Rejected the `parallax-far.png` / `parallax-near.png` assets.** They're green/blue
  rolling *hills*, which clash hard with this dark space-cave palette (`#0b0b16` field,
  `#1a1c2c` walls, `#3b5dc9` pillars) and would sap pillar contrast. The starfield is
  the only on-palette backdrop — same choice snake/breakout made (theirs static; mine
  scrolls, which an auto-scroller needs).
- **No inline JSON `comment` key.** I drafted one explaining the backdrop, then removed
  it — no sibling scene uses JSON comments, so it'd break the "match surrounding code"
  convention (and risk a stricter validator). Rationale lives in the README instead.
- **Top/bottom walls left subtle.** `#1a1c2c` on the starfield reads faintly (the walls
  are the only star-less bands). I considered telegraphing the lethal ceiling/floor more,
  but the genre convention (Helicopter/Flappy) is subtle bounds, the *primary* hazard
  (pillars) is highly legible, and the death FX signals contact — so brightening them is
  cosmetic polish not worth the scope/risk this pass. Noted as a minor observation.
- **Pillars kept as flat `#3b5dc9` rects.** They read as clean neon obstacles with strong
  contrast against the starfield; the only candidate sprite (`wall.png`, 16px) would
  stretch to 54×150 and look worse. Intentional-enough art; no change.

---

## Findings (machine-readable)

```
- id: helicopter-01
  title: Playfield is dead-flat black — no sense of speed/depth (auto-scroller)
  area: layering-ui
  symptom: Between pillars the screen is static black; the genre's core "sense of speed" is absent.
  rootCause: play.json had only a flat background color; no backdrop entity, no motion cue.
  category: localized
  contractImpact: n/a
  proposedFix: Added two full-field starfield image entities (x:0 and x:800) at layer 0, each running auto-scroll(wrap:true)+velocity for a seamless infinite loop; speed via new $cfg.bgScrollVx (-70 ≈ 0.3× scrollVx) so stars/pillars read as parallax depth.
  filesTouched: [games/helicopter/src/scenes/play.json, games/helicopter/config.json]
  otherGamesLikelyAffected: n/a
  status: applied
  verified: live probe (bg-stars-a x: -19→-54, bg-stars-b 781→746, vx -70, ~800px spacing maintained); full-cycle wrap probe in real renderer = max uncovered gap 0.00px, wrap observed; screenshots audit/shots/after-2-play.png, after-3-play2.png, after-4-wrap.png; build+5/5 tests+validate exit 0.

- id: helicopter-02
  title: Score HUD overlaps the mute button (unreadable digits)
  area: layering-ui
  symptom: The score number sat behind the 🔊 DOM button at top-left; leading digits obscured.
  rootCause: hud-score positioned at canvas x:12; the #mute-btn DOM control is pinned at left:8 (40px wide, ~8–48px).
  category: localized
  contractImpact: n/a
  proposedFix: Moved hud-score x:12 → x:60 (matches breakout's audit fix), clearing the button with margin.
  filesTouched: [games/helicopter/src/scenes/play.json]
  otherGamesLikelyAffected: n/a
  status: applied
  verified: before/after screenshots (audit/shots/before-2-play.png shows "23"/"33" behind the button; after-*.png show "23"/"33"/"142" fully clear and readable).

- id: helicopter-03
  title: README parts table mis-attributed pillar motion to auto-scroll
  area: bug
  symptom: Docs said auto-scroll@1.0.0 "drives the pillars"; the code uses scale-by-state for that and auto-scroll was unused.
  rootCause: Stale doc from an earlier implementation.
  category: localized
  contractImpact: n/a
  proposedFix: Repointed the auto-scroll row to the new scrolling backdrop, added a scale-by-state row for the ramped pillar scroll, documented bgScrollVx.
  filesTouched: [games/helicopter/README.md]
  otherGamesLikelyAffected: n/a
  status: applied
  verified: README review; matches play.json (pillars use scale-by-state, backdrop uses auto-scroll).

- id: helicopter-04
  title: Renderer ignores declarative background.layers (parallax is a silent no-op)
  area: capability-gap
  symptom: A game can declare background.layers but the renderer never draws them; declarative parallax silently does nothing.
  rootCause: packages/sdk/src/runtime/renderer.ts drawBackground() only fills bg.color/string and never reads bg.layers (confirmed by reading the method).
  category: engine-root
  contractImpact: none
  proposedFix: Make drawBackground honor background.layers (draw each layer image, optionally with a scroll offset). The schema ALREADY accepts `layers`, so this is renderer-only — no schema/API/protocol change (clean PATCH). NOTE: helicopter did NOT need this — scrolling+depth was achieved via image entities + the auto-scroll part — so this is corroborating evidence for snake-05, not a blocker.
  filesTouched: []
  otherGamesLikelyAffected: [snake, breakout, survival-arena, tower-defense, idle-clicker]
  status: queued-for-synthesis

- id: helicopter-05
  title: Recurring HUD-vs-corner-button collision (no shared HUD safe-area)
  area: layering-ui
  symptom: Canvas HUD text placed in the top corners collides with the mute (top-left) and pause (top-right) DOM buttons, which sit at left/right:8, 40px, in every game's index.html. Fixed ad hoc per game (breakout moved score to x:60; snake centered its HUD; helicopter-02 here).
  rootCause: Each game must manually keep canvas HUD clear of the two fixed ~48px corner button zones; there is no shared "HUD safe-area" convention or helper.
  category: engine-root
  contractImpact: none
  proposedFix: Document a convention (keep canvas HUD ≥ ~52px inset from the top-left/top-right corners), or have the library expose a small safe-area constant/helper. Convention/doc only — no contract change.
  filesTouched: []
  otherGamesLikelyAffected: [snake, breakout, survival-arena, tower-defense, idle-clicker]
  status: queued-for-synthesis

- id: helicopter-06
  title: Depth — obstacle/hazard variety
  area: depth
  symptom: A single hazard type (a fixed 54×150 blue pillar at 5 fixed heights); no variation.
  rootCause: Genre-standard depth not yet built (out of scope this pass).
  category: localized
  contractImpact: n/a
  proposedFix: Multiple obstacle shapes/sizes, moving/oscillating pillars, gaps that narrow.
  filesTouched: []
  otherGamesLikelyAffected: n/a
  status: deferred

- id: helicopter-07
  title: Depth — collectibles / pickups
  area: depth
  symptom: No coins/gems/fuel to collect; score is pure survival time.
  rootCause: Genre-standard depth not yet built.
  proposedFix: Scrolling collectibles (coin/gem parts already in assets) for bonus score / score multipliers.
  filesTouched: []
  status: deferred

- id: helicopter-08
  title: Depth — distance milestones
  area: depth
  symptom: No milestone feedback (e.g. "500m!", speed-zone announcements).
  rootCause: Genre-standard depth not yet built.
  proposedFix: Distance/score milestone events with a transient HUD callout + small FX.
  filesTouched: []
  status: deferred

- id: helicopter-09
  title: Depth — multiple hazard patterns
  area: depth
  symptom: One uniform spawn cadence; no choreographed patterns (waves, pinch gaps, zig-zag corridors).
  rootCause: Genre-standard depth not yet built.
  proposedFix: Data-driven pattern sets the wave-spawner cycles through as difficulty rises.
  filesTouched: []
  status: deferred
```

---

## Verification (real output)

**Build + tests (`games/helicopter`):**
```
vite build → dist/assets/index-*.js 128.49 kB  ✓ built
vitest run → Test Files 1 passed (1) | Tests 5 passed (5)
```

**Validate:**
```
$ npx gitcade validate games/helicopter
Validating .../games/helicopter  tier: ecosystem
✓ PASS — publishable, smoke boot ran 60 frames   (exit 0)
```

**Browser (real bundle via :3001 artifact server, headless chromium):**
- Scroll wired + live: `bg-stars-a` x −19→−54, `bg-stars-b` 781→746 over 0.5s (vx −70, ~800px spacing held).
- Seamless wrap (real renderer, ~14s / full cycle): wrap observed = true; **max uncovered gap across [0,800] = 0.00px**.
- Pause: `isPaused=true`, overlay `display:grid`, player y + scoreDisplay **frozen** (346.76 / 4 unchanged after 0.8s); resume → `isPaused=false`, overlay `none`.
- Sharp input: `window.scrollY = 0` while pressing Space (no page scroll).
- No console errors / page errors / request failures in any run.
- Screenshots: `audit/shots/before-{1-title,2-play,3-play2}.png`, `audit/shots/after-{1-title,2-play,3-play2,4-wrap}.png`.

**Served bundle:** republished via `node audit/harness/republish.mjs helicopter` (30 objects); `GET :3001/artifacts/helicopter/main/index.html` → 200.
