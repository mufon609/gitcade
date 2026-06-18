# ENGINE-ROADMAP.md — Engine-Core Gaps & Next-Feature Roadmap

This is the third synthesis doc, the **engine-core** counterpart to:

- [`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md) — generalization candidates for `@gitcade/library` parts.
- [`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md) — per-game, isolated balance/content/asset work.

Where those two cover *library parts* and *single-game polish*, this doc covers the
**SDK runtime/schema** — the gaps that force every game to patch the same thing in
host JS. It is the answer to two questions: *which bandaids are really engine gaps?*
and *what should the engine grow next?*

> **Audit basis (2026-06-17).** A fresh end-to-end read of `packages/sdk/src/runtime/*`
> and all six games' **current** `src/main.ts` + `src/custom-behaviors/index.ts` (not
> the historical narrative in the other docs). Line refs below are verified against the
> code as of this date.

---

## The pattern we're hunting

GitCade's contract is **"a game is data, not code"**: a game should be `game.json` +
`config.json` + JSON scenes composing library/SDK parts, with a *thin* host `main.ts`
doing only what has no data primitive (mount the canvas, mount the storage bridge, wire
DOM chrome, gate audio). So the audit rule is simple:

> **Any real game logic in `main.ts`, and any custom behavior/system, is a candidate
> bandaid.** If the same bandaid appears in several games, it's an engine gap.

The good news: the **library** half is largely done. Across two prior audit cycles the
heavy primitives were extracted into the SDK/library — `snapToGrid`, `transaction`,
`persistence`, `scale-by-state`, `formatCompact`, `cappedOfflineGain`, `throttle`,
`face-angle`, and World-level `isBuildable`/`whenRestored`/`entityAt`/`justReleased`.
**Survival-arena is now down to zero custom parts** — the model end-state.

What remains is **engine-core**: things no library part can fix because they need the
runtime, the renderer, the input layer, the tick loop, or the schema to change. Those
are the findings below.

---

## Contract-safety legend (per [CLAUDE.md](../CLAUDE.md) frozen-contract protocol)

| | Meaning | Release |
|---|---|---|
| 🟢 **Additive** | New library part, new *optional* SDK method, or the renderer/runtime honoring an **already-declared** schema slot. No frozen shape changes. | PATCH or MINOR; no human decision needed (this is exactly how `background.layers`, `rotation/scale`, and `whenRestored` shipped). |
| 🟡 **Schema addition** | A **new optional field** on a frozen schema object. The project treats schema-*shape* additions as contract changes (it deferred the text-sprite `format` field on these grounds). | MINOR + a human decision. Often has a 🟢 part-based alternative. |
| 🔴 **Semantics change** | Reshapes a frozen contract or the **frozen tick order**. | STOP → human decision. |

---

## Summary

| # | Engine gap | Games affected | Today's bandaid | Safety |
|---|------------|----------------|-----------------|:---:|
| E1 | **No unified input/action layer** ✅ shipped 0.4.0 | snake, helicopter, breakout | ~~DOM buttons `dispatchEvent(new KeyboardEvent())`~~ → logical action layer | 🟢 |
| E2 | **No formatted / computed / entity text binding** ✅ shipped 0.4.0 | all 6 | ~~per-frame `mirror()` rAF loop~~ → `format-binding` data part | 🟢 |
| E3 | **No key→flow-event data part** ✅ shipped 0.4.0 | all 6 | ~~host Enter/Space → `emit()` bridge~~ → `key-emit` part | 🟢 |
| E4 | **No data pause primitive** ✅ shipped 0.4.0 | all 6 | ~~host `setPaused` state machine~~ → engine `togglePause`/`pauseKeys` | 🟢 |
| E6 | **No shared/global stat modifier** ✅ shipped 0.4.0 | tower-defense | ~~`restampTowers` rewrites every tower's params~~ → `stat-modifier` system | 🟢 |
| E7 | **Win conditions can't query live entities / compose** ✅ shipped 0.4.0 | tower-defense | ~~hand-rolled win in `creep-accounting`~~ → composed `win-lose-conditions@1.1.0` | 🟢 |
| E8 | **No entity show/hide** | tower-defense | park preview entities at `x:-9999` | 🟡 |
| E9 | **No hover/cursor input channel** ✅ shipped 0.5.0 | tower-defense | ~~host `pointermove` → `world.state.buildHover` + manual screen→world transform~~ → `world.input.cursor()` | 🟢 |
| E10 | **No scene-scoped event listeners** ✅ shipped 0.5.0 | tower-defense (+ any event-driven part) | ~~per-part `WeakMap` `attachOnce` dedup~~ → `world.events.onScene` | 🟢 |

---

## Findings

### E1 — No unified input / action layer 🟢 — ✅ SHIPPED in 0.4.0
**Affected:** snake, helicopter, breakout (every game with a non-axis controller).

> **✅ SHIPPED (0.4.0, additive MINOR).** The SDK `Input` gained a logical-action
> layer — `defineActions`/`action`/`actionVector`/`setAction`/`setActionVector`/
> `resetActions`, evaluating bindings (keyboard `keys`/`axisKeys`, a touch `rect`, an
> analog `zone`) or a host override — plus a library **`input-actions@1.0.0`** system
> that installs the bindings as pure scene DATA, and a **`move-grid-step@1.1.0`**
> `moveAction` param. **Adopted:** snake (keyboard `axisKeys` + a touch d-pad driving
> `setActionVector`), helicopter (`thrust` bound to `Space` + a full-canvas `rect`,
> "hold anywhere to fly" — zero host touch glue), breakout (the paddle now uses the
> SDK `keyboard-axis`, which already had drag-to-move touch). **The synthesized-
> `KeyboardEvent` block is deleted from all three.** Keyboard play is byte-identical
> (verified by per-game real-DOM-event end-to-end tests). Scene-scoped (cleared on
> `loadScene`); inert for any game that defines no action. Republish + consumer repin
> pending (the change is built but unpublished).

There are **three incompatible input conventions** and nothing unifies them:
- `move-grid-step` (snake) and `thrust-lift` (helicopter) read **keyboard codes only**
  (`anyDown(up/down/left/right)`; `anyDown(thrustKeys)`).
- the SDK `keyboard-axis` reads codes **plus** a built-in "move toward the finger"
  pointer mode (`packages/sdk/src/runtime/behaviors/keyboard-axis.ts:25-33`).
- the library `touch-dpad`/`touch-button` parts emit **velocity** / a **`world.state`
  flag** (`packages/library/src/ui/touch.ts:56-85`) — which the keyboard-only movers
  don't read.

So a game adding touch **can't drop in `touch-dpad`** — the mover won't see it. The only
layer all movers share is the raw DOM key event, so each game builds DOM buttons that
**synthesize keyboard events**:

```
games/snake/src/main.ts:150-181        // synthKey() + window.dispatchEvent(new KeyboardEvent(...))
games/helicopter/src/main.ts (HOLD TO FLY → Space)
games/breakout/src/main.ts  (◀ ▶ → arrows)
```

Synthesizing browser input to feed your own engine is the textbook bandaid, copy-pasted
three times.

**Root cause:** movers are hardwired to physical key codes; there is no logical-*action*
indirection.
**Fix sketch:** an input-binding layer — declare actions (`thrust`, `left`, `fire`),
each satisfiable by keyboard codes, a touch zone/button, or a pointer; expose
`world.input.action("thrust")` and give movers an optional `action:` param (default to
their current key reading, so existing games are byte-identical). Ships as additive SDK
surface + new mover params (a part MINOR) + a data touch-control descriptor.
**Why it's first:** retires the hackiest, most-duplicated code in the codebase **and** is
the prerequisite for every Track-2 control scheme (twin-stick, shoot-at-pointer).

### E2 — No formatted / computed / entity-bound text 🟢 (part) / 🟡 (schema field) — ✅ SHIPPED in 0.4.0 (part path)
**Affected:** all six games.

> **✅ SHIPPED (0.4.0, additive — the contract-safe PART path).** New library
> **`format-binding@1.0.0`** system: per-binding it reads a `world.state` (or a named
> entity's `state`) value and floors/rounds/ceils/compacts/`fixed:N`-formats it,
> optionally multiplies by a second state key, wraps it in a `{v}`/`{c}` template (with
> a `$cfg`-resolved constant so config stays single-sourced), maps a discrete value to a
> label, or hides on zero — writing the result to the key a text/HUD sprite already
> binds. **No schema change** (the text-sprite `bind` slot is untouched); this is why
> the part path was chosen over the 🟡 text-sprite `format` field. **Adopted:**
> helicopter and survival-arena **deleted their per-frame `mirror()` rAF loops entirely**
> (score floor; hp-from-entity + clock ceil + maxHp const + win/lose outcome map);
> idle-clicker and tower-defense **shrank** theirs to the genuinely host-bound residue
> (the HTML shop/upgrade bar, the offline `Date.now()` heartbeat, TD's one two-value
> outcome line) — the numeric/compact/templated HUD strings, including idle's duplicated
> `formatCompact`, are now DATA. Verified by per-game end-to-end HUD assertions.

`TextSprite` has `bind` but no `format`/`precision`/template
(`packages/sdk/src/schema/sprite.ts:61-71`); the renderer prints the raw value with
`String(bound)` (`renderer.ts:227`). Binding also only reaches `world.state`, never an
entity's state or a computed expression. Consequences, in every game:

```
games/helicopter/src/main.ts:45-51    // a standalone rAF loop JUST to floor a float score
games/tower-defense/src/main.ts:96-115 // mirror(): "Gold N", "Wave n/10", build hints, every frame
games/idle-clicker/src/main.ts:158-177 // mirror(): formatCompact coins/rate/power, every frame
games/survival-arena/src/main.ts:50-68 // mirror(): also byId("player").state.hp → world.state.hp
```

These `mirror()` loops poll `world.state` (and, in survival, a child entity's internal
state) every animation frame because there is no declarative formatting and no
change-event to drive an update.

**Root cause:** text binding is unformatted, `world.state`-only, and push-not-bind.
**Fix sketch (two paths):**
- 🟢 **Part path (contract-safe):** a library `format-binding` system —
  `{ src, dst, format: "compact|int|fixed:2|template:'Wave {v}/10'" }` reads
  `world.state[src]`, writes the formatted `world.state[dst]`. Deletes the rAF loops as
  *data*, no schema change. An `entity-state-binding` system covers survival's hp bridge.
- 🟡 **Schema path (cleaner, needs a decision):** add `format`/`bind`-from-entity fields
  to `TextSprite`. This is the version the prior audit *deferred* as a frozen-contract
  reshape — note it here so the decision is explicit, but the part path gets the win now.
**Why it's high:** biggest pure-deletion across the whole game set; every game loses a
per-frame host loop.

### E3 — No keyboard → flow-event data part 🟢 — ✅ SHIPPED in 0.4.0
**Affected:** all six (every menu screen).

> **✅ SHIPPED (0.4.0, additive).** New library **`key-emit@1.0.0`** UI behavior — the
> keyboard companion to `tap-emit`: it emits a flow event on the down-edge of `keys`, and
> goes on the SAME flow-button entity as `tap-emit`, emitting the SAME event, so pointer
> AND keyboard drive the scene's `flow.on` with no host code. It adopts a key still HELD
> across the spawning scene change (so a thrust key down at game-over doesn't instantly
> skip the over screen). **Adopted:** every title/over/win button in all six games; the
> host Enter/Space `keydown` bridge is **deleted** from all six `main.ts`.

### E4 — No data pause primitive 🟢 — ✅ SHIPPED in 0.4.0 (engine API)
**Affected:** all six (idle-clicker had no pause; the other five adopted).

> **✅ SHIPPED (0.4.0, additive — engine API, not a pure-data part).** Design finding:
> **a frozen sim cannot unfreeze itself** — a behavior/system that would clear a
> `__paused` flag is dead while paused — so the unpause trigger MUST live outside the
> sim loop. The SDK `Game` now owns pause: `pauseKeys` (GameOptions) are edge-detected in
> the **rAF loop**, which keeps running while paused (the DOM key listeners keep the held
> set live), a `pauseScenes` guard blocks pausing menus (never strands a pause — unpause
> is always allowed), `togglePause()` flips the freeze, and a **`pause-changed`** event
> lets the host REACT (overlay + audio) without owning the logic. **Adopted:** the five
> games with a pause deleted their `setPaused` state machine + Esc/P `keydown` listener,
> keeping only a `pause-changed` listener + `pauseBtn.onclick → togglePause()`. (The
> roadmap's `__paused`-flag sketch can't work for the deadlock reason above; the
> engine-owned-keys design is the realistic answer. The overlay/audio stay host — they're
> DOM/audio presentation the engine can't touch.)

### E6 — No shared / global stat modifier 🟢 — ✅ SHIPPED in 0.4.0
**Affected:** tower-defense, idle-clicker.

> **✅ SHIPPED (0.4.0, additive — new library SYSTEM).** New **`stat-modifier@1.0.0`**:
> per `modifier` it computes a value from `world.state` (a `from` key, or a `$cfg`
> `base` optionally scaled by the same `1+perLevel·(level-1)` factor as `scale-by-state`,
> optionally × a `multKey`, clamped to `[min,max]`) and writes it to a named behavior
> `param` across EVERY entity carrying a tag, every tick. It is the shared/global
> counterpart to the entity-self `scale-by-state`. **Adopted:** tower-defense — the
> towers' range/cooldown are now DATA (a modifier keyed on `towerRange`/`towerCooldown`),
> and **`restampTowers`/`stampDef` are deleted**: a per-tick set raises every live tower
> on an upgrade AND stamps a freshly-spawned tower the same tick, with no event listener.
> **idle-clicker was evaluated and intentionally left as-is** — its `prestigeMult` is
> already clean data (a `multKey` param read by the income SYSTEMS), not a host bandaid,
> and those are systems reading `world.state`, not tagged entities with behavior params,
> so `stat-modifier` (which stamps entity behavior params) wouldn't fit it cleanly.
> Verified by a per-game e2e (a range upgrade re-stamps both an existing and a
> later-placed tower). Republish + repin pending (built, unpublished).

`scale-by-state` scales an entity from *its own* state. But a TD upgrade must raise
range/cooldown on **all** towers, so the game reaches into every live tower's
`behaviors[].params` on each upgrade event:

```
games/tower-defense/src/custom-behaviors/index.ts:52-72  // stampDef / restampTowers
games/tower-defense/src/custom-behaviors/index.ts:141    // re-stamp a freshly-spawned tower from world.state
```

Idle-clicker has the same shape: `prestigeMult` is hand-threaded through all four income
systems (`click-to-earn`/`auto-income`/`interval-bonus`/`prestige` each multiply by
`multKey`).
**Root cause:** no data representation of "this value modifies many entities/systems."
**Fix sketch:** a library `stat-modifier` system — applies `world.state[level]`-derived
multipliers to a named param across all entities tagged X (the shared/global counterpart
to the entity-self `scale-by-state`). New part; additive.

### E7 — Win conditions can't query live entities or compose 🟢 — ✅ SHIPPED in 0.4.0
**Affected:** tower-defense.

> **✅ SHIPPED (0.4.0, additive — bumped the library system to `win-lose-conditions@1.1.0`).**
> The condition vocabulary grew, additively and byte-identically for existing
> `{key,cmp,value}` conditions: a **live entity-count** condition `{ tag, count?, value? }`
> (via `world.query(tag).length`; `value` defaults to `0`, so "field cleared" needs no
> numeric literal — dodging the magic-number rule cleanly), a **state truthy/falsy flag**
> `{ key, truthy|falsy }`, and **`all`/`any` composition**. **Adopted:** tower-defense —
> its real win `{ all: [ {key:"wavesComplete",truthy}, {tag:"creep",count:"eq"} ] }` is
> now DATA; `creep-accounting`'s hand-rolled win predicate is deleted (it keeps only the
> one-line `waves-complete` event → flag bridge). Verified by the existing auto-win /
> no-premature-win playthrough tests (the only path to `outcome:"win"` is now the
> composite) plus a flag-bridge e2e. Republish + repin pending.

`win-condition` only tests `world.state[key] >= gte`
(`packages/sdk/src/runtime/systems/win-condition.ts:22-37`). TD's real win is
"`wavesComplete` **and** zero live creeps **and** not already over," which it can't
express, so it's hand-rolled in `creep-accounting`.
**Fix sketch:** extend the condition vocabulary additively — an `entityCount` condition
type (`{ tag, eq:0 }`) and `all`/`any` composition — or ship a `win-when` system. Adding
optional condition kinds to the existing system's params is additive.

### E8 — No entity show/hide 🟡
**Affected:** tower-defense (build preview), any toggled affordance.

There's no per-entity visibility toggle, so the build-preview parks its ring/cell entities
off-screen to fake hide: `for (const e of [ring, cell]) e.x = -9999`
(`games/tower-defense/src/custom-behaviors/index.ts:274`).
**Fix sketch:** a runtime `entity.visible` honored by the renderer's draw filter. Cleanest
as a new optional schema field (🟡 — schema addition), or 🟢 via a behavior that swaps the
sprite to `kind:"none"`.

### E9 — No hover / cursor input channel 🟢 — ✅ SHIPPED in 0.5.0
**Affected:** tower-defense (desktop build preview).

> **✅ SHIPPED (0.5.0, additive SDK method).** `Input` gained **`world.input.cursor()`** —
> the last pointer position in WORLD coords, button held or NOT — backed by a `lastCursor`
> updated on every `pointermove` (the desktop hover case the held-pointer set ignored) plus
> pointerdown/up, reusing the same screen→world transform every other pointer channel uses.
> It returns `null` until the first pointer event and after `pointerleave` / focus loss /
> detach, so touch (a tap ends in `pointerleave`) and headless both report `null`. **Adopted:**
> tower-defense — the `build-preview` system reads `world.input.cursor()` directly (the
> `hoverKey` param is gone), and the host `pointermove → world.state.buildHover` listener +
> its manual `(clientX-rect.left)*sx` transform are **deleted** from `main.ts`. Verified by an
> e2e (a hover moves the preview to the snapped cell; `pointerleave` parks it) plus the cursor
> world-transform unit tests. This also unblocks the Track-B aim modes (shoot-at-pointer /
> twin-stick), which need a button-less aim channel.

`Input` exposed held pointers + click edges (`justReleased`) but **no button-less cursor
position**, so TD hand-rolled hover with its own `pointermove` listener and a manual
screen→world transform:

```
games/tower-defense/src/main.ts:205-214  // world.state.buildHover = { (clientX-rect.left)*sx, ... }
```

**Fix sketch:** add `world.input.cursor()` (last pointer position in world coords, down or
not). Additive SDK method; replaces the per-game listener + transform.

### E10 — No scene-scoped event listeners 🟢 — ✅ SHIPPED in 0.5.0
**Affected:** tower-defense, and any event-driven part.

> **✅ SHIPPED (0.5.0, additive).** The `EventBus` gained **`onScene(evt, fn)`** — identical
> to `on`, but the subscription is auto-removed on the next scene transition: `Game.loadScene`
> now calls a new **`clearSceneListeners()`** right next to its existing `flow.on` edge teardown
> (the proven scene-scoped-listener pattern, generalized). `on` is byte-identical, and the
> event queue / `clear()` are untouched. **Adopted:** tower-defense — both `tower-build` and
> `creep-accounting` register their listeners via `world.events.onScene`, attached once per
> scene ENTRY by a scene-scoped `world.state` guard flag (the same seed-once idiom they
> already used), and the per-World `attachOnce`/`ATTACHED` `WeakMap` dedup is **deleted**. A
> "Play again" re-enters `play` against a clean bus, so nothing double-counts. Verified by an
> e2e (a `play → over → play` round-trip: one `creep-killed` still bumps `resolved` by exactly
> 1, not 2) plus EventBus unit tests. idle-clicker stays poll-based (its current clean approach;
> the optional events conversion was left out to keep scope tight).

`Game.loadScene` cleared `world.state` and entities but **not** the event bus, so a system
that listens to events double-attached on "Play again." Every event-driven part reimplemented
a per-World `WeakMap` "attach once" dedup
(`games/tower-defense/src/custom-behaviors/index.ts`); idle-clicker sidestepped it by being
purely poll-based (itself a workaround).
**Fix sketch:** a scene-scoped `world.events.onScene(evt, fn)` (auto-removed on
transition), or document a built-in once-per-world helper. Additive.

---

## Roadmap

Two tracks. **Track A retires the bandaids above** (un-limits the existing games, makes
new games cheaper). **Track B adds capabilities for genres the engine can't yet express**
— these are the additive-but-new-content items already scoped in `GAME-IMPROVEMENTS.md`'s
deferred list, surfaced here so the sequencing is one picture.

### Track A — retire the bandaids (do in this order)

1. **Input action layer (E1).** 🟢 ✅ **SHIPPED in 0.4.0** — highest leverage; unblocks
   Track B controls. Deleted the synth-key blocks in snake/helicopter/breakout.
2. **Text formatting/binding (E2), part path.** 🟢 ✅ **SHIPPED in 0.4.0** — deleted the
   `mirror()` rAF loops in helicopter + survival outright; shrank idle + TD to their
   host-HTML/offline residue.
3. **`key-emit` (E3) + `pause` primitive (E4).** 🟢 ✅ **SHIPPED in 0.4.0** — deleted the
   Enter/Space bridge (all six) and the `setPaused` state machine (the five with a pause).
   `cursor()` (E9) still pending.
4. **Shared stat-modifier (E6) + composable win conditions (E7).** 🟢 ✅ **SHIPPED in
   0.4.0** — TD's shared range/cooldown upgrade (`stat-modifier`) and its real win
   (`win-lose-conditions@1.1.0` composite) are now data; `restampTowers`/`stampDef` and
   the hand-rolled win predicate are deleted.
5. **Scene-scoped listeners (E10) + cursor channel (E9).** 🟢 ✅ **SHIPPED in 0.5.0** —
   TD's event-driven systems now use `world.events.onScene` (the `attachOnce` WeakMap is
   gone) and `build-preview` reads `world.input.cursor()` (the host hover bridge is gone).
   **Entity visibility (E8)** is the last Track-A item — 🟡, wants the schema-field
   decision or the `kind:"none"` behavior workaround.

(E5 — a post-step tick hook for snake's instant-death-on-step — was dropped: it touches the
frozen tick order for a single game whose `snake-guard` workaround already produces correct
gameplay. Revisit only if a second consumer needs it.)

### Track B — unlock new genres (all 🟢 additive library parts)

These remove no existing bandaid; they enable content the games currently *can't have*.
Cross-referenced from `GAME-IMPROVEMENTS.md` deferred list:

- **`spawn-on-event` + a powerup-effect channel** → Breakout multiball/powerups
  (`powerup-capsule.png` already ships unused), drop-on-death, boss minions.
- **`shoot-at-pointer` / aim mode** → true twin-stick survival-arena and any shooter
  (depends on E1's input layer for the aim channel).
- **`damage-flash` / i-frames** → on-hit feedback + brief invulnerability
  (survival, snake, TD, breakout).
- **Level-aware `wave-spawner` density** → the *density* half of difficulty ramping
  (helicopter pillar cadence, survival swarm pressure); the *speed* half already shipped
  as `scale-by-state`.
- **`reflect-on-hit` `forceDir`/bias + total-speed cap** → Breakout side-paddle bounce
  (B7) and edge-english over-speed; 🔴 the total-speed cap changes reflect feel for every
  consumer (Pong + Breakout) → human decision.

### Items that need a human decision (frozen-contract)

Collected for one sign-off: **E8** if taken via a new schema field rather than the behavior
path; **`reflect-on-hit` total-speed cap** (changes feel for all consumers); plus the
still-open contract items already logged in `GAME-IMPROVEMENTS.md` (hitbox/collision inset,
td-10 tileset tile-scale).

---

## Cross-references

- Library-part extraction candidates (proven custom parts awaiting a second consumer):
  `LIBRARY-GAPS.md` (`trailing-body`, `thrust-lift`, `build-on-request`, the idle trio +
  `prestige`, `event-counters`, `build-preview`).
- Per-game balance/content/asset work: `GAME-IMPROVEMENTS.md`.
- Frozen-contract patch protocol: `CLAUDE.md` → "Frozen contracts".
