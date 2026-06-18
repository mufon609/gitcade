# Tower Defense — a GitCade ecosystem game

Place turrets along the creep path, spend the gold from each kill on upgrades, and
hold the line through **10 escalating waves**. **100% of its balance lives in
`config.json`** — there is not a single balance number in the scenes or behaviors,
so any rebalance is a one-line JSON diff.

## Play

```bash
npm install
npm run dev
npm run build
npm run validate   # also proves the no-magic-numbers rule: zero balance literals
```

- **Click open ground** to build a turret (60 gold). You **cannot** build on the
  road — the path is a data tilemap flagged un-buildable, so a tower on the lane is
  impossible by construction.
- Each kill pays a **bounty**; spend it on the **Range / Fire rate / Bounty** bar.
- Let **15** creeps leak and you lose; clear all **10** waves to win.

## What it's composed of

| Part | Source | Role |
|---|---|---|
| `wave-spawner@1.0.0` | library system | the 10 escalating creep waves |
| `follow-path@1.0.0` | library behavior | creeps walking the fixed waypoint path |
| `ai-aim-and-fire@1.0.0` | library behavior | turrets acquiring + firing at creeps in range |
| `contact-damage` + `health-and-death` | library behaviors | turret bullets damaging creeps; creep HP + death |
| `currency@1.0.0` | library system | the gold economy |
| `transaction@1.0.0` | library system | the buy-a-turret purchase (afford → deduct → place) |
| `upgrade-tree@1.0.0` | library system | the Range / Fire-rate / Bounty upgrades (cost growth + max levels, all `$cfg`) |
| `stat-modifier@1.0.0` | library system | a shared upgrade: writes the upgraded range/cooldown onto **every** tower each tick (E6) |
| `win-lose-conditions@1.1.0` | library system | win on all waves complete **and** the field cleared (a composed `all` condition, E7); lose on too many leaks |
| `trigger-zone@1.0.0` | library behavior | the exit that leaks (and removes) a creep |
| `explosion@1.0.0` | library FX | the burst on every kill |

### The two custom systems

Placement and the objective economy are the only mechanics outside the library, in
[`src/custom-behaviors/`](src/custom-behaviors/index.ts) — **`tower-build`** (turns
a map click into a buildable-tile-checked, grid-snapped turret, reading the SDK click
edge and routing the cost through `transaction`) and **`creep-accounting`** (bounty +
leak counters on each kill/leak, and the one-line bridge of the spawner's
`waves-complete` event to a flag). Both are fully param-driven (every number a `$cfg`)
and restart-safe, and are logged in [`../LIBRARY-GAPS.md`](../LIBRARY-GAPS.md) as
generalization candidates. As of 0.4.0 the shared upgrade-stamp (E6 → `stat-modifier`)
and the win decision (E7 → `win-lose-conditions@1.1.0`'s composed condition) are no
longer hand-rolled here — they're library data.

## Rebalance it — every number is here

[`config.json`](config.json) holds **all** of it — economy, towers, creeps, waves,
and the upgrade tree. Nothing to hunt for in code.

### Worked example: make towers cheaper

Cut the tower price so defenses come up faster:

```diff
// config.json
-  "towerCost": 60,
+  "towerCost": 40
```

Re-run `npm run validate` → still publishable. Try also:

```diff
-  "creepHp": 60,         // tankier creeps
+  "creepHp": 90,
-  "maxLeak": 15,         // less forgiving
+  "maxLeak": 8
```

## Fork it

Fork on GitCade, edit `config.json`, and your rebalanced branch is one-click
playable — and one-click comparable against the original. Code MIT; procedural art
CC-BY-4.0 (from `@gitcade/library`).
