# AUDIT — games/helicopter

**Auditor pass:** instrumented headless harness (real `createGame` + `createLibraryRegistry` + the game's `thrust-lift`, simulated input over 240–1800 frames across 6 scenarios) **+** real-browser play (Chrome-for-Testing via the `chromium` shim against `npm run dev`, keyboard-driven, screenshots at title / play / pause / game-over). No code changed; harness lived in `/tmp` and was deleted; repo tree is clean.

---

## Verdict

**PLAYABLE but DEGRADED — does NOT behave as intended.**

The host chrome, one-button thrust/gravity, the floor/ceiling crash, score accrual, and high-score persistence all work. **The central advertised mechanic does not exist:** the README/MASTER-PLAN promise "dodge pillars at **VARIED heights** scrolling left," but **every obstacle spawns at `spawnPoints[0]` (y = 30), forming a fixed band y∈[30,180] hugging the ceiling.** A player flying at the natural start altitude (y ≈ 280) never enters that band — measured clearance ≈ 100 px, and a competent hover survived **1800 frames (30 s), score 360, never once threatened by an obstacle.** The game reduces to "don't touch the floor or ceiling." It is a working flyer, but not the pillar-threading game it claims to be.

Visual proof (browser): both blue pillars render at the top of the canvas while the ship sits in the lower third — they are scenery, not hazards.

---

## Findings

| ID | Bucket | Severity | Title | Repro | Observed vs Expected | Root cause | Blast radius (B only) |
|----|--------|----------|-------|-------|----------------------|------------|-----------------------|
| **H1** | **B** | **major** | All obstacles pinned to `spawnPoints[0]`; varied-height pillars never appear | Boot game, run 600 frames, sample every obstacle's `y` | **Observed:** distinct obstacle spawn-Y = `[30]` only; obstacle Y-range `[30..30]`, bottom `[180..180]`. **Expected:** pillars cycling the 5 authored heights `{30,420,220,90,360}` | `packages/library/src/systems/wave-spawner.ts:97` — spawn-point index is `spawnPts[s.spawnedThisWave % spawnPts.length]`; `spawnedThisWave` resets to 0 at every wave start (`wave-spawner.ts:85`). With `waveSize: 1` (config.json:9) every wave spawns exactly one obstacle, always at index `0 % 5 = 0`. The round-robin only advances **within** a wave, never **across** waves, and there is no persistent cumulative spawn counter. | See "Blast radius" below |
| **H2** | **A** | **major** | Obstacle hazard effectively un-collidable in normal play → game is un-loseable except via walls | Competent hover at y≈280 for 1800 frames | **Observed:** survived 30 s, score 360, 0 obstacle crashes; obstacles pass overhead with ~100 px clearance. **Expected:** must weave up/down through gaps; runs end on a missed pillar | Consequence of H1 **but fixable game-locally without touching the library** (see fix list): the round-robin *does* cycle within one wave, so a config-only change restores variety | — |
| **H3** | **A** | **minor / balance** | First spawn height crowds the ceiling | After an H1/H2 fix, an obstacle at the authored `y:30` (band 30–180) leaves only a 12 px gap to `wall-top` (0–18) | A pillar at that height is an almost-unthreadable wall against the ceiling | `src/scenes/main.json:53` `spawnPoints[0] = {x:820,y:30}` with obstacle `h:150` and `wall-top h:18` | — |
| **H4** | **A** | **polish** | Obstacles linger ~2.2 s off-screen after exiting | `obstacleLife` = 6 s; an obstacle travels 820→-54 px at -230 px/s ≈ 3.8 s to fully clear, then sits invisible until lifespan kills it | Wasted simulation; harmless to play | `config.json:7` `obstacleLife: 6` vs `scrollVx: -230` | — |

### H1 blast radius (other seed games using `wave-spawner` + `spawnPoints`)

- **tower-defense** — `spawnPoints` length **1** (single path entrance `{-30,108}`), `waveSize 5`. Index is always 0 anyway; **no variety intended or lost → unaffected.**
- **survival-arena** — `spawnPoints` length **6**, `waveSize 4` (+2 growth). Wave 1 uses indices 0–3, wave 2 (size 6) uses 0–5, later waves wrap. **Mildly affected:** every wave restarts the cursor at index 0, biasing spawns toward the early points and never carrying the cursor between waves — but because waves are large and grow, spatial variety is largely preserved. Worth a glance, not a blocker.
- **helicopter** — `spawnPoints` length **5**, `waveSize 1` → **pathological: only index 0 ever used.** This game is the worst-case consumer.
- snake, breakout, idle-clicker — do not use `wave-spawner`.

**General rule the bug encodes:** any `wave-spawner` consumer whose **per-wave spawn count is smaller than its `spawnPoints` count** silently loses the unreachable points, and a `waveSize` of 1 collapses to a single fixed point. This is a **[PUBLISH]** patch-release candidate (a persistent cross-wave round-robin cursor, e.g. carry the index on `SpawnerState` instead of keying on `spawnedThisWave`) — **do not fix in this audit; it is a frozen package.**

---

## Prioritized fix list

### Game-local fixes (Bucket A — fixable in `games/helicopter` alone, no library change)

1. **(H1/H2, highest value) Restore varied heights with a config-only change.** Because `wave-spawner` round-robins *within* a wave, set the pillars to drip as one continuous wave instead of one-per-wave:
   - `config.json`: `waveSize` 1 → **5** (= `spawnPoints` count), `waveDelay` → **0**, keep `spawnInterval`/`waveDelay` cadence on `interval` (e.g. `spawnInterval` ≈ 1.15). One wave of 5 then cycles all five authored heights `{30,420,220,90,360}` via the within-wave round-robin; `maxWaves: 0` keeps it endless. This sidesteps H1 entirely without editing the frozen library. (Verify in browser that pillars now appear at multiple heights and that hovering at y≈280 is no longer safe.)
2. **(H3)** Lift the tightest height off the ceiling: change `spawnPoints[0].y` from `30` to ~`50–70` so the worst-case gap to `wall-top` is threadable. (`src/scenes/main.json:53`.)
3. **(H4, polish)** Tighten `obstacleLife` from `6` toward `~4.2` so obstacles die just after leaving the screen.

### Library-patch candidates (Bucket B — FROZEN; flag only, do not fix here)

- **[PUBLISH] `@gitcade/library` `wave-spawner`** (`packages/library/src/systems/wave-spawner.ts:97`): round-robin spawn-point selection keys on the per-wave `spawnedThisWave`, so the cursor never advances across waves; small waves under-use (or, at `waveSize 1`, never reach) spawn points beyond index 0. Suggested patch: maintain a persistent cumulative-spawn cursor on `SpawnerState` for the index. Blast radius as above (helicopter pathological, survival-arena mild, tower-defense none). Route to the Phase-3 patch-release triage session — see the patch-release protocol in MASTER-PLAN §3.

---

## What worked (verified, not assumed)

- **Velocity tick order** (the known DECISIONS caveat): correct for both the player `[thrust-lift, velocity, trail]` and the obstacle `[auto-scroll, velocity, trigger-zone, health-and-death]` — the velocity integrator is ordered after the parts that set velocity; no frozen/lagged motion, no NaN.
- **Crash → game-over:** `trigger-zone` on both walls fires `crash`; idle fall hit `wall-bottom` at frame 53, holding thrust hit `wall-top` at frame 52 — both correctly ended the run. The obstacle's own `trigger-zone` also fires `crash` correctly *when reached* (confirmed by deliberately climbing into the band). `trigger-zone` reads `entity.collisions` populated the same tick by the `aabb-collision` system (ordered first) — no one-tick seed delay here.
- **Score:** `currency` passive income (12/s) accrues; `score` tracks and persists the high score via the SDK storage bridge — browser showed `Best 48` after a run.
- **"Play again" / double-listener caveat (DECISIONS):** verified clean. `Game.loadScene` does not reset `world.events`, but the shell registers its `crash`/screen-fx listeners **once** in its constructor, and the `explosion` system dedupes via an `attachOnce` WeakMap keyed by the World. After a reload, crashes incremented by exactly 1 per real crash and the explosion produced **20 particles in both run 1 and run 2** — no double-fire, no double-explosion.
- **Host chrome:** title, pause (P/Esc), game-over card with score+best, and "Play again" all functioned in the real browser. Only console noise was a harmless `favicon.ico` 404.

## Coverage / limits

- Mobile touch was verified **structurally** (the single `HOLD TO FLY` button synthesizes `Space` keydown/keyup, which `thrust-lift` reads) and via the shell's pointer handlers, **not** by emulating real touch events in the browser — the touch pad is shared GameShell glue, exercised by the other games.
- The `sync-assets` step warns that `@gitcade/library` assets are absent (no `npm install` populated them); the scene uses a solid background color and the local `public/assets/sprites/player-ship.png`, both of which rendered, so this did not affect play. Not counted as a game finding.
- Determinism: the engine uses `Math.random` for nothing in this game's path; obstacle placement is fully deterministic (which is *why* H1 is total, not intermittent).
