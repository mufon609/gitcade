# ENGINE-ROADMAP.md — Live Engine-Core Bandaid Log

This file carries only **concrete workarounds that exist in shipped game source
today** — the live evidence of an engine gap, where a game patches in host JS or a
custom part what the engine should provide.

> Only **open** bandaids are listed here. Shipped engine capabilities live in git history
> and the SDK/library package history — not re-listed once done.

---

## The pattern we're hunting

GitCade's contract is **"a game is data, not code"**: a game should be `game.json` +
`config.json` + JSON scenes composing library/SDK parts, with a *thin* host `main.ts`
doing only what has no data primitive. So the audit rule is:

> **Any real game logic in `main.ts`, and any custom behavior/system, is a candidate
> bandaid.** If the same bandaid appears in several games, it's an engine gap — log it here
> with the source location and the *fix direction*.

---

## Contract-safety legend

| | Meaning | Release |
|---|---|---|
| 🟢 **Additive** | New library part, new *optional* SDK method, or the renderer/runtime honoring an **already-declared** schema slot. No frozen shape changes. | PATCH or MINOR; no human decision. |
| 🟡 **Schema addition** | A **new optional field** on a frozen schema object. | MINOR + a human decision. Often has a 🟢 part-based alternative. |
| 🔴 **Semantics change** | Reshapes a frozen contract or the **frozen tick order**. | STOP → human decision. |

---

## Open bandaids

None currently — no shipped game carries an engine-gap workaround (host JS or a custom part
doing what the engine should provide). When one appears, log it here with its source location
and the fix direction.

---

## Cross-references

- Frozen-contract patch protocol: [`CLAUDE.md`](../CLAUDE.md) → "Frozen contracts".
