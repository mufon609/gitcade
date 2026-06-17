# LIBRARY-GAPS.md — Generalization Candidates from Phase 3

Phase 3 built six seed games composing **only** `@gitcade/library` + SDK parts.
Where a game genuinely needed a mechanic no catalog part provides, it was written
as a **param-driven custom part** in that game's `src/custom-behaviors/` (all
balance via `$cfg`, so it still passes `gitcade validate`) and logged here as a
candidate for promotion into a future `@gitcade/library` minor release.

These are **proposals for a later library phase**, not Phase 3 work — the SDK and
library are frozen, and nothing here changes a frozen contract. Each entry notes
the game(s) that would benefit, so a future maintainer can see real demand before
generalizing.

> **0.2.0 update (Stage 4 — Snake):** candidate **#2 shipped** as the library
> `place-on-free-cell` system (gap G4). Snake's Stage-4 repin adopted it and
> **deleted** its ~60-line hand-rolled free-cell `spawnFood`. The one residual edge
> that part does *not* cover is logged inline under #2. Candidate #1
> (`trailing-body`) is now slimmed to the body follower; the post-step death/clamp
> guard is added as **#7**.

Four of the six games needed zero custom code (Breakout and Survival Arena are
pure library/SDK composition; Snake/Helicopter need one custom part each; the two
governance flagships need two/three small economy systems). That ratio is itself a
useful signal: the action-game half of the library is complete; the **economy and
control** corners are the gaps.

> **0.3.1 update (0.3.0 game-audit synthesis):** four engine-root findings from the
> audit shipped as **clean additive PATCHes** (no frozen-contract change), retiring the
> per-game workarounds the audited games used:
> - **`background.layers` parallax** (findings snake-05 / breakout-05 / helicopter-04 /
>   survival-arena-07): the renderer now honors the long-standing `background.layers`
>   schema slot (tiled, time-scrolled). Games drop the full-field-image-entity +
>   `auto-scroll` + `velocity` + `$cfg` scroll-key workaround for a declarative
>   `background.layers`. See [CONVENTIONS.md §3](../packages/library/CONVENTIONS.md).
> - **`world.whenRestored(keys)` + `persist-restored` event** (finding IC-9): a
>   deterministic persistence-restore signal, replacing the `isPersistPending` poll-race
>   that enabled idle-clicker's offline-credit bug. See CONVENTIONS.md §5.
> - **`throttle` FX helper** + the **FX-proportionality convention** (findings
>   td-08 / snake-04 / IC-8 / breakout-04 / survival-arena-08): screen FX for big rare
>   beats, LOCAL bursts for routine actions, rate-limited shake for frequent-but-
>   meaningful ones. See CONVENTIONS.md §1.
> - **validator advisories** (findings IC-10 + helicopter-05 / survival-arena-06):
>   non-failing `gitcade validate` warnings for HUD-under-corner-button and
>   full-field-rect-at-center-coords. See CONVENTIONS.md §2, §4.
>
> One audit finding is **deferred, not shipped**: scaling 16px library tilesets to a
> 40px map `tileSize` (finding td-10) would need a new `tilemap` schema field — a schema
> *shape* change, so not PATCH-clean. The drab no-tileset fallback it shares a cluster
> with (td-09) *did* ship: the renderer now tints the fallback from
> `properties[idx].color` and draws a per-cell gridline (additive — `color` rides the
> existing `properties` catchall). td-10 proper is a MINOR-release / asset-bundle item.

> **0.3.2 update (second games+engine audit synthesis).** A fresh end-to-end audit of all
> six games + the engine shipped the following as **clean additive PATCHes** (no frozen-
> contract change), each streamlining several games at once. Per-game *isolated* findings
> (balance/content/feel) were split out into [`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md);
> only the ecosystem-wide work is here.
> - **Renderer honors `entity.rotation` + `scale`** (declared-but-ignored slot, like
>   `background.layers`) + a new library **`face-angle`** behavior that writes rotation
>   (modes velocity/target/pointer/tilt). The data path to a directional sprite for the
>   whole ecosystem. **Adopted:** helicopter's ship now banks with vertical velocity. See
>   CONVENTIONS.md §8. Beneficiaries: helicopter, survival-arena, tower-defense, snake,
>   breakout (juice).
> - **Music synth off-beat fix** (engine bug, all six games): `MusicPlayer.schedule`
>   matched notes by integer-beat equality, so every fractional-beat (eighth-note) note —
>   ~half the ACTION lead and 2/5 of the MENU melody — *never played*. Now scheduled in a
>   half-open per-beat window with a sub-beat offset. The music was playing as a sparse
>   on-beat skeleton on every game.
> - **`ai-aim-and-fire@1.1.0` priority targeting** (`priorityKey`/`priorityOrder`) +
>   **`follow-path@1.1.0` `__pathProgress`** metric. **Adopted:** tower-defense towers now
>   fire at the most-advanced creep ("first"), not the nearest — the #1 TD feel gap (towers
>   shot the wrong creep ~58% of the time). Default unset = nearest (byte-identical).
> - **Library `formatCompact` + `cappedOfflineGain` utils** (LIBRARY-GAPS #6, partial).
>   **Adopted:** idle-clicker's HUD now compacts (`1.23K`/`4.5M`) instead of overrunning as
>   a digit wall, and offline credit uses the shared capped formula. Beneficiaries: any
>   currency/score game (tower-defense gold, survival-arena score).
> - **Behavior-ordering validator advisories** (`mover-without-integrator`,
>   `scale-ramp-after-integrator`) + a tightened `scale-by-state` ordering doc. These catch
>   the survival-arena dead-speed-ramp class (a velocity rescale ordered after the
>   integrator) and the silent never-moves class **statically**, reaching into spawn
>   prototypes where creeps/enemies/bullets live. **Fixed:** survival-arena's reorder + a
>   hardened smoke test that measures displacement, not post-tick `vx`. See CONVENTIONS.md §9.
>
> **Deferred (contract-change → needs a human decision, or additive-but-no-current-consumer):**
> hitbox/collision inset, a text-sprite `format` field, td-10 tileset scaling, a
> `reflect-on-hit` total-speed cap / `forceDir` bias, `spawn-on-event` + powerup effects,
> `shoot-at-pointer`, `damage-flash`/i-frames, level-aware `wave-spawner` density, a
> `move-grid-step` turn buffer. Catalogued with per-game rationale in GAME-IMPROVEMENTS.md.

---

## 1. `trailing-body` — path-history follower
**From:** Snake (`games/snake/src/custom-behaviors/index.ts`, system `snake-body`)
**Demand:** Snake; any "tail", "worm", "light-cycle", or conga-line follower.

A system that records a lead entity's cell/position history and keeps N follower
segments trailing it, growing/shrinking on demand, with self-collision detection.
Generalization: parameterize the spacing (grid step vs. continuous distance), the
grow trigger (score delta, event, or call), and the collision outcome (event vs.
destroy). **As of 0.2.0** Snake's `snake-body` is *just* the follower + collision —
the food placement it used to own is delegated to the library `place-on-free-cell`
(see #2), so this is a cleaner extraction target than it was.
**Params already proven:** `headTag`, `segmentTag`, `tileSize`, `startLength`,
`growBy`, `startDir`, `segmentPrototype`, `scoreKey`/`foodValue` (poll-based growth,
restart-safe — no event listener); plus `placeEvent` (emitted when the board is
empty, consumed by `place-on-free-cell`).

## 2. `respawn-pickup-on-free-cell` — ✅ SHIPPED in 0.2.0 (`place-on-free-cell`, G4)
**From:** Snake — was folded into `snake-body`, **now adopted** as a library part.
**Demand:** Snake, any collectathon needing "always exactly one (or N) pickups on
unoccupied cells".

The library `place-on-free-cell` system spawns a prototype on a verified-free,
in-bounds grid cell (via `randomFreeCell` + `world.rng`) whenever a `trigger` event
fires. Snake wires it to a `place-food` event its `snake-body` emits when the board
is empty, and tags the head + segments with a shared `snake-cell` so the helper
excludes the whole snake. The "first food on the wall" / stacked-spawn symptoms are
impossible by construction. **Snake's ~60-line `spawnFood` is deleted.**

**Residual edge — ✅ RESOLVED in 0.2.1 (the `excludeTags`/`excludeCells` param).**
`place-on-free-cell` previously excluded only cells occupied by *live* `occupiedTag`
entities at placement time; it could not exclude a **predicted/imminent cell** — the
single cell the head will step into next tick — which Snake's old `spawnFood` excluded
(the S2 fix). 0.2.1 added `excludeTags?: string[]` (and `excludeCells?: Vec2[]`) to
`randomFreeCell`/`place-on-free-cell` (part → v1.1.0). **Adopted in Stage 5a:** Snake's
`snake-body` now maintains an invisible marker entity tagged `imminent` on the head's
next cell, and the scene passes `excludeTags: ["imminent"]` — so food can never land on
the imminent cell. Verified by a 126-placement stress probe: `onImminent: 0, onSnake: 0,
oob: 0`. The ~0.08% harmless re-eat is closed by construction.

## 3. `thrust-lift` — one-axis thrust / flappy control
**From:** Helicopter (`games/helicopter/src/custom-behaviors/index.ts`, behavior `thrust-lift`)
**Demand:** Helicopter; jetpack flyers, flappy clones, submarine/balloon games.

Hold a key to accelerate along one axis against a constant opposing acceleration,
with speed clamps both ways. A clean companion to the existing `move-platformer`
(which is impulse-jump, not hold-thrust). **Params already proven:** `thrustKeys`,
`thrust`, `gravity`, `maxUp`, `maxDown`.

> **0.2.0 update (Stage 4 — Helicopter):** the old `flagKey` param (a `world.state`
> boolean touch fallback) was **dropped** — Helicopter's touch button synthesizes
> the same `Space` keydown/keyup the key path already reads (host glue in
> `main.ts`), so the second code path was dead. The behavior is otherwise unchanged
> and still the cleanest extraction target for the flappy/jetpack genre.

## 4. `build-on-request` — tap/click-to-place build system
**From:** Tower Defense (`games/tower-defense/src/custom-behaviors/index.ts`, system `tower-build`)
**Demand:** Tower Defense; any placement/RTS/sandbox game (turrets, walls, plants).

Consume a placement request (`{x,y}` set by a host tap), validate affordability
against a currency key, snap to a grid, reject occupied cells, stamp upgrade-derived
stats onto the spawned entity, and deduct the cost. Pairs naturally with `currency`
and `upgrade-tree`. Restart-safe (listeners attached once per `World` via a
`WeakMap`). **Params proven:** `requestKey`, `currencyKey`, `towerCost`, `tileSize`,
`rangeKey`/`cooldownKey`/`bountyBonusKey`, `baseRange`/`baseCooldown`/`minCooldown`,
`prototype`.

> **0.2.0 update (Stage 4 — Tower Defense, game #6).** `tower-build` was rewritten
> to adopt every relevant 0.2.0 primitive, which sharpens what a library
> `build-on-request` should be: (a) it now reads the **G2 click EDGE directly**
> (`world.input.justReleased()`) — the host `canvas.addEventListener("pointerdown",
> … state.placeRequest)` is **deleted**, so placement is pure data; (b) it gates on
> the **G3 tilemap** (`world.isBuildable(x,y)`) — the headline "towers on the road"
> bug is fixed by refusing a non-buildable tile, with the road moved from rectangle
> `path` entities to ONE data tilemap (drawn by the renderer + queried), no
> double-encoding; (c) the cost is no longer an inline afford/deduct — it sets a
> `buyRequest` the library **`transaction`** system (G5) audits, and the tower is
> spawned on its `tower-bought` OK event (one audited part owns the money). A library
> `build-on-request` should take `tileSize`/`towerTag`/`prototype` + a `buildable`
> require flag and emit a `transaction` request rather than spending inline.
> **Real friction filed — ✅ RESOLVED in 0.2.1.** the library's **`snapToGrid`** (G4,
> `packages/library/src/util.ts`) was **NOT re-exported** from the `@gitcade/library`
> package index, so a game that wanted grid-snap had to inline the 3-line formula
> (Tower Defense did, with a comment). 0.2.1 re-exports `snapToGrid` / `randomFreeCell`
> (+ `Vec2`/`CellBounds`/`RandomFreeCellOpts` types) from `src/index.ts`. **Adopted in
> Stage 5a:** `games/tower-defense/src/custom-behaviors/index.ts` deleted its inlined
> `snapToGrid` and now `import { snapToGrid } from "@gitcade/library"` — same math, one
> source of truth. Verified: an off-center click at (107,93) places a tower snapped to
> cell center (100,100); validate + replay clean.

## 5. `event-counters` — event-driven economy & objective tallies
**From:** Tower Defense (`creep-accounting`)
**Demand:** Tower Defense; any game turning events into currency + win/lose counters.

On named events (e.g. `creep-killed`, `creep-leaked`) award currency (base + an
upgradeable bonus) and ratchet objective counters (`resolved`, `leaked`) that
`win-lose-conditions` reads. Generalizes "reward/penalty on event" — a recurring
need (bounties, combo meters, objective progress). Restart-safe via the same
attach-once pattern.

## 6. Idle-economy trio — `click-to-earn`, `auto-income`, `interval-bonus`
**From:** Idle Clicker (`games/idle-clicker/src/custom-behaviors/index.ts`)
**Demand:** Idle Clicker; any incremental/idle game.

- **`click-to-earn`** — pay `clickPower` per registered click (host increments a
  `clicks` key; the system polls the delta, so it's restart-safe).
- **`auto-income`** — passive `coins += autoRate * dt`, where `autoRate` is raised
  by `upgrade-tree` generator upgrades.
- **`interval-bonus`** — grant a lump every `period` seconds and expose a countdown
  for the HUD (a self-resetting timer; complements `timer-countdown`, which ends the
  game at zero rather than looping).

These three + the library `currency` + `upgrade-tree` are a complete idle kit.
Offline progress itself stays host-side (it needs `Date.now()` and the storage
bridge), but a library helper that computes `cappedOfflineGain(rate, lastSeen, cap)`
would remove the last bit of boilerplate.

> **0.2.0 update (Stage 4 — Idle Clicker):** the trio survived the repin with two
> changes worth promoting. (a) **`click-to-earn` now reads the G2 click EDGE
> directly** (`world.input.justReleased()` + `world.entityAt(x,y)` filtered to a
> `targetTag`), so the host `pointerdown` listener that used to increment a `clicks`
> key is **gone** — the click is pure data. A library `click-to-earn` should take
> `targetTag`/`basePower`/`multKey` and read the edge itself. (b) A small **`prestige`**
> system was added (request-flag driven, like `upgrade-tree`): bank current coins,
> bump a permanent `multKey` by `$cfg.bonus`, reset coins/power/rate/upgrades, emit
> `prestige`. It's the idle-genre counterpart to `upgrade-tree` and a clean
> generalization candidate. **Params proven:** click-to-earn `coinsKey`,`targetTag`,
> `powerKey`,`basePower`,`multKey`,`tapEvent`; prestige `requestKey`,`coinsKey`,
> `multKey`,`bonus`,`powerKey`,`basePower`,`rateKey`,`baseRate`,`levelsKey`,`bankKey`.

> **0.2.0 update — persistence vs. system-seeding RACE (G6, real friction).** The
> library `persistence` system restores a saved key only if it is **absent** from
> `world.state` ("live value wins"). But `currency` (and the custom seed-once
> economy systems) seed `coins`/`clickPower`/`autoRate` **synchronously on tick 1**,
> while `persistence` issues an **async** `storage.get` that resolves a microtask
> later — so on a scene where those systems run, the save is always clobbered before
> it loads (verified: a reboot showed `coins: 0` instead of the saved `12345`).
> Idle Clicker's fix is a **scene-flow workaround**, no engine change: run
> `persistence` on the **title** scene (which seeds none of the economy keys), let
> the async restore land during the title dwell, then carry the restored keys into
> `play` via the title's `flow.persist`. By the time `play` loads, `coins` is already
> present, so `currency` skips its seed. This works but is non-obvious; a robust G6
> would either (i) load persistence **before** the first system tick (a synchronous
> "hydrate on scene load, then build systems" step), or (ii) give `persistence` a
> "restore wins over seed for these keys" mode. Until then, the title-load-then-carry
> pattern is the documented recipe for any game that persists a system-seeded key.
>
> **✅ RESOLVED in 0.2.1 — the scene-scoped hydration claim (option ii).** The SDK
> `World` gained `claimPersistKeys/isPersistPending/resolvePersistKeys/persistPendingKeys`
> (cleared per scene by `Game.loadScene`); the library `persistence` system claims its
> declared keys SYNCHRONOUSLY on its first tick (so it must be ordered *before* seed
> systems) and writes every saved key authoritatively on resolve; the library `currency`
> defers its seed while `isPersistPending(key)`. **Adopted in Stage 5a (idle-clicker
> collapse):** the title-scene `persistence` instance + its `flow.persist` carry are
> DELETED; `persistence` now runs FIRST on the **play** scene alongside `currency` and
> the custom economy systems. The custom seed-once systems (`click-to-earn` → clickPower,
> `auto-income` → autoRate) now mirror `currency` and defer on `isPersistPending`, so a
> saved system-seeded key survives a reload on its OWN scene. Verified: a reboot restores
> `coins/clickPower/autoRate/upgrades/prestigeMult` exactly (the smoke G6 test was
> rewritten for the play-scene model; the headless reload replay is identical to the
> 0.2.0 title-workaround baseline).

## 7. `post-step-death-guard` — same-tick fatal-move detection + on-screen clamp
**From:** Snake (`games/snake/src/custom-behaviors/index.ts`, behavior `snake-guard`)
**Demand:** Snake; any grid mover that must die the instant a step lands on a fatal
cell (wall / its own body / a hazard) without the body visibly leaving the field.

A behavior placed AFTER the mover (`move-grid-step`) in the entity's behavior array
so it observes the freshly-stepped, post-turn position in the SAME tick. A system
runs *before* behaviors (frozen tick order), so a system-level check necessarily
acts one step stale — the head visibly slides off-field for a frame before dying.
This guard reads the post-step cell, ends the run on a wall/self hit, and clamps the
entity back to its last committed on-screen cell. Generalization: parameterize the
fatal predicate (out-of-bounds, a tag-occupied cell, a tilemap hazard flag) and the
outcome event. **0.2.0 added no primitive for this** — it remains a frozen-tick-order
workaround, so it's a genuine candidate. **Params proven:** `stateKey` (shared with
the body system), `tileSize`, `gameOverEvent`.

## 8. State-driven (ramping) difficulty — scale a LIVE value by a level counter
**From:** Helicopter (`scroll-ramp`); **Survival Arena** (`swarm-scale`)
**Demand:** Helicopter (scroll speed); Survival Arena (enemy toughness/speed); any
endless game whose world speed / enemy stats should climb with a difficulty level
(runners, shmups, flappy clones, arena survival, horde modes).

The library `auto-scroll` part forces a **static** `$cfg` velocity every tick — it
cannot read a counter — and `wave-spawner` / `level-progression` resolve their
`$cfg` params **once at scene load**. So 0.2.0 has *no* data path to make a single
play scene scroll FASTER (or its enemies tougher) as its difficulty climbs.
Helicopter's `scroll-ramp` closes that for scroll speed: it sets `entity.vx = vx *
(1 + (level-1) * perLevel)`, reading the `levelKey` counter the library
`level-progression` (scoreGte) maintains, so the ramp stays data-driven (thresholds
+ per-level step all in `$cfg`) with one tiny behavior instead of discrete per-level
scenes. **Params proven:** `vx`, `vy`, `levelKey`, `perLevel`.

> **0.2.0 update (Stage 4 — Survival Arena):** the SAME gap surfaced a second time,
> for *enemy toughness/speed* instead of scroll speed. `wave-spawner` scales the
> swarm COUNT as data (`waveSizeGrowth`), but because it bakes the `prototype`'s
> `$cfg` refs in once at scene load, `ai-chase` speed and `health-and-death` hp
> cannot follow the live `level`. Survival Arena adds a tiny per-enemy `swarm-scale`
> behavior (ordered after `ai-chase`/`velocity`): a one-time hp bump at spawn by
> `hpPerLevel` and a per-tick velocity rescale by `speedPerLevel`, both reading the
> `levelKey` counter — the exact `scroll-ramp` shape applied to a swarm (level 1→8
> took enemy speed 95→188 and hp 80→203 in the verified run). **Params proven:**
> `levelKey`, `speedPerLevel`, `hpPerLevel`, `baseHp`. With TWO games now demanding
> it, the clean generalization is an optional `levelKey`+`perLevel` (or a general
> `scaleByStateKey`) on the existing `auto-scroll`/`ai-chase`/`health-and-death`
> params, or a `level`-aware mode on `wave-spawner` that re-resolves a small set of
> prototype `$cfg` multipliers per wave — rather than shipping bespoke parts.
>
> **✅ RESOLVED in 0.2.1 — the library `scale-by-state` behavior.** Ships as a single
> data part that ramps a live field by `factor = 1 + perLevel*(level-1)` read from a
> `world.state` level counter, in three modes — `set` (force `base*factor` each tick,
> for an auto-scroll velocity), `multiply` (rescale the live velocity another behavior
> set this frame), `once` (one-time guarded stat bump) — with `target` = `vx|vy|
> velocity|state:<key>`, all balance via `$cfg`. **Adopted in Stage 5a:** Helicopter's
> custom `scroll-ramp` is DELETED → one `scale-by-state{target:"velocity",mode:"set",
> baseX:$cfg.scrollVx,perLevel:$cfg.speedRampPerLevel}` on the obstacle (verified: vx
> -230 @ lvl1 → -455 @ lvl8, identical to the old behavior). Survival Arena's custom
> `swarm-scale` is DELETED → TWO instances on the enemy: `mode:"multiply" target:
> "velocity"` after `ai-chase` (speed 95→188) and `mode:"once" target:"state:hp" base:
> $cfg.enemyHp` after `health-and-death` (hp 80→203 @ lvl8) — both matching the old
> custom part. Two custom behaviors removed; balance still 100% in config.

---

## Note on restart safety (applies to any promoted system)

`Game.loadScene` clears `world.state` and entities but NOT the `world.events`
listeners. Any promoted system that listens to events must dedupe its attachment
per `World` (the `WeakMap<World, Set<string>>` pattern the library FX parts already
use) and read live `world.state` inside the listener — otherwise a "Play again"
double-attaches and double-counts. Phase 3's custom systems either poll (no
listener) or use that dedupe pattern; a library version should do the same.
