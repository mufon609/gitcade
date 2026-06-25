# Breakout — a GitCade ecosystem game

Bounce the ball off your paddle to clear **three levels** of bricks (a solid wall,
a hollow box, then a diamond), the ball launching faster each level. Three lives,
rising score, paddle-edge spin, a persistent high score. Built **100% from SDK
built-ins + @gitcade/library parts** — zero custom game code — with all balance in
`config.json` and the **whole screen flow + level progression expressed as data**:
the three levels `extends` one shared `play-base` scene and the manifest's `levels`
sequence drives the progression via the reserved `@next`/`@first` flow tokens.

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
| `health-and-death@1.1.0` | library behavior | each **breakable** brick's hit points + score tally on break |
| `contact-damage@1.0.0` | library behavior | the ball damaging bricks on contact |
| `trigger-zone@1.1.0` | library behavior | the bottom kill-line that loses the ball |
| `scale-by-state@1.0.0` | library behavior | ramps the ball's launch speed by `world.state.level` (the runtime sets it to the active stage) — faster each level, zero per-scene config |
| `lives-respawn@1.1.0` | library system | three lives, respawn the ball, end the game when they run out |
| `level-progression@1.0.0` | library system | emits `level-cleared` the moment the **breakable** tag is fully cleared; the `@next` flow token turns that into the next-level (or win) transition |
| `format-binding@1.0.0` | library system | derives the dynamic "LEVEL N" HUD label from `world.state.level` — one base scene, no per-level label entity |
| `tap-emit` | library UI part | the full-canvas title / win / over buttons emit the flow events (`start-pressed`, `retry`) — no host menu code |
| `persistence` | library system | round-trips the high score (`best`) through the SDK storage bridge from the manifest `persist` block |
| `score@1.0.0` | library system | running score + `best` (the running max) |
| `reflect-on-hit`, `bounce-world-edges`, `clamp-to-world`, `velocity`, `aabb-collision` | SDK built-ins | the ball physics + paddle clamping |

### Levels & screen flow are DATA (scene inheritance + a level sequence)

The three play levels **`extends`** one shared `play-base.json` scene — the paddle,
ball, kill-line, HUD, and the whole system stack are authored **once** there; each
`level-N.json` overlays only its own brick layout. The manifest declares the
ordered `levels` sequence and a `levelsComplete` target, and the scenes route with
the reserved tokens **`@next`** (advance, or start the first level from the title)
and **`@first`** (restart the campaign), so a level never hard-wires its successor:

```
title --start-pressed→@next--> level-1 --level-cleared→@next--> level-2 --→@next--> level-3 --→@next--> win
   ^                              |  \__ gameover __\            |  \_ gameover _\      |  \_ gameover _\   |
   |                              v                              v                      v                   |
   +--------- retry→@first ------ over <-------------------------+----------------------+   retry→@first ---+
```

`level-N` (`extends: "play-base"`) ⇒ `manifest.levels = ["level-1","level-2","level-3"]`,
`levelsComplete = "win"`. The runtime sets `world.state.level` to the active stage's
1-based index, so the HUD's "LEVEL N" label (`format-binding`) and the ball's
per-level launch-speed ramp (`scale-by-state`) both come from the stage for free —
no per-level config. `score` / `best` / `lives` carry across via `flow.persist`, and
`best` survives a reload via the manifest `persist` block. SFX, particles,
screen-shake, pause, and the Enter/Space → flow-event bridge are the only host glue
in [`src/main.ts`](src/main.ts). [`src/custom-behaviors/`](src/custom-behaviors/index.ts)
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
  "respawnDelay": 1.1,     // seconds before the ball respawns
  "ballSpeedPerLevel": 0.1 // +10% launch speed per level (via scale-by-state on world.state.level)
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
