# Audit Summary — breakout (0.3.0 engine)

**Counts:** 3 applied (localized) · 2 queued (engine-root) · 5 deferred (depth).
Working tree only — **not committed**. Rebuilt + verified against the freshly-built local
`dist` (real `main.ts` host). **NOT republished to MinIO** — the republish step was blocked
pending human approval (it's an outward-facing push); a human can run
`node audit/harness/republish.mjs breakout` to refresh the served bundle.

---

## Review
Breakout was mechanically solid — multi-level flow (title → L1 → L2 → L3 → win/over) wired as
data, fixed-timestep physics, `axis:"auto"` brick reflection, lives/respawn, pause, mute, and
persistence all worked, and there is **no tunneling** at any configured speed (the loop fixes the
timestep at 1/60, so the ball moves ≤9.3px/step against a 14px ball / 22px brick — collision is
crisp and angles are fair by construction). Three presentation problems dragged the feel down.
(1) Every **brick break** — the single most frequent action — fired a whole-screen
`shake(4,0.12,50)`; small per hit, but at high break rates it jiggled the entire screen
continuously (the same "screen-FX on a routine action" anti-pattern snake/tower-defense hit).
(2) The live **score sat under the DOM mute button** (`hud-score` at x:12, the 🔊 button occupies
x:8–48), so the leading digits were obscured during play (confirmed in-browser: "50" jammed
behind the icon). (3) The lower ~3/4 of every level was a **flat navy void** — no depth, and the
title→play→over flow had no visual through-line. Now: breaking a brick throws a **local
brick-shatter burst** at the brick (no screen shake), the HUD reads cleanly (score clear of the
mute button, "LEVEL n" centered, lives clear of the pause button), and all six scenes share a
**starfield** so the playfield has depth and the flow is cohesive. The bright ball and brick rows
stay high-contrast over the starfield. Screen effects are now reserved for the big, rare moments
(ball-lost, level-cleared, game-over), which were judged proportionate and left as-is. Pause,
mute, sharp input (arrow/Space scroll-prevent + held-key blur-clear, both handled in the SDK),
and persistence were verified working and left untouched.

## Actions taken (localized fixes — applied)
- **`src/main.ts`** — removed the `"block-broken": (f) => f.shake(4, 0.12, 50)` binding from the
  `ScreenEffects.bindToEvents` map and rewrote the FX comment to document the rule: routine
  feedback (breaking a brick) is now **local** particles declared as scene data; the screen is
  reserved for big, infrequent events. Kept `ball-lost` (shake + red flash), `level-cleared`
  (green flash), and `gameover` (shake) — proportionate big moments.
- **`src/scenes/level-1.json`, `level-2.json`, `level-3.json`** —
  - Added an `explosion` FX **system** (`event: "block-broken"`, `colors` = the five brick-row
    hexes) → a radial debris burst at the broken brick. `health-and-death` emits `block-broken`
    with the brick's `{id}` *before* destroying it, so `eventPos` resolves the burst to the
    brick's center. Numeric tuning (count/speed/ttl/gravity) intentionally omitted — the library
    defaults are tuned for this and the validator's games-are-data rule rejects non-structural
    numeric literals in params (`colors` is a string array, which is allowed — same approach as
    snake's `sparkle`).
  - Moved the HUD clear of the DOM corner buttons: `hud-score` x:12 → **60** (clears the mute
    button), `hud-level` x:320 → **400** (true center). `hud-lives` left at x:668 (already clear
    of the pause button). All retain `layer:100` and their `bind`s.
  - Added a `bg-stars` starfield entity (`assets/backgrounds/starfield.png`, `layer:0`, 800×600,
    tag `decor`, no behaviors) — pure decoration below the playfield.
- **`src/scenes/title.json`, `over.json`, `win.json`** — added the same `bg-stars` starfield
  (`layer:0`, below the `layer:10` menu text) so the whole title→play→win/over flow is cohesive.

## Decisions made
- **`explosion` (not `sparkle`) for the brick break** — a brick *shatters*; radial debris pulled
  by gravity reads as destruction, where sparkle's gentle upward twinkle is for pickups. Declared
  as a scene **system** (data), not host code, to keep "games are data" — mirrors snake's choice
  to put pickup FX in scene data and keep only big-moment screen FX in `main.ts`.
- **No config keys added for FX intensity** — followed the snake precedent of relying on the
  library's tuned defaults; adding `$cfg` keys for particle count/speed would be churn for a
  presentational effect and isn't required by the validator (only non-whitelisted numeric
  *literals* fail, and I passed none).
- **Kept the brick sprites as flat colored rects** — the per-row colors (#b13e53 / #ef7d57 /
  #ffcd75 / #a7f070 / #41a6f6) are deliberate, legible difficulty tiers. The bundled
  `breakable-block.png` is 16×16; stretching it to a 72×22 brick would look wrong **and** destroy
  the color coding. Reskinning would be a regression, so I left them (same "no reskin" call snake
  reached).
- **No playfield frame** (snake added one) — breakout's boundary is *not* uniform: top/left/right
  bounce, the bottom is the open killzone. A uniform frame would imply the bottom bounces too, so
  it would mislead. The starfield alone gives the depth.
- **Lives HUD left in place** — at x:668 right-aligned it already clears the pause button at every
  realistic scale; pushing it further right (toward the button) to "balance" the row would
  *increase* overlap risk, so I didn't.
- **Did not implement depth** (power-ups, brick types, combo scoring, more levels, difficulty
  ramp) — deferred by scope; logged as backlog below.
- **Did not republish to MinIO** — the republish is an outward-facing push and was blocked pending
  approval; all verification was done against the freshly-built local `dist` served through the
  real `main.ts`, which is byte-identical to what republish would upload.

## Findings

```
- id: breakout-01
  title: Whole-screen shake on every brick break (routine-action screen FX)
  area: fx-juice
  symptom: Breaking a brick — the most frequent action — shook the whole screen; small per hit, but continuous and noisy when the ball rips through a packed wall.
  rootCause: main.ts bound "block-broken" → ScreenEffects.shake(4,0.12,50); a screen-level effect used for a high-frequency routine action.
  category: localized
  contractImpact: n/a
  proposedFix: Drop the block-broken screen shake; add an `explosion` FX system (event:"block-broken", brick-palette colors) to each level scene so feedback is LOCAL debris at the broken brick (the existing "hit" sound stays).
  filesTouched: [games/breakout/src/main.ts, games/breakout/src/scenes/level-1.json, games/breakout/src/scenes/level-2.json, games/breakout/src/scenes/level-3.json]
  status: applied
  verified: data-harness emit "block-broken" {id:"brick-r0c0"} → particle count 0→14, spawned at the brick center (cx≈38,cy≈81 = brick-r0c0 center); validate exit 0; after-screenshot shows local colored debris at the break point, no screen-wide flash.

- id: breakout-02
  title: Score HUD hidden behind the mute button
  area: layering-ui
  symptom: During play the live score sat at top-left (x:12) directly under the 🔊 DOM mute button, so the leading digit(s) were obscured (e.g. "50" jammed behind the icon).
  rootCause: Canvas HUD text at x:12 (align:left, y:10→30 with textBaseline top) occupies the same top-left corner the absolutely-positioned mute button (x:8–48, y:8–48, z-index 5) draws over.
  category: localized
  contractImpact: n/a
  proposedFix: Move hud-score x:12→60 (clear of the mute button) and center hud-level x:320→400; leave hud-lives (already clear of the pause button).
  filesTouched: [games/breakout/src/scenes/level-1.json, games/breakout/src/scenes/level-2.json, games/breakout/src/scenes/level-3.json]
  status: applied
  verified: before/after browser screenshots (top-left "50" overlapping 🔊 → "50" fully clear, "LEVEL 1" centered).

- id: breakout-03
  title: Flat void playfield; no visual through-line across scenes
  area: layering-ui
  symptom: The lower ~3/4 of every level was flat navy with no depth, and title/play/over had no shared backdrop, so the flow felt disjoint.
  rootCause: Scenes used a solid background color only; nothing gave the empty play space depth or tied the screens together.
  category: localized
  contractImpact: n/a
  proposedFix: Add a starfield background entity (starfield.png, layer 0, tag decor, no behaviors) to all six scenes. Pure decoration below the playfield; the bright ball/bricks stay legible over it.
  filesTouched: [games/breakout/src/scenes/title.json, games/breakout/src/scenes/level-1.json, games/breakout/src/scenes/level-2.json, games/breakout/src/scenes/level-3.json, games/breakout/src/scenes/over.json, games/breakout/src/scenes/win.json]
  status: applied
  verified: after screenshots (title + level-1 + pause) show cohesive starfield; ball/bricks high-contrast; requestFailures: [] (starfield.png loads); validate exit 0.

- id: breakout-04
  title: Screen-FX on a routine action is a cross-game anti-pattern (corroborates snake-04)
  area: fx-juice
  symptom: Same defect class as snake-01/tower-defense — a full-screen ScreenEffects.shake/flash bound to a high-frequency routine event in each game's hand-written main.ts. Breakout's block-broken shake is confirmed an instance.
  rootCause: FX event-bindings are bespoke host glue per game with no shared convention steering authors toward LOCAL feedback for routine actions; screen FX is the easy default.
  category: engine-root
  contractImpact: none
  proposedFix: Additive, non-contract. (a) A documented convention in the scaffold/templates ("screen FX = big rare moments; routine actions = local explosion/sparkle/spawnBurst"), and/or (b) a validator/lint advisory flagging ScreenEffects.shake/flash bound to known high-frequency events. The per-game fix stays per-game (each removes its binding) — done here for breakout.
  otherGamesLikelyAffected: [snake, tower-defense, idle-clicker, survival-arena, helicopter]
  status: queued-for-synthesis

- id: breakout-05
  title: Renderer ignores declarative background.layers (corroborates snake-05)
  area: capability-gap
  symptom: 0.3.0 lists declarative layered/parallax backgrounds as a capability, but background:{layers:[...]} renders only the color; layers never draw — so background depth must be faked with a full-field image entity.
  rootCause: SDK Renderer.drawBackground reads only background.color; it never iterates background.layers, though the schema accepts the layered descriptor.
  category: engine-root
  contractImpact: none
  proposedFix: Additive — implement the layers draw in drawBackground (draw each layer image, offset by scrollX/scrollY). Schema already exists, so it's a pure renderer addition. Workaround used here: a full-field starfield image entity at layer 0 (the snake pattern).
  otherGamesLikelyAffected: [snake, helicopter, survival-arena, tower-defense, idle-clicker]
  status: queued-for-synthesis

- id: breakout-06
  title: Depth — power-ups (multi-ball, paddle-grow, sticky)
  area: depth
  symptom: No power-ups; every brick is identical and breaking one only scores.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Drop occasional capsules from broken bricks (collect-on-touch) that grant multi-ball / wider paddle / sticky-catch; config-driven drop rate and durations. NOT built this pass.
  status: deferred

- id: breakout-07
  title: Depth — multiple brick types (armored, mystery, unbreakable)
  area: depth
  symptom: One brick type (1 HP, fixed score); no variety or puzzle structure.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Add brick variants via config (multi-HP armored bricks using health-and-death hp; mystery bricks that emit a power-up event; layout-only unbreakable blocks). NOT built this pass.
  status: deferred

- id: breakout-08
  title: Depth — combo / streak scoring
  area: depth
  symptom: Every brick is worth a flat blockScore; no reward for sustained rallies.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Multiply score for consecutive brick hits without the ball touching the paddle (reset combo on paddle bounce); config-driven multiplier/curve. NOT built this pass.
  status: deferred

- id: breakout-09
  title: Depth — more / generated levels
  area: depth
  symptom: Only three hand-authored levels; the win screen arrives quickly.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Add more level scenes (or a layout generator) extending the existing level-progression flow chain. NOT built this pass.
  status: deferred

- id: breakout-10
  title: Depth — per-level difficulty ramp (ball speed)
  area: depth
  symptom: Ball speed and paddle size are identical in all three levels; difficulty comes only from brick layout, so later levels do not feel faster.
  rootCause: Genre-standard depth not built (deferred by scope); all levels share the same $cfg values.
  category: localized
  contractImpact: n/a
  proposedFix: Ramp ball speed (and/or shrink the paddle) per level — e.g. scale-by-state keyed on `level`, or per-level config overrides. NOT built this pass.
  status: deferred
```

## Verification (real output)
- **Build:** `vite build` ✓ (`dist/assets/index-VCpbJmWv.js`, after sync-assets).
- **Tests:** `vitest run` → `tests/smoke.test.ts (6 tests)` — **6 passed**.
- **Validate:** `gitcade validate games/breakout` → `✓ PASS — publishable, smoke boot ran 60 frames` (**exit 0**).
- **Brick-shatter (local FX):** data-harness — before: 0 particles; emit `block-broken {id:"brick-r0c0"}` → **14 particles** at cx≈38,cy≈81 (brick-r0c0 center). `pageErrors: []`, `requestFailures: []`.
- **Live loop:** breakout-flow harness — title → level-1 (40 bricks, 1 ball) → run resolves via flow to `over` with `console errors: []`, `pageErrors: []`, `requestFailures: []`.
- **Persistence:** persist-reload harness (`persistentStorage`) — after play `best:250`; **reboot** → title scene restores `best:250`. No errors.
- **Browser (real `main.ts` host, served from freshly-built dist):** before/after screenshots —
  score moved out from under the mute button, "LEVEL" centered, starfield on title + levels,
  local colored brick debris visible at the break point, pause overlay freezes the sim over the
  blurred starfield. `pageErrors: []`, `requestFailures: []` on every run.
- **Not republished to MinIO** (blocked pending approval). To refresh the served artifact bundle:
  `node audit/harness/republish.mjs breakout`.
