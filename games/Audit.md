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

Ordered by implementation priority (top first): schema/runtime honesty before
features, hygiene, and tooling; the invasive channels refactor last.

- **Scene `extends` granularity** — merges whole entities by id; no per-field / `$cfg`-slice override of an inherited entity.
- **Dead schema fields** — `scene.music` and tile `ladder`/`lane`/`walkable` advertise capability the runtime never consumes.
- **Determinism coverage** — the runtime twice-run advisory still skips custom-part games (now partly covered by the static source scan).
- **No canvas DPR/resize handling** — device pixel ratio is read once at construction.
- **Untyped channels** — event bus is `string + unknown` with magic-string names; cross-part state spreads across four overlapping untyped bags.

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
