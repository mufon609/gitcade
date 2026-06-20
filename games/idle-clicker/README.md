# Idle Clicker — a GitCade ecosystem game

Tap the coin, buy cursors and factories to automate income, and watch the number
climb — **even while you're away**. Offline progress is computed from your last
save and flows **only through the SDK storage bridge** (`world.storage`), never raw
browser storage. **100% of its balance lives in `config.json`.**

## Play

```bash
npm install
npm run dev
npm run build
npm run validate   # enforces the no-magic-numbers rule AND the no-raw-storage rule
```

- **Tap the coin** (or anywhere on the field) to earn.
- Buy **Stronger tap / Cursor / Factory** from the shop bar.
- **Prestige** to reset for a permanent multiplier.
- **Esc / P** to pause. Closing the tab autosaves; offline earnings await your return.

## What it's composed of

| Part | Source | Role |
|---|---|---|
| `currency@1.0.0` | library system | the coin balance |
| `upgrade-tree@1.0.0` | library system | the Stronger-tap / Cursor / Factory upgrades (cost growth, prerequisites, all `$cfg`) |
| `sprite-animate` | SDK built-in | the spinning coin |

### The custom economy + offline progress

The idle loop isn't in the action library, so three small, fully `$cfg`-driven
systems live in [`src/custom-behaviors/`](src/custom-behaviors/index.ts):
**`click-to-earn`** (coins per tap), **`auto-income`** (coins/sec from generators),
and **`interval-bonus`** (the periodic bonus + its countdown).

**Offline progress** is in [`src/main.ts`](src/main.ts): on resume it loads the
save via `world.storage`, credits `autoRate × time-away` (capped at
`offlineCapSeconds`), and autosaves on an interval and on tab-hide/close — all
through the SDK storage bridge. Standalone (`npm run dev`) this uses the in-memory
dev-shim; on the GitCade platform the same calls persist via the postMessage bridge
(no game code changes).

## Rebalance it — every number is here

[`config.json`](config.json) holds **all** of it: starting state, click power,
generator rates, the bonus timer, the offline cap, the prestige bonus, and the full
upgrade tree.

### Worked example: a faster early game

Make taps and the first cursor pay off sooner — no code:

```diff
// config.json
-  "upgradeClickAmount": 1,
+  "upgradeClickAmount": 2,
-  "upgradeCursorCost": 50,
+  "upgradeCursorCost": 30,
-  "bonusAmount": 50,
+  "bonusAmount": 120
```

Re-run `npm run validate` → still publishable.

## Fork it

Fork on GitCade, retune `config.json`, and your branch is one-click playable and
comparable. Code MIT; procedural art CC-BY-4.0 (from `@gitcade/library`).
