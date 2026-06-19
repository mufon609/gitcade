# UNIFIED-RESOLUTION-DESIGN.md — the collision-resolution phase (carry + push + solids in one pass)

A design for the engine's next major structural piece: replacing the three scattered,
author-ordered **platformer solid-resolution behaviors** (`solid-collide`, `tilemap-collide`,
`ride-platform`) with a single, deterministic **resolution phase** that owns every dynamic body
and resolves it — push-out, slopes, carry, and **push** — in one ordered pass.

This is the home the [`INDIE-ROADMAP`](./INDIE-ROADMAP.md) two-body section defers carry-as-a-phase
and two-body push to.

> ✅ **COMPLETE (sdk+library `1.5.0`), then HARDENED + EXTENDED through `1.10.0`.** All five proof-gated
> increments (§8) landed; the §9 sign-offs were approved. There is now exactly ONE collision model — a
> `collider` component resolved by the `World.resolveBodies()` phase — and the three legacy behaviors
> (`solid-collide`/`tilemap-collide`/`ride-platform`) are RETIRED. All platformer proofs run on colliders;
> arcade scenes are byte-identical (the phase no-ops without a collider). In-tree/unpublished — pending a
> human publish go-ahead. The increment history below is the design record; the git log is the
> authoritative per-step changelog.
>
> **Pre-freeze hardening + extension (1.6.0–1.10.0, §11):** an adversarial audit then drove five more
> increments — push fuzz harness + inset-consistency fix + a loud (no-longer-silent) push cap (1.6.0);
> **swept push** so a fast pusher can't tunnel/yank a crate (1.7.0); **render interpolation** for smooth
> play under any frame rate (1.8.0, render-only — headless sim byte-identical); **dynamic-on-dynamic
> stacking** — a `pushable` crate is solid-to-dynamics (stand on it, stack, ride it), resolved in
> dependency order — which realizes the §5 topological solve and the §5.4 "standing on a crate" item
> the original push increment deferred (1.9.0); and **solid-aware carry/ride + full-transform render
> interpolation** (1.10.0) — completing the two halves the 1.8.0/1.9.0 increments shipped partial (a
> re-audit found render interpolation was position-only and that a passively carried/ridden rider was
> driven *through* a wall, because the motion-derived push-out can't eject a zero-velocity body).

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
3. **Carry** — if the body rested on a `carriable` solid at tick start (feet-probe vs the carrier's
   pre-tick top `body.prevY`, `vy>=0`), apply the carrier's this-tick displacement
   (`carrier.x - carrier.body.prevX`, descending `y` likewise) **BEFORE the push-out** (steps 1–2),
   not after it. *Implementation note (1.3.0):* carry-FIRST, not the originally-sketched
   step-2-then-carry-then-re-resolve — because the push-out's own re-grounding already follows a
   moving platform vertically, adding the descent again *after* it double-counts and sinks the rider
   one tick's displacement per frame. Applying carry first, then resolving once, is the regression
   fix (a carrier sliding a walking rider into a wall stops it the same tick via the push-out) AND
   is lag-free: a carrier is a solid already moved by its own behaviors this tick, so its
   displacement is final — no author-ordering rule (what the retired `ride-platform` needed).
4. **Push** — a dynamic that drives into the SIDE of a `pushable` dynamic shoves it horizontally.
   *Implementation note (1.4.0):* a final `resolvePush()` pass (a bounded, fixed-iteration positional
   relaxation — replay-safe) in three phases: (1) each non-pushable pusher shoves each crate it
   overlaps by the full penetration ONCE; (2) the crates settle among themselves (mass-split by
   inverse mass — two equal crates each move half) and against the solid world, where a crate the
   eject wedges against a solid is marked BLOCKED and its blocked-ness propagates up a flush chain
   (so a chain compresses against a wall instead of crates sinking into each other); (3) each pusher
   is clamped flush behind the settled crates. Differs from the originally-sketched "split by mass,
   move both, re-run step 2" — pure mass-split couldn't move an infinite-mass pusher back off a
   wall-blocked crate, hence the phased push-once + blocked-propagation + clamp. **Scope:** push is
   HORIZONTAL; crate↔crate flushness carries sub-px relaxation residue. *(1.7.0 made the pusher→crate
   shove SWEPT — `sweptShove` transfers the pusher's leading-edge overshoot, clamped to the first solid
   in the crate's path, so a fast pusher no longer tunnels or yanks. 1.9.0 made a pushable
   SOLID-TO-DYNAMICS — standing on / riding a crate is now supported, see §11.)*

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

- `platformer-solids` — ✅ player + lift gain `collider`s; `solid-collide` removed. Parity verified (1.1.0).
- `platformer-slopes` — ✅ `collider` + slope tiles; `tilemap-collide` removed. Parity (1.2.0).
- `platformer-carry` — ✅ `carriable` carriers, `ride-platform` removed (1.3.0). The re-baseline the
  design anticipated proved **unnecessary** — carry-first (§5.3) is lag-free and reproduces the old
  exact pixels, so all assertions held unchanged.
- `platformer-scroll` — the full mover proof; migrate last (increment 5).
- **NEW** `platformer-push` — ✅ (1.4.0) push a crate into a wall (pusher stops flush behind it),
  off a ledge (the crate falls under its own gravity), and a 2-crate chain that compresses against
  a wall. The proof that anchors two-body push. (The "onto a switch" case folds into precise
  positional push — covered by the into-wall flushness.)

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
2. **Slopes in the phase — ✅ landed (sdk+library `1.2.0`).** Step 2's `resolveSlopes` second pass
   (run after the solid push-out, on the same body, merged into the same-tick contacts);
   `platformer-slopes` migrated at parity (4 smoke assertions unchanged), browser-verified.
3. **Carry in the phase — ✅ landed (sdk+library `1.3.0`).** A rider that rested on a `carriable`
   solid at tick start inherits the carrier's this-tick displacement BEFORE the push-out (carry-first
   — see §5.3's implementation note: applying it after and re-resolving double-counts the descent).
   `ride-platform` retired (source, part manifest, registration, test — catalog 98→97). `platformer-carry`
   migrated and needed **no re-baseline** — lag-free carry-first reproduces the old exact pixels.
   *The regression fix + the architectural payoff.*
4. **Push — ✅ landed (sdk+library `1.4.0`).** The `resolvePush()` pass (positional relaxation:
   push-once → settle crates with blocked-propagation → clamp pushers; mass-split, chains, fixed
   iterations); `pushable`/`mass` added to the `collider` schema; new `platformer-push` proof
   (into-wall, off-ledge, 2-crate chain), browser-verified. *The original goal — the new capability.*
5. **Finish migration — ✅ landed (sdk+library `1.5.0`).** `platformer-scroll` migrated to a collider
   (parity, browser-verified); `solid-collide`/`tilemap-collide` retired (source/parts/registration/
   tests, catalog 97→95, behavior types 25→23) and the now-dead `collider-before-integrator` validator
   advisory removed; `move-platformer`/`sprite-state-machine`/scene-prop docs re-pointed at the phase.
   All three legacy behaviors are gone — the effort is COMPLETE.

Increments 1–2 landed as byte-equivalent-in-behavior parity work (low risk); increment 3 (carry) was
the architectural payoff; increment 4 (push) was the new capability; increment 5 (finish the migration
+ retire the last two behaviors) completed it.

---

## 9. Sign-off decisions — ✅ all approved & shipped (1.1.0–1.5.0)

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

## 11. Pre-freeze hardening + extension (1.6.0–1.10.0)

An adversarial audit of the 1.1.0–1.5.0 phase (fresh eyes, reproduce-don't-trust) found the model
sound — fast-path byte-identical, candidate-keyed determinism, deterministic tick order all hold — but
flagged real shortcuts to fix BEFORE the contract freezes, so they don't become permanent bandaids.
Four proof-gated increments followed (git log is the per-step changelog):

- **1.6.0 — hardening.** The solid-entity broadphase in `resolveColliderAgainstWorld` now resolves a
  dynamic against a solid's **collider box** (its `inset` honored), consistent with `ejectFromSolids`/
  `findCarrier` (it read the raw sprite box before — an inset solid blocked at a different face than it
  ejected/carried at). The push relaxation gained its missing **determinism + no-penetration fuzz**
  (`resolve-bodies-push-fuzz`), and its fixed `PUSH_ITERATIONS` cap is **no longer silent** — a chain
  that under-separates warns once (`warnPushNonConvergence`).
- **1.7.0 — swept push.** Phase 1 of `resolvePush` was non-swept: a pusher faster than the crate's
  width per tick tunnelled clean through (settled overlap 0 ⇒ no shove) or got yanked backward by the
  phase-3 clamp (settled overlap under-read the penetration). `sweptShove` now drives the crate by the
  pusher's leading-edge OVERSHOOT past the crate's near face, `clampShoveBySolids` limits it to the
  first solid in the crate's path (no shoving a crate through a wall), and the pusher ends flush ahead.
  Backward-compatible at walk speed; pinned by `resolve-bodies-push-swept` (incl. a high-speed
  no-tunnel fuzz).
- **1.8.0 — render interpolation.** The sim is fixed-timestep but the renderer drew the latest settled
  positions, so play juddered when rAF didn't divide the 60 Hz tick. The renderer now lerps each body
  and the camera between their last two tick positions (`body.prevX/prevY` → `x/y`, `camera.prevX/prevY`
  → `x/y`) by `alpha = accumulator/fixedDt`, with a teleport-snap (a per-tick jump beyond a viewport
  dimension isn't interpolated). **Render-only** — `alpha` defaults to 1 (byte-identical), and headless
  `stepFrames` never renders, so the validator/replays/every test are wholly unaffected.
- **1.9.0 — dynamic-on-dynamic stacking.** A `pushable` crate is now SOLID-TO-DYNAMICS: each body's
  push-out gains every crate as a TOP-ONLY (`oneWay`) solid — stand on a crate, stack crates, jump up
  through, drop through on down+jump — while push still owns the horizontal (a walker shoves a crate's
  side, never stopped dead). This realizes the §5 **topological dependency-order solve**
  (`topoOrderByRestsOn`): a rider resolves AFTER the crate it rests on, so it lands on / rides the
  crate's settled position. The carrier set gains the crates, so a rider rides a crate that falls or is
  carried by a moving platform (transitively); `rideHorizontalPush` carries riders by a crate's net
  push displacement after the push pass (so riding a horizontally-pushed crate is lag-free, stacks
  included). **Byte-identical when no entity is pushable.** (1.9.0 left one boundary — a rider carried
  or ridden into a wall-corner — closed in 1.10.0 below.)

- **1.10.0 — solid-aware carry/ride + full-transform render interpolation.** A re-audit (reproduce,
  don't trust the docs) found the 1.8.0 and 1.9.0 increments each shipped a common case and filed the
  rest as a "limitation"; 1.10.0 completes both generalizations.
  - **Solid-aware carry + ride.** The phase moves a rider POSITIONALLY by its carrier's displacement
    (carry of a `carriable` platform; ride of a horizontally pushed crate), but the only correction in
    the per-body loop — `resolveSolids` — is MOTION-derived: it ejects a body only on an axis it has
    velocity INTO a solid. So a passive (`vx=0`) rider was driven straight THROUGH a wall and never
    ejected — not "next tick" but *permanently* (the velocity push-out can't touch a zero-velocity
    body; this corrects the 1.9.0 residual note, which assumed a next-tick fix that can't happen). The
    crate *push* already used the velocity-independent `clampShoveBySolids`; **carry and ride now use
    the same clamp**, so a rider stops flush at a wall. One rule — "clamp a horizontal displacement to
    the solid world" — now backs push, carry, and ride; the carrier the rider rests on is excluded (you
    don't collide horizontally with your own support). Byte-identical wherever no wall is in the path,
    so every prior carry/stack proof and test is unchanged. Gated by `resolve-bodies-carry-ride-walls`
    (SDK, both halves + determinism) and a carry-into-wall scenario in the `platformer-carry` proof.
  - **Full-transform render interpolation.** 1.8.0 interpolated POSITION only, so a `face-angle` turret
    (rotation) or a `tween` pop (scale) still juddered. The renderer now also lerps `rotation` and
    per-axis `scale` between the last two ticks (`body.prevRotation`/`prevScaleX`/`prevScaleY`,
    snapshotted alongside `prevX/prevY`). Rotation uses the SHORTEST arc — a plain lerp would unwind a
    `face-angle` ±π `atan2` branch-cut jump (or a `tween` 2π spin-loop) the long way around; scale
    SNAPS on a sign flip — `face-velocity` flips `scaleX` instantly, and lerping across 0 would collapse
    the sprite to a line. **Render-only** — `alpha` defaults to 1 (byte-identical), headless never
    renders. Gated by `render-transform-interp` (SDK) + a real-Chrome screenshot diff across alphas.

---

## Cross-references

- Engine direction + the deferral this realizes: [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md) (two-body
  section, "Suggested sequencing").
- Frozen-contract protocol: [`../CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
