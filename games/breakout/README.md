# Breakout — a GitCade ecosystem game

Bounce the ball off your paddle to clear **three levels** of bricks (a solid wall,
a hollow box, then a diamond). Three lives, rising score, paddle-edge spin, a
persistent high score. Built **100% from SDK built-ins + @gitcade/library parts**
— zero custom game code — with all balance in `config.json` and the **whole screen
flow + level progression expressed as data** (scene `flow` edges, `tap-emit`
buttons, declarative `persist`).

## Play

```bash
npm install      # @gitcade/sdk + @gitcade/library (workspace-linked locally)
npm run dev
npm run build
npm run validate
```

Desktop: **Arrows / A·D** to move, **Space/Enter** to start, **Esc/P** to pause.
Mobile: touch and drag on the canvas — the paddle moves toward your finger.

## What it's composed of

No engine code — every entity and rule is a catalog part or SDK built-in:

| Part | Source | Role |
|---|---|---|
| `keyboard-axis` | SDK built-in | the paddle — Arrows / A·D drive it on the X axis (`touch: true` lets a finger drag it) |
| `health-and-death@1.0.0` | library behavior | each **breakable** brick's hit points + score tally on break |
| `contact-damage@1.0.0` | library behavior | the ball damaging bricks on contact |
| `trigger-zone@1.0.0` | library behavior | the bottom kill-line that loses the ball |
| `lives-respawn@1.0.0` | library system | three lives, respawn the ball, end the game when they run out |
| `level-progression@1.0.0` | library system | emits `level-cleared` the moment the **breakable** tag is fully cleared; the scene's `flow.on` edge turns that into the next-level (or win) transition |
| `tap-emit` | library UI part | the full-canvas title / win / over buttons emit the flow events (`start-pressed`, `retry`) — no host menu code |
| `persistence` | library system | round-trips the high score (`best`) through the SDK storage bridge from the manifest `persist` block |
| `score@1.0.0` | library system | running score + `best` (the running max) |
| `reflect-on-hit`, `bounce-world-edges`, `clamp-to-world`, `velocity`, `aabb-collision` | SDK built-ins | the ball physics + paddle clamping |

### Levels & screen flow are DATA

The run is six JSON scenes wired by per-scene `flow.on` edges — there is no
host screen-state machine:

```
title --start-pressed--> level-1 --level-cleared--> level-2 --level-cleared--> level-3 --level-cleared--> win
   ^                        |  \__ gameover __\           |  \__ gameover __\        |  \__ gameover __\    |
   |                        v                              v                          v                     |
   +----------- retry ----- over <------------------------+--------------------------+      retry ---------+
```

Each `level-N.json` differs only in its brick layout; `score` / `best` / `lives`
carry across the transition via `flow.persist`, and `best` survives a reload via the
manifest `persist` block. SFX, particles and screen-shake, pause, and the
Enter/Space → flow-event bridge are the only host glue in
[`src/main.ts`](src/main.ts). [`src/custom-behaviors/`](src/custom-behaviors/index.ts)
is intentionally empty: Breakout proves the library composes a full multi-level
arcade game with no new code.

## Rebalance it

All of Breakout's feel is in [`config.json`](config.json):

```json
{
  "paddleSpeed": 520,      // paddle px/sec
  "ballSpeedX": 180,       // ball horizontal launch speed
  "ballSpeedY": -300,      // ball vertical launch speed (negative = upward)
  "paddleEnglish": 160,    // how much paddle-edge hits curve the ball
  "paddleSpeedup": 1.03,   // ball speed multiplier per paddle hit
  "ballMaxSpeed": 560,     // speed cap
  "blockHp": 1,            // hits to break a brick
  "blockScore": 50,        // points per brick
  "startLives": 3,         // lives
  "respawnDelay": 1.1      // seconds before the ball respawns
}
```

### Worked example: a gentler, slower game

Make the ball calmer and give the player more lives — no code:

```diff
// config.json
-  "ballSpeedY": -300,
+  "ballSpeedY": -230,
-  "paddleSpeedup": 1.03,
+  "paddleSpeedup": 1.0,
-  "startLives": 3,
+  "startLives": 5
```

Re-run `npm run validate` and the slower, friendlier build is publishable.

## Fork it

Fork on GitCade, change a number, and your branch is one-click playable. Code MIT;
procedural art CC-BY-4.0 (from `@gitcade/library`).
