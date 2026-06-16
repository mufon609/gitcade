# Audit Summary — snake (0.3.0 engine)

**Counts:** 3 applied (localized) · 2 queued (engine-root) · 4 deferred (depth).
Working tree only — **not committed**. Rebuilt + **republished to MinIO** (`snake/main`, 30 objects).

---

## Review
Snake was mechanically sound (grid move, body follow, self/wall death, food respawn, pause,
mute, persistence all worked) but had three feel/presentation problems and one void-like look.
(1) Every coin pickup — the most frequent action — fired a **full-screen yellow flash**
(`f.flash("#ffcd75", 0.08)`), reading as a strobe. (2) The score HUD sat at top-left
(`x:12,y:10`) directly **under the DOM mute button**, so the live score was partially hidden
behind the 🔊 icon during play. (3) The playfield was a **flat near-black void** — no framing,
no texture — which is the "graphics feel shallow" the user reported; the lethal walls were also
invisible until you died on them. Now: pickups give **local sparkle particles** at the eaten
cell (+ the existing collect sound), the score is **centered at the top** ("SCORE" + value)
clear of both corner buttons, and all three scenes share a **starfield background** with the
play scene gaining an **indigo frame** that marks the lethal boundary. The snake (green) and
coin (orange) stay high-contrast and readable against the navy. Pause, mute, persistence, and
input were verified working and left as-is.

## Actions taken (localized fixes — applied)
- **`src/main.ts`** — removed the `collect: (f) => f.flash("#ffcd75", 0.08)` screen-flash binding
  (kept the `snake-dead` shake+red-flash; a death is a big, infrequent event and is proportionate).
  Rewrote the FX comment to document that routine pickup feedback is now LOCAL (the `sparkle`
  system in play.json) and that screen effects are reserved for big moments.
- **`src/scenes/play.json`** —
  - Added a `sparkle` FX system (`sparkle@1.0.0`, `event:"collect"`, themed colors
    yellow/white/green) → bursts particles at the eaten coin's position (`eventPos` resolves the
    food entity that `collect-on-touch` names in its event payload). Numeric tuning (count/speed/
    ttl) intentionally omitted — the library defaults (8/70/0.6) are tuned for pickups and the
    validator's games-are-data rule rejects non-structural numeric literals in params.
  - Moved the score HUD off the top-left corner: split into `hud-score-label` ("SCORE", dim) +
    `hud-score` (value), both `align:center` at `x:400` — clear of the mute (top-left) and pause
    (top-right) DOM buttons. Both still `layer:100`, `bind:"score"` retained.
  - Added a `bg-stars` background entity (starfield.png, `layer:0`) and a `playfield-frame`
    (hollow `shape` rect, transparent fill + `#3b5dc9` stroke, `layer:1`) marking the lethal
    boundary. Both tagged `decor`, no behaviors — pure decoration; neither carries `snake-cell`
    or `imminent`, so food placement, collision, and the body systems are untouched.
- **`src/scenes/title.json`, `src/scenes/over.json`** — added the same `bg-stars` background
  (`layer:0`, below the `layer:10` text) so the title → play → over flow is visually cohesive.

## Decisions made
- **`sparkle` over a hand-rolled `spawnBurst`** — sparkle is the declarative, data-driven library
  part purpose-built for pickups; keeping FX as scene data (not host code) matches "games are data".
- **Kept the death FX** (`shake(12,0.45,36)+flash("#b13e53",0.3)`) — judged proportionate in-browser;
  a lost run is exactly the kind of big, rare event screen effects are for (seeded note agreed).
- **Background via an entity, not declarative `background.layers`** — the 0.3.0 schema *accepts* a
  layered/parallax descriptor but the frozen renderer's `drawBackground` only fills `color` and
  never draws the layers (see snake-05). A full-field `image` entity at `layer:0` is the working,
  data-driven path, so I used it.
- **Frame kept subtle and play-only** — a 2px indigo stroke at the canvas edge reads as an
  intentional "screen" accent (matches the button accent) without being garish; it lives only in
  the play scene where "the walls" have gameplay meaning, not on the menus.
- **No sprite reskins** — head (green blob), body (green segment), coin (orange) already read as
  intentional, coherent art and pop against the new background; reskinning was unjustified churn.
- **Did not implement depth** (obstacles / speed ramp / bonus food / wrap mode) — deferred by scope;
  logged as backlog below.

## Findings

```
- id: snake-01
  title: Full-screen flash on every coin pickup (routine-action strobe)
  area: fx-juice
  symptom: The whole screen flashed yellow on every food pickup — the single most frequent action — reading as a strobe.
  rootCause: main.ts bound collect → ScreenEffects.flash("#ffcd75",0.08); a screen-level effect used for a high-frequency routine action.
  category: localized
  contractImpact: n/a
  proposedFix: Remove the collect screen-flash; add the library `sparkle` FX system (event:"collect") so feedback is LOCAL particles at the eaten cell, plus the existing collect sound.
  filesTouched: [games/snake/src/main.ts, games/snake/src/scenes/play.json]
  status: applied
  verified: data-harness emit "collect" → 8 particle entities spawn (play-game.mjs); validate exit 0; browser play screenshots show no strobe.

- id: snake-02
  title: Score HUD hidden behind the mute button
  area: layering-ui
  symptom: During play the live score sat at top-left (x:12,y:10) directly under the 🔊 DOM mute button, so the digit was partially obscured.
  rootCause: Canvas HUD text positioned in the same top-left corner the host's absolutely-positioned mute button (z-index 5) occupies; the DOM button always draws over the canvas.
  category: localized
  contractImpact: n/a
  proposedFix: Move the score to top-center (x:400, align:center) with a small "SCORE" caption — clear of both corner buttons (mute top-left, pause top-right).
  filesTouched: [games/snake/src/scenes/play.json]
  status: applied
  verified: before/after browser screenshots (top-left overlap → centered, unobstructed "SCORE 0").

- id: snake-03
  title: Flat void playfield; lethal walls invisible
  area: layering-ui
  symptom: Playfield was flat near-black with no framing or texture ("graphics feel shallow"); the deadly walls were invisible until death.
  rootCause: Scene background was a solid color only; nothing delineated the play area or its boundary.
  category: localized
  contractImpact: n/a
  proposedFix: Add a starfield background entity (layer 0) on all three scenes for depth/cohesion, and an indigo playfield frame (hollow stroked rect, layer 1) on the play scene to mark the lethal boundary. Pure decoration (tag decor, no behaviors).
  filesTouched: [games/snake/src/scenes/play.json, games/snake/src/scenes/title.json, games/snake/src/scenes/over.json]
  status: applied
  verified: browser screenshots (title/play/over) show cohesive starfield + frame; snake/coin stay high-contrast; no request failures (starfield.png loads from MinIO); validate exit 0.

- id: snake-04
  title: Screen-flash on routine actions is a cross-game anti-pattern
  area: fx-juice
  symptom: Same defect as snake-01 recurs across games — a full-screen ScreenEffects.flash bound to a high-frequency routine event (pickup/placement) in each game's hand-written main.ts.
  rootCause: FX event-bindings are bespoke host glue in every game with no shared convention steering authors toward LOCAL feedback (sparkle/spawnBurst) for routine actions; screen FX is the easy default.
  category: engine-root
  contractImpact: none
  proposedFix: Additive, non-contract. Either (a) a documented convention in templates/scaffold + the per-game audits ("screen effects = big rare moments; routine actions = local sparkle/burst"), and/or (b) a validator/lint advisory that flags ScreenEffects.flash/shake bound to known high-frequency events. The fix itself stays per-game (each removes its binding).
  otherGamesLikelyAffected: [tower-defense (already addressed in commit 64ec732), idle-clicker, survival-arena, breakout, helicopter]
  status: queued-for-synthesis

- id: snake-05
  title: Renderer ignores declarative background.layers (parallax is a no-op)
  area: capability-gap
  symptom: The 0.3.0 framework lists "declarative layered/parallax backgrounds" as a capability to maximize, but setting background:{color,layers:[...]} renders only the color — the layers never draw.
  rootCause: SDK Renderer.drawBackground (packages/sdk renderer, dist index.cjs ~line 1042) reads only bg.color and fillRects it; it never iterates bg.layers, though BackgroundSchema (sdk ~line 813) fully accepts the layered descriptor (src/scrollX/scrollY).
  category: engine-root
  contractImpact: none
  proposedFix: Additive — implement the layers draw in drawBackground (draw each layer image, offset by scrollX/scrollY against a camera/scroll origin; static when 0). Schema already exists, so this is a pure renderer addition, no contract change. (Workaround used here: a full-field image entity at layer 0.)
  otherGamesLikelyAffected: [helicopter, survival-arena, breakout, tower-defense, idle-clicker]  # any game wanting parallax/layered depth; auto-scrollers most
  status: queued-for-synthesis

- id: snake-06
  title: Depth — obstacles / interior walls
  area: depth
  symptom: No interior hazards; the field is empty except food.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Add static/again-spawning obstacle cells (a `snake-cell`-like lethal tag the guard already pattern-supports); config-driven density. NOT built this pass.
  status: deferred

- id: snake-07
  title: Depth — speed ramp as the snake grows
  area: depth
  symptom: stepInterval is constant; difficulty never escalates.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Drive stepInterval down as length/score climbs (scale-by-state or a small system), bounded by config. NOT built this pass.
  status: deferred

- id: snake-08
  title: Depth — bonus / timed food
  area: depth
  symptom: One coin type, fixed value; no risk/reward.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: Occasional higher-value timed food that despawns; config-driven cadence/value. NOT built this pass.
  status: deferred

- id: snake-09
  title: Depth — wrap vs no-wrap mode
  area: depth
  symptom: Walls are always lethal; no wrap-around variant.
  rootCause: Genre-standard depth not built (deferred by scope).
  category: localized
  contractImpact: n/a
  proposedFix: A config flag toggling edge-wrap (head re-enters opposite side) vs lethal walls; the frame would key off the mode. NOT built this pass.
  status: deferred
```

## Verification (real output)
- **Build:** `vite build` ✓ (`dist/assets/index-BYnXTYgI.js`).
- **Tests:** `vitest run` → `tests/smoke.test.ts (4 tests)` — **4 passed**.
- **Validate:** `gitcade validate games/snake` → `✓ PASS — publishable, smoke boot ran 60 frames` (**exit 0**).
- **Sparkle (local pickup FX):** data-harness `emit "collect"` → **8 particle entities** spawn in
  the play scene; `pageErrors: []`, `requestFailures: []`.
- **Persistence:** `persist-reload` harness → best `137` set, survives `reboot`, **restored 137**; no errors.
- **Browser (artifact server, real main.ts host glue):** title/play/pause/over screenshots from
  `http://localhost:3001/artifacts/snake/main/index.html` after `republish.mjs snake` —
  centered unobstructed "SCORE", starfield on all scenes, indigo frame on play, pause overlay
  freezes the sim over a blurred starfield. `errors: []` on every run.
- **Republished to MinIO:** `snake/main` (30 objects) so the served bundle reflects these changes.
