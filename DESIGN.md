# DESIGN.md — Why GitCade Is Built This Way

This document owns the **rationale**. The [README](./README.md) says *what* the
system is and *how* the pieces fit; [CLAUDE.md](./CLAUDE.md) is the operating
contract for changing it; the roadmaps under [`games/`](./games/) say *what
comes next*. This file says *why the architecture is the bet* — so a new
contributor or evaluator can judge the design on its own terms, not reverse-
engineer the reasoning from the code.

---

## TL;DR — the one bet

**A game is data, not code.**

Everything else is downstream of that sentence. Validated data can be authored by
an AI, forked by a machine, diffed line-by-line, and proven to run before it
ships. Freeform game code can be none of those things *safely*. The two product
pillars — GitHub-style forking and a component marketplace as the standard — are
not features layered on top of an engine; they are what this particular engine
shape makes *possible*. Pick a conventional code-first engine and those pillars
become aspirations you can never fully keep.

---

## What the bet buys

A game is a `game.json` manifest, a flat `config.json` of every tunable number,
and JSON scene/entity definitions that reference parts by `partId@version` and
balance values by `$cfg.key`. From that single decision, three properties follow
that a code-first engine cannot match:

- **Forks are structured diffs.** Because balance is data, rebalancing a game —
  or remixing a fork — is a one-line JSON change, not a code edit. A fork's
  entire delta is legible: changed files, and for `config.json`, the actual
  before/after values. "Fork it, rebalance it, share a side-by-side compare URL"
  is a diff renderer, not a promise.
- **Remixes compose, they don't rewrite.** A game is assembled from interoperable,
  versioned parts. Swapping a part is a reference change the runtime resolves and
  the validator checks — so "remix by swapping parts, no code" is mechanically
  true, not a marketing line.
- **Authorship is safe to automate.** An agent editing constrained JSON against a
  frozen schema is bounded: the worst it can produce is data the validator
  rejects with a precise reason. An agent editing freeform code can produce
  anything, and *no one can cheaply prove the result is safe or even runnable.*
  This is the property that makes "AI-built games" a category we can stand behind
  rather than a liability.

---

## Why not freeform code — the alternatives we rejected

| Decision | What we chose | What we rejected, and why |
|---|---|---|
| **Game logic** | Composed from versioned catalog parts referenced as `partId@version` | **Per-game freeform code.** It can't be validated, composed, or diffed; every game becomes a bespoke blob no other game or tool can reason about. The marketplace can't exist on top of it. |
| **Balance / tunables** | Plain numbers in `config.json`, referenced by `$cfg.key`; magic literals are a publish error | **Numbers inline in code.** A rebalance would be a code change, a remix couldn't be expressed as a one-line diff, and forks couldn't be compared value-by-value. |
| **Runtime** | Deterministic fixed-timestep loop with a seeded RNG hook | **Variable-step / wall-clock simulation.** Non-determinism forecloses replays, ghosts, seeded challenges, and the headless validator boot — the cheap reproducibility that is a genuine differentiator. |
| **Storage** | A postMessage storage bridge, saves namespaced by `gameSlug + branch` | **Direct `localStorage` from the game.** A sandboxed game can't reach browser storage anyway, and per-branch namespacing is what lets a fork and its origin coexist without corrupting each other's saves. |
| **Isolation** | Games run in a `sandbox="allow-scripts"` iframe (opaque origin) served only by the artifact server under a strict per-game CSP | **Running game code on the platform origin.** User-published, AI-built artifacts are untrusted by definition; the strongest isolation is the only honest default. |
| **Contract changes** | Frozen schema/API; only additive (new *optional* field, new part, new optional param) changes ship as MINOR | **Reshaping shapes in place.** Published standalone game repos and every user fork pin versions; a silent reshape breaks them. Freezing is what makes the ecosystem trustable. |

The through-line: each rejected option is *easier in the moment* and *fatal to a
pillar later*. The constraints are the product.

---

## Determinism is a capability, not a detail

The fixed-timestep loop (60 Hz accumulator, spiral-of-death clamp, render
interpolation, tab-hidden auto-pause) plus a seeded `world.rng` means a recorded
input stream reproduces a run byte-identically, and the same `Game` runs in the
browser (`start()`) and headless (`stepFrames(n)`). That single property is the
root of a whole family of things a freeform-code platform cannot reliably offer:

- **Replays and ghost races** — record inputs, replay anywhere, including against
  a friend's ghost.
- **Seeded daily challenges** — everyone gets the same board from the same seed.
- **Verifiable speedruns** — a submitted input stream either reproduces the
  claimed result or it doesn't; the validator can adjudicate it headless.
- **A headless publish gate** — the validator boots every game with no canvas and
  proves it runs before it ever reaches a player.

We treat these not as a roadmap of features to build but as *consequences to
harvest*. The architecture already paid for them.

**Proven, not just intended.** Determinism is only a foundation you can build on if
it actually holds, so the SDK ships a conformance harness that turns the property
into a checkable fact: `snapshotWorld` serializes the full simulation state
byte-stably, and `runDeterminismCheck` boots a game twice on the same seed and the
same scripted input, steps N frames, and asserts the two runs never diverge (down
to the first offending frame). A single parameterized suite runs it over every seed
game and every library proof, and `gitcade validate` runs it as a non-failing
**advisory** — it flags a game whose two runs drift (the fingerprint of stray
`Math.random` or a wall-clock read in a behavior) without rejecting it, because
hardening this into a hard publish gate is a deliberate, separate decision, not a
silent contract change. Reproducible play needs no new knob: pass the canonical
seedable RNG as the existing option — `createGame(sources, { rng: seededRng(seed) })`
— and that run replays byte-for-byte.

**Cross-engine, not just same-engine.** The conformance harness runs both passes in *one*
engine, so by construction it cannot see a *cross-engine* divergence — the same blind-spot shape
as the render path. The hazard is the transcendental `Math.*` functions (`sin`/`cos`/`atan2`/`pow`/
`hypot`/…): ECMAScript mandates correctly-rounded `+ - * /` and `Math.sqrt` (bit-identical
everywhere) but leaves the transcendentals *implementation-approximated*, so their last ULP differs
across V8 / SpiderMonkey / JavaScriptCore. The simulation therefore routes every transcendental
through a *second* sanctioned seam — **`world.math`**, the entropy seam's analogue — a pure-JS,
fdlibm-derived implementation built only on the correctly-rounded primitives, so it is bit-identical
on every conformant engine. A committed **golden fingerprint** (the full snapshot stream hashed,
generated under `world.math`) anchors this: any engine that reproduces it is byte-identical to the
one that produced it. With that, "replay anywhere, in any JS engine" is *proven*, not just intended.

The check is sound only because of one invariant it cannot itself see: **rendering is
pure.** `render()` may read world state but must never advance `world.rng` or mutate
the world — all entropy and all state change live in the `update` phase. An
update-only conformance check is blind to a render-path violation by construction, so
this rule is what keeps the guarantee true as the engine grows (camera shake, for
instance, draws its RNG inside its update-phase system and only *writes* a
render-applied offset — never the reverse).

---

## The validator is the keystone

`gitcade validate` is where intent becomes guarantee. It is the publish gate, and
it performs, in order: manifest + config + scene schema validation; the storage
rule (no raw `localStorage` for ecosystem games); the no-magic-numbers rule with
`$cfg` resolution; cross-scene reference integrity (`flow.on` targets, `extends`,
`levels`, `entryPoint`, and `overrides` patch targets); `partId@version` catalog resolution against the pinned
`libraryVersion`; and a headless smoke boot.

Its job is not to nag — it is to make the pillars *true*:

- No magic numbers ⇒ every fork is diffable and every rebalance/remix is a
  concrete, one-line `$cfg` diff.
- Resolved part references ⇒ every remix actually composes from real catalog parts.
- The smoke boot ⇒ a published game is known to run, not hoped to.
- Schema + reference integrity ⇒ a fork can never silently fail to load.

**Therefore the validator is the highest-value surface in the codebase, and the
most adversarially tested.** If the validator can be fooled, the guarantees are
fiction. Hardening it — fuzzing that no literal escapes the magic-number rule,
that every catalog part round-trips, that every published game stays byte-valid
across a library bump — is not maintenance; it is defending the moat.

---

## The component marketplace as the standard

`@gitcade/library` is not a convenience layer; it is the *standard* games are
built against. Parts are game-agnostic, versioned, and carry machine-readable
catalog metadata, so a game's bill of materials is browsable and a part is
swappable. When a game genuinely needs a mechanic no part provides, it lives as a
param-driven custom part (all balance still via `$cfg`, so it still validates)
and becomes a candidate for promotion once a second consumer proves the demand —
so the catalog grows from proven demand, never speculation.

The design tension to hold consciously: **the more a game reaches for custom
code, the weaker the "compose, don't write" promise.** Closing recurring gaps
with real catalog parts (so authors don't routinely fall back to custom
behaviors) is therefore a *concept-hardening* activity, not mere content work.

---

## The invariants we protect

These are the load-bearing promises. Breaking any one of them doesn't make the
system worse — it makes it a different, ordinary system.

1. **Every published game stays valid forever.** Frozen contracts + additive-only
   evolution. A game published against an old version keeps loading.
2. **Every fork is guaranteed to load and run.** This is the promise that makes
   forking special. The day a remix can silently break is the day the concept
   dies.
3. **Balance is always data.** No magic numbers, ever. This is what keeps forks
   diffable and a remix a one-line diff.
4. **Determinism is preserved.** New runtime is additive and no-ops over scenes
   that don't use it, so headless play stays byte-identical. Both kinds of
   simulation non-determinism flow through sanctioned seams: all entropy through
   `world.rng`, and all transcendental math through `world.math` (engine-independent,
   so play is byte-identical across JS engines, not just within one). No behavior or
   system reads a wall clock; rendering is pure (it never advances RNG or mutates the
   world). This is enforced, not trusted: the conformance harness re-runs every game
   and proof on a fixed seed (proving same-engine identity) AND checks each against a
   committed cross-engine golden. Reproducibility is never traded away for a feature.
5. **Untrusted game code never escapes the sandbox.** Isolation is not negotiable
   for a platform of AI-built, user-published artifacts.

When a proposed change would weaken an invariant, that is not a trade-off to
weigh — it is a stop-and-reconsider.

---

## What this design is good for — and what it isn't

Honesty about scope is part of the design.

**Good for:** arcade, casual, puzzle, idle, tower-defense, top-down, and — since
the platformer-physics foundation landed — scrolling platformers. Anything where
the value is composition, reproducibility, easy rebalancing, web distribution,
and forkable/remixable artifacts. It is an unusually strong substrate for
*AI-authored* games specifically, for the safety reason above.

**Not built for:** 3D; freeform engine-level creativity where the fun lives in
bespoke logic (the data-only model is a straitjacket there, by design); heavy
shader/particle/large-sprite-count rendering (Canvas 2D — the renderer now
viewport-culls tiles and entities, so a large *world* scrolls cheaply; the ceiling
is per-frame sprite *count*, not world size); and binary export to app
stores or consoles (the model is a sandboxed artifact served to the browser, not
an exported build).

The point is not that these are unfixable — several are contained, additive
changes — but that the design is *opinionated*, and its strengths and limits are
the same decision viewed from two sides.

---

## Where the concept goes

This is direction, not a task list — the live engine-gap log is
[`games/ENGINE-ROADMAP.md`](./games/ENGINE-ROADMAP.md). The design lens on it is
the same question: **does this make the bet more true?**

- **Harvest determinism.** With conformance now proven and gated (every game re-runs
  byte-identically on a fixed seed + input, and the validator advises on drift), the
  capability is bankable — so build on it: replay/record-playback first (record the
  seed + input stream, replay through the same `Game`), then ghosts and seeded daily
  runs. High value, small surface, and uniquely ours.
- **Harden the validator.** Treat it as the moat; fuzz it until the guarantees are
  unbreakable.
- **Close catalog gaps with parts, not custom code,** so "compose, don't write"
  keeps holding as the genre range grows.
- **Make versioned parts migratable,** so the marketplace is a living standard,
  not a frozen snapshot.
- **Keep evolution additive.** The discipline that protects the invariants is the
  same discipline that lets the system grow without betraying anyone who already
  shipped or forked.

The ambition that fits the architecture is to be the **trustworthy substrate** for
AI-built, forkable games — the layer whose guarantees (every fork runs, every
change is a verifiable diff, every run reproducible) nothing built on freeform
generated code can offer. That, not breadth, is the edge worth compounding.
