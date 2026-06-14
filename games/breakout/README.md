# Breakout — a GitCade ecosystem game

Bounce the ball off your paddle to smash a wall of 50 bricks. Three lives, rising
score, paddle-edge spin. Built **100% from SDK built-ins + @gitcade/library
parts** — zero custom game code — with all balance in `config.json`.

## Play

```bash
npm install      # pulls @gitcade/sdk@0.1.0 + @gitcade/library@0.1.0 from npm
npm run dev
npm run build
npm run validate
```

Desktop: **Arrows / A·D** to move, **Space/Enter** to start, **Esc/P** to pause.
Mobile: the **◀ ▶** buttons (they synthesize the same key events the paddle reads).

## What it's composed of

No engine code — every entity and rule is a catalog part or SDK built-in:

| Part | Source | Role |
|---|---|---|
| `move-4dir@1.0.0` | library behavior | the paddle (left/right only; up/down keys disabled) |
| `health-and-death@1.0.0` | library behavior | each **breakable** brick's hit points + score tally on break |
| `contact-damage@1.0.0` | library behavior | the ball damaging bricks on contact |
| `trigger-zone@1.0.0` | library behavior | the bottom kill-line that loses the ball |
| `lives-respawn@1.0.0` | library system | three lives, respawn the ball, end the game when they run out |
| `level-progression@1.0.0` | library system | advances the level when the **breakable** tag is fully cleared (→ win) |
| `win-lose-conditions@1.0.0` | library system | win when `level` reaches `winLevel` |
| `score@1.0.0` | library system | score + high score persisted via the SDK storage bridge |
| `reflect-on-hit`, `bounce-world-edges`, `clamp-to-world`, `velocity`, `aabb-collision` | SDK built-ins | the ball physics + paddle clamping |

The title/pause/game-over screens, the mobile pad, SFX, particles and screen-shake
are shared **GameShell** host glue in [`src/host/`](src/host/) — chrome, not game
logic. [`src/custom-behaviors/`](src/custom-behaviors/index.ts) is intentionally
empty: Breakout proves the library composes a full arcade game with no new code.

## Rebalance it (the governance demo)

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

Re-run `npm run validate` and the slower, friendlier build is publishable — exactly
the one-line `config.json` diff a passed governance proposal commits automatically.

## Fork it

Fork on GitCade, change a number, and your branch is one-click playable. Code MIT;
procedural art CC-BY-4.0 (from `@gitcade/library`).
