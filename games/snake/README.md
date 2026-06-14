# Snake — a GitCade ecosystem game

Turn on a grid, eat the spinning coins to grow, and never run into a wall or your
own tail. Built entirely from the **GitCade SDK** + **@gitcade/library** parts,
with all balance in `config.json` — the way every GitCade game is meant to be.

## Play

```bash
npm install      # pulls @gitcade/sdk@0.1.0 + @gitcade/library@0.1.0 from npm
npm run dev      # play standalone (in-memory save shim)
npm run build    # static /dist the GitCade build worker serves
npm run validate # the publish gate: schema + no-magic-numbers + storage + smoke
```

Desktop: **Arrows / WASD** to turn, **Space/Enter** to start, **Esc/P** to pause.
Mobile: the on-screen **d-pad** (it synthesizes the same key events the parts read).

## What it's composed of

Everything below is a catalog part (referenced by `partId@version` in the scene)
or an SDK built-in — no engine code:

| Part | Source | Role |
|---|---|---|
| `move-grid-step@1.0.0` | library behavior | the head's continuous grid turning (no 180° reversals) |
| `collect-on-touch@1.0.0` | library behavior | coins award score + emit `collect` on pickup |
| `score@1.0.0` | library system | live score + high score persisted via the SDK storage bridge |
| `sprite-animate` | SDK built-in | the head's idle wobble + the coin's spin |
| `aabb-collision` | SDK built-in | pairs the head with food so pickups register |

### The one custom part

Snake's trailing body is the single mechanic no library part covers, so it lives
in [`src/custom-behaviors/`](src/custom-behaviors/index.ts) as the **`snake-body`**
system (param-driven, all balance via `$cfg`). It follows the head's path
cell-by-cell, grows on each `collect` event, ends the run on a wall/self hit, and
keeps one food on a free cell. It is logged in
[`../LIBRARY-GAPS.md`](../LIBRARY-GAPS.md) as a generalization candidate.

The title/pause/game-over screens, the mobile pad, SFX, particles and screen-shake
are the shared **GameShell** host glue in [`src/host/`](src/host/) — chrome, not
game logic. The validated game is pure data + the one custom system.

## Rebalance it (the governance demo)

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

That diff is exactly the shape a passed governance proposal commits automatically.
Re-run `npm run validate` and the build is publishable.

## Fork it

Fork the repo on GitCade, edit `config.json` (or swap the coin sprite for any other
library pickup), and your branch is one-click playable. Code is MIT; the procedural
art is CC-BY-4.0 (shipped by `@gitcade/library`).
