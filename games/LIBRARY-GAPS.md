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
Snake's version also folds in wall-collision and "keep one pickup on a free cell"
(see #2). Generalization: split body-follow from the pickup logic; parameterize the
spacing (grid step vs. continuous distance), the grow trigger (score delta, event,
or call), and the collision outcome (event vs. destroy).
**Params already proven:** `headTag`, `segmentTag`, `tileSize`, `startLength`,
`growBy`, `startDir`, `segmentPrototype`, `scoreKey`/`foodValue` (poll-based growth,
restart-safe — no event listener).

## 2. `respawn-pickup-on-free-cell`
**From:** Snake (folded into `snake-body`)
**Demand:** Snake, any collectathon needing "always exactly one (or N) pickups on
unoccupied cells".

Maintain a target count of a pickup tag, spawning replacements at random grid cells
not occupied by a given set (the snake body). Currently entangled with `snake-body`;
worth extracting as a small spawner sibling to `wave-spawner`.

## 3. `thrust-lift` — one-axis thrust / flappy control
**From:** Helicopter (`games/helicopter/src/custom-behaviors/index.ts`, behavior `thrust-lift`)
**Demand:** Helicopter; jetpack flyers, flappy clones, submarine/balloon games.

Hold a key (or a `world.state` flag set by a touch button) to accelerate along one
axis against a constant opposing acceleration, with speed clamps both ways. A clean
companion to the existing `move-platformer` (which is impulse-jump, not hold-thrust).
**Params already proven:** `thrustKeys`, `thrust`, `gravity`, `maxUp`, `maxDown`,
`flagKey`.

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

---

## Note on restart safety (applies to any promoted system)

`Game.loadScene` clears `world.state` and entities but NOT the `world.events`
listeners. Any promoted system that listens to events must dedupe its attachment
per `World` (the `WeakMap<World, Set<string>>` pattern the library FX parts already
use) and read live `world.state` inside the listener — otherwise a "Play again"
double-attaches and double-counts. Phase 3's custom systems either poll (no
listener) or use that dedupe pattern; a library version should do the same.
