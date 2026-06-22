# GitCade Engine Audit — Working Backlog

A living backlog of engine work toward a clean, professional foundation. Items are
stated **generally** — a dedicated session digs into any single one. Completed items
are removed as they land (see git history for what shipped and why).

The engine core is sound; this backlog is the gap between "works for the seed games"
and "clean to build a hundred games on."

---

## Foundation (strengths to build on)

- Fixed-timestep loop with render-only interpolation; headless stays byte-identical.
- Determinism is proven and gated (seedable RNG, byte-stable snapshot, twice-run check).
- Collision resolution is one defensive, swept, typed model (push-out / slopes / carry / push / stacking).
- Additive fast-path discipline — collider, parenting, and timers all no-op when unused, so opting out is byte-identical.

---

## Open bugs

_None currently — new finds get filed here._

---

## Design weaknesses

_None currently — resolved items live in git. New finds get filed here._

### Freeze inventory (known no-op, defer to a future MAJOR)

- `World.pick(x, y, tag?)` — a one-line public alias of `entityAt` with no production reader (only
  its own SDK self-test). Harmless to keep; deleting it is a public-surface MAJOR, so fold it away
  (the method + its lone test, together) the next time a World-touching MAJOR ships.

---

## Missing core improvements

**Tier 1 — platform cleanliness**
- Schema versioning + migration (no `schemaVersion` stamp on any artifact).

**Tier 2 — professional polish**
- Source-position diagnostics (`file:line:col`).
- Asset/reference integrity (sprite/tileset/background `src`; `TextSprite.bind` target).
- Audio rework — master gain bus, sample/buffer playback, polyphony cap.

**Tier 3 — primitives the parts re-implement**
- Engine-level tween/easing; first-class state machine; typed event channel + name registry; prefab/spawn-template registry.
- Migrate library parts onto the `world.after` scheduler and `cooldown` helper (retire the hand-rolled timing).

**Tier 4 — future / performance**
- Renderer atlas/batching/dirty-rect; gamepad + input remap; anim per-frame markers + ping-pong.
