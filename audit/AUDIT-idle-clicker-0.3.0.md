# Audit Summary — idle-clicker (0.3.0 engine)

**Counts: 7 applied (localized) · 3 queued (engine-root) · 5 deferred (depth).**
Republished the fixed `/dist` to the dev MinIO (`audit/harness/republish.mjs idle-clicker`,
30 objects) so the served `:3001` artifact reflects every fix. **No commit / no push** —
working tree only, for PM review.

---

## Review

Mechanically the economy is sound (data-driven currency + upgrade-tree + the custom idle
trio + prestige), but the game shipped with two **dead-input** bugs and a **broken flagship
feature**. (1) The title's full-screen `start-target` and the play scene's full-screen
`tap-field` were both authored at `position {400,300}` (the renderer/`entityAt` treat
position as TOP-LEFT, so a 800×600 box at {400,300} covers only the off-screen bottom-right
quadrant) and on a LOW layer (1 / 0, beneath the layer-100 HUD text that `tap-emit`'s
topmost-pick rule lets swallow the tap) — so most of the title did nothing on tap and most
of the play field didn't earn. (2) Clicking — the highest-frequency action in the whole game
— fired a full-screen yellow `flash` every tap, a strobe; the periodic bonus flashed too.
(3) The **offline catch-up was silently broken in production**: the credit waited until it
*sampled* `isPersistPending` true, but the production parent store is synchronous, so the
restore's claim opens and closes inside one inter-frame gap and the rAF host loop never sees
it → earnings-while-away were dropped. All three are fixed and browser-verified; the power
HUD readout that ran under the mute button is fixed too. The game now starts on any tap,
earns on any tap, juices locally at the cursor, and credits offline earnings correctly
(capped, once). Tests 5/5, `gitcade validate` exit 0, tsc 0.

## Actions taken (localized fixes applied)

1. **`src/scenes/title.json`** — `start-target` `position {400,300}→{0,0}`, `layer 1→999`
   (the convention snake/tower-defense use). The tap target now covers the whole canvas and
   sits above the title text, so a tap anywhere starts the game. *(IC-1)*
2. **`src/scenes/play.json`** — `tap-field` `position {400,300}→{0,0}`, `layer 0→999`. The
   "tap anywhere to earn" field now actually covers the field and is the topmost pick, so a
   tap anywhere on the play canvas earns (no dead zones behind the HUD text). *(IC-2)*
3. **`src/custom-behaviors/index.ts`** — `click-to-earn` now remembers the last qualifying
   tap point and emits `click` with `{ taps, x, y }` (was `{ taps }`), so a data FX system
   can burst at the cursor (`eventPos` reads `{x,y}`). *(IC-3)*
4. **`src/scenes/play.json`** — added two library FX systems: `sparkle@1.0.0` on `event:"click"`
   (gold, at the tap point) and `sparkle@1.0.0` on `event:"bonus"` (green/gold, `size:6`, at
   the coin via `eventPos`'s world-center fallback). FX tuning is presentation, so only the
   whitelisted `colors`/`size` are set inline (no `$cfg`/no count/speed/ttl — matches the
   snake/tower-defense convention and keeps "100% of balance in config" true). *(IC-3, IC-4)*
5. **`src/main.ts`** — removed the `click` and `bonus` full-screen `flash` binds; **kept**
   `prestige` (flash + shake — a rare, major, run-resetting moment, proportionate). The
   `upgrade-denied` cue moved from a full-screen flash to a **local** red shake on the exact
   shop button that was denied (the event carries its `id`; `shopButtons` maps id→button),
   keeping the `hit` sound. *(IC-3, IC-4, IC-5)*
6. **`index.html`** — added the `@keyframes denied` / `.denied` button-shake CSS used by #5. *(IC-5)*
7. **`src/scenes/play.json`** — `hud-power` and `hud-prestige` text moved `x 16→56` so the
   `x… / click` multiplier and the prestige readout clear the 48px top-left mute button (the
   `x1` was hidden under it). *(IC-6)*
8. **`src/main.ts`** — **offline-credit production fix.** Replaced the transient
   `sawRestoreClaim` sampler (which a sync-store, sub-frame restore never trips, dropping the
   credit) with two DURABLE gates: GATE 1 `world.state.bonusLeft` is a number (the
   `interval-bonus` system, ordered after `persistence`, writes it every play tick — a
   frame-timing-independent "the sim has ticked & the claim is placed" signal) and GATE 2
   `!isPersistPending("coins")` (the restore resolved). Past both gates, a numeric `lastSeen`
   can only be a restored save → credit on top of the restored coins; its absence = first run
   → no credit, just start the heartbeat. Removed `playFrames`. *(IC-7)*

## Decisions made

- **`tap-field`/`start-target` at layer 999 (above the HUD), not just `{0,0}` at a low layer.**
  Both are transparent, so they don't occlude anything; putting them topmost removes the
  dead zones the right-offset HUD-text AABBs created (position is top-left, but the text is
  center/right-aligned, so the clickable box sits to the right of the visible glyphs — a
  confusing invisible dead patch). "Tap literally anywhere" is the right idle-clicker UX; the
  shop buttons + mute are HTML overlays, so they still intercept their own taps.
- **Kept prestige as screen flash + shake.** It's the one big, rare, deliberate moment;
  proportionate (same bar snake/tower-defense use). Did not pile extra FX on it.
- **`upgrade-denied` → button shake, not a tiny screen flash.** A can't-afford mis-tap is
  minor and originates at an HTML button at the bottom of the screen — local feedback at that
  button is clearer than flashing the canvas, and removes the last routine screen-flash.
- **Did NOT modify the offline-credit MATH, only its trigger.** The `autoRate × elapsed × mult`
  formula and the `offlineCapSeconds` cap were already correct and not exploitable (verified:
  away=100000s capped to 28800s → exactly +1,440,000). Only the broken detection was replaced.
- **Number formatting left as `toLocaleString` (commas).** Compact K/M/B notation would help
  only deep into a run and risks early-game affordability confusion (rounding vs exact costs);
  flagged as deferred polish, not built.
- **Did NOT touch `packages/*`.** The offline-credit ROOT enabler (no engine "restore-complete"
  signal) and the routine-flash anti-pattern are reported as engine-root, not patched here.

## Findings (machine-readable)

```
- id: idle-clicker-01
  title: Title tap-to-start target only covers the off-screen bottom-right quadrant
  area: bug
  symptom: On the title, tapping most of the screen (incl. the literal "Tap anywhere to start" text) did nothing; only a thin sliver near center started the game.
  rootCause: start-target authored at position {400,300} (top-left semantics → 800×600 box spans x∈[400,1200],y∈[300,900], only the bottom-right quadrant on-screen) AND layer 1, below the layer-100 title text that tap-emit's topmost-pick rule lets swallow the tap.
  category: localized
  contractImpact: n/a
  proposedFix: position {400,300}→{0,0}, layer 1→999 (full-canvas, above the text — the snake/tower-defense convention).
  filesTouched: [games/idle-clicker/src/scenes/title.json]
  status: applied
  verified: browser probe — taps at 6 points (top-left, center, the start text, coin, bottom-right, left-mid) ALL start the game (was 1/6).

- id: idle-clicker-02
  title: Play "tap anywhere to earn" field only earns in the bottom-right quadrant
  area: bug
  symptom: Tapping most of the play field earned nothing; only the visible coin sprite + a small region paid out.
  rootCause: tap-field (full-screen, tagged coin-button) authored at position {400,300} (same top-left bug → bottom-right quadrant only) AND layer 0 (below the layer-100 HUD text, whose AABBs are right-offset and swallow taps).
  category: localized
  contractImpact: n/a
  proposedFix: position {400,300}→{0,0}, layer 0→999 (full-canvas, topmost pick → any canvas tap earns).
  filesTouched: [games/idle-clicker/src/scenes/play.json]
  status: applied
  verified: browser probe — taps at 6 points across the field ALL earn (was 2/6).

- id: idle-clicker-03
  title: Full-screen flash on EVERY click (the highest-frequency action) — a strobe
  area: fx-juice
  symptom: The whole screen flashed yellow on every coin tap; idle players click constantly, so it read as a strobe.
  rootCause: main.ts bound click → ScreenEffects.flash("#ffcd75",0.06); a screen-level effect on the single most frequent action. The click event also carried no position, so only a screen-wide effect was possible.
  category: localized
  contractImpact: n/a
  proposedFix: Drop the click screen-flash; make click-to-earn emit the tap point {taps,x,y}; add a library `sparkle` FX system (event:"click", gold) so feedback is LOCAL particles at the cursor, plus the existing collect sound.
  filesTouched: [games/idle-clicker/src/main.ts, games/idle-clicker/src/custom-behaviors/index.ts, games/idle-clicker/src/scenes/play.json]
  status: applied
  verified: browser FX probe — 6 rapid clicks: max fx-overlay opacity 0 (NO flash), 48 live particle entities spawned at the tap points.

- id: idle-clicker-04
  title: Full-screen flash on the periodic bonus
  area: fx-juice
  symptom: A green full-screen flash every bonusPeriod (25s) — a positive routine beat treated as a screen-wide event.
  rootCause: main.ts bound bonus → ScreenEffects.flash("#a7f070",0.18).
  category: localized
  contractImpact: n/a
  proposedFix: Drop the bonus screen-flash; add a library `sparkle` FX system (event:"bonus", green/gold, size 6) — eventPos falls back to world center (≈ the coin), so it reads as the coin paying out.
  filesTouched: [games/idle-clicker/src/main.ts, games/idle-clicker/src/scenes/play.json]
  status: applied
  verified: browser FX probe (no screen flash on bonus); prestige flash retained (overlay opacity 0.944 on prestige).

- id: idle-clicker-05
  title: Denied buy used a full-screen flash; cue now local to the offending button
  area: fx-juice
  symptom: A can't-afford / locked purchase flashed the whole canvas red — disconnected from the HTML shop button at the bottom that was tapped.
  rootCause: main.ts bound upgrade-denied → ScreenEffects.flash; the event carries the upgrade id, so precise local feedback was available but unused.
  category: localized
  contractImpact: n/a
  proposedFix: On upgrade-denied, briefly red-shake the specific shop button (id→button via the existing shopButtons map) via a CSS keyframe; keep the hit sound. No canvas flash.
  filesTouched: [games/idle-clicker/src/main.ts, games/idle-clicker/index.html]
  status: applied
  verified: browser FX probe — denying the factory buy applies the `.denied` class to the factory button.

- id: idle-clicker-06
  title: Power / prestige HUD readout ran under the top-left mute button
  area: layering-ui
  symptom: The "x1 / click" power multiplier (and the prestige readout) started at x=16, hidden behind the 48px mute button — the multiplier value was unreadable.
  rootCause: hud-power/hud-prestige text at position x=16; the mute button occupies x∈[8,48].
  category: localized
  contractImpact: n/a
  proposedFix: Move both readouts to x=56 (clear of the button).
  filesTouched: [games/idle-clicker/src/scenes/play.json]
  status: applied
  verified: browser screenshot — "x1 / click" fully visible to the right of the mute button. (Same class as tower-defense's td layering finding.)

- id: idle-clicker-07
  title: Offline catch-up silently dropped in production (sync-store restore race)
  area: persistence
  symptom: Earnings-while-away were never credited on reload in production — coins restored to the saved value with no "Welcome back" bonus.
  rootCause: applyOfflineCredit required SAMPLING world.isPersistPending("coins")===true (a sawRestoreClaim flag) before crediting, to prove a restore happened. But the host mirror() rAF loop runs once/frame (and before the sim loop), while the platform parent store is SYNCHRONOUS (localStorage-backed bridge store): the persistence claim is placed and released entirely within one inter-frame macrotask gap, so the pending=true window is never observed → credit skipped. (Also: the rAF loop can outrun the sim's first tick, so a frame-count fallback fires before the claim is even placed and the heartbeat then clobbers the restored lastSeen.)
  category: localized        # root cause is the game's host shim; the engine-root enabler is idle-clicker-09
  contractImpact: n/a
  proposedFix: Gate the credit on two DURABLE signals instead of the transient flag — GATE 1: world.state.bonusLeft is a number (interval-bonus, ordered after persistence, writes it every play tick → "the sim ticked & the claim is placed", frame-timing-independent); GATE 2: !isPersistPending("coins") (restore resolved). Then a numeric lastSeen ⟺ a restored save → credit once on top of restored coins; absent ⟺ first run → start the heartbeat. Remove the playFrames counter.
  filesTouched: [games/idle-clicker/src/main.ts]
  status: applied
  verified: faithful storage-bridge harness (gitcade.storage protocol, SYNCHRONOUS get = production path), real iframe reload with lastSeen rewritten to 1h ago — coins 2000→182,070 (+180,028) and hint "Welcome back! +180,028 coins while away"; capped (away 100000s → +1,440,000 = 50×28800); applies exactly once (offlineApplied guard). The old code on the same harness left coins at 2,042 (no credit).

- id: idle-clicker-08
  title: Routine-action full-screen flash is a cross-game anti-pattern (idle-clicker is the worst offender)
  area: fx-juice
  symptom: Multiple games bind a full-screen ScreenEffects.flash to a high-frequency routine event in hand-written main.ts; idle-clicker flashed on EVERY click — the highest-frequency action of any seed game.
  rootCause: ScreenEffects.flash is the easy reach; there's no first-class "local FX at an event position" idiom, so games over-use the screen-wide effect. (Same root as snake-04 / td-08.)
  category: engine-root
  contractImpact: none   # additive: a documented convention + the burst-at-event-position recipe (sparkle/explosion bound to the action event, payload {x,y}) — both library parts already exist; the per-game fix is to stop binding flash to routine events
  proposedFix: Standardize the recipe (sparkle/explosion on the action event, event carries {x,y}) as the routine-feedback idiom; optionally a validator/lint advisory flagging flash/shake bound to known high-frequency events. Per-game fix is to remove the binding (done here).
  filesTouched: []
  otherGamesLikelyAffected: [snake, tower-defense, survival-arena, breakout, helicopter]   # snake-04 & td-08 already filed this; idle-clicker confirms it as the headline offender
  status: queued-for-synthesis

- id: idle-clicker-09
  title: No deterministic "persistence restore complete" signal — games must poll a transient flag
  area: persistence
  symptom: idle-clicker's offline credit had to detect "the restore landed" by polling the transient world.isPersistPending flag from a rAF loop, which silently misses a sub-frame-fast (sync-store) restore (root of idle-clicker-07). Any game wanting one-shot post-restore host logic hits the same foot-gun.
  rootCause: The SDK exposes restore state only as a transient polled flag (claimPersistKeys/isPersistPending/resolvePersistKeys); there is no event/promise that fires once when a scene's persistence restore has resolved.
  category: engine-root
  contractImpact: none   # additive: emit a world event (e.g. "persist-restored" with the restored keys) and/or expose world.whenRestored(keys): Promise — neither reshapes a frozen schema/signature/protocol/header
  proposedFix: Add an additive restore-complete signal so host code can hook restore completion deterministically instead of racing it. Would let idle-clicker drop the bonusLeft/pending gating heuristic entirely.
  filesTouched: []
  otherGamesLikelyAffected: [idle-clicker]   # only consumer today, but a latent foot-gun for any future game doing post-restore work
  status: queued-for-synthesis

- id: idle-clicker-10
  title: Full-field interaction rects are easy to mis-author at center coords (position is top-left)
  area: layering-ui
  symptom: The same coordinate bug recurs — a full-screen interaction rect authored at {400,300} (intended "center") covers only the bottom-right quadrant: tower-defense title start/retry, idle-clicker title start, idle-clicker play tap-field (3 sites, 2 games).
  rootCause: Entity position is the TOP-LEFT corner (entity-factory: x = def.position.x; entityAt AABB = [x, x+w]); a full-field rect must be {0,0}+high layer, but {400,300}+low layer is an intuitive mis-author that passes validation and the headless smoke boot (which taps at 400,300, inside the broken AABB).
  category: engine-root   # the per-game fixes stand (and td/this prompt called the title case per-game); flagging the RECURRENCE as an optional preventive-tooling candidate, not a contract change
  contractImpact: none   # additive/optional: a docs convention, a `full-field`/anchor helper, or a validator advisory when a tap-emit/full-size rect is centered on a low layer
  proposedFix: Optional preventive tooling (convention doc, a fullscreen-rect helper, or a lint advisory). No frozen contract changes. The localized fixes (idle-clicker-01/02) are the actual resolution.
  filesTouched: []
  otherGamesLikelyAffected: [tower-defense]   # confirmed; any game hand-authoring a full-field UI rect
  status: queued-for-synthesis

- id: idle-clicker-11
  title: Multiple generator types
  area: depth
  symptom: One auto-income pool fed by two generator upgrades (cursor/factory); no distinct generator archetypes.
  rootCause: single autoRate accumulator.
  category: localized
  contractImpact: n/a
  proposedFix: Add distinct generators (per-type rates/costs/art) as data in config + upgrade-tree.
  filesTouched: []
  status: deferred

- id: idle-clicker-12
  title: Prestige loop polish
  area: depth
  symptom: Prestige banks + bumps a flat multiplier and resets; no prestige currency/shop or escalating prestige tiers.
  rootCause: minimal prestige system (bank + flat bonus + reset).
  category: localized
  contractImpact: n/a
  proposedFix: Add a prestige currency + a meta-upgrade shop / scaling prestige tiers.
  filesTouched: []
  status: deferred

- id: idle-clicker-13
  title: Milestones / achievements
  area: depth
  symptom: No goals, badges, or milestone payouts to pace progress.
  rootCause: none implemented.
  category: localized
  contractImpact: n/a
  proposedFix: Data-driven milestone table (coin/click thresholds → reward + HUD toast).
  filesTouched: []
  status: deferred

- id: idle-clicker-14
  title: Upgrade tiers / breadth
  area: depth
  symptom: Three upgrades (click/cursor/factory), no maxLevels and no later-tier unlocks beyond the cursor→factory prereq.
  rootCause: small upgrade catalog.
  category: localized
  contractImpact: n/a
  proposedFix: Expand the upgrade-tree catalog (more nodes, prereqs, tiers) — pure config/data.
  filesTouched: []
  status: deferred

- id: idle-clicker-15
  title: Offline-earnings summary modal + compact number formatting
  area: depth
  symptom: Offline credit shows only a one-line hint ("Welcome back! +N"); no summary modal. Big numbers use comma formatting (toLocaleString), not compact K/M/B.
  rootCause: minimal presentation; fmt() uses toLocaleString.
  category: localized
  contractImpact: n/a
  proposedFix: A welcome-back modal (time away, per-source breakdown) + compact K/M/B formatting for very large numbers (guarded so early-game affordability stays exact).
  filesTouched: []
  status: deferred
```

## Verification (real output)

**Unit tests** — `npm --prefix games/idle-clicker test`:
```
 ✓ tests/smoke.test.ts (5 tests) 30ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

**Validator** — `npx gitcade validate games/idle-clicker`:
```
  tier: ecosystem
✓ PASS — publishable, smoke boot ran 60 frames     (exit 0)
```

**Typecheck** — `npx tsc --noEmit` (games/idle-clicker): exit 0.

**Browser — coordinate probe** (served `:3001` artifact, after republish):
```
TITLE: tap → start?   top-left ✓ · center ✓ · the 'tap to start' text ✓ · coin ✓ · bottom-right ✓ · left-mid ✓   (was: only center)
PLAY:  tap → earn?    top-left ✓ · dead-center ✓ · coin ✓ · bottom-right ✓ · upper-right ✓ · left-mid ✓          (was: only center + coin)
console/page errors: none
```

**Browser — FX probe**:
```
click → max fx-overlay opacity: 0          (no flash ✓)
click → max live particles: 48             (local burst at the cursor ✓)
prestige → max fx-overlay opacity: 0.944   (flash retained for the big moment ✓)
denied factory buy → button.denied class applied: true ✓
pageerrors: none
```

**Browser — offline catch-up** (faithful gitcade.storage bridge parent, SYNCHRONOUS get =
production path, real iframe reload with saved lastSeen rewritten to 1h ago):
```
after reload → coins: 182,070   (restored 2000 + credited 180,028 + a little accrual)
after reload → hint: "Welcome back! +180,028 coins while away"     ✓
cap test (away 100000s, cap 28800s) → +1,440,000  (= 50 × 28800)   ✓  not exploitable
applies exactly once (offlineApplied guard).
[Same harness on the OLD code: coins 2,042, no credit — i.e. the production bug reproduced and then fixed.]
```

**Serving:** republished the built `/dist` to the dev MinIO via
`node audit/harness/republish.mjs idle-clicker` (30 objects) so the `:3001` artifact serves
the fixes. Nothing committed or pushed.
