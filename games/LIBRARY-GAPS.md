# LIBRARY-GAPS.md — Generalization Candidates

The six seed games compose **only** `@gitcade/library` + SDK parts. Where a game
genuinely needs a mechanic no catalog part provides, it lives as a **param-driven
custom part** in that game's `src/custom-behaviors/` (all balance via `$cfg`, so it
still passes `gitcade validate`) and is logged here as a candidate for promotion into a
future `@gitcade/library` minor release.

These are **proposals for a later library phase** — nothing here changes a frozen contract.
Each entry notes the game(s) that would benefit, so a future maintainer can see real demand
before generalizing. A candidate is removed from this list once it ships as a library part.

The action-game half of the library is complete; the **economy and control** corners are
where the remaining custom parts cluster.

---

## 1. `trailing-body` — path-history follower
**From:** Snake (`games/snake/src/custom-behaviors/index.ts`, system `snake-body`)
**Demand:** Snake; any "tail", "worm", "light-cycle", or conga-line follower.

A system that records a lead entity's cell/position history and keeps N follower segments
trailing it, growing/shrinking on demand, with self-collision detection. Generalization:
parameterize the spacing (grid step vs. continuous distance), the grow trigger (score delta,
event, or call), and the collision outcome (event vs. destroy). Snake's `snake-body` is the
follower + collision only (food placement is delegated to the library `place-on-free-cell`),
so it's a clean extraction target.
**Params already proven:** `headTag`, `segmentTag`, `tileSize`, `startLength`, `growBy`,
`startDir`, `segmentPrototype`, `scoreKey`/`foodValue` (poll-based growth, restart-safe — no
event listener); plus `placeEvent` (emitted when the board is empty, consumed by
`place-on-free-cell`).

## 2. `thrust-lift` — one-axis thrust / flappy control
**From:** Helicopter (`games/helicopter/src/custom-behaviors/index.ts`, behavior `thrust-lift`)
**Demand:** Helicopter; jetpack flyers, flappy clones, submarine/balloon games.

Hold a key (or a bound input action) to accelerate along one axis against a constant opposing
acceleration, with speed clamps both ways. A clean companion to the existing `move-platformer`
(impulse-jump, not hold-thrust). **Params already proven:** `thrustKeys`, `thrust`, `gravity`,
`maxUp`, `maxDown`.

## 3. `build-on-request` — tap/click-to-place build system
**From:** Tower Defense (`games/tower-defense/src/custom-behaviors/index.ts`, system `tower-build`)
**Demand:** Tower Defense; any placement/RTS/sandbox game (turrets, walls, plants).

Read the click EDGE (`world.input.justReleased()`), grid-snap the tap (`snapToGrid`), gate on
a buildable tilemap cell (`world.isBuildable`), reject occupied cells, route the cost through
the library `transaction` system (afford → deduct → emit), and spawn the prototype on the OK
event. Pairs naturally with `currency` and `upgrade-tree`; registers its OK-event listener via
`world.events.onScene` (scene-scoped, no manual dedup). A library `build-on-request` should
take `tileSize`/`towerTag`/`prototype` + a `buildable` require flag and emit a `transaction`
request rather than spending inline. **Params proven:** `currencyKey`, `towerCost`,
`buyRequestKey`, `boughtEvent`, `tileSize`, `rangeKey`/`cooldownKey`/`bountyBonusKey`,
`baseRange`/`baseCooldown`, `towerTag`, `prototype`.

## 4. `event-counters` — event-driven economy & objective tallies
**From:** Tower Defense (`creep-accounting`)
**Demand:** Tower Defense; any game turning events into currency + win/lose counters.

On named events (e.g. `creep-killed`, `creep-leaked`) award currency (base + an upgradeable
bonus) and ratchet objective counters (`resolved`, `leaked`) that `win-lose-conditions` reads.
Generalizes "reward/penalty on event" — a recurring need (bounties, combo meters, objective
progress). Restart-safe by registering its listeners via `world.events.onScene`.

## 5. Idle-economy trio — `click-to-earn`, `auto-income`, `interval-bonus`
**From:** Idle Clicker (`games/idle-clicker/src/custom-behaviors/index.ts`)
**Demand:** Idle Clicker; any incremental/idle game.

- **`click-to-earn`** — pay `clickPower` per click; reads the click EDGE
  (`world.input.justReleased()` + `world.entityAt` filtered to a `targetTag`) directly.
- **`auto-income`** — passive `coins += autoRate * dt`, where `autoRate` is raised by
  `upgrade-tree` generator upgrades.
- **`interval-bonus`** — grant a lump every `period` seconds and expose a countdown for the
  HUD (a self-resetting timer; complements `timer-countdown`, which ends the game at zero).

These three + the library `currency` + `upgrade-tree` + the small **`prestige`** system (bank
coins, bump a permanent `multKey`, reset, emit `prestige`) are a complete idle kit. Offline
progress stays host-side (it needs `Date.now()` + the storage bridge), atop the library
`cappedOfflineGain` helper. **Params proven:** click-to-earn
`coinsKey`/`targetTag`/`powerKey`/`basePower`/`multKey`/`tapEvent`; prestige
`requestKey`/`coinsKey`/`multKey`/`bonus`/`powerKey`/`basePower`/`rateKey`/`baseRate`/`levelsKey`/`bankKey`.

## 6. `post-step-death-guard` — same-tick fatal-move detection + on-screen clamp
**From:** Snake (`games/snake/src/custom-behaviors/index.ts`, behavior `snake-guard`)
**Demand:** Snake; any grid mover that must die the instant a step lands on a fatal cell
(wall / its own body / a hazard) without the body visibly leaving the field.

A behavior placed AFTER the mover (`move-grid-step`) in the entity's behavior array so it
observes the freshly-stepped, post-turn position in the SAME tick. A system runs *before*
behaviors (frozen tick order), so a system-level check necessarily acts one step stale — the
head visibly slides off-field for a frame before dying. This guard reads the post-step cell,
ends the run on a wall/self hit, and clamps the entity back to its last committed on-screen
cell. Generalization: parameterize the fatal predicate (out-of-bounds, a tag-occupied cell, a
tilemap hazard flag) and the outcome event. It remains a frozen-tick-order workaround (a true
post-step tick hook would touch the frozen tick order — 🔴), so promote only if a second
consumer appears. **Params proven:** `stateKey`, `tileSize`, `gameOverEvent`.

---

## Note on restart safety (applies to any promoted system)

`Game.loadScene` clears `world.state` and entities, and (since 0.5.0) also clears the event
bus's **scene-scoped** listeners. Any promoted system that listens to events should register
via **`world.events.onScene(evt, fn)`** — attached once per scene ENTRY (guard with a
scene-scoped `world.state` flag, since systems run every tick) and read live `world.state`
inside the listener. A scene change auto-removes the listener, so a "Play again" never
double-attaches. A game-lifetime listener still uses `world.events.on`.
