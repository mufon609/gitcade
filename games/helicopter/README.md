# Helicopter — a GitCade ecosystem game

The one-button classic: **hold** to rise against gravity, **release** to fall, and
thread the scrolling pillars as long as you can. Your score is your survival time;
the high score persists. Built from **SDK + @gitcade/library parts** plus a single
custom control behavior, with all balance in `config.json`.

## Play

```bash
npm install
npm run dev
npm run build
npm run validate
```

Desktop: **hold Space** to rise. Mobile: **tap-and-hold** the big button.
**Space/Enter** start, **Esc/P** pause.

## What it's composed of

| Part | Source | Role |
|---|---|---|
| `scale-by-state@1.0.0` | library behavior | pushes the pillars leftward past the fixed craft, ramping their speed per level |
| `trigger-zone@1.0.0` | library behavior | the hazards — pillars and the top/bottom walls emit `crash` on contact |
| `wave-spawner@1.0.0` | library system | the endless stream of pillars at varied heights |
| `currency@1.0.0` | library system | accrues the survival score (`pointsPerSec`) |
| `score@1.0.0` | library system | high score persisted via the SDK storage bridge |
| `explosion@1.0.0` + `trail` | library FX | the crash burst and the craft's exhaust trail |
| `velocity` | SDK built-in | integrates the pillar motion |

The seamless scrolling starfield backdrop (the sense-of-speed cue) is the SDK
renderer's declarative **`background.layers`** (0.3.1) — `play.json`'s `background`
carries a `starfield.png` layer with a `scrollX` drift, tiled and wrapped by the
renderer. No part, no host scroll glue, and no `$cfg` key (it's presentational).

### The one custom part

A one-button flyer's lift is the single mechanic no library part covers, so it
lives in [`src/custom-behaviors/`](src/custom-behaviors/index.ts) as the
**`thrust-lift`** behavior (param-driven, all balance via `$cfg`). It's logged in
[`../LIBRARY-GAPS.md`](../LIBRARY-GAPS.md) as a generalization candidate
("one-axis thrust / flappy control").

## Rebalance it (the governance demo)

All of the feel is in [`config.json`](config.json):

```json
{
  "thrust": 1500,     // upward acceleration while held (px/sec²)
  "gravity": 950,     // downward acceleration when released (px/sec²)
  "maxUp": 360,       // climb speed cap
  "maxDown": 430,     // fall speed cap
  "scrollVx": -230,   // pillar scroll velocity (negative = leftward)
  "waveDelay": 1.15,  // seconds between pillars
  "pointsPerSec": 12  // score earned per second survived
}
```

### Worked example: a floatier, more forgiving helicopter

Make it gentler so new players last longer — no code:

```diff
// config.json
-  "gravity": 950,
+  "gravity": 720,
-  "scrollVx": -230,
+  "scrollVx": -180,
-  "waveDelay": 1.15,
+  "waveDelay": 1.6
```

Re-run `npm run validate` and the easier build is publishable — the one-line diff a
passed governance proposal commits automatically.

## Fork it

Fork on GitCade, retune `config.json`, or swap the obstacle/craft sprite for any
library entity. Code MIT; procedural art CC-BY-4.0 (from `@gitcade/library`).
