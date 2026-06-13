# Pong — GitCade Phase 1 Proof

Classic Pong against a CPU paddle, **built entirely from SDK primitives and JSON —
zero custom code**. If Pong had needed a custom behavior, that would have meant the
SDK primitives were too weak and the SDK (not this example) would be the thing to
fix. It didn't.

## How it's composed

| Piece | SDK part(s) used |
|---|---|
| Player paddle | `keyboard-axis` (W/S or ↑/↓, + touch) → `velocity` → `clamp-to-world` |
| CPU paddle | `follow-entity-axis` (tracks the ball) → `velocity` → `clamp-to-world` |
| Ball | `reflect-on-hit` (paddles) → `bounce-world-edges` (top/bottom) → `velocity` → `score-zone` |
| Collision | `aabb-collision` system over the `ball`/`paddle` tag pair |
| Win | `win-condition` system (first to `$cfg.winScore`) |
| Score readout | two `text` sprites bound to `world.state.scoreLeft` / `scoreRight` |

Every balance number lives in [`config.json`](./config.json); the scene
references them as `$cfg.*`. The only literals in the scene are structural
(positions, sizes, paddings, frame data).

## Controls

- **Player (left):** `W`/`S` or `↑`/`↓`, or touch the left half of the screen.
- **CPU (right):** plays itself.

## Run it

```bash
npm run dev       # play it (Vite dev server, in-memory storage shim)
npm run build     # static build to dist/
npm test          # headless 60-frame smoke boot
npm run validate  # full publish-gate validation (gitcade validate .)
```

## Rebalance without code

Make the CPU easier — change one number:

```diff
// config.json
-  "aiPaddleSpeed": 320,
+  "aiPaddleSpeed": 220,
```

That one-line `config.json` diff is exactly the shape a passed GitCade governance
proposal commits automatically.
