# INDIE-ROADMAP.md — From Genre-Toy Engine to Indie-Grade 2D Platform

The **engine-fundamentals** roadmap, written from a "ship a real indie game" lens and
measured against one question:

> **Could this run a modern, professional-feeling 2D indie game — a *Super Mario Bros.*-class
> side-scroller?**

This is the authoritative home for forward-looking engine direction and **takes priority**
over the narrower [`ENGINE-ROADMAP.md`](./ENGINE-ROADMAP.md) (shipped-game bandaid log) and
[`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md) (per-game balance/content). It lists **open
work only** — shipped engine capabilities live in git history and the SDK/library package
history, not here. For *why* the architecture is the bet, see [`../DESIGN.md`](../DESIGN.md);
for the collision model specifically, [`UNIFIED-RESOLUTION-DESIGN.md`](./UNIFIED-RESOLUTION-DESIGN.md).

---

## The distance left to cover

The arcade/casual foundation and the scrolling-platformer foundation are both in place. What
remains before a *polished* indie platformer is **mechanical polish and content/authoring, not
foundation** — and almost every item below is purely **additive** under the frozen-contract
protocol (new runtime, new optional schema fields, new library parts). The one place a frozen
assumption had to move (`scene.size == viewport`) was decoupled additively via the optional
`scene.world` field, so nothing reshaped. The tiers below are in rough priority order.

---

## Tier 1 — remaining platformer feel

- **Pixel-perfect rendering option.** The renderer upsamples by `devicePixelRatio`, which
  **blurs pixel art**. Pixel-art games need integer scaling + `image-rendering: pixelated` +
  sub-pixel-snapped draws. 🟡 (a render-mode flag).

---

## Tier 2 — professional / juicy polish

The difference between "the platformer runs" and "this feels like a finished product."

- **Gamepad support.** `Input` covers keyboard + pointer/touch + a logical-action layer but
  has **no `navigator.getGamepads()` path**. Indie games are controller-first. 🟢 (an additive
  Input source feeding the existing action layer).
- **Real (sampled) audio.** All sound is procedurally synthesized — the SDK oscillator beeps
  plus the library's synth SFX and generative chiptune loops — with **no sampled-audio /
  streamed-music path** (`decodeAudioData`, asset audio files), and `scene.music` is a slot the
  synth player maps to a generative track. A professional feel leans on **recorded SFX +
  composed music + a mixer** (buses, ducking, crossfade). 🟢 (a sampled `AudioPlayer` subclass
  + an asset-audio convention).
- **Remaining juice primitives.** Screenshake (`camera-shake`) and tween/easing (`tween`) are
  data primitives already; still open: **hitstop / time-scale**, **knockback**,
  **squash-stretch**. Hitstop touches the fixed-step loop → handle carefully. 🟢
- **Screen transitions as data** (fade/wipe between scenes) instead of an instant `loadScene`
  swap. 🟢

---

## Tier 3 — content & authoring at indie scale

Capabilities for building and shipping a game with real content *volume*.

- **Tiled (`.tmx`/`.json`) import.** Hand-writing a Mario-sized level as entity JSON doesn't
  scale. Minimal step: a **`grid-layout` spawner** (expand `{prototype, rows, cols, spacing}`
  into entities at load) — a brick wall becomes a few lines, not N entity blocks. Full step:
  import a real tile editor's output. 🟢
- **Texture atlases / sprite packing.** Atlas regions cut load and let one sheet hold many
  sprites. 🟢
- **Per-frame sprite-count scaling.** Viewport culling means world *size* is no longer the
  renderer ceiling; per-frame sprite *count* is. A spatial index / chunked tilemaps is the next
  step. 🟢
- **Hitbox inset / separate collider** (`collisionInset` / `hitbox` on the entity schema):
  fairer collisions than the raw sprite AABB (corner-clip deaths, contact damage). 🟡
- **Save slots, settings, and a pause menu as data** (volume, key/pad remap, multiple
  profiles) — the expected shell of a finished game. 🟢 (builds on the persistence system).
- **Dialogue / cutscene / trigger-script primitive** for story-driven games. 🟡
- **Localization hook** (string tables, not hardcoded text sprites). 🟢
- **Genre-unlock library parts** (each removes a current workaround or enables content the
  games can't have): **`damage-flash` / i-frames** (on-hit feedback + brief invulnerability,
  built on `entity.opacity`); **`spawn-on-event` + a powerup-effect channel** (Breakout
  multiball/powerups, drop-on-death, boss minions); **`shoot-at-pointer` / aim mode** (true
  twin-stick, reads `world.input.cursor()`); **`reflect-on-hit` `forceDir`/bias + a total-speed
  cap**; **`move-grid-step` turn buffer**; and a **tileset tile-scale** field (scale a 16 px
  library tileset to a 40 px map `tileSize`). Most are 🟢; the speed cap and tile-scale touch
  shared feel/contract → human decision.

---

## The strategic tension — read before committing

GitCade's thesis is **"a game is data; community remixes are config diffs."** A polished
platformer is, by nature, a pile of bespoke, tightly-tuned mechanics. These pull against each
other, so pick a posture deliberately:

1. **Stay data-first (recommended for the platform's identity).** Ship every capability as
   **additive SDK runtime + library parts**, so "make a Mario" becomes "compose the platformer
   kit." Slower, but it *preserves the moat* — the validator, fork/remix, and governance only
   work because games are data. The work above is overwhelmingly additive, so this is the cheap
   path anyway.
2. **Use the `open` tier as the escape hatch.** The manifest defines a `tier: "open"` that omits
   `libraryVersion` (`schema/manifest.ts`) — the natural home for **code-rich indie games that
   don't fit the data model**, shipping more custom behavior without the magic-number rule, in a
   sandboxed build. (It raises a sandboxing/security question for arbitrary game code — decide
   deliberately before opening it wide.)
3. **Do not reshape frozen contracts to chase this.** Anything that would retype a field, change
   the tick order, or alter the storage-bridge / artifact conventions is a STOP-and-decide.
   Express new capability through **optional** schema fields, exactly as the camera decouple did.

---

## Sequencing

Each capability ships as an SDK minor + a library minor, gated the project's normal way: a
**proof game validates** it (the way the `proofs/` games anchor the rest), `npm test` is green,
and the behavior is **browser-verified**, not assumed. Rough order:

1. **Polish players feel first** — gamepad, pixel-perfect render mode, the remaining juice
   (hitstop / knockback / squash-stretch), screen transitions.
2. **Audio** — the sampled SFX + music + mixer path.
3. **Content & authoring** — Tiled / `grid-layout`, atlases, the save / settings / pause shell,
   per-frame sprite-count scaling, `collisionInset`.
4. **Depth & story** — the dialogue/cutscene primitive, localization, and the remaining
   genre-unlock parts.

---

## Contract-safety legend

| | Meaning | Release |
|---|---|---|
| 🟢 **Additive** | New runtime/library part, renderer honoring an already-declared slot, or a new optional param. No frozen shape changes. | PATCH/MINOR; no human decision. |
| 🟡 **Schema addition** | A new optional field on a frozen schema object (e.g. `collisionInset`, a pixel-perfect render flag). | MINOR + a human decision. |
| 🔴 **Semantics change** | Reshapes a frozen contract or the tick order. | STOP → human decision. |

Open items needing a human sign-off: **pixel-perfect render mode**, **`collisionInset`/hitbox**,
the **`reflect-on-hit` total-speed cap**, and the **tileset tile-scale** field. Everything else
above is 🟢.

---

## Cross-references

- Current concrete bandaids in shipped games: [`ENGINE-ROADMAP.md`](./ENGINE-ROADMAP.md).
- Per-game balance/content/feel/asset work: [`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md).
- Custom-part promotion candidates: [`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md).
- Collision-model rationale: [`UNIFIED-RESOLUTION-DESIGN.md`](./UNIFIED-RESOLUTION-DESIGN.md).
- Frozen-contract protocol: [`../CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
