# Survival Arena — a GitCade ecosystem game

A Vampire-Survivors-lite and the **FX showcase** of the seed set: auto-fire at
escalating swarms of chasers, dodge with twin-stick movement, and stay alive for
75 seconds. A local explosion burst on every kill, a death burst, a level-up
sparkle, a screen-shake when you take a hit, and a generative chiptune loop. The
screen flow (title → play → over) and high-score persistence are **data** (scene
`flow` + `manifest.persist`), composed **entirely** from SDK + `@gitcade/library`
parts — including the level-driven enemy toughness/speed ramp, now pure data via
two `scale-by-state` instances (no custom behavior remains).

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
| `explosion@1.0.0` ×2 + `sparkle@1.0.0` | library FX | kill burst (`enemy-died`), death burst (`player-died`), level-up sparkle |
| `level-progression@1.0.0` | library system | a `level` counter that ratchets up on score (`scoreGte`) |
| `score@1.0.0` + `persistence` + `manifest.persist` | library | score + declarative cross-run high score (no host save code) |
| `tap-emit` + scene `flow.on` | library UI + SDK | the data-driven title → play → over flow |
| `hud-bar` | library UI | the health bar (mirrors the player's HP) |
| `scale-by-state` ×2 | library behavior | reads the live `level` and ramps each enemy's hp (once, at spawn) + chase speed (every tick) |

Screen-shake (a small one when the player is hit, a bigger one + red flash on
death, a blue flash on level-up) and the chiptune loop are slim host glue in
[`src/main.ts`](src/main.ts). The per-kill burst itself is **data** — a local
`explosion` at each dead enemy — so the host owns only the screen-level FX the
frozen renderer can't do from a behavior. Making the swarm *tougher and faster* as
the level climbs (`wave-spawner` scales COUNT but bakes the prototype's stats in at
scene load) — once the custom `swarm-scale` behavior, logged in
[`../LIBRARY-GAPS.md`](../LIBRARY-GAPS.md) #8 — is now expressed purely as data with
two library `scale-by-state` instances on the enemy prototype.

## Rebalance it

All of the difficulty is in [`config.json`](config.json):

```json
{
  "playerSpeed": 230, "playerHp": 100, "surviveTime": 75,
  "fireCooldown": 0.24, "bulletDamage": 34,
  "enemyHp": 80, "enemySpeed": 95, "enemyDamage": 9,
  "spawnInterval": 0.45, "waveSize": 5, "waveSizeGrowth": 3, "waveDelay": 1.6, "maxAlive": 40,
  "levelThreshold": 80, "levelThresholdGrowth": 120, "maxLevel": 8,
  "speedPerLevel": 0.14, "hpPerLevel": 0.22
}
```

`waveSize`/`waveSizeGrowth` scale the swarm's **count** as the waves climb;
`speedPerLevel`/`hpPerLevel` scale each enemy's **speed and toughness** with the
`level` (which advances every `levelThreshold` (+growth) of score). All FX burst
sizes (`killBurstCount`, `deathBurstCount`, …) are config too.

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

Re-run `npm run validate` and the harder build is publishable.

## Fork it

Fork on GitCade, retune `config.json`, or swap `enemy-chaser` for any other
library enemy sprite. Code MIT; procedural art CC-BY-4.0 (from `@gitcade/library`).
