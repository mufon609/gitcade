# UNIFIED-RESOLUTION-DESIGN.md — the collision-resolution phase

GitCade's platformer solidity is **one collision model**: a typed `collider` component,
resolved by a single deterministic tick phase, `World.resolveBodies()`. This doc owns the
*why* — the rationale a contributor would otherwise have to reverse-engineer from
`packages/sdk/src/runtime/collision.ts`. For the whole-system bet see
[`../DESIGN.md`](../DESIGN.md); for what the engine grows next see
[`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md).

## Why a phase, not per-entity behaviors

A collider is resolved in exactly one place — a phase that owns *every* dynamic body and
resolves them together, in dependency order. Per-entity resolution (each body resolving
itself in author-controlled behavior order) cannot express the cases that matter:

- **Carry** — a rider must inherit its carrier's motion *and* re-resolve against walls in the
  same tick. Per-entity resolution needs a load-bearing ordering rule ("carriers before
  riders") to avoid sliding a rider through a wall — a footgun, not a guarantee.
- **Push and chains** — a pusher moving a crate, the crate resolving against the world, and
  crate→crate chains require mutual resolution across bodies in dependency order, which N
  independent resolvers fundamentally cannot do.
- **Determinism** — one owner can key sub-stepping to each body's own candidate set instead of
  the global solid set, so a far solid never perturbs a body's physics.

The phase is the single owner of "resolve all touching bodies together."

## Additive and opt-in

`resolveBodies()` runs only over entities that carry a `collider`; an entity without one is
never touched, exactly as `resolveHierarchy()` no-ops over an unparented entity. So **every
arcade scene is byte-identical**, and the general `velocity` + movement-behavior +
`aabb-collision` overlap-detection model is untouched. Fast path: no collider anywhere ⇒
return before any allocation.

## Where it runs

`Game.update()`: snapshot prev transform → systems → behaviors (incl. the velocity
integrator) → `prune` → **`resolveBodies()`** → `resolveHierarchy()` → render. It *appends* a
phase (as the hierarchy phase is appended); it does not reorder the frozen
systems→behaviors→prune sequence. Resolving *after* the whole behavior pass is what lets it
see every body's settled intended position and resolve them together; a parented child then
follows an already-resolved parent. A mover reading `entity.body.contacts` reads last tick's
contacts — the documented, coyote-covered one-tick-stale read.

## The collider component (the typed contract)

An additive optional schema object, resolved onto `entity.body.collider`:

```jsonc
"collider": {
  "role": "dynamic" | "solid",  // dynamic = moves + gets resolved; solid = blocks dynamics
  "oneWay": false,              // solid on its top face only (a pass-through ledge)
  "carriable": false,           // a moving solid that carries riders standing on it
  "pushable": false,            // a dynamic a pusher can shove (needs role:"dynamic")
  "mass": 1,                    // push-split weight; a solid is effectively infinite mass
  "inset": { "x": 0, "y": 0 }   // collider box inset from the sprite AABB (a fairer hitbox)
}
```

The tilemap stays the static solid field (solid / oneWay / slope tile props unchanged); the
phase resolves dynamic colliders against solid tiles directly. The collider box — `inset`
honored — is used consistently for blocking, ejection, and carry, never the raw sprite AABB.

## The solver — one ordered pass

Dynamic colliders resolve in **dependency order**: a body that rides or is pushed by another
resolves after it (a topological order over the rests-on / pushed-by graph, cycle-safe, like
the hierarchy walk). Per body:

1. **Broadphase** — gather the solids the swept box could touch (solid tiles by bounded cell
   range; solid entities via a candidate-keyed AABB).
2. **Push-out** — `resolveSolids` (swept) against the solid candidates, then `resolveSlopes`
   against slope cells; writes `entity.body.contacts`.
3. **Carry** — a body that rested on a `carriable` solid at tick start (feet-probe vs the
   carrier's pre-tick top, `vy >= 0`) inherits the carrier's this-tick displacement.
4. **Push** — a dynamic driving into the *side* of a `pushable` dynamic shoves it
   horizontally: a bounded positional relaxation (push-once → settle crates by inverse `mass`
   with blocked-ness propagating up a wall-flush chain → clamp pushers flush behind them).

A `pushable` crate is also **solid-to-dynamics** as a top-only (`oneWay`) solid, so bodies
stand on, stack on, and ride crates — resolved in the same dependency order (a rider resolves
after the crate it rests on, transitively through a falling or carried crate).

## Three non-obvious decisions

The parts worth not re-deriving:

- **Carry is applied *before* the push-out, not after.** The push-out's own re-grounding
  already follows a moving platform vertically; adding the carrier's descent again afterward
  double-counts and sinks the rider one displacement per frame. Carry-first resolves once,
  is lag-free, and stops a carried rider the same tick a carrier slides it into a wall.
- **Carry and ride clamp to solids the same way push does.** `resolveSolids` is
  motion-derived — it ejects a body only on an axis it has velocity *into* a solid — so a
  passive (`vx = 0`) rider moved positionally by its carrier would be driven straight through
  a wall and never ejected. Carry and ride therefore clamp their horizontal displacement to
  the solid world (the velocity-independent clamp push already uses), excluding the carrier the
  rider rests on. One rule — "clamp a horizontal displacement to solids" — backs push, carry,
  and ride.
- **Push is swept.** A pusher faster than a crate's width per tick would otherwise tunnel
  clean through it (zero settled overlap ⇒ no shove) or get yanked backward by the clamp. The
  shove transfers the pusher's leading-edge overshoot past the crate's near face, clamped to
  the first solid in the crate's path (never shoving a crate through a wall).

## Determinism (load-bearing for replays + the validator)

Bodies resolve in a fixed order (topological, ties by entity-array index); sub-step count is
keyed to each body's candidate set, not the global solid set; the push relaxation has a fixed
iteration cap that **warns once** when a chain under-separates rather than failing silently.
The phase is a pure function of world state in → world state out. Render interpolation is
**render-only**: the renderer lerps the drawn transform between the last two ticks by
`alpha = accumulator / fixedDt` — position + camera, rotation by the shortest arc, per-axis
scale snapping on a sign flip — with a teleport-snap for per-tick jumps beyond a viewport
dimension. `alpha` defaults to 1 and headless `stepFrames` never renders, so the simulation,
replays, and validator are byte-identical regardless of frame rate.

## Scope

Push is horizontal; crate↔crate flushness carries sub-pixel relaxation residue. The phase
touches only the platformer solid-resolution path — `aabb-collision` overlap detection
(contact-damage / collect / win checks) and the movement behaviors are a separate, untouched
concern.

## Cross-references

- Whole-system rationale: [`../DESIGN.md`](../DESIGN.md).
- Forward engine roadmap: [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md).
- Frozen-contract patch protocol: [`../CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
