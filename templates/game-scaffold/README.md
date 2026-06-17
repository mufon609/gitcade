# GitCade Game Scaffold

The compliant starting point for a new **ecosystem-tier** GitCade game. Everything
here is composed from the SDK + JSON; you should rarely write engine code.

## Structure

```
game.json                 # manifest: name, slug, pinned sdkVersion/libraryVersion, tier
config.json               # ALL tunable balance numbers (speeds, costs, health, …)
index.html                # canvas host
src/main.ts               # generic bootstrap (identical for every game — don't edit)
src/scenes/*.json         # scene definitions (entities + systems); entryPoint picks the entry scene
src/custom-behaviors/     # optional game-specific behaviors (most games need none)
assets/                   # static assets (v1 art is procedural; usually empty)
tests/smoke.test.ts       # headless 60-frame boot test (the publish gate)
```

## The rules that make a game publishable

1. **No magic numbers.** Every balance value (speed, cost, spawn rate, health,
   threshold) lives in `config.json` and is referenced from a behavior/system
   param as `"$cfg.<key>"`. Numeric literals are allowed in params ONLY for
   structural keys (position `x`/`y`, `size`, `layer`, frame indices, …). This is
   what turns most rebalances into one-line `config.json` diffs.
2. **No raw storage.** Persist via `world.storage` (the SDK bridge), never
   `localStorage`/`indexedDB`. Switching branches or playing a fork must never
   corrupt saves. The dev server uses an in-memory shim automatically.
3. **Pin your versions.** `sdkVersion` (and `libraryVersion`, for ecosystem) in
   `game.json` are exact semver — never ranges.

Run `npm run validate` (alias for `gitcade validate .`) to check all of the above
plus a headless smoke boot. Exit 0 means publishable.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with an in-memory storage shim — play it standalone |
| `npm run build` | Static build to `dist/` (what the platform serves as the artifact) |
| `npm test` | Headless 60-frame smoke boot |
| `npm run validate` | Full publish-gate validation |

## Rebalancing

Want a faster ball? Change one number:

```diff
// config.json
-  "ballSpeedX": 200,
+  "ballSpeedX": 320,
```

No code touched — that one-line `config.json` diff is all it takes.
