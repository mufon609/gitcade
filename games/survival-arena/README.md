# Survival Arena — a GitCade ecosystem game

A Vampire-Survivors-lite and the **FX showcase** of the seed set: auto-fire at
escalating swarms of chasers, dodge with twin-stick movement, and stay alive for
75 seconds. Explosion particles on every kill, screen-shake on impact, a generative
chiptune loop. Built **100% from SDK + @gitcade/library parts** — no custom code.

## Play

```bash
npm install
npm run dev
npm run build
npm run validate
```

Desktop: **Arrows / WASD** or **drag** toward where you want to go; you auto-fire.
Mobile: the **d-pad** (or just drag on the canvas). **Space/Enter** start, **Esc/P** pause.

## What it's composed of

| Part | Source | Role |
|---|---|---|
| `move-topdown-360@1.0.0` | library behavior | normalized twin-stick movement + drag-to-steer for touch |
| `shoot@1.0.0` | library behavior | the player's auto-fire, aimed at the nearest enemy |
| `wave-spawner@1.0.0` | library system | escalating waves of chasers from spawn points |
| `ai-chase` + `contact-damage` + `health-and-death` | library behaviors | each enemy pursues, hurts on touch, and dies (with a score bounty) |
| `timer-countdown@1.0.0` | library system | survive the clock → **win** |
| `win-lose-conditions@1.0.0` | library system | one death → **lose** |
| `explosion@1.0.0` | library FX | debris burst on every `enemy-died` |
| `score@1.0.0` | library system | score + high score via the SDK storage bridge |
| `hud-bar` | library UI | the health bar (mirrors the player's HP) |

Screen-shake (per kill + on death) and the chiptune loop are the shared
**GameShell** host glue. [`src/custom-behaviors/`](src/custom-behaviors/index.ts)
is empty — the action-game half of the library was built for exactly this.

## Rebalance it (the governance demo)

All of the difficulty is in [`config.json`](config.json):

```json
{
  "playerSpeed": 230, "playerHp": 100, "surviveTime": 75,
  "fireCooldown": 0.26, "bulletDamage": 34,
  "enemyHp": 100, "enemySpeed": 95, "enemyDamage": 9,
  "spawnInterval": 0.7, "waveSize": 4, "waveSizeGrowth": 2, "waveDelay": 3, "maxAlive": 40
}
```

### Worked example: a frantic "bullet-hell" tuning

Speed everything up and thicken the swarm — no code:

```diff
// config.json
-  "spawnInterval": 0.7,
+  "spawnInterval": 0.35,
-  "waveSizeGrowth": 2,
+  "waveSizeGrowth": 4,
-  "fireCooldown": 0.26,
+  "fireCooldown": 0.16
```

Re-run `npm run validate` and the harder build is publishable — the one-line diff a
passed governance proposal commits automatically.

## Fork it

Fork on GitCade, retune `config.json`, or swap `enemy-chaser` for any other
library enemy sprite. Code MIT; procedural art CC-BY-4.0 (from `@gitcade/library`).
