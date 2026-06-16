# `@gitcade/sdk` + `@gitcade/library` 0.2.0 — Build Notes (Stage 3b)

**Status:** IMPLEMENTED. Both packages at `0.2.0`, pack-clean, all suites green,
all `g*` acceptance probes PASS, 0.1.x additivity verified. Awaiting the human
`[PUBLISH]` gate (republish to npm + Stage-4 consumer repins).

Built to the 0.2.0 design spec (`SDK-0.2.0-DESIGN.md` — removed in the 0.3.0
audit-dir cleanup; recoverable from git history; settled spec, all 7 OQs
resolved). This file records what landed, the decisions that needed a judgment
call during implementation, the pasted probe results, and what Stage 4 inherits.

---

## What landed

### SDK (`packages/sdk`)
- **G2 — click edge + pick.** `Input.justPressed/justReleased/clicked/taps/endFrame`
  (`runtime/input.ts`); `onPDown`/`onPUp` record one-tick edges (held-set delete
  unchanged); `Game.update()` calls `input.endFrame()` at tick end. `World.entityAt(x,y,tag?)`
  + `pick()` (topmost by layer/zIndex).
- **G3 — tilemap.** `TilePropsSchema` + `TilemapSchema.properties` (additive optional);
  `World.tilemap` (set in `loadScene`) + `tileAt`/`isBuildable`/`cellRect`; renderer
  draws the tilemap under entities (`runtime/renderer.ts`, OQ-3) — tileset blit when an
  image is present, muted per-index fallback fills otherwise; no-op when absent.
- **G1 — scene flow (keystone).** `SceneFlowSchema` (`flow.on`, `flow.persist`) on
  `SceneSchema`; `World.requestScene`/`takePendingScene` + `SceneChangeRequest`;
  `Game.loadScene(id, opts?)` preserves the `prevPersist ∪ keepExtra` slice (empty ⇒
  byte-identical 0.1.x full wipe); flow-edge listeners installed per scene and **torn
  down on scene change** (`flowUnsubs`); the scene-change queue is **drained at the end
  of `Game.update()`** (OQ-5) so headless/validator/harness callers all see transitions.
- **G5 assist — economy.** `World.canAfford(key,cost)` / `spend(key,cost)` (OQ-2).
- **G6 binding — persistence.** `PersistSchema` on the manifest (OQ-6); `createGame`
  threads `manifest.persist` → `world.persist`. No storage wire change.

### Library (`packages/library`)
- **G5 — `transaction` system** (afford→deduct→emit; wraps the SDK assist).
- **G6 — `persistence` system** (round-trips `world.persist` keys through `world.storage`).
- **G4 — `place-on-free-cell` system** + `util.snapToGrid`/`randomFreeCell` +
  `wave-spawner` `placement` param (`"free-cell"` | default `"literal"`).
- **OQ-7 — `tap-emit` UI behavior** (emits a flow event on click; reads the G2 edge + pick).
- New `parts/*.json` for all four + `wave-spawner` param docs; `CATALOG.json`
  regenerated (85 parts, `@gitcade/library@0.2.0`).

---

## Decisions made during implementation (judgment calls within the settled spec)

1. **`world.tilemap` is a plain (non-`readonly`) field, read-only by convention.**
   `Game.loadScene` must assign it; parts must not. Documented in the JSDoc. This
   makes `"tilemap" in world` always true (the harness `worldHasTilemap` flips to
   `true` even for scenes with no tilemap) — a harness-surface change, not a game
   behavior change.
2. **Flow-edge listeners are tracked and removed on every scene change** (`flowUnsubs`),
   rather than globally clearing the event bus. The existing FX emitters keep their
   own `WeakMap`-based attach-once listeners on the shared bus; a blanket clear would
   disturb them, so the narrower teardown was chosen (re-entering a scene never
   accumulates duplicate flow edges — covered by a unit test).
3. **`place-on-free-cell` uses the sanctioned `WeakMap<World, Set>` attach-once idiom**
   (identical to `fx/emitters.ts`), spawning inside the trigger listener. This is the
   established pattern for event-driven systems and avoids both module-mutable state
   and cross-scene listener leaks.
4. **`persistence` never writes an empty snapshot.** Save is gated on "≥1 declared key
   present + changed (or interval due)", not on a `loaded` flag — because the async
   `storage.get` resolves only after a synchronous `stepFrames` block. This is what
   makes the reboot path correct: the first ticks after a reboot (state empty, restore
   pending) skip saving, so the stored value is never clobbered before it is restored.
   "Live value wins" on restore (only absent keys are filled).
5. **`snapToGrid`/`randomFreeCell` stayed as `util.ts` helpers** (per §2 G4), not
   separate catalog parts. The catalogued G4 surface is the `place-on-free-cell` system
   + the `wave-spawner` `placement` param; this keeps `LIBRARY_SYSTEM_TYPES` and the
   catalog 1:1 (the catalog test enforces exact correspondence).

**Frozen contracts:** storage wire protocol untouched (G6 only consumes `world.storage`);
the fixed tick order (systems→behaviors→prune→events.clear) is unchanged — `endFrame()`
and the scene-queue drain run at tick *end*, never mid-tick; all new randomness uses
`world.rng`. No shipped game's source or pins were modified.

---

## Probe results (pasted — all PASS on 0.2.0)

Run via `node audit/harness/run-g-probes.mjs` (boots each scene in headless Chrome
through the real `createGame` path; the harness rebuilds the browser bundle from the
freshly built `dist`).

```
g0-regression  spawn positions (no placement) => {"count":13,"distinct":1,"sample":"106,81"}   # 0.1.x stacked — unchanged
g1-scene-flow  api-surface => world.requestScene present; input.justPressed:true
               scene-id-now => "two"            final state => { gold: 100 }                     # transition + persist
g2-click-edge  entityAt(150,120,"pickable") => { id:"b", ... }
               justReleased (one tick) => [{id:1,x:150,y:120}]   after a tick => []              # one-tick edge
g3-tilemap     tileAt(75,75) => 1   isBuildable(75,75) => false   isBuildable(25,25) => true
g4-free-cell   spawned centers => 13 DISTINCT in-bounds cells (no stacking)
g5-transaction final state => { gold: 20, purchaseRequest: "" }   # 50−30 deducted; 999 denied
g6-persist     state after reboot => { best: 4242 }  (scratch absent)                            # restored via storage
```

`apiSurface().has` flips fully true on 0.2.0: `world.entityAt/pick/tileAt/tilemap/
spend/canAfford`, `input.clicked/justPressed`.

## Test + gate results
- `@gitcade/sdk`: **51 tests pass** (incl. new `runtime-0.2.0` + `schema-0.2.0`).
- `@gitcade/library`: **84 tests pass** (incl. new `systems-0.2.0`; catalog in sync, 85 parts).
- `gitcade validate examples/pong` → PASS (60-frame smoke). All 5
  `packages/library/proofs/*` (0.1.x ecosystem games) → PASS on the 0.2.0 SDK+catalog
  — the additivity proof. (The `games/*` seed dirs report only `catalog-unavailable`,
  an environmental missing-per-game-`node_modules` condition, version-independent and
  pre-existing — not a schema regression. They repin + install in Stage 4.)
- `npm pack --dry-run` clean: `@gitcade/sdk@0.2.0` (21 files), `@gitcade/library@0.2.0`
  (124 files).

---

## What Stage 4 inherits

**New primitives available to games (all additive, opt-in by bumping `sdkVersion`
→ `0.2.0` and, for ecosystem games, `libraryVersion` → `0.2.0`):**
- SDK: `flow`/`requestScene` scene graph + persist hand-off; `input.justPressed/
  justReleased/clicked`; `world.entityAt/pick`; `world.tileAt/isBuildable/cellRect`
  + tilemap rendering; `world.canAfford/spend`; `manifest.persist` → `world.persist`.
- Library: `transaction`, `persistence`, `place-on-free-cell`, `tap-emit`,
  `wave-spawner placement:"free-cell"`, `snapToGrid`/`randomFreeCell`.

**Repin order (from spec §3.2 — simple→complex so the heaviest consumer lands last
with every primitive available):**
1. **Snake** — G1 (flow demo), G4 (food via `place-on-free-cell`), G6 (best score).
2. **Breakout** — G1 (levels/flow).
3. **Helicopter** — G1; verify `wave-spawner` placement param.
4. **Survival Arena** — G1, G4 (spawn scatter), G5 if economy.
5. **Idle Clicker** — G6 (prestige/coins), G5 (economy dedupe), G1.
6. **Tower Defense** — all of G2 (click-place), G3 (buildable road tilemap), G4
   (grid-snap), G5 (buy), G1 (flow). Heaviest; last.

Each game bumps its pins, deletes the GameShell flow code it can now express as data
(the Snake title→play→over demo in spec §G1 proves deletion is possible — **not done
here**; Stage 4 per-game), and re-verifies by replay. Offline-credit math
(idle-clicker) stays out of scope (OQ-4) — generic persistence only.

---

## `[PUBLISH]` note (human gate)

Both packages are pack-clean at `0.2.0` but **not published**. As with the
`sdk@0.1.1`/`library@0.1.1` patch wave, the human publishes to npm at the gate:

```
cd packages/sdk     && npm publish        # @gitcade/sdk@0.2.0
cd packages/library && npm publish        # @gitcade/library@0.2.0 (prepublishOnly regenerates catalog + builds)
```

Then Stage 4 repins consumers (seed games, `platform/web`, scaffold template) to
`0.2.0` in their own sessions. `platform/web` and the seed-game pins were left
untouched here by constraint.

---

# 0.2.1 — engine cleanup (Stage 5b)

**Status:** IMPLEMENTED. Both packages bumped `0.2.0 → 0.2.1`, pack-clean, all
suites green (`sdk` 51, `library` 92), all `g*` probes PASS, `examples/pong` +
all 5 `proofs/*` still validate, 0.1.x **and** 0.2.0 scenes behave identically.
Awaiting the human `[PUBLISH]` gate. **Scope was `packages/sdk` + `packages/library`
ONLY** — no game or `platform/` source was touched.

Built to the four gaps `LIBRARY-GAPS.md`
(#2, #4, #6, #8) surfaced. **Additive / backward-compatible**: every change is a new
API method, a new param, a new behavior, or a new export. The frozen contracts are
untouched — storage **wire protocol** unchanged (`storage/protocol.ts` not edited),
the fixed tick order (systems → behaviors → prune → events.clear → endFrame →
scene-drain) preserved, all new randomness via `world.rng`.

## What changed

### #6 — persistence-vs-system-seeding race  *(the real correctness fix)*
The 0.2.0 `persistence` restored a key only if **absent** ("live value wins"), but
`currency` (and per-game seed-once economy systems) set their key **synchronously on
tick 1**, while the restore is an **async** `storage.get` that resolves a microtask
later — so on a seeding scene the save was always clobbered before it loaded. Idle
Clicker worked around it by running `persistence` on the **title** scene and carrying
the restored keys into `play` via `flow.persist`.

**Primitive fix (no per-game workaround):** a scene-scoped *hydration claim* on
`World` (SDK):
- `world.claimPersistKeys(keys)` / `isPersistPending(key)` / `resolvePersistKeys(keys)`
  + `persistPendingKeys()` (host helper). `Game.loadScene` clears the claim set on
  every transition (scene-scoped).
- The library **`persistence`** system now claims its declared keys **synchronously on
  its first tick** (so it must be ordered *before* seed systems in the scene's `systems`
  array — the natural authoring), fires the async load, and on resolve **writes every
  saved key authoritatively** then releases the claim (a key with no saved value is
  released so its seed fires next tick).
- The library **`currency`** system now **defers its seed** (returns early) while
  `world.isPersistPending(currencyKey)` is true. With no persistence claiming the key
  this is a no-op → identical 0.2.0 behavior (additive).

Determinism preserved: claims are synchronous; the async-resolution ordering is the
same microtask model 0.2.0 already had. Idle Clicker's title-scene workaround still
works (the title scene seeds none of the economy keys, so claim/defer never fires
there). Verified by a new `library/test/systems-0.2.0.test.ts` race test: a saved
`coins` balance survives a reboot of the **same** scene that runs `currency` — on 0.2.0
that scene would have clobbered the save with `0`.

### #4 — re-export `snapToGrid` / `randomFreeCell` from `@gitcade/library`  *(trivial)*
They existed in `src/util.ts` but weren't re-exported from the package index, so games
inlined the 3-line grid-snap formula (Tower Defense did). Now
`export { snapToGrid, randomFreeCell, type Vec2, type CellBounds, type RandomFreeCellOpts }`
from `src/index.ts`. The rest of `util.ts` stays internal. Test added.

### #8 — scale a live state key from data  *(landed)*
New library **behavior `scale-by-state`** (+ `parts/behaviors/scale-by-state.json`,
catalogued). Ramps a live field by `factor = 1 + perLevel * (level-1)` read from a
`world.state` level counter, in three modes: `set` (force `base*factor` each tick —
Helicopter `scroll-ramp`), `multiply` (rescale the live velocity another behavior set
this frame — Survival `swarm-scale` speed), `once` (one-time stat bump, guarded —
Survival `swarm-scale` hp). `target` = `vx|vy|velocity|state:<key>`. All balance via
`$cfg`. Tests cover all three shapes.

### #2 — `place-on-free-cell` / `randomFreeCell` exclusion  *(landed)*
`randomFreeCell` gained `excludeTags?: string[]` (extra tags whose live entities block
their cell) and `excludeCells?: Vec2[]` (explicit world points); `place-on-free-cell`
exposes `excludeTags` as a param (part bumped to **v1.1.0**). A game closes Snake's
~0.08% imminent-cell re-eat by tagging a marker at the head's next cell. Test added.

## Catalog / counts
`CATALOG.json` regenerated → **86 parts** (`@gitcade/library@0.2.1`): +1 behavior
(`scale-by-state`); `place-on-free-cell` → v1.1.0. `LIBRARY_BEHAVIOR_TYPES` is now 19,
systems still 12. Both package READMEs updated for the new exports/behaviors.

## Gate results (pasted)
- `@gitcade/sdk`: **51 tests pass**; typecheck clean.
- `@gitcade/library`: **92 tests pass** (was 84; +8 across the four gaps); typecheck
  clean; catalog in sync (86 parts).
- `g*` probes (headless Chrome, real `createGame`): all PASS. `g0-regression` still
  reports the 0.1.x stacked-spawn baseline `{count:13, distinct:1}` (unchanged —
  additivity). `g6-persist` restores `best:4242`, `scratch` absent; the world surface
  now exposes `claimPersistKeys/isPersistPending/persistPendingKeys/resolvePersistKeys`.
- `gitcade validate examples/pong` → PASS; all 5 `proofs/*` → PASS on the 0.2.1
  build (0.1.x ecosystem games unaffected — the additivity proof).
- `npm pack --dry-run` clean: `@gitcade/sdk@0.2.1` (21 files), `@gitcade/library@0.2.1`
  (125 files).

## Per-game workarounds now REMOVABLE in Stage 5a
- **Idle Clicker — title-scene persistence dance.** With #6 fixed, persistence +
  `currency`/economy seed systems can run on the **same play scene**: order
  `persistence` first, declare the keys, drop the title-scene `persistence` instance
  and the `flow.persist` carry that existed *only* to dodge the race. (Keep any
  `flow.persist` used for genuine in-session hand-off.) The economy keys restore
  authoritatively because `currency` defers to the claim.
- **Helicopter — custom `scroll-ramp` behavior** → replace with library
  `scale-by-state` (`target:"velocity"`, `mode:"set"`, `baseX/baseY`, `perLevel`,
  `levelKey`). Delete `games/helicopter/src/custom-behaviors` scroll-ramp.
- **Survival Arena — custom `swarm-scale` behavior** → replace with **two**
  `scale-by-state` instances on the enemy: `mode:"multiply" target:"velocity"`
  (speed, ordered after `ai-chase`) and `mode:"once" target:"state:hp" base:$cfg`
  (hp, ordered after `health-and-death`). Delete the custom part.
- **Tower Defense — inlined grid-snap** → import `snapToGrid` from `@gitcade/library`
  (#4) instead of the inline formula.
- **Snake — imminent-cell re-eat (optional)** → if desired, tag a marker at the head's
  next cell and pass `excludeTags` to `place-on-free-cell` (#2). Low priority (~0.08%).

These are *enabled* here, **not performed** (games are out of scope this session; Stage
5a repins to `0.2.1` and applies them, re-verifying by replay).

## `[PUBLISH]` note (human gate)
Both packages pack-clean at `0.2.1`, **not published**. Human publishes at the gate:

```
cd packages/sdk     && npm publish        # @gitcade/sdk@0.2.1
cd packages/library && npm publish        # @gitcade/library@0.2.1 (prepublishOnly regenerates catalog + builds)
```
