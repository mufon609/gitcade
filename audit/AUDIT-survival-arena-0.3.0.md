# Audit Summary — survival-arena (0.3.0 engine)

**Counts:** 5 applied (localized) · 3 queued (engine-root, for PM synthesis) · 5 deferred (depth backlog).
No commit, no MinIO republish (verified against a locally-served fresh `dist`, port 3002 — the
published `survival-arena/main` bundle is still the pre-audit one; the final republish-all is the
human/PM's step). All changes confined to `games/survival-arena/`. No `config.json` change, no
frozen-contract change.

---

## Review

Survival-arena is the seed set's "FX showcase," and it was in good shape on the headline
anti-pattern (no full-screen flash on a routine action). The problems were narrower but real.
**(1)** The play HUD physically collided with the DOM mute button: the score number rendered *on
top of* the speaker icon and the green health bar tucked under it (the recurring
canvas-HUD-vs-corner-button issue every game in this set has). **(2)** The juice allocation was
mis-weighted: a global `shake` was fired on **every** enemy death — and because the local
`explosion` particle burst (which is data, and is the right per-kill feedback) already fires there,
the shake was redundant *and*, at swarm density, never settled between kills, degrading into a
constant low rumble that flattened the bigger beats and hurt readability. Meanwhile the single most
important survival signal — **the player taking a hit** — had no screen feedback at all (only the
HUD bar silently shrank). **(3)** The playfield was dead-flat black, no depth, on the game billed as
the showcase. **(4)** The docs (main.ts header, README, test docstring) still described a custom
`swarm-scale` behavior that no longer exists — scaling has been pure data via two `scale-by-state`
instances since 0.2.1, so the comments were actively misleading.

**State now:** HUD is clear of both corner buttons and fully readable; per-kill juice is the local
explosion burst (no global rumble); screen-shake is reserved for player-stakes beats (a small,
rate-limited shake when *you* get hit; the big shake + red flash on death; the blue flash on
level-up); the playfield has a static starfield backdrop + a subtle arena frame; docs match the
code. Build, 6/6 tests, `gitcade validate` (exit 0), `tsc --noEmit` (exit 0), and a real-browser run
(title → play → fight → pause) with **zero** console/page/request errors all pass.

---

## Actions taken (localized fixes applied)

1. **`src/scenes/play.json` — HUD clear of the mute button.** Moved `hud-score` `x:12 → 60`
   (align left) and `hud-health-bar` `x:12 → 60`. The DOM mute button occupies x≈8–48 / y≈8–48
   (top-left); the renderer draws left-aligned text *from* `e.x`, so x:12 put both directly under
   it. x:60 clears the 48px button (matches breakout/helicopter's x:60 convention). The timer is
   right-aligned and ends at x:668 — already clear of the top-right pause button (x≈752–792) — so it
   was left alone.

2. **`src/scenes/play.json` — starfield backdrop + arena frame.** Added a `bg-stars` full-field
   `image` entity (`assets/backgrounds/starfield.png`, layer 0) and an `arena-frame` `rect` with a
   `#3b5dc9` stroke (layer 1) — snake's proven pattern. **Static, not scrolling:** this is a fixed
   arena (no world scroll/camera), so a drifting backdrop would imply motion that doesn't exist; a
   static field is the honest, lowest-risk choice and needs no new behavior or config key. Both
   tagged `decor` (untouched by the collision pairs / wave-spawner placement).

3. **`src/main.ts` — FX re-allocation (drop the per-kill rumble; juice the player hit).** Removed
   the `"enemy-died": shake(5,0.16,44)` binding (the local `explosion` burst in play.json is the
   correct, already-present per-kill feedback). Added a `"damage"` binding gated to
   `data.target === "player"` → a small `shake(7,0.2,40)`, host-throttled to ≥220ms so a swarm
   pile-on can't strobe-shake. **Deliberately no flash on hit:** getting hit is a frequent/routine
   event, and a full-screen flash on a routine action is the exact anti-pattern this pass exists to
   kill — the shake conveys the hit without washing the field. Death (big shake + red flash) and
   level-up (blue flash) bindings unchanged. No `config.json` change: these are host screen-FX feel
   constants, exactly like the death/level-up magnitudes already hardcoded here — presentation glue,
   not balance (the validator's `$cfg` rule governs game-data params, not host FX constants).

4. **`src/main.ts` + `README.md` + `tests/smoke.test.ts` — corrected stale `swarm-scale` docs.**
   All three claimed a custom `swarm-scale` behavior ramps enemy hp/speed. It doesn't exist —
   `custom-behaviors/index.ts` is a no-op and scaling is two library `scale-by-state` instances on
   the enemy prototype (speed = `multiply`/per-tick, hp = `once`/at-spawn). Rewrote the main.ts
   header, the README intro + parts table + composition prose, and the test docstring to match. Also
   updated the README's FX line ("screen-shake on impact" → "screen-shake when you take a hit") to
   reflect the re-allocation.

---

## Decisions made

- **Static starfield, no scroll.** Considered helicopter's seamless 2-tile auto-scroll, but that's
  for auto-scrollers; this arena has a fixed camera. Static avoids an unjustified config key and any
  scroll-seam risk. (See engine-root sa-07 — `background.layers` would be the declarative home for
  this if the renderer honored it.)
- **Shake on hit, not on kill — a principled juice allocation.** Kills are constant and already have
  local bursts → no screen FX. Getting hit is impactful and far less frequent (gated by per-enemy
  `damageCooldown`) → worth a shake. This ties screen motion to *player stakes*, which reads better
  in an FX showcase than rumble-on-everything.
- **No sprite swaps.** The enemy/player/bullet sprites are already intentional library art (not flat
  rects), so "replace flat sprites" didn't apply; re-skinning is taste/depth, out of scope.
- **Did NOT add the starfield to title/over.** Those are clean menu screens by design; adding it is
  cosmetic and only widens the diff. Left as-is.
- **No MinIO republish.** Verified against a locally-served fresh `dist` to avoid the
  publish-before-all-six-done issue a prior session hit. The final republish-all remains the
  human/PM step.
- **Readability under load** judged acceptable: the starfield is dim/sparse and enemies are
  saturated-red and larger, so threat parsing holds against the new backdrop (confirmed in-browser).

---

## Findings (machine-readable)

```yaml
- id: survival-arena-01
  title: Play HUD collides with the DOM mute button (score over the icon, health bar under it)
  area: layering-ui
  symptom: The score number renders on top of the top-left mute speaker icon; the green health bar's left edge tucks under the same button.
  rootCause: Renderer draws left-aligned text from e.x; hud-score and hud-health-bar sat at x:12, inside the mute button's x≈8–48 footprint.
  category: localized
  contractImpact: n/a
  proposedFix: Moved hud-score and hud-health-bar to x:60 (clears the 48px button). Timer is right-aligned ending at x:668, already clear of the pause button — left alone.
  filesTouched: [games/survival-arena/src/scenes/play.json]
  status: applied
  verified: browser before/after (audit/shots/sa-before-2-play.png vs sa-after-2-play.png) — score "50"/health bar now right of the speaker icon; gitcade validate exit 0.

- id: survival-arena-02
  title: Global screen-shake on every kill becomes a constant rumble at swarm density
  area: fx-juice
  symptom: Under a dense swarm the screen never stops jittering; the bigger death/level beats lose impact and threats are harder to track.
  rootCause: main.ts bound "enemy-died" → shake(5,0.16,44). Kills happen many times/sec, each resets the shake timer, so it never decays. The local explosion burst (data, play.json) already gives correct per-kill feedback, making the shake redundant.
  category: localized
  contractImpact: n/a
  proposedFix: Removed the per-kill shake binding; kept the local explosion burst as per-kill juice.
  filesTouched: [games/survival-arena/src/main.ts]
  status: applied
  verified: code change; browser run shows stable field with local bursts; 6/6 tests, zero console errors.

- id: survival-arena-03
  title: Player taking damage had no screen feedback (the key survival signal was silent)
  area: fx-juice
  symptom: When an enemy hits you, only the HUD health bar shrinks — easy to miss under load; no juice on the most important event.
  rootCause: No FX bound to a non-fatal player hit; only player-died had feedback.
  category: localized
  contractImpact: n/a
  proposedFix: Bound "damage" (filtered to data.target === "player") → small shake(7,0.2,40), host-throttled to ≥220ms so a pile-on can't strobe. No flash (a full-screen flash on a routine/frequent action is the anti-pattern); shake conveys the hit without washing the field.
  filesTouched: [games/survival-arena/src/main.ts]
  status: applied
  verified: code change; the "damage" event fires constantly (every bullet hit) and the gated handler ran with zero errors across the browser run; tsc exit 0.

- id: survival-arena-04
  title: Dead-flat black playfield on the "FX showcase" game
  area: layering-ui
  symptom: The arena had no backdrop or boundary — black void; the showcase looked the least polished in motion.
  rootCause: play.json background was a flat fill with no decor layer.
  category: localized
  contractImpact: n/a
  proposedFix: Added a static full-field starfield (layer 0) + a subtle indigo arena frame (layer 1), snake's pattern. Static because the arena has a fixed camera.
  filesTouched: [games/survival-arena/src/scenes/play.json]
  status: applied
  verified: browser before/after (sa-before-2-play.png vs sa-after-2-play.png) — starfield + frame present, threats still legible; validate exit 0.

- id: survival-arena-05
  title: Docs describe a custom `swarm-scale` behavior that no longer exists
  area: bug
  symptom: main.ts header, README (intro + parts table + prose), and the test docstring all credit a custom `swarm-scale` behavior for enemy scaling.
  rootCause: Scaling was moved to pure data (two library `scale-by-state` instances) at the 0.2.1 repin; custom-behaviors/index.ts is a no-op, but the surrounding docs were never updated — actively misleading to a reader/forker.
  category: localized
  contractImpact: n/a
  proposedFix: Rewrote all three to describe the data-driven `scale-by-state` ramp (speed = multiply/per-tick, hp = once/at-spawn) and the "no custom behavior remains" reality; also corrected the README FX line to match the re-allocation.
  filesTouched: [games/survival-arena/src/main.ts, games/survival-arena/README.md, games/survival-arena/tests/smoke.test.ts]
  status: applied
  verified: grep shows no remaining "swarm-scale (custom behavior)" claims; 6/6 tests still pass; validate exit 0.

- id: survival-arena-06
  title: Recurring canvas-HUD vs DOM-corner-button collision (cross-game)
  area: layering-ui
  symptom: Every game's top-corner canvas HUD collides with the mute/pause DOM buttons in index.html; fixed ad hoc per game (here x:60).
  rootCause: No shared safe-area convention between the canvas HUD and the fixed-position corner buttons; each game hardcodes its own inset.
  category: engine-root
  contractImpact: none
  proposedFix: Adopt a shared HUD safe-area convention/constant (~52px corner inset) so HUD layout doesn't have to rediscover the button footprint per game.
  otherGamesLikelyAffected: [snake, breakout, helicopter, idle-clicker, tower-defense]
  status: queued-for-synthesis
  verified: n/a (not applied) — corroborates the same finding raised in the helicopter audit.

- id: survival-arena-07
  title: Renderer ignores `background.layers` → declarative backdrops/parallax are a silent no-op
  area: capability-gap
  symptom: A scene can declare `background.layers` but nothing renders; every game backdrop is done with a full-field image entity at layer 0 instead.
  rootCause: 0.3.0 renderer `drawBackground` only fills `background.color` and drops `background.layers` (the schema accepts them).
  category: engine-root
  contractImpact: none
  proposedFix: Implement `background.layers` in `drawBackground` (schema already accepts the shape → additive PATCH). Retires the per-game image-entity backdrop workaround used here.
  otherGamesLikelyAffected: [snake, breakout, helicopter, tower-defense, idle-clicker]
  status: queued-for-synthesis
  verified: n/a (not applied) — corroborates snake-05 / breakout-05 / helicopter.

- id: survival-arena-08
  title: No proportionality guardrail for screen-level juice (shake/flash) vs event frequency
  area: fx-juice
  symptom: A screen-shake (or flash) bound to a high-frequency event (per-kill, per-hit) degrades into constant rumble/strobe — the same class as the green-flash-on-placement anti-pattern, just shake instead of flash. Each game must rediscover the rule by feel.
  rootCause: The library FX surface makes screen-shake/flash trivially bindable to any event, with no convention or helper signaling "screen-level FX is for rare/decisive beats; high-frequency feedback should be local (particles/per-entity)."
  category: engine-root
  contractImpact: none
  proposedFix: Document a juice-proportionality convention (screen FX = rare beats; frequent feedback = local), and/or ship an opt-in throttle helper on ScreenEffects (e.g. a min-interval guard) so games don't reinvent the host-side rate-limit used here. Low confidence it recurs widely — flag for the PM to cluster against the other games' FX bindings.
  otherGamesLikelyAffected: [tower-defense, breakout]
  status: queued-for-synthesis
  verified: n/a (not applied).

# ---- Depth backlog — DEFERRED (flagged, NOT built this pass) ----

- id: survival-arena-D1
  title: Enemy variety (ranged / tank / splitter)
  area: depth
  symptom: One enemy archetype (a melee chaser); difficulty scales only count/hp/speed, so threat parsing never changes qualitatively.
  rootCause: Single prototype in the wave-spawner.
  category: localized
  proposedFix: Add enemy archetypes (a ranged shooter, a slow high-hp tank, a splitter that spawns minions on death) as additional prototypes/waves. (Defer — depth pass.)
  status: deferred

- id: survival-arena-D2
  title: Weapon / upgrade pickups
  area: depth
  symptom: The player's loadout is fixed for the whole run; no build-crafting (the core of the Vampire-Survivors genre).
  rootCause: No pickup/upgrade system wired.
  category: localized
  proposedFix: Drop pickups that grant fire-rate/multishot/damage/speed upgrades over the run. (Defer — depth pass.)
  status: deferred

- id: survival-arena-D3
  title: Score multipliers / kill combos
  area: depth
  symptom: Flat per-kill score; no reward for chaining kills or playing aggressively.
  rootCause: score system tallies a flat killScore.
  category: localized
  proposedFix: Add a combo/multiplier that ramps with rapid kills and decays on idle. (Defer — depth pass.)
  status: deferred

- id: survival-arena-D4
  title: Boss waves / milestone encounters
  area: depth
  symptom: Waves differ only by count/stat scaling; no set-piece peaks.
  rootCause: Uniform wave-spawner cadence.
  category: localized
  proposedFix: Inject a boss entity at level/time milestones (telegraphed, high-hp, distinct attack). (Defer — depth pass.)
  status: deferred

- id: survival-arena-D5
  title: Pickups / economy (XP, health drops, currency)
  area: depth
  symptom: No mid-run resources — no health recovery, no XP/currency loop to spend.
  rootCause: No drop/economy system.
  category: localized
  proposedFix: Enemies drop XP gems / occasional health; XP feeds the upgrade loop (D2). (Defer — depth pass.)
  status: deferred
```

---

## Verification (pasted evidence)

**Build** (`npm --prefix games/survival-arena run build`):
```
✓ 23 modules transformed.
dist/index.html                  3.59 kB │ gzip:  1.58 kB
dist/assets/index-uiKQJ8Os.js  130.73 kB │ gzip: 37.47 kB
✓ built in 249ms
```

**Typecheck** (`tsc --noEmit -p games/survival-arena/tsconfig.json`): exit 0.

**Tests** (`npm --prefix games/survival-arena test`):
```
✓ tests/smoke.test.ts (6 tests) 62ms
Test Files  1 passed (1)
     Tests  6 passed (6)
```
(Covers: boot, title→play + auto-fire + score, maxAlive cap, difficulty ramp toughens swarm,
death→over handoff, retry resets the run.)

**Validate** (`gitcade validate games/survival-arena`):
```
✓ PASS — publishable, smoke boot ran 60 frames
```
exit 0.

**Browser** (freshly-built dist served on 127.0.0.1:3002, headless Chrome-for-Testing):
- `[errors] none` across title → play → ~2s fight (driving WASD) → pause.
- Screenshots in `audit/shots/`: `sa-before-{1-title,2-play,3-play2,4-pause}.png` (pre-edit, from the
  live artifact bundle) vs `sa-after-{1-title,2-play,3-play2,4-pause}.png` (post-edit, fresh dist).
  Before: score number drawn over the mute icon, health bar under it, flat black field. After: HUD
  clear of both corner buttons, starfield + arena frame, threats legible, pause overlay still freezes
  the sim.

(Helper scripts left in `audit/shots/`: `shoot.mjs`, `serve.mjs` — throwaway audit tooling.)
