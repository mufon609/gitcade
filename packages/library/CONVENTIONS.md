# CONVENTIONS.md — composing games with `@gitcade/library` + SDK

Authoring conventions distilled from the **0.3.0 game-audit pass** (six seed games,
audited end-to-end). These are not new contract — they record the patterns that read
well and the footguns that bit multiple games, so the next author (human or AI) starts
from the answer. The validator emits **non-failing advisories** (`gitcade validate`
warnings) for the two most common mistakes; the rest is judgment.

> Everything here is **data** — scene JSON, `config.json` (`$cfg`), and `partId@version`
> refs. Balance lives in `config.json`; presentation (sprites, tilemap, background)
> does not. None of these conventions changes a frozen contract.

---

## 1. FX proportionality — screen effects are for big, rare beats

The single most common audit finding (it hit tower-defense, snake, idle-clicker, and
breakout): a **full-screen `ScreenEffects.shake`/`flash` bound to a routine,
high-frequency action** — a flash on every tower placement, a shake on every brick
break / kill / pickup. Per hit it looks fine; at speed it degrades into a constant
rumble or strobe that flattens the genuinely big moments and hurts readability.

**The rule:**
- **Routine, frequent actions** (a pickup, a kill, a brick break, a placement) → a
  **LOCAL particle burst** at the point of action. Use the data FX systems —
  `explosion` (shatter/destruction) or `sparkle` (gentle pickup/level-up) — bound to
  the action's event. The event carries `{x,y}` or `{id}`, so `eventPos` resolves the
  burst to where it happened. Declare it as **scene data**, not host code:
  ```json
  { "type": "explosion", "params": { "event": "block-broken", "colors": ["#b13e53", "#ef7d57"] } }
  ```
  Omit numeric tuning (`count`/`speed`/`ttl`) to inherit the library's tuned defaults —
  those are non-whitelisted literals the validator rejects in params anyway. `colors[]`
  and `size` are allowed.
- **Big, rare beats** (death, level-clear, game-over, prestige) → a screen
  `shake`/`flash` is right and proportionate. Bind these in host glue.
- **Frequent-but-meaningful** (the player *taking* damage in a swarm) → a screen effect
  can earn its place, but **rate-limit it** with the `throttle` helper so a pile-up
  can't strobe, and prefer shake over flash (a full-screen flash on a frequent event is
  the very anti-pattern above):
  ```ts
  import { throttle } from "@gitcade/library";
  fx.bindToEvents(world, {
    damage: throttle(220, (f, data) => {
      if ((data as { target?: string } | null)?.target !== "player") return;
      f.shake(7, 0.2, 40);
    }),
  });
  ```

## 2. HUD safe-area — keep canvas HUD out of the corners

Every game's `index.html` pins a **mute button (top-left)** and a **pause button
(top-right)** as DOM elements over the canvas, each ~40px at an 8px offset. Canvas HUD
text/bars authored in those corners get covered (this bit helicopter, survival-arena,
breakout, snake, idle-clicker, tower-defense).

**The rule:** keep canvas HUD **≥ ~56px** from the top corners. Left-anchored HUD at
`x:60` clears the mute button; right-anchored HUD should end before `width − 56`; or
center it. `gitcade validate` warns (`hud-corner-button`) when a `hud`-tagged entity
sits in a corner button zone.

## 3. Background depth — prefer declarative `background.layers`

For background depth/parallax, use the **declarative `background.layers`** descriptor
(honored by the renderer since 0.3.1) rather than a hand-rolled full-field image entity
+ `auto-scroll` + `velocity` + a `$cfg` scroll key:

```json
"background": {
  "color": "#0b0b16",
  "layers": [
    { "src": "assets/backgrounds/starfield.png", "scrollX": -70 }
  ]
}
```

Each layer is an image **tiled** to cover the viewport and drifted by `scrollX`/`scrollY`
(px per second, against sim time — frame-rate independent). A fixed-camera scene uses
`scrollX: 0` (a static backdrop). Because `background` is **presentational**, the scroll
speed is a plain literal in the descriptor — no `$cfg` key needed. (Pre-0.3.1 games that
faked this with a full-field image entity at `layer:0` still work; migrate them when
convenient.)

## 4. Full-field rects anchor at the top-left {0,0}

A full-field tap target / UI overlay covers the field with **`position {0,0}`,
`size` = the field (e.g. `800×600`)**, and a high `layer` (e.g. `999`) so it's the
topmost pick. Authoring it at **center** coords (`{400,300}`) is a recurring bug: the
renderer/AABB use **top-left** semantics, so a centered anchor only covers the top-left
quadrant. It can still pass validation because the headless smoke boot taps dead-center
— inside the broken box. `gitcade validate` warns (`fullfield-rect-offset`) when a
near-full-field entity is anchored at center coords.

## 5. Cross-run persistence — await the restore, don't poll

`manifest.persist` + the `persistence` system round-trip `world.state` keys through the
storage bridge. The restore is **async**; host code that reads a persisted value on boot
must wait for it. Use the deterministic signal (0.3.1) rather than polling
`isPersistPending` and racing it:

```ts
await world.whenRestored(["best", "coins"]); // resolves once the saved values have landed
// ...now read world.state.best / world.state.coins authoritatively
```

or listen for the `"persist-restored"` event (`{ keys }`). This removes the restore race
that caused idle-clicker's offline-credit bug.

## 6. Don't reskin sprites without a reason

Several games deliberately use flat colored shapes (breakout's per-row brick tiers,
snake's segments) where the per-color coding *is* the readability. A bundled 16px sprite
stretched to a large cell looks worse and erases that coding. Reskin only when the art
genuinely improves the game — not for its own sake.
