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

**Residual edge (not covered, logged for a future bump):** `place-on-free-cell`
excludes only cells occupied by *live* `occupiedTag` entities at placement time. It
cannot exclude a **predicted/imminent cell** — the single cell the head will step
into next tick — which Snake's old `spawnFood` excluded (the S2 fix). At a 40×30
grid (~1198 free cells) the odds of a coin landing on that one cell are ~0.08% and
the only effect is an instant, harmless re-eat, so Snake accepts it. A future
`place-on-free-cell` could take an `excludeCells`/`excludeTags[]` param to close it.

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

---

## Note on restart safety (applies to any promoted system)

`Game.loadScene` clears `world.state` and entities but NOT the `world.events`
listeners. Any promoted system that listens to events must dedupe its attachment
per `World` (the `WeakMap<World, Set<string>>` pattern the library FX parts already
use) and read live `world.state` inside the listener — otherwise a "Play again"
double-attaches and double-counts. Phase 3's custom systems either poll (no
listener) or use that dedupe pattern; a library version should do the same.
