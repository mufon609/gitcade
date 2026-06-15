# REGRESSION.md — Stage 5a capstone (repin → 0.2.1 + full six-game regression)

**Date:** 2026-06-15 · **Scope:** the six games + `games/PUBLISHED.md` +
`games/LIBRARY-GAPS.md`. **No `packages/*` or `platform/` edits.** No npm publish, no
GitHub push (deferred Stage 5c). No server left running.

All six games were repinned from `0.2.0` → `0.2.1` (`game.json` `sdkVersion`/
`libraryVersion` + `package.json` deps), the 0.2.1 engine cleanups were applied and
re-verified by playing, the whole set was regression-tested headless, and all six
fresh `0.2.1` `/dist` builds were republished to local MinIO `<slug>/main/`.

Method: every claim below is backed by a headless-Chrome replay through the real
`createGame` + `createLibraryRegistry` + the game's own `registerCustomBehaviors`
path (the same registry `src/main.ts` builds), driving scripted input and sampling
`world.state`/entities/console. Harness: `audit/harness/play-game.mjs` (+
`game-entry.mjs`, `build-game-bundle.mjs`, `summarize.mjs`, `republish.mjs`,
`scenarios/*`). The `/favicon.ico` 404 is answered 204 by the driver so "0 console
errors" is meaningful (the real artifact server serves a favicon).

---

## Per-game status

| Game | validate | build | smoke tests | headless replay (0 console/page err) | republished `<slug>/main/` |
|---|---|---|---|---|---|
| snake | ✓ PASS | ✓ clean | 4/4 | ✓ eat→grow (score 0→10, segs 0→4), food valid, marker live | 30 objs |
| breakout | ✓ PASS | ✓ clean | 6/6 | ✓ title→level-1, bricks 40→0, score→250, flow→over | 30 objs |
| helicopter | ✓ PASS | ✓ clean | 5/5 | ✓ obstacles vary in height, ramp climbs | 30 objs |
| survival-arena | ✓ PASS | ✓ clean | 6/6 | ✓ speed 95→188 + hp 80→203 scale by level | 30 objs |
| idle-clicker | ✓ PASS | ✓ clean | 5/5 | ✓ tap-earn, upgrades, prestige, reload restores | 30 objs |
| tower-defense | ✓ PASS | ✓ clean | 7/7 | ✓ road-refused, snap, economy, upgrade UI | 30 objs |

Package suites (sanity — unchanged, no `packages/*` edits): **`@gitcade/sdk` 51/51**,
**`@gitcade/library` 92/92** green. MinIO blobs verified via the S3 API: each served
`index.html` references the exact fresh bundle hash (`snake index-BNR2QPFX.js`,
`breakout index-DPkN8mmm.js`, `helicopter index-D7fXoln1.js`, `survival-arena
index-D73wGcnJ.js`, `idle-clicker index-DdP12OoD.js`, `tower-defense index-DK4zNBaQ.js`)
and the bundle asset object is present.

---

## The three original complaints — RE-CONFIRMED FIXED (pasted evidence)

### 1. Helicopter — obstacles vary in height (not "only at the top")
```
[obstacle-heights] scene=play eval={"scene":"play","distinctYs":[60,90,220,420]}
[lvl1-speed]      eval={"level":1,"vxs":[-230]}
[lvl8-speed]      eval={"scene":"play","level":8,"vxs":[-455]}     # ramp climbs 230→455
```
Obstacles spawn across multiple configured heights; the difficulty ramp accelerates
the scroll with the live `level`. 0 console/page errors.

### 2. Snake — food never on a wall, the body, or (new) the imminent cell
```
imm-stress: {"placements":126,"onImminent":0,"onSnake":0,"scene":"over"}   # 0 violations
eat-test:   {"scoreBefore":0,"scoreAfter":10,"ate":true,"segBefore":0,"segAfter":4,
             "grew":true,"foodsAfter":1,"markers":1}                       # eat+grow+respawn, marker live
```
Plus the snake smoke suite (4/4): food spawns exactly 1, title→play→over flow, score
handoff, retry respawns food. 0 console/page errors.

### 3. Tower Defense — towers can't be placed on the road; economy real; store/upgrade UI works
```
[tile-probe]   eval={"buildable_100_100":true,"road_100_140":false,"tile_100_100":0,"tile_100_140":1}
[after-buildable-click] gold=60 tower=1     # buildable off-center click → tower, gold 120→60 (transaction)
[after-road-click]      gold=60 tower=1     # ROAD click → NO tower, gold unchanged  ← headline fix
[after-second]          gold=0  tower=2     # second buildable → tower, gold 60→0    ← economy real
tower center after click(107,93): [{"cx":100,"cy":100,...}]   # snapToGrid → cell center
upgrade: rangeBefore 135 → rangeAfter 163, upgrades {range:1}, gold 9940→9865   # store/upgrade UI
```
0 console/page errors.

### Persistence-on-reload (spot-check, all six)
The five high-score games restore their persisted key across a `reboot()` (shared
storage = a real reload): snake/helicopter/breakout/survival-arena `best` = 4242,
tower-defense `bestWave` = 4242 — all `restored: 4242`, 0 errors. Idle-clicker (richer):
a reboot restores `coins 93, clickPower 2, autoRate 1, upgrades {click:1,cursor:1}` —
identical to the pre-reload snapshot.

---

## 0.2.1 cleanups — which LANDED (all five) vs reverted (none)

| Cleanup (LIBRARY-GAPS #) | Change | Verified | Status |
|---|---|---|---|
| **tower-defense** `snapToGrid` (#4) | deleted inlined 3-line snap, `import { snapToGrid } from "@gitcade/library"` | off-center click (107,93) → tower at cell-center (100,100); validate + replay clean | **LANDED** |
| **helicopter** `scroll-ramp` → `scale-by-state` (#8) | deleted custom `scroll-ramp`; obstacle uses `scale-by-state{target:"velocity",mode:"set",baseX:$cfg.scrollVx,perLevel:$cfg.speedRampPerLevel}` | vx -230@lvl1 → -455@lvl8, identical to baseline; validate PASS | **LANDED** |
| **survival-arena** `swarm-scale` → 2× `scale-by-state` (#8) | deleted custom `swarm-scale`; enemy uses `multiply target:"velocity"` (after ai-chase) + `once target:"state:hp" base:$cfg.enemyHp` (after health-and-death) | speed 95→188, hp 80→203 @ lvl8, identical to baseline; validate PASS | **LANDED** |
| **idle-clicker** title-scene persistence collapse (#6) | dropped title `persistence` + its `flow.persist`; `persistence` now FIRST on play; custom `click-to-earn`/`auto-income` defer their seed on `world.isPersistPending` (mirroring `currency`) | reboot restores coins/clickPower/autoRate/upgrades/prestigeMult exactly; smoke G6 rewritten + 5/5 pass | **LANDED** |
| **snake** `excludeTags` imminent-cell (#2, optional) | `snake-body` maintains an invisible `imminent` marker at the head's next cell; scene passes `excludeTags:["imminent"]` | 126 placements, 0 on imminent/snake/oob; eat+grow still works | **LANDED** |

**Reverted: none.** All five verified clean and kept. The idle-clicker collapse also
required a one-line `isPersistPending` guard on the game's own custom seed systems
(in scope — game source) so the play-scene persistence save-side safety holds; the
game's smoke test was updated to the play-scene persistence model (still in scope).

---

## Scope + server discipline
- Changed: `games/*` (six game.json + package.json + the cleanups) and the two
  tracking docs. **No `packages/*` or `platform/` edits** (verified via `git status`).
- No server left running: republish is a direct S3 upload; all headless replays used
  ephemeral loopback servers that close on process exit; `:3000`/`:3001` untouched
  (neither bound at finish); Postgres `gitcade-infra-db-1` + MinIO
  `gitcade-infra-minio-1` are the always-on Docker, untouched.

## Audit program: COMPLETE locally
Every game is fixed, on `0.2.1`, validates, builds, replays clean, and is republished
to local MinIO. Only the **deferred Stage 5c go-live** remains, at the owner's
discretion: `npm publish` `@gitcade/sdk@0.2.1` + `@gitcade/library@0.2.1` (the human
`[PUBLISH]` gate), push each game's `0.2.1` source to `gitcade-games/<slug>`, and a
worker-faithful rebuild (clone → install from public npm → build → upload).
