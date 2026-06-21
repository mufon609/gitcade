# Determinism — same-engine and cross-engine

GitCade's reproducibility track (replays, ghosts, seeded daily challenges, verifiable speedruns,
the headless publish gate) rests on one property: **a fixed-timestep run is a pure function of its
seed and its per-frame input.** This document is the reference for *how* that holds — and, crucially,
how it holds **across JS engines**, not just within one.

See also: [`DESIGN.md`](../../DESIGN.md) (the rationale, invariant #4), `runtime/determinism.ts` (the
same-engine conformance harness), and `runtime/fdmath.ts` (the cross-engine transcendental seam).

---

## The two seams

A behavior or system may introduce non-determinism in exactly two ways, and each has ONE sanctioned
seam. Anything outside these seams is a determinism bug.

| Source | Seam | Why |
|---|---|---|
| **Entropy** (randomness) | `world.rng` | A seedable PRNG (mulberry32, integer-only → already cross-engine). `Math.random` is non-reproducible and bypasses replay. |
| **Transcendental math** (`sin`/`cos`/`tan`/`atan`/`atan2`/`exp`/`log`/`pow`/`asin`/`acos`, and lengths) | `world.math` | ECMAScript leaves the transcendental `Math.*` *implementation-approximated*; their last ULP differs across V8 / SpiderMonkey / JavaScriptCore. `world.math` is a pure-JS, fdlibm-derived implementation built only on the correctly-rounded primitives, so it is **bit-identical on every conformant engine**. |

No behavior or system may read a wall clock (`Date.now`/`performance.now`/`new Date`); a
fixed-timestep sim derives time from `world.time`/`world.frame`. Rendering is **pure** — it may read
world state but never advances `world.rng`, calls `world.math`-affecting state, or mutates the world.

### Why the basic ops are safe

ECMAScript mandates correctly-rounded (round-to-nearest-even) results for `+ - * /` and `Math.sqrt`,
so those are bit-identical across engines. **Fixed-point math is not needed** — only the
non-correctly-rounded library calls must be replaced. That is the whole job `world.math` does.

---

## `world.math` — the transcendental seam

`world.math` (type `MathOps`, the frozen `CanonicalMath` singleton in `runtime/fdmath.ts`) is the
transcendental analogue of `world.rng`, additive since **sdk 1.12.0**. The ported surface is kept
minimal:

- **`hypot(x, y)` = `sqrt(x*x + y*y)`** — built only from correctly-rounded primitives, so it needs
  no polynomial. (It is NOT bit-equal to `Math.hypot`, which runs its own scaled algorithm; *ours* is
  the contract.) **Prefer comparing SQUARED distances** where the magnitude itself is not needed —
  `dx*dx + dy*dy <= r*r` is exact AND sqrt-free, the right tool for range / arrival / aggro / deadzone
  gates.
- **`powInt(base, n)`** — exact-enough integer power by exponentiation-by-squaring (only `*`, so
  cross-engine bit-identical). The right tool for cost / upgrade / difficulty curves where the exponent
  is a count.
- **`pow(x, y)`** (real exponent) — `exp(y * log(x))` over the canonical `exp`/`log`, with the IEEE
  edge cases handled. Deterministic; a few ULP of accuracy, ample for difficulty curves and
  camera-shake falloff.
- **`sin` `cos` `tan` `atan` `atan2` `asin` `acos` `exp` `log`** — faithful fdlibm ports, within ~1 ULP
  of native `Math.*`, tested in `test/fdmath-1.12.0.test.ts` (accuracy vs `Math.*` + a committed
  golden bit-pattern vector).

The exotics (`cbrt`, `expm1`, `log1p`, `log2`, `log10`, hyperbolics) are intentionally absent until a
real consumer needs one — the catalog's "grow from proven demand" ethos.

---

## Classification of transcendental sites

A transcendental call is **category (a)** if its result can influence `snapshotWorld` output (the
serialized deterministic state) or gate a state branch — these MUST use the seam. It is **category
(b)** if it is render-only or audio-only and never reaches the snapshot — these may use raw `Math.*`.
`snapshotWorld` is the definition of "deterministic state"; note that FX particles are world entities
and so *are* snapshotted.

### Category (a) — routed through the seam

| Site (file → function) | Call | Reaches the snapshot via |
|---|---|---|
| `sdk/runtime/world.ts` → `resolveHierarchy` | sin/cos | child world `x`/`y`/`rotation` (every tick; unrotated parents skip it) |
| `sdk/runtime/entity.ts` → `attachTo` | sin/cos | captured `local` transform |
| `sdk/runtime/input.ts` → `bindingVector` | hypot | analog-zone vector → velocity |
| `library/behaviors/ai-wander.ts` → `pickHeading` | sin/cos | `wanderDir` → velocity |
| `library/behaviors/face-angle.ts` | atan2 (×3), squared-speed gate | `entity.rotation` |
| `library/behaviors/follow-path.ts`, `ai-patrol.ts` | squared-distance gate | waypoint-arrival branch |
| `library/behaviors/move-topdown-360.ts` | squared-distance gate | deadzone → velocity |
| `library/behaviors/melee-swing.ts` | hypot | hitbox spawn position |
| `library/behaviors/contact-damage.ts` → `applyKnockback` | hypot | knockback velocity |
| `library/util.ts` → `length` / `normalize` | hypot | used by many sim behaviors |
| `library/ui/touch.ts` → `dpadVector` | hypot | `touchDpad` → velocity |
| `library/systems/camera-shake.ts` | pow | `camera.shakeX`/`shakeY` (an RNG-desync canary) |
| `library/systems/upgrade-tree.ts` → `costFor` | powInt | upgrade cost → `world.state` gate |
| `library/fx/particle.ts` → `spawnBurst` | sin/cos | particle `vx`/`vy` (particles are world entities) |

SDK-internal sites import `fdmath` directly; library parts reach `world.math` (or import the named
functions where a pure helper has no `world`). Gate sites use **squared-distance** and so call neither
`sqrt` nor the seam.

### Category (b) — raw `Math.*` is correct (render/audio only)

| Site | Call | Why it may stay raw |
|---|---|---|
| `sdk/runtime/renderer.ts` → `lerpAngle` | atan2/sin/cos | shortest-arc rotation **interpolation** — drawn, never written back |
| `sdk/runtime/renderer.ts` (cull radius) | hypot | viewport-cull test — only decides whether to *draw* |
| `library/fx/screen-effects.ts` → `update` | sin/cos | host-side `ScreenEffects` controller — translates a DOM overlay, never touches world state |
| `library/audio/synth.ts` → `midiToFreq` | pow | WebAudio oscillator frequency — audio is not snapshotted |

`Math.PI`/`Math.LN2`/… are spec-fixed constants (identical on every engine) and stay; `Math.sqrt`/
`abs`/`floor`/`round`/`min`/`max`/`trunc`/`sign` are correctly-rounded and stay.

---

## How it is enforced

1. **Same-engine** — `runDeterminismCheck`/`assertDeterministic` boot each game/proof twice on a fixed
   seed + scripted input and assert byte-identity at every frame (`test/determinism-*` suites). The
   validator runs this as a non-failing publish advisory.
2. **Cross-engine** — a committed **golden fingerprint** (`packages/library/test/determinism-golden-1.12.0.json`):
   the full per-frame snapshot stream of every game/proof, SHA-256'd, generated under `world.math`. Any
   engine reproducing a digest is byte-identical to the one that produced it. Regenerate ONLY as a
   deliberate, surfaced re-base: `UPDATE_GOLDEN=1 npx vitest run` in `packages/library`.
3. **Static advisory** — `gitcade validate` scans a game's `src/` (excluding `main.ts` host glue) for
   raw transcendental `Math.*` and the `**` operator, pointing authors to `world.math`. **Warning
   only** — promoting it to a hard publish gate is a separate, deliberate decision.

The determinism *fingerprint* re-based to `world.math` at **sdk/library 1.12.0**; pre-1.12.0
fingerprints are not comparable across that boundary.
