# ENGINE-ROADMAP.md — Live Engine-Core Bandaid Log

The **engine-core** counterpart to [`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md) (library-part
extraction candidates) and [`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md) (per-game
polish). This file now carries only **concrete workarounds that exist in shipped game
source today** — the live evidence of an engine gap, where a game patches in host JS or a
custom part what the engine should provide.

> **Forward-looking engine direction lives in [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md)**,
> which is the authoritative roadmap and takes priority. The "what should the engine grow
> next" material (camera, collision/physics, rendering, audio, input, animation, juice,
> authoring, and the genre-unlock library parts) was consolidated there. This file is the
> bug-evidence log; that file is the plan.

> Only **open** bandaids are listed here. Shipped engine capabilities live in git history
> and the SDK/library package history — not re-listed once done.

---

## The pattern we're hunting

GitCade's contract is **"a game is data, not code"**: a game should be `game.json` +
`config.json` + JSON scenes composing library/SDK parts, with a *thin* host `main.ts`
doing only what has no data primitive. So the audit rule is:

> **Any real game logic in `main.ts`, and any custom behavior/system, is a candidate
> bandaid.** If the same bandaid appears in several games, it's an engine gap — log it here
> with the source location, and capture the *fix direction* in
> [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md).

---

## Contract-safety legend

| | Meaning | Release |
|---|---|---|
| 🟢 **Additive** | New library part, new *optional* SDK method, or the renderer/runtime honoring an **already-declared** schema slot. No frozen shape changes. | PATCH or MINOR; no human decision. |
| 🟡 **Schema addition** | A **new optional field** on a frozen schema object. | MINOR + a human decision. Often has a 🟢 part-based alternative. |
| 🔴 **Semantics change** | Reshapes a frozen contract or the **frozen tick order**. | STOP → human decision. |

---

## Open bandaid

### E8 — No entity show/hide 🟡
**Live in:** `games/tower-defense/src/custom-behaviors/index.ts` — the build preview parks
its ring/cell entities off-screen to fake hide (`for (const e of [ring, cell]) e.x = -9999`).
**Why it's a bandaid:** there's no per-entity visibility toggle, so a toggled affordance has
to be teleported out of view instead of hidden.
**Fix direction:** tracked in [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md) (Tier 3 genre-unlock
parts) — a runtime `entity.visible` honored by the renderer's draw filter (🟡 schema
addition), or 🟢 a behavior that swaps the sprite to `kind:"none"`.

---

## Cross-references

- Forward engine roadmap + contract-change decisions: [`INDIE-ROADMAP.md`](./INDIE-ROADMAP.md).
- Library-part extraction candidates: [`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md).
- Per-game balance/content/asset work: [`GAME-IMPROVEMENTS.md`](./GAME-IMPROVEMENTS.md).
- Frozen-contract patch protocol: [`CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
