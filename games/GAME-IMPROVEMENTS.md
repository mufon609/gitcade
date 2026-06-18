# GAME-IMPROVEMENTS.md — per-game, isolated work (handle separately)

This report is the **game-isolated** half of the games+engine audit — per-game balance,
content, feel, and asset work. The ecosystem-wide work (engine/library fixes + capabilities
that streamline *multiple* games) is tracked separately in
[`LIBRARY-GAPS.md`](./LIBRARY-GAPS.md) and [`ENGINE-ROADMAP.md`](./ENGINE-ROADMAP.md).
Everything below changes **one game only** — its balance, content, feel, or assets — and is
deliberately **not** done in an ecosystem pass. Each item is tagged:

- **data** — `config.json` / scene JSON only (a small config diff).
- **host** — that game's `src/` glue.
- **asset** — needs a sprite/audio/background.
- **needs-engine** — blocked on a future engine capability (cross-referenced to the deferred
  list at the bottom); cannot be done game-locally today.

---

## Snake

| # | Sev | Class | Item |
|---|-----|-------|------|
| S1 | low | host/data | **Initial-length off-by-one.** `startLength: 3` yields a **4-cell** snake — `snake-body` seeds `target = startLength` but caps total length at `target + 1`. Seed `target = startLength - 1` (or cap at `target`) in `src/custom-behaviors/index.ts`. Pick one definition so `growBy`/`startLength` semantics match. |
| S2 | **med** | data | **Flat speed — the #1 competitor gap.** `stepInterval` is a constant `0.11`; classic Snake accelerates as you grow. Wire the **existing** library `scale-by-state` (`target:"state:..."` / a length or score counter) to ramp `stepInterval` — **zero engine work**, balance in `config.json`. Highest-leverage feel change. |
| S3 | low | asset | **No readable grid.** The board is a starfield + frame; cell boundaries are invisible, which hurts precise tail-side turns. Add a faint grid background (tiled grid image, or a decor tilemap). |
| S4 | low | host/data | **Wall-wrap toggle.** Offer a config flag for wrap-around walls (google-snake/Nokia classic). Needs `snake-body`/`snake-guard` to wrap rather than die on OOB. |
| S5 | low | docs | `games/snake/README.md` pins a stale `@gitcade/*` version; bump it to the current release. |

**Verified correct (no action):** reversal guard, same-tick wall death + on-screen clamp, food-never-on-snake placement (incl. the imminent-cell marker), best-score persistence.
**Potential future engine win:** a one-slot **turn buffer** in `move-grid-step` (queue the next turn so a fast double-tap at a corner isn't dropped) — benefits any grid mover; see deferred list.

---

## Helicopter

| # | Sev | Class | Item |
|---|-----|-------|------|
| H1 | **med** | data/host | **Crash explosion never renders.** The `explosion` FX is bound to `crash`, which *also* routes `flow.on.crash → over`; `loadScene` wipes the freshly-spawned particles before a frame draws. Bind the burst on the **destination** (`over`) scene, or delay the route. (Convention added to CONVENTIONS.md §7.) |
| H3 | low | data | **Dead spacing knob.** `waveSize:1` makes `spawnInterval` inert — actual spacing is governed entirely by `waveDelay` (now ramped per level by `wave-spawner`'s `intervalPerLevel`). Document `waveDelay` as *the* live knob (a config tweak to `spawnInterval` currently does nothing). |
| H4 | low | data | **Spawn points cluster near the top** (`y: [60,420,220,90,360]` — two within 30px at the top). Spread vertically for varied threading. |
| H5 | low | asset | **No heli/rotor or pillar art.** The game named "Helicopter" reuses `player-ship.png`; obstacles are flat `#3b5dc9` rects. A heli sprite (animatable rotor via `sheet`) + a tileable pillar/cave-wall sprite would lift identity. Distinct crash SFX too. |

---

## Breakout

| # | Sev | Class | Item |
|---|-----|-------|------|
| B1 | **med** | data | **Brick variety is cosmetic.** All four colors share `hp:1`/`blockScore:50`. Real Breakout grades bricks — give the top rows `hp:2`/higher score via new config keys (`health-and-death` already supports per-entity `hp`; the per-color readability is intentional per CONVENTIONS §6). Biggest zero-engine win. |
| B3 | low | data | **L2/L3 are sparser (30/26 bricks) than L1 (40)** — fewer bricks as you progress, though the per-level ball-speed ramp (`scale-by-state` on `world.state.level`) now compensates. Densify or structure the later layouts. |
| B4 | low | data | Drop the dead `"solid"` tag on every brick (no system references it). |
| B5 | low | data | **No ball/paddle juice.** Add the library `trail` behavior to the ball (data-only); a paddle "squash on hit" needs the new `entity.scale` rendering (now available — could adopt). |
| B6 | low | needs-engine | **Same-tick last-brick-clear + ball-loss charges a life** (`lives-respawn` vs `level-progression` ordering). Rare edge; clean fix is a `lives-respawn` "suspend on clear/win" param (deferred list). |
| B7 | low | needs-engine | **Side/underside paddle contact pushes the ball DOWN** (`reflect-on-hit` fixed `axis:"y"`). A `forceDir`/`bias` param (deferred list) fixes it; Pong benefits too. |

**Powerups / multiball** (the genre's defining content) are **needs-engine**: a `spawn-on-event` part + a powerup-effect channel (deferred list). `powerup-capsule.png` already ships, unused.

---

## Tower Defense

| # | Sev | Class | Item |
|---|-----|-------|------|
| T1 | **med** | data | **One creep, one tower, one path.** The genre IS variety (fast/armored/flying creeps; slow/splash/sniper towers). All addable as **data** (more `wave-spawner` + tower-build prototypes) once a tower-picker exists. Biggest engagement lever. |
| T2 | med | host/data | **No per-tower upgrade/sell.** Upgrades are global (`restampTowers` hits all towers). Per-tower agency needs a selected-tower concept (host UI + a small custom system). |
| T3 | low | data | **`build-denied` FX fires on every mistap** including taps on the road — the FX-proportionality footgun (CONVENTIONS §1). Gate it to the funds-denial case, or use a quieter cue. |
| T4 | low | data | `towerMinCooldown` (0.2) is dead config (the upgrade chain bottoms out at 0.30s). Flag for the rebalance surface. |
| T5 | low | data | `goldPerSec:0` → a player who spends to zero pre-placement can soft-lock until a kill pays out. Intentional tension, but a candidate for a config softening. |
| T6 | low | asset/needs-engine | **Directional art** (turret with a barrel, facing creep) would unlock the now-available rotation rendering for turrets; a proper tiled road needs **td-10** (a `tilemap` tile-scale field — contract change, deferred). |

---

## Idle Clicker

| # | Sev | Class | Item |
|---|-----|-------|------|
| I1 | **med** | data | **Shallow tree — only 3 generators, all uncapped.** Cookie-Clicker's pull is a long ladder. Add 3–4 more `upgrade-tree` entries (each a `$cfg` block + a shop button); the `requires` chain already works. Biggest depth lever, pure data. |
| I2 | med | data/host | **Prestige is a flat +0.25 with no gate** — prestige at 0 coins just churns the multiplier. Add a `minCoins` gate and scale the reward by banked progress (extend the `prestige` system when it's promoted to the library). |
| I3 | low | data | No milestone/achievement beat (e.g. "crossed 1M"). Cheap data win: a threshold event + one-shot `sparkle`/`flash`. |
| I4 | low | host | `coins` is carried as a raw float; floor on save if you want clean saves (no gameplay impact — costs are integers). |
| I5 | low | host | `interval-bonus` timer resets to full on every reload (`__bonus` isn't persisted). Self-penalizing; fix only if it bothers you. |
| I6 | low | asset | Distinct generator icons for the shop buttons (currently text-only) — idle games lean on per-building iconography. |

---

## Survival Arena

| # | Sev | Class | Item |
|---|-----|-------|------|
| V1 | **high** | data | **Re-balance against the LIVE speed ramp.** Enemies accelerate 95→188 px/s by lvl 8, but the tuning was set against a flat-speed swarm. With `playerSpeed:230` the level-8 margin is only ~42 px/s — likely too tight. Playtest; lift `playerSpeed` or soften `speedPerLevel`. |
| V2 | **med** | data | **No enemy variety.** One `enemy-chaser` prototype. Add a fast-swarm tier (`enemy-swarm.png` **already in the manifest**) as a second `wave-spawner` instance — pure data. The genre's core content lever. |
| V3 | med | data | **No in-run progression.** Brotato/VS live on XP gems → level-up → pick an upgrade. Even a minimal version (enemies drop a `collect-on-touch` gem that bumps `score`, feeding the existing `level-progression`) adds the missing reward loop. `gem.png` already exists. |
| V4 | low | data | Win-state is a text swap ("YOU SURVIVED"); an endless/stretch mode past 75s is a natural extension. |
| V5 | low | asset | Confirm the synth audio keys (`shoot`/`explode`/`lose`) resolve — there's no `public/assets/audio/`; the library player is procedural, so this is a verify, not a known break. |

---

## Deferred ecosystem candidates

These would benefit several games but are **not** yet shipped — either they need a
**frozen-contract change** (a human decision per the patch protocol) or they enable **new
content** rather than retire an existing workaround. Listed so a future release can pick them
up; cross-referenced from the per-game items above.

**Contract-change — needs a human decision:**
- **Hitbox inset** (`collisionInset`/`hitbox` on the entity schema): fairer collisions for sprite colliders (helicopter corner-clip deaths, survival contact, breakout, snake, TD). New entity-schema field → not PATCH-clean.
- **Text-sprite `format`/`precision` field**: a declarative alternative to host `formatCompact`. Reshapes the frozen text-sprite contract — the host-helper path (shipped) is the patch-clean answer.
- **td-10 tileset tile-scale**: scaling 16px library tilesets to a 40px map `tileSize` needs a new `tilemap` field (a MINOR/asset-bundle item).
- **`reflect-on-hit` total-speed cap**: today the cap is per-axis, so edge-english can push total speed ~41% over `ballMaxSpeed`. Changing it alters reflect feel for every consumer (Pong + Breakout).

**Additive (PATCH-clean) — could ship in a later minor, no current game hand-rolls them:**
- **`spawn-on-event`** system (`{prototype, at:eventPos|fixed, count}`) + a **powerup-effect** channel → Breakout multiball/powerups, boss minions, drop-on-death.
- **`shoot-at-pointer`** / `shoot` `aimPointer` mode → true twin-stick aim (survival-arena, future shooters).
- **`damage-flash` / i-frames** behavior → on-hit feedback + brief invulnerability (survival-arena, snake, TD, breakout).
- **`lives-respawn` "suspend on clear/win"** param → fixes Breakout's same-tick life-on-clear edge (B6).
- **`reflect-on-hit` `forceDir`/`bias`** param → fixes Breakout's side-paddle down-bounce (B7); Pong benefits.
- **`move-grid-step` turn buffer** (one-slot queued next-turn) → snake/any grid mover corner precision.
- **Promote the proven custom parts** still logged in LIBRARY-GAPS: `trailing-body` + `post-step-death-guard` (snake), `thrust-lift` (helicopter), `build-on-request` + `event-counters` + `build-preview` (TD), the idle trio + `prestige` (idle-clicker). All additive; promote when a second consumer appears.
