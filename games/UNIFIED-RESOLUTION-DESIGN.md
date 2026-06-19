# UNIFIED-RESOLUTION-DESIGN.md — the collision-resolution phase (carry + push + solids in one pass)

A design for the engine's next major structural piece: replacing the three scattered,
author-ordered **platformer solid-resolution behaviors** (`solid-collide`, `tilemap-collide`,
`ride-platform`) with a single, deterministic **resolution phase** that owns every dynamic body
and resolves it — push-out, slopes, carry, and **push** — in one ordered pass.

This is the home the [`INDIE-ROADMAP`](./INDIE-ROADMAP.md) two-body section defers carry-as-a-phase
and two-body push to. The implementation is a sequence of proof-gated increments (§8); the §9
sign-offs are **approved**, and **increment 1 — the `resolveBodies()` phase, the `collider`
component, and candidate-keyed solid push-out — has landed in sdk+library `1.1.0`** (the
`platformer-solids` proof migrated to colliders at parity). Increments 2–5 (slopes, carry, push,
finish migration + retire the behaviors) remain.

> Scope note: this touches ONLY the platformer solid-resolution path. The general behavior model
> — `velocity`, movement behaviors, `aabb-collision` *overlap detection* (for contact-damage /
> collect / win checks) — is untouched. Arcade games (which never used solid resolution) stay
> byte-identical. Nothing PUBLISHED breaks: `sdk@0.6.0` has no platformer-collision parts at all,
> and the three behaviors being retired are unpublished (the in-tree 1.x line — catalogued
> `solid-collide@1.0.0` / `tilemap-collide@1.1.0` / `ride-platform@1.0.0`) and used **only by the
> in-tree proofs**, so the whole migration is bounded to `packages/library/proofs/`.

---

## 1. Why — the problem with today's model

Solid resolution is scattered across three behaviors that each resolve **one entity in
isolation**, in author-controlled order, with no coordination between bodies:

- `tilemap-collide` — resolves a body against solid tiles.
- `solid-collide` — resolves a body against solid *entities*.
- `ride-platform` — carry: a rider inherits a carrier's per-tick delta, ordered **first** in the
  rider's behaviors so it runs before that rider's own `solid-collide` re-resolves it.

Three concrete problems fall out of "resolution is N independent, author-ordered behaviors":

1. **Carry can't become a clean phase.** This session proved a naive *post-behavior* carry phase
   is a **regression**: it applies the carrier's displacement *after* the rider's `solid-collide`
   has already settled, so a carrier sliding a rider into a wall pushes it **through** the wall
   (no same-tick re-resolution). The current behavior avoids this only because `ride-platform` is
   manually ordered *before* the rider's resolver. The author-ordering rule ("carriers before
   riders", "`ride-platform` first") is the load-bearing correctness mechanism — a footgun.
2. **Push is unexpressible.** A pusher moving a crate, the crate then resolving against the world,
   and chains (crate→crate) require **mutual** resolution across bodies in dependency order — which
   N-independent-behaviors fundamentally cannot express.
3. **Sub-stepping is globally coupled.** `resolveSolids` derives its swept sub-step count from the
   smallest solid in the rect list, and rewinds/re-advances a fast body even when it contacts
   nothing — so a body's exact micro-position depends on the *global* solid set. (This is why the
   "byte-identical broadphase" cleanup was deferred here, §6.)

The root cause is architectural: **there is no single owner of "resolve all touching bodies
together."** That owner is the resolution phase.

---

## 2. Decision — an ADDITIVE opt-in phase, not a replacement of the behavior model

The audit deferred "a physics system that owns all bodies / removes `velocity`" because four
non-platformer seed games author `velocity` + behavior collision with meaningful order. That
deferral stands. The resolution phase is **narrower and additive**:

- A new tick phase, `World.resolveBodies()`, runs **only over entities that carry a `collider`
  component** (§4). An entity without one is never touched — the phase no-ops over it exactly the
  way `resolveHierarchy()` no-ops over an unparented entity. So **every arcade scene is
  byte-identical**, and `velocity` / the behavior model are untouched.
- For platformer bodies, the `collider` component + the phase **replace** the three behaviors.
  Because those behaviors are proof-only and unpublished, this is a clean single-model swap, not a
  dual-path coexistence: there is exactly one way to be solid (a `collider`), resolved in exactly
  one place (the phase).

Net: *additive* with respect to the published/arcade world, *replacement* with respect to the
(unpublished, proof-only) platformer-collision behaviors. One collision model, bounded migration.

---

## 3. Decision — resolution is a tick PHASE, slotted like `resolveHierarchy`

`Game.update()` today: snapshot `prevX/prevY` → systems → behaviors (incl. the `velocity`
integrator) → `prune` → `resolveHierarchy` → events/input cleanup → scene drain.

Insert `resolveBodies()` **after `prune`, before `resolveHierarchy`**:

```
behaviors (velocity integrates → bodies at naive post-move positions)
  → prune
  → resolveBodies()        ← NEW: resolve every collider against the solid world + carry + push
  → resolveHierarchy()     (a parented child now follows a RESOLVED parent)
  → render
```

This **appends** a phase (as `resolveHierarchy` was appended at 0.9.0); it does not reorder the
frozen systems→behaviors→prune sequence. Resolving after the *whole* behavior pass (rather than
mid-behavior-list like `solid-collide` does today) is what lets the phase see every body's settled
intended position and resolve them **together** in dependency order. A mover reading
`entity.body.contacts` still reads last tick's contacts — already the documented, coyote-covered
one-tick-stale read.

> 🟡 **Sign-off:** a new tick phase is the same contract-class as the 0.9.0 hierarchy phase
> (additive, no-ops when unused, no reorder of the existing steps). Confirm before building.

---

## 4. Decision — a typed `collider` component

Replace the tag-and-behavior encoding (`solid` tag, `oneWayTag`, `carryTag`, ad-hoc behaviors)
with one first-class typed declaration of how an entity participates in resolution.

**Authored** (additive optional schema field on the entity, resolved into a runtime component):

```jsonc
"collider": {
  "role": "dynamic" | "solid",     // dynamic = moves + gets resolved; solid = blocks dynamics
  "oneWay": false,                  // solid only on its top face (a pass-through ledge)
  "carriable": false,              // a moving solid that carries riders standing on it
  "pushable": false,               // a dynamic that a pusher can move (needs role:"dynamic")
  "mass": 1,                        // push split weight; a solid is effectively infinite mass
  "inset": { "x": 0, "y": 0 }      // collider box inset from the sprite AABB (the 🟡 hitbox item)
}
```

- The **tilemap stays the static solid field** — solid/oneWay/slope tile props are unchanged; the
  phase resolves dynamic colliders against solid tiles directly (absorbing `tilemap-collide`).
- A `solid` collider that *moves* (tween/velocity) + `carriable:true` is a moving platform.
- `inset` folds in the roadmap's deferred `collisionInset`/hitbox 🟡 item — fairer collisions
  (corner-clip, contact damage) for free, since the collider box is now first-class.
- Runtime: extend the existing `BodyComponent` (`entity.body`) — already the typed home for
  `prevX/prevY`/`contacts` — with the resolved collider fields, so there is **one** physics-body
  component, not two.

> 🟡 **Sign-off:** a new optional schema object (like `scene.world` / `entity.parent` were).
> Additive — old games never set it. Lighter fallback if rejected: drive the phase off the
> existing tags (`solid`/`carrier`/`oneWayTag`) instead of a component — uglier, but no new schema.

---

## 5. The solver — one ordered pass

`resolveBodies()` runs once per tick. Fast-path: if no entity has a `collider`, return before any
allocation (byte-identical no-op). Otherwise, resolve **dynamic** colliders in **dependency order**
(a body that rides or is pushed by another resolves *after* it — a topological order over the
"rests-on / pushed-by" graph, deterministic and cycle-safe, exactly like `resolveHierarchy`'s
parent-first walk). For each dynamic body, in order:

1. **Broadphase** — gather the solids its swept box could touch this tick: solid tiles via the
   bounded cell range, solid entities via a uniform-grid / candidate-keyed AABB. (Reuses the
   `tilemap-collide` swept-range idea and the 0.12.0 grid idea.)
2. **Push-out vs the static world** — `resolveSolids` (swept) against the solid candidates, then
   `resolveSlopes` (second pass) against slope cells. Writes `entity.body.contacts`. *(These two
   SDK primitives are reused as-is — the phase is their new single caller.)*
3. **Carry** — if the body rests on a `carriable` solid (feet-probe vs the carrier's pre-tick top
   `body.prevY`, `vy>=0`), apply the carrier's **resolved** this-tick displacement
   (`carrier.x - carrier.body.prevX`, descending `y` likewise), **then re-run step 2**. Re-resolving
   *after* the carry is the regression fix: a carrier shoving a rider into a wall stops the rider
   at the wall this same tick. Because carriers are resolved before riders (dependency order), the
   carrier's displacement is final and there is no author-ordering rule and no one-tick lag.
4. **Push** — if the body penetrates a `pushable` dynamic, split the penetration by mass (an
   immovable solid = infinite mass → the pusher stops; two equal crates → each moves half), move
   both, then re-run step 2 for each. Crate→crate chains resolve via the dependency order plus a
   **fixed** iteration cap (fixed count = replay-safe).

**Determinism (load-bearing for replays + the validator):** bodies resolved in a fixed order
(topological, ties by entity-array index); sub-step count derived from the **candidate** set, not
the global solid set (kills the global-`minDim`/rewind coupling §1.3 — a *deliberate* micro-change,
not byte-identical to today, gated by proofs+tests+browser, §6); fixed push-iteration count. The
phase is a pure function of world state in → world state out.

---

## 6. The deferred broadphase determinism fix, folded in

The "byte-identical `solid-collide` broadphase" cleanup was deferred to here because it *cannot* be
byte-identical: `resolveSolids` couples a body's micro-position to the global solid set. The phase
makes this a **deliberate** improvement instead — sub-stepping keyed to each body's actual
candidate set, so a far decorative solid no longer perturbs a body's physics. Not byte-identical to
the prior per-behavior resolvers (the unpublished in-tree line); gated by the platformer proofs + the solids tests + the
filtered-vs-fullscan fuzz harness (asserting the *new* candidate-keyed semantics) + browser. No
published break (0.6.0 has no platformer collision).

---

## 7. Migration — bounded to the proofs

The three retired behaviors are used only in-tree by four proofs. Each migrates from authoring
behaviors to authoring a `collider` component (tile solid/slope props unchanged):

- `platformer-solids` — player + lift gain `collider`s; `solid-collide` removed. Verify parity.
- `platformer-slopes` — `collider` + slope tiles; `tilemap-collide` removed.
- `platformer-carry` — `carriable` carriers, `ride-platform` removed; **re-baseline** the position
  assertions (the phase resolves carry on slightly different exact pixels — same observable ride/
  walk-while-carried/descend behavior).
- `platformer-scroll` — the full mover proof; migrate last.
- **NEW** `platformer-push` — push a crate into a wall, off a ledge, onto a switch, and a 2-crate
  chain. The proof that anchors two-body push.

`solid-collide` / `tilemap-collide` / `ride-platform` are then **retired** from the catalog (their
`type`s removed). The `move-platformer` mover is unaffected — it reads `entity.body.contacts`,
which the phase still writes.

---

## 8. Sequencing — proof-gated increments (the build order for the implementation session)

Each ships as a lockstep SDK+library bump, gated by a migrated/new proof that `gitcade validate`s,
green tests, and chromium browser-verification.

1. **Phase skeleton + `collider` component + solid push-out — ✅ landed (sdk+library `1.1.0`).**
   `resolveBodies()` does steps 1–2 (broadphase + `resolveSolids`), driven by the `collider`
   component (`role`/`oneWay`/`inset` — the moving/push facets land with increments 3–4 that honor
   them); `platformer-solids` migrated at parity (all 9 smoke assertions unchanged); candidate-keyed
   sub-stepping landed, pinned by the filtered-vs-fullscan fuzz harness; browser-verified. *Foundation.*
2. **Slopes in the phase.** Step 2's slope pass; migrate `platformer-slopes`.
3. **Carry in the phase.** Step 3 (carrier-resolved displacement + re-resolve, dependency order);
   migrate `platformer-carry` + re-baseline; retire `ride-platform`. *The regression fix.*
4. **Push.** Step 4 (mutual MTV, mass split, chains, fixed iterations); new `platformer-push` proof.
   *The original goal.*
5. **Finish migration.** Migrate `platformer-scroll`; retire `solid-collide`/`tilemap-collide` from
   the catalog; update `INDIE-ROADMAP` (mark carry-phase + push landed).

Increments 1–2 are byte-equivalent-in-behavior parity work (low risk). Increment 3 is the
architectural payoff. Increment 4 is the new capability.

---

## 9. Open decisions needing a human sign-off (before building)

- **The new `resolveBodies()` tick phase** (§3) — 🟡, same class as the 0.9.0 hierarchy phase.
- **The `collider` schema component** (§4) — 🟡, a new optional schema object; includes the
  `inset`/hitbox field (its own deferred 🟡).
- **Retiring `solid-collide`/`tilemap-collide`/`ride-platform`** — confirm the single-model swap
  (vs keeping the behaviors as a parallel path). Recommended: retire (proof-only, cleaner).
- **The candidate-keyed determinism change** (§5/§6) — confirm it ships as a deliberate
  proof-gated change, not byte-identical preservation.

None of these breaks a published artifact; all are bounded to the in-tree proofs.

---

## 10. Already in place (de-risk)

- `BodyComponent` (`entity.body`) — the typed home the phase's collider fields extend.
- `entity.body.prevX/prevY` — tick-start position, exactly what carry's dependency-ordered delta
  and a future render-interpolation pass need.
- `resolveSolids` / `resolveSlopes` — clean SDK primitives the phase calls unchanged.
- `resolveHierarchy()` — the proven template for an additive, no-op-when-unused, dependency-ordered
  tick phase.
- Typed `entity.body.contacts` — the contact protocol the phase writes and the mover reads.

The hard, genuinely-new work is the **dependency-ordered coupled solver** (carry + push with
re-resolution) and its **determinism story**. The data model and the phase plumbing are well-
templated by existing code.

---

## Cross-references

- Engine direction + the deferral this realizes: [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md) (two-body
  section, "Suggested sequencing").
- Frozen-contract protocol: [`../CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
