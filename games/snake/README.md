# Snake — a GitCade ecosystem game

Turn on a grid, eat the spinning coins to grow, and never run into a wall or your
own tail. Built entirely from the **GitCade SDK** + **@gitcade/library** parts,
with all balance in `config.json` — the way every GitCade game is meant to be.

## Play

```bash
npm install      # pulls @gitcade/sdk + @gitcade/library from npm
npm run dev      # play standalone (in-memory save shim)
npm run build    # static /dist the GitCade build worker serves
npm run validate # the publish gate: schema + no-magic-numbers + storage + smoke
```

Desktop: **Arrows / WASD** to turn, **Space/Enter** to start, **Esc/P** to pause.
Mobile: the on-screen **d-pad** (it drives the same data `move` action the keyboard does, via `input.setActionVector`).

## What it's composed of

Everything below is a catalog part (referenced by `partId@version` in the scene)
or an SDK built-in — no engine code:

| Part | Source | Role |
|---|---|---|
| `move-grid-step@1.0.0` | library behavior | the head's continuous grid turning (no 180° reversals) |
| `collect-on-touch@1.0.0` | library behavior | coins award score + emit `collect` on pickup |
| `place-on-free-cell` | library system | drops each coin on a verified-free, in-bounds grid cell |
| `score@1.0.0` | library system | live score + the running `best` (max) |
| `persistence` | library system | round-trips `best` through the SDK storage bridge across reloads |
| `tap-emit` | library behavior | the canvas title/game-over buttons emit a flow event on tap |
| `sprite-animate` | SDK built-in | the head's idle wobble + the coin's spin |
| `aabb-collision` | SDK built-in | pairs the head with food so pickups register |

### Flow is data

The **title → play → game-over** screens are three JSON scenes
([`src/scenes/`](src/scenes/)) wired by per-scene `flow.on` edges:
`start-pressed → play`, `snake-dead → over`, `retry → play`. The buttons are
`tap-emit` entities; the run's `score` hands off to the game-over card and `best`
survives a reload — all declared as data, no host screen code.

### The custom parts

Two mechanics no library part covers live in
[`src/custom-behaviors/`](src/custom-behaviors/index.ts), param-driven with all
balance via `$cfg`:

- **`snake-body`** (system) — the trailing body that follows the head's path
  cell-by-cell, grows on each coin, and ends the run on a wall/self hit. Food
  *placement* is now delegated to the library `place-on-free-cell`; this system
  only keeps the "exactly one food" invariant.
- **`snake-guard`** (behavior) — ends the run the instant a step carries the head
  into a wall/its own body and clamps it back on-screen (exploits the frozen tick
  order; runs after `move-grid-step`).

Both are logged in [`../LIBRARY-GAPS.md`](../LIBRARY-GAPS.md) as generalization
candidates. The remaining host glue in [`src/main.ts`](src/main.ts) is only what
has no data primitive: audio, screen juice (flash/shake), the mobile d-pad (which
drives the data `move` action via `input.setActionVector`), and a pause toggle.

## Rebalance it

**All** of Snake's balance is four numbers in [`config.json`](config.json):

```json
{
  "stepInterval": 0.11,   // seconds between grid steps — lower = faster snake
  "startLength": 3,       // body segments at the start
  "growBy": 1,            // segments gained per coin
  "foodValue": 10         // score per coin
}
```

### Worked example: make the snake faster and worth more

Want a tougher, higher-scoring game? Change two numbers — no code:

```diff
// config.json
-  "stepInterval": 0.11,
+  "stepInterval": 0.07,
-  "foodValue": 10,
+  "foodValue": 25
```

Re-run `npm run validate` and the build is publishable.

## Fork it

Fork the repo on GitCade, edit `config.json` (or swap the coin sprite for any other
library pickup), and your branch is one-click playable. Code is MIT; the procedural
art is CC-BY-4.0 (shipped by `@gitcade/library`).
