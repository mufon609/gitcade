# ENGINE-ROADMAP.md — Engine-Core Gaps & Next-Feature Roadmap

The **engine-core** synthesis doc — the SDK runtime/schema counterpart to
[`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md) (library parts) and
[`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md) (per-game polish). It tracks the gaps
that force a game to patch the same thing in host JS, and what the engine should grow
next.

> This doc carries only **open** work. Shipped engine capabilities live in git history and
> the SDK/library package history — they are not re-listed here once done.

---

## The pattern we're hunting

GitCade's contract is **"a game is data, not code"**: a game should be `game.json` +
`config.json` + JSON scenes composing library/SDK parts, with a *thin* host `main.ts`
doing only what has no data primitive (mount the canvas, mount the storage bridge, wire
DOM chrome, gate audio). So the audit rule is:

> **Any real game logic in `main.ts`, and any custom behavior/system, is a candidate
> bandaid.** If the same bandaid appears in several games, it's an engine gap.

---

## Contract-safety legend (per [CLAUDE.md](../CLAUDE.md) frozen-contract protocol)

| | Meaning | Release |
|---|---|---|
| 🟢 **Additive** | New library part, new *optional* SDK method, or the renderer/runtime honoring an **already-declared** schema slot. No frozen shape changes. | PATCH or MINOR; no human decision needed. |
| 🟡 **Schema addition** | A **new optional field** on a frozen schema object. The project treats schema-*shape* additions as contract changes. | MINOR + a human decision. Often has a 🟢 part-based alternative. |
| 🔴 **Semantics change** | Reshapes a frozen contract or the **frozen tick order**. | STOP → human decision. |

---

## Open engine gap

### E8 — No entity show/hide 🟡
**Affected:** tower-defense (build preview), any toggled affordance.

There's no per-entity visibility toggle, so the build-preview parks its ring/cell entities
off-screen to fake hide (`for (const e of [ring, cell]) e.x = -9999` in
`games/tower-defense/src/custom-behaviors/index.ts`).
**Fix sketch:** a runtime `entity.visible` honored by the renderer's draw filter — cleanest
as a new optional schema field (🟡 — schema addition), or 🟢 via a behavior that swaps the
sprite to `kind:"none"`.

---

## Track B — unlock new genres (all 🟢 additive library parts)

These remove no existing bandaid; they enable content the games currently *can't have*.
Cross-referenced from `GAME-IMPROVEMENTS.md`'s deferred list:

- **`spawn-on-event` + a powerup-effect channel** → Breakout multiball/powerups
  (`powerup-capsule.png` already ships unused), drop-on-death, boss minions.
- **`shoot-at-pointer` / aim mode** → true twin-stick survival-arena and any shooter
  (reads the `world.input.cursor()` aim channel).
- **`damage-flash` / i-frames** → on-hit feedback + brief invulnerability
  (survival, snake, TD, breakout).
- **`grid-layout` spawner** → expand a compact `{ prototype, rows, cols, spacing }`
  into entities at scene load, so an authored level's layout isn't N verbose entity
  blocks. Surfaced by the Breakout `extends` conversion: the level files are now thin
  (shell inherited via `extends`), but each brick is still a full entity block — a
  grid-layout part would collapse a brick wall to a few lines.
- **`reflect-on-hit` `forceDir`/bias + total-speed cap** → Breakout side-paddle bounce (B7)
  and edge-english over-speed; 🔴 the total-speed cap changes reflect feel for every consumer
  (Pong + Breakout) → human decision.

---

## Items that need a human decision (frozen-contract)

Collected for one sign-off: **E8** if taken via a new schema field rather than the behavior
path; the **`reflect-on-hit` total-speed cap** (changes feel for all consumers); plus the
still-open contract items in `GAME-IMPROVEMENTS.md` (hitbox/collision inset, td-10 tileset
tile-scale, the text-sprite `format` field).

---

## Cross-references

- Library-part extraction candidates (proven custom parts awaiting a second consumer):
  `LIBRARY-GAPS.md`.
- Per-game balance/content/asset work: `GAME-IMPROVEMENTS.md`.
- Frozen-contract patch protocol: `CLAUDE.md` → "Frozen contracts".
