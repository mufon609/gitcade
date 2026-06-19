# INDIE-ROADMAP.md — From Genre-Toy Engine to Indie-Grade 2D Platform

An independent audit of the GitCade engine (`@gitcade/sdk` runtime + schema and
`@gitcade/library` parts) against one question:

> **Could this grow into something that runs a game like *Super Mario Bros.* — or a
> modern, professional-feeling 2D indie game?**

This is the **engine-fundamentals** roadmap, written from a "ship a real indie game"
lens. It is the authoritative home for forward-looking engine direction and **takes
priority** over the narrower per-feature notes in
[`ENGINE-ROADMAP.md`](./ENGINE-ROADMAP.md) (shipped-game bandaid log) and
[`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md) (per-game balance/content). Where those
files used to carry engine-capability items, they now point here.

---

## TL;DR verdict

- **Can it run a side-scrolling platformer? The physics floor is now complete.** The engine
  has a **scrolling camera** (`camera-follow` system + a `scene.world` larger than the
  viewport), **tilemap collision** (`tilemap-collide`): solid tile floors, walls, and
  ceilings; mid-air platforms you can stand on; and jumping off tile ground — plus
  **entity-vs-entity solid resolution** (`solid-collide`) and **swept (continuous)
  collision**, so a crate, a ledge, or a moving lift is exactly as solid as a tile and a
  fast body won't tunnel a thin platform (up to a bounded, well-beyond-gameplay speed). The
  terrain half is proven end-to-end by the
  `platformer-scroll` reuse proof and the entity-solid half by `platformer-solids`
  (`packages/library/proofs/`). A Mario-style traversal — running a level wider than the
  screen, landing on / bonking / riding solid bodies — works today.
- **What's left before a *full* Mario:** mostly Tier-2 polish (sampled audio, particles/
  juice, render interpolation, gamepad) plus two-body **push** (movable crates) — **slopes +
  ladders** now compose from the kit (0.11.0). The genre-feel mover (variable jump, jump buffering, apex hang, run
  accel), **one-way (pass-through) platforms + drop-through**, a **data-driven animation state
  machine + facing flip**, **entity opacity/visibility**, the **entity hierarchy / transform
  parenting**, and **moving-platform carry** (`ride-platform`) are now in the engine — so a
  Mario-lite (run a wide level, animate the character, land on / drop through platforms, ride
  a moving platform) composes from the kit today. What's left is content/feel built on the
  floor that now exists, not foundation.
- **Is the architecture well-suited to grow further? Yes.** The deterministic fixed-step
  loop, the entity/behavior/system composition, and the data-driven scene model are exactly
  the right bones, and **almost every gap below is purely additive** under the frozen-
  contract protocol — new runtime, new optional schema fields, new library parts. The one
  place that touched a frozen assumption — `scene.size == viewport` — was decoupled
  **additively** via an optional `scene.world` field + a runtime `world.camera`, so every
  published game stayed byte-valid.

The honest summary: a clean, well-engineered **arcade/casual** engine (Pong, Snake,
Breakout, tower-defense, idle, top-down survival) that now also carries the
**scrolling-platformer foundation**. The remaining distance to a polished indie platformer
is real but mostly *mechanical*, not foundational.

---

## What was audited

`packages/sdk/src/runtime/{game,world,entity,renderer,collision,input,audio}.ts`, the
collision/win/spawn systems, `packages/sdk/src/schema/*` (scene, sprite, entity, tilemap,
manifest, the magic-number whitelist + validator), the full `@gitcade/library`
behavior/system/fx/audio set, and the six shipped games' host glue.

---

## The foundations that are genuinely good (keep these)

These are assets, not liabilities — an indie build should be layered *on top of* them, not
around them.

- **Deterministic fixed-timestep loop** (`game.ts`): 60 Hz accumulator with a
  spiral-of-death clamp, tab-hidden auto-pause, and a clean headless `stepFrames(n)` path.
  A fixed step + an RNG hook (`world.rng`) means **reproducible simulation** — the bedrock
  for replays, ghost races, speedrun verification, and the headless validator. Many indie
  engines *wish* they had this.
- **ECS-lite composition** (`entity.ts` / behaviors / systems): entities are
  transform + velocity + tags + a scratch `state` bag + an ordered behavior list; systems
  are scene-wide. Composable, data-authorable, and already proven across six genres.
- **Data-driven scenes**: scene `extends` inheritance, a `manifest.levels` sequence with
  `@next`/`@first` flow tokens, declarative `flow.on` transitions, and cross-run
  persistence. A multi-level campaign shell is authored once.
- **Tilemaps are first-class** (`scene.tilemap` data + the `tilemap-collide` behavior):
  tiles are stored, drawn, queryable (`world.tileAt` / `isBuildable` / `cellRect`), and now
  **physically solid** — a cell flagged `solid` stops/lands/blocks an entity AABB. "Mario
  levels are tiles" holds end to end.
- **Frozen-contract discipline + a real validator**: the no-magic-number rule, `$cfg`
  resolution, cross-scene reference integrity, and behavior-ordering advisories. This is
  what makes fork/remix/governance work and keeps published games byte-stable.

---

## Tier 0 — the platformer foundation

All four keystones — **a scrolling camera**, **tilemap collision**, **entity-vs-entity
solid resolution**, and **swept (continuous) collision** — are now in the engine. The
physics floor is complete; what's above it (Tier 1) is feel, not foundation.

### Now in the engine — the scrolling-platformer foundation
- **Camera / viewport.** `scene.world` (optional) decouples the simulation bounds from the
  viewport (`scene.size`); the runtime `world.camera` is the window the renderer translates
  by (`-cam.x`/`-cam.y`, rounded, skipped at the origin so non-scrolling scenes stay
  byte-identical). The `camera-follow` system pans the viewport to a target with optional
  easing + deadzone, clamped to the world. Authored additively — every pre-camera game
  renders unchanged.
- **Tilemap collision.** A `solid` tile-property flag + the `tilemap-collide` behavior
  resolve an entity's AABB against solid cells (axis-separated, pre-fall span for the X
  pass so a landing doesn't read the floor as a wall), zero the contacted velocity
  component, and write the **first-class typed `entity.contacts`** (`onGround`/`onCeiling`/
  `onWallL`/`onWallR`/`onOneWay`) — the contract home of the contact-sensing protocol,
  alongside the typed `entity.collisions`/`entity.anim`. `move-platformer` reads
  `entity.contacts.onGround`, so a tile floor satisfies the jump test.
- **Entity-vs-entity solids + swept collision.** The SDK's shared `resolveSolids` push-out
  primitive (`runtime/collision.ts`) snaps a moving AABB out of solid rects — fed solid
  tile *cells* by `tilemap-collide` and solid *entities* by the new `solid-collide`
  behavior — with the same contact flags, so a crate, ledge, or vertical lift is exactly
  as solid as a tile (stand on it, get blocked, bonk it, jump off it, ride it). Several
  resolvers on one entity combine their flags per tick (`applyContacts`). Adaptive swept
  sub-stepping caps each slice below the thinnest solid (within a bounded sub-step budget
  that clears any realistic speed), so a fast body won't tunnel a thin platform; a slow body
  runs a single byte-identical pass. Proven end-to-end by the `platformer-solids` reuse proof.

### Two-body dynamics — CARRY ✅ now in the engine; PUSH still open 🟢
`solid-collide` is a **one-way** push-out: the moving entity is resolved out of solids that
are themselves immovable. The two halves on top of it:
- **Carry. ✅ Now in the engine (`ride-platform`, 0.10.0).** A rider standing on a `carryTag`
  solid inherits that solid's per-tick world delta — **horizontal** carry (a platform sliding
  sideways takes the rider) and **descending** carry (a sinking platform the rider follows
  down); vertical-up carry already came from the push-out. Built on a generic first-class
  `entity.prevX/prevY` (the tick's start position, snapshotted by the loop — also the
  groundwork render interpolation needs); the behavior probes the carrier's pre-tick top + a
  `vy>=0` gate, so it's self-contained and a fast-descending platform never leaves the rider.
  Proven by the `platformer-carry` proof (ride + walk-while-carried + descending follow). 🟢
- **Push — movable crates** (a player push that *moves* the crate: mass + mutual resolution)
  remain open. The harder half; carry was the common platformer need. Deferred to a deliberate
  **unified-resolution** effort: a single ordered phase that resolves coupled touching bodies
  (carry + push) *and* re-resolves them against solids in the same pass. A naive post-behavior
  carry phase is a regression (it applies carry AFTER the rider's `solid-collide`, so a carrier
  shoving a rider into a wall penetrates it — whereas `ride-platform` runs FIRST and re-resolves
  same-tick), so carry-as-a-phase and push land together here, not separately. The full design —
  the additive `resolveBodies()` phase, the `collider` component, the dependency-ordered carry+push
  solver, the determinism story, and the proof-gated build order — is written up in
  [`UNIFIED-RESOLUTION-DESIGN.md`](./UNIFIED-RESOLUTION-DESIGN.md). 🟢 (foundation landed
  `1.1.0`–`1.2.0` — the `resolveBodies()` phase + `collider` component + candidate-keyed solid
  push-out + the slope pass, with `platformer-solids`/`platformer-slopes` migrated; carry/push remain).

---

## Tier 1 — "feels like a real platformer" (once Tier 0 lands)

- **A proper platformer mover. ✅ Now in the engine (`move-platformer` 1.2.0).** The mover
  gained the genre-feel layer — **variable jump height** (release-to-cut), **jump
  buffering**, **apex hang** (reduced gravity near the peak), and **run acceleration/
  friction** (instead of the old instant `vx = axis * speed`) — plus it reads the typed
  contact field (`entity.contacts.onGround` off a tile floor or a solid body). Every piece is an OPTIONAL
  param defaulting to the original fixed-impulse/instant behavior, so the bump is additive
  (a game setting none of them is byte-identical); driven end-to-end via `$cfg` by the
  `platformer-scroll` proof.
- **One-way (pass-through) platforms. ✅ Now in the engine.** A `oneWay` tile-property flag
  (and a `solid-collide` `oneWayTag` for ledge entities) makes a cell/body solid on its TOP
  face only: a falling body lands on it, but jumps up through it, runs past it sideways, and
  `move-platformer`'s **drop-through** (down + jump, `down`/`dropThroughTime`) falls through
  it. Built on the shared `resolveSolids` primitive (the one-way case is a per-rect flag);
  proven by the `platformer-scroll` proof (land-on + drop-through). 🟢
- **Moving platforms. ✅ Now in the engine** via the two-body **carry** mode (`ride-platform`,
  0.10.0) — a rider rides a sliding/sinking solid platform (see Tier-0 two-body below). 🟢
- **Ladders + slopes. ✅ Now in the engine (0.11.0).** **Floor slopes** are a `slopeL`/`slopeR`
  tile-property pair (surface heights up from the cell bottom — 45° and gentler linear ramps,
  tiling seamlessly), resolved by a NEW SDK `resolveSlopes` primitive run as a second non-AABB
  pass after `resolveSolids` inside `tilemap-collide`: it rests a body's bottom on the per-column
  surface (sampled at the body center), sticks downhill, and lets a jump pass up through —
  no-op when a map has no slope cells. **Ladders** are a `ladder` tile flag + a `move-platformer`
  climb mode (`climbSpeed`/`up`/`down`): over a ladder tile, up/down climbs with gravity off, and
  the player steps off the side. Both additive (optional params default off). Proven by the
  `platformer-slopes` proof (walk up/down a chevron ramp, climb a ladder). 🟢
- **Animation state machine. ✅ Now in the engine (`sprite-state-machine`).** A data-driven
  behavior that maps motion state (grounded via the typed `entity.contacts.onGround`, horizontal
  speed, vertical direction) → a named `sheet` clip each tick: idle → run → jump → fall →
  land, with `land` as a non-looping one-shot that holds until it completes. Each clip name
  is a param (defaults to its conventional name; `""` disables a state). Built on the
  existing `sheet`/`animations` schema; proven by the `platformer-scroll` proof. 🟢
- **A facing/flip convention. ✅ Now in the engine (`face-velocity`).** Sets `entity.scaleX`
  sign from horizontal velocity so a side-view sprite faces the way it moves (the renderer
  already honors a negative `scaleX` as a flip). Preserves scale magnitude, holds facing
  below a threshold, has an `invert` for left-facing art. Distinct from `face-angle` (which
  rotates). 🟢
- **Pixel-perfect rendering option.** The renderer upsamples by `devicePixelRatio`, which
  **blurs pixel art**. Pixel-art indie games need integer scaling +
  `image-rendering: pixelated` + sub-pixel-snapped draws. 🟡 (a render-mode flag).
- **Honor `opacity`/`alpha`. ✅ Now in the engine.** `renderer.drawEntity` applies an
  optional `entity.opacity` as `globalAlpha` (multiplied + clamped, skipped at 1) — the
  whitelisted key it used to ignore. A behavior writes `entity.opacity` at runtime for
  fades, ghosts, i-frame flicker, and damage flashes. 🟢 renderer-only.

---

## Tier 2 — "feels professional / juicy" (the polish layer)

This is the difference between "the platformer runs" and "this feels like a finished
product."

- **Render interpolation.** `render()` draws the latest fixed tick with **no
  interpolation** between steps (`game.ts`). On 120/144 Hz displays motion updates only
  60×/s → visible **judder**. Add accumulator-alpha interpolation of draw positions. 🟢
- **Gamepad support.** `Input` covers keyboard + pointer/touch + a logical-action layer but
  has **no `navigator.getGamepads()` path**. Indie games are controller-first; this is a
  conspicuous gap. 🟢 additive Input source feeding the existing action layer.
- **Real audio.** All sound is **procedurally synthesized** — the SDK's 8 oscillator beeps
  (`audio.ts`) and the library's richer synth SFX + two generative chiptune loops
  (`library-audio-player.ts`). There is **no sampled-audio / streamed-music path** (no
  `decodeAudioData`, no asset audio files), and the `scene.music` field is effectively a
  declared slot the synth player maps to a generative track. A professional indie feel
  leans on **recorded SFX + composed music + a mixer** (buses, ducking, crossfade). 🟢
  additive (a sampled `AudioPlayer` subclass + an asset-audio convention).
- **Juice primitives as data. Screenshake ✅ done (`camera-shake`).** A data-triggered
  system that, on a named event (`world.events.emit("shake", { magnitude, duration })`),
  writes a decaying random offset to the runtime `camera.shakeX`/`shakeY` (added by the
  renderer, kept separate from the follow base so it never disturbs `camera-follow` or
  pointer mapping). Deterministic off `world.rng`; proven by the `platformer-scroll` proof.
  This is the engine replacement for the host-side `ScreenEffects` DOM canvas-translate
  shake — **the survival-arena adoption is a post-publish one-liner** (it pins `0.6.0` in
  `package.json` and resolves the installed catalog, so it can't reference the 0.7.0
  `camera-shake` part until 0.7.0 ships; the swap is `emit("shake", …)` + the system in
  `play.json`, with flash staying a host overlay). Still open: **hitstop/time-scale,
  knockback, squash-stretch** (hitstop touches the fixed-step loop → handle carefully). 🟢
- **Tweening / easing primitive. ✅ Now in the engine (`tween`).** A behavior that animates
  one numeric property (`x`/`y`/`scale`/`scaleX`/`scaleY`/`rotation`/`opacity`) from a start
  to a target over a duration with an easing curve (linear / in-out-quad / `out-back`
  overshoot) and a `loop` mode (none / loop / pingpong). Drives the renderer-honored
  transform + `opacity` slots, so coin pops, bobbing pickups, fade-ins, and pulsing beacons
  are data — proven by the pulsing goal flag in the `platformer-scroll` proof. 🟢
- **Screen transitions as data** (fade/wipe between scenes), instead of an instant
  `loadScene` swap. 🟢

---

## Tier 3 — content & authoring at indie scale

Capabilities for building (and shipping) a game with real *content volume*.

- **Tiled (`.tmx`/`.json`) import.** Authoring a Mario-sized level as hand-written entity
  JSON does not scale. The minimal step is a **`grid-layout` spawner** (expand
  `{prototype, rows, cols, spacing}` into entities at load) — a brick wall becomes a few
  lines instead of N entity blocks. The full step is importing a real tile editor's output.
  🟢
- **Texture atlases / sprite packing.** Canvas2D `drawImage`-per-entity is fine to a few
  hundred entities, but atlas regions cut load and let one sheet hold many sprites. 🟢
- **Spatial partitioning for collision. ✅ Now in the engine (0.12.0).** `aabb-collision` keeps
  the O(n·m) nested loop for small tag pairs but, above a threshold, buckets the `b` colliders
  into a uniform grid and tests each `a` only against the candidates in the cells its AABB
  overlaps — O(n+m) typical, so a busy level with hundreds of colliders scales. The result is
  **byte-identical** to the naive loop (candidates tested in ascending index order → same
  `entity.collisions` contents AND order), so determinism is preserved. Internal — no contract
  or behavior change; pinned by SDK byte-identity tests vs a naive reference at scale. 🟢
- **Hitbox inset / separate collider** (`collisionInset` / `hitbox` on the entity schema):
  fairer collisions than the raw sprite AABB (corner-clip deaths, contact damage). 🟡 new
  optional entity field.
- **Entity hierarchy / parenting. ✅ Now in the engine (transform hierarchy).** A parented
  entity (`parent` + `local` schema fields) has its WORLD transform derived each tick from its
  parent's world transform composed with a parent-frame offset — a `resolveHierarchy()` tick
  phase (after behaviors, before render; a no-op when no entity has a parent, so parentless
  scenes stay byte-identical). `entity.x/y/rotation/scaleX/scaleY` stay WORLD-space (renderer/
  collision/queries unchanged); the offset lives in `entity.local`. Carried items, a turret on a
  moving platform, multi-part bosses, attached HUD/FX, and a rigid rider all compose; runtime
  `attachTo`/`detach` pick up / drop without teleport; multi-level chains resolve parent-first,
  cycle-safe; the validator catches dangling/cyclic parent refs. Proven by the `entity-parent`
  proof. 🟡 (additive optional schema fields + an additive tick phase). NB a rider that *walks*
  on a moving platform is the resolver **carry** mode below, not transform parenting.
- **Save slots, settings, and a pause menu as data** (volume, key/pad remap, multiple
  profiles) — the expected shell of a finished game. 🟢 (builds on the persistence system).
- **Dialogue / cutscene / trigger-script primitive** for story-driven indie games. 🟡
- **Localization hook** (string tables, not hardcoded text sprites). 🟢
- **Genre-unlock library parts** (absorbed here from the older roadmaps; each removes a
  current workaround or enables content the games can't have): the **entity visibility
  toggle** (✅ done — the renderer skips `visible:false`, and tower-defense's `x = -9999`
  off-screen-park bandaid is retired); **`damage-flash` / i-frames** (on-hit feedback +
  brief invulnerability — now unblocked by `entity.opacity`); **`spawn-on-event` + a
  powerup-effect channel** (Breakout
  multiball/powerups, drop-on-death, boss minions); **`shoot-at-pointer` / aim mode** (true
  twin-stick, reads `world.input.cursor()`); **`reflect-on-hit` `forceDir`/bias + total
  speed cap**; **`move-grid-step` turn buffer**; and a **tileset tile-scale** field (scale a
  16 px library tileset to a 40 px map `tileSize`). The first few are 🟢; the speed-cap and
  tile-scale touch shared feel/contract → human decision.

---

## The strategic tension — read before committing to this

GitCade's thesis is **"a game is data; community remixes are config diffs."** A polished
platformer is, by nature, a pile of bespoke, tightly-tuned mechanics. These pull against
each other, and the roadmap should pick a posture deliberately:

1. **Stay data-first (recommended for the platform's identity).** Ship every Tier-0/1/2
   capability as **additive SDK runtime + library parts**, so "make a Mario" becomes
   "compose the platformer kit." This is slower, but it *preserves the moat*: the
   validator, fork/remix, and governance only work because games are data. The good news,
   per the tags above, is that this is overwhelmingly *additive* — no frozen reshape is
   required except the camera decouple (done additively).

2. **Use the existing `open` tier as the escape hatch.** The manifest already defines a
   `tier: "open"` that omits `libraryVersion` (`schema/manifest.ts`). That is the natural
   home for **code-rich indie games that don't fit the data model** — let them ship more
   custom behavior without the magic-number rule, in a sandboxed build. This buys
   ambitious indie titles *without* contorting the ecosystem-tier contract. (It raises a
   sandboxing/security question for arbitrary game code — worth a deliberate decision
   before opening it wide.)

3. **Do not reshape frozen contracts to chase this.** The camera is the only place a
   frozen assumption (`scene.size == viewport`) must move; do it via **optional**
   `scene.world` / `scene.camera` fields so every published game stays byte-valid. Anything
   that would retype a field, change the tick order, or alter the storage-bridge/artifact
   conventions is a STOP-and-decide, exactly as today.

---

## Suggested sequencing (the roadmap)

Each phase ships as an SDK minor + a library minor, gated the project's normal way: a
**proof game validates** it (a "Mario-lite" proof, the way Pong and the `proofs/` games
anchor the rest), `npm test` is green, and the behavior is **browser-verified**, not
assumed.

- **Phase A — platformers become possible.** *Shipped:* camera + world/viewport decouple
  (`scene.world` + `world.camera` + `camera-follow`) and tilemap collision (`solid` flag +
  `tilemap-collide` + the `move-platformer` grounding hook), validated by the
  `platformer-scroll` proof; **the shared `resolveSolids` push-out primitive with
  entity-vs-entity solids (`solid-collide`) and swept sub-stepping**, validated by the
  `platformer-solids` proof. The whole physics floor is in; `move-platformer` 1.2.0
  added the Tier-1 feel layer (variable jump, jump buffering, apex hang, run accel/friction)
  — additively, driven by the `platformer-scroll` proof; and **one-way (pass-through)
  platforms + drop-through** landed on the same primitive (`oneWay` tile flag / `oneWayTag`
  + `move-platformer` `down`/`dropThroughTime`), proven by the `platformer-scroll` proof.
  The two-body **carry** mode (`ride-platform`, 0.10.0) lands the moving-platform case, and
  **floor slopes + ladders** (`resolveSlopes` + `move-platformer` climb, 0.11.0) the terrain.
  *Remaining (Tier 1):* two-body **push** (movable crates).
- **Phase B — it feels like a platformer.** *Shipped:* the **animation state machine**
  (`sprite-state-machine`) + **flip convention** (`face-velocity`), and **entity
  `opacity`/`visibility`** honored by the renderer (the latter retiring the tower-defense
  off-screen-park bandaid) — driven end-to-end by the `platformer-scroll` proof.
  *Remaining:* render interpolation, gamepad, pixel-perfect render mode, hitstop. (The
  `tween`/easing primitive — a Tier-2 item — also landed here, ahead of its phase.)
- **Phase C — it feels finished.** Sampled audio + music + mixer, data-driven
  particles/screenshake/camera juice, Tiled/`grid-layout` authoring, atlases, spatial-hash
  broadphase, `collisionInset`, save slots / settings / pause menu.
- **Phase D — depth & story.** *Shipped:* the **entity hierarchy / transform parenting**
  (`parent`/`local` + `resolveHierarchy()` + `attachTo`/`detach`), proven by the `entity-parent`
  proof. *Remaining:* dialogue/cutscene primitive, localization, and the remaining genre-unlock
  parts.

---

## Contract-safety legend

| | Meaning | Release |
|---|---|---|
| 🟢 **Additive** | New runtime/library part, renderer honoring an already-declared slot, or a new optional param. No frozen shape changes. | PATCH/MINOR; no human decision. |
| 🟡 **Schema addition** | A new optional field on a frozen schema object (e.g. `scene.camera`, `collisionInset`, a pixel-perfect render flag). | MINOR + a human decision. |
| 🔴 **Semantics change** | Reshapes a frozen contract or the tick order. | STOP → human decision. |

Items needing a human sign-off, collected: **pixel-perfect render mode**,
**`collisionInset`/hitbox**, the **`reflect-on-hit` total-speed cap**, and the **tileset
tile-scale** field. (**Entity hierarchy / parenting** shipped as a sign-off-gated 🟡 — additive
`parent`/`local` schema fields + an additive `resolveHierarchy()` tick phase, no frozen reshape.) (The camera/world decouple — the one near-load-bearing
change — shipped additively via the optional `scene.world` field, so it needed no frozen
reshape.) Everything else is 🟢.

---

## Cross-references

- Current concrete bandaids in shipped games: [`ENGINE-ROADMAP.md`](./ENGINE-ROADMAP.md).
- Per-game balance/content/feel/asset work: [`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md).
- Custom-part promotion candidates: [`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md).
- Frozen-contract protocol: [`CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
