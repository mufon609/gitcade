# AUDIT — games/tower-defense

**Auditor pass:** instrumented headless harness (real `createGame` + `createLibraryRegistry` + this game's `tower-build`/`creep-accounting`, simulated input over 6 scenarios, 300–8 200 frames each, sampling `world.entities`/`world.state`/events) **+** real-browser play (Chrome-for-Testing via the `chromium` Playwright build driven by `puppeteer-core` against `npm run dev`; click-to-build, upgrade-bar clicks, pause; screenshots at title / early-play / towers-built / midgame / pause). No code changed; harness lived in `/tmp` and was deleted; repo tree is clean (only the four `AUDIT-*.md` files are untracked). The game's own `vitest` smoke test passes.

---

## Verdict

**PLAYABLE, and behaves AS INTENDED — yes.**

This is the cleanest seed game audited so far. Every mechanic the README and MASTER-PLAN promise was verified working against live simulation, not inferred from counts:

- **Creeps traverse the FULL path smoothly** — a tracked creep advanced waypoint `0→1→2→3→4→5`, position monotonic along every leg, velocity correct on each turn, **no stalling, teleporting, or skipping, no NaN** (Scenario A).
- **No stacking** — within a wave the 5 creeps drip out at the `spawnInterval` and occupy 4–5 distinct positions strung along the lane (Scenario B). (Only one spawn point exists — a single path entrance — so the wave-spawner round-robin is a non-issue here; see Coverage.)
- **Towers acquire, damage, and kill** — a single turret fired 33 shots, landed 31 (**94 % projectile hit-rate**) and killed creeps; bullets self-destruct on hit and expire by lifespan (Scenario C).
- **The economy + objective close the loop** — bounty (+8) is paid on each kill, `leaked` increments on each exit, and **15 leaks ends the run as a loss** (idle run lost at wave 4, `leaked=15`, Scenario A).
- **The game REACHES a WIN at the final wave** — a competent auto-player (10 towers + 6 upgrades) cleared all **140 creeps across 10 waves**, `resolved=140`, `leaked=0`, `outcome=win`, `winner=player`; `waves-complete` and `gameover` both fired exactly once (Scenario E).
- **Upgrade tree is fully correct** — Range/Fire-rate/Bounty all apply, cost grows by their `$cfg` growth factor, **max-level caps deny further buys (spent=0)**, and purchases **re-stamp live towers** (`aim.params.range/cooldown` track `world.state`), exactly per the custom `tower-build` restamp listener (Scenario D).
- **"Play again" does not double-count** — after a `loadScene` replay the first kill paid exactly **+8** (one bounty, no doubling) and `resolved` incremented by 1 per creep; the `attachOnce`-keyed-by-World pattern in both custom systems holds across reloads (Scenario F).

Browser play confirms the visuals: title card + how-to + upgrade bar render; the L-shaped path draws along the waypoints; creeps walk it spread out; tower sprites render above the path; kills produce explosion particle bursts; the gold HUD climbs as bounties pay; pause shows the "Paused" card. Only console noise was two harmless `404`s (favicon + the absent `@gitcade/library` asset dir; all gameplay sprites load from `public/assets`).

No blockers, no majors, no broken mechanics. Two minor/polish items below.

---

## Findings

| ID | Bucket | Severity | Title | Repro | Observed vs Expected | Root cause | Blast radius (B only) |
|----|--------|----------|-------|-------|----------------------|------------|-----------------------|
| **TD1** | **A** | **polish** | First waypoint sits *behind* the spawn point → creep nudges left 1 frame at spawn | Track a creep's first frames | **Observed:** new creep spawns at `cx≈-18` and moves **left** (`vx=-70`) for ~1 frame to reach waypoint-0, then reverses to `vx=+70`. **Expected:** immediate rightward travel | `spawnPoints[0]={x:-30,y:108}` (a top-left coord; with `w:24` the center is `cx≈-18`) vs `follow-path.points[0]={x:-30,y:120}` (a center coord). The first waypoint is ~12 px left of the spawn center, so the creep heads to it (left) before advancing. (`src/scenes/main.json:384–413`) | — |
| **TD2** | **A** | **minor (governance footgun)** | Win threshold `totalCreeps:140` is a hand-computed duplicate of the wave math, decoupled from the spawn params | Change `waveSize`/`waveSizeGrowth`/`maxWaves` without recomputing `totalCreeps` | **As shipped: correct** — Σ `round(waveSize+growth·(w-1))` for w=1..10 = 5+7+…+23 = **140**, exactly `totalCreeps`, so the `resolved≥140` win fires on the last kill (verified, Scenario E). **Risk:** a rebalance that raises spawn count but not `totalCreeps` ⇒ premature win; one that **lowers** spawn count below `totalCreeps` ⇒ `resolved` caps under the threshold and **neither win nor lose ever fires → softlock**. | `config.json:23,27` — `maxWaves`/`waveSize`/`waveSizeGrowth` determine the true total, but the win condition reads a separate constant `totalCreeps` (`src/scenes/main.json:472`). Nothing couples or asserts them. Notable because TD is the **governance flagship**: config edits are its whole point, and this is the one edit that can silently brick the win. | — |

No Bucket B (library) findings manifest in this game — see Coverage for the parts checked-and-cleared.

---

## Prioritized fix list

### Game-local fixes (Bucket A — fixable in `games/tower-defense` alone, no library change)

1. **(TD2, highest value for a governance game)** Remove the duplicated win total. Either drive the win off a key that can't desync from the spawner — e.g. win when `wave ≥ maxWaves` **and** `creep` count is 0 (the spawner already emits `waves-complete`; a `win-lose` condition on a "all waves cleared" flag would be self-consistent) — or, if `totalCreeps` must stay, add a `// must equal Σ waveSizeFor(1..maxWaves)` comment in `config.json` and a one-line assertion in the smoke test so a bad rebalance fails `npm run validate` instead of softlocking players. Lowest-churn option: keep `totalCreeps` but document + test the invariant.
2. **(TD1, polish)** Align the spawn point with waypoint-0 so creeps never step backward: set `spawnPoints[0].x` to `-42` (so `cx` lands on the `-30` waypoint center) **or** make `follow-path.points[0]` the first *on-screen* waypoint `{x:0..220, y:120}` and let the spawn x feed straight into it. Invisible today (it happens off-screen at `x<0`), pure tidiness.

### Library-patch candidates (Bucket B — FROZEN; flag only)

- **None for this game.** All composed library parts (`wave-spawner`, `follow-path`, `ai-aim-and-fire`, `contact-damage`, `health-and-death`, `currency`, `upgrade-tree`, `win-lose-conditions`, `trigger-zone`, `explosion`) behaved correctly under TD's usage. The known `wave-spawner` spawn-point round-robin defect (helicopter's H1) is **inert here** because TD uses a single spawn point — see Coverage.

---

## What worked (verified, not assumed)

- **Velocity tick order** (the DECISIONS caveat): correct everywhere. Creep behavior order is `[follow-path, velocity, health-and-death]` (the `velocity` integrator after the part that *sets* velocity) and bullet order is `[velocity, contact-damage, health-and-death]` (velocity integrates the `vx/vy` set by `ai-aim-and-fire` at spawn). Motion was smooth, deterministic, NaN-free across 8 000+ frames.
- **`contact-damage` one-tick seed delay**: handled. Bullets spawn, the next tick's `aabb-collision` pairs `[creep, tower-bullet]`, and by then the creep's `hp` is seeded by `health-and-death`; the "skip victim whose hp isn't a number yet" guard prevented any `NaN`. Net 94 % of shots dealt damage.
- **`health-and-death`**: creep `hp:60` seeded once; bullets expire on `lifespan:1.0` (live bullet count rose and fell, never leaked). Creep death emits `creep-killed`; leaking is a separate `trigger-zone kill` (no `deathEvent`), so a leak correctly pays **no** bounty.
- **`creep-accounting` / `win-lose-conditions`**: `creep-killed` → `gold += bounty + bountyBonus`, `resolved += 1`; `creep-leaked` → `leaked += 1`, `resolved += 1`. `win-lose` lost on `leaked ≥ 15` and won on `resolved ≥ 140`; `gameOver` is idempotent (one `gameover` event per run).
- **`loadScene` / double-listener caveat**: clean. `loadScene` clears `world.state` and entities but not `world.events`; both custom systems and the `explosion` FX gate their `world.events.on` through an `attachOnce` WeakMap keyed by the World, so a replay re-uses the single listener. First-kill bounty after replay was exactly +8.
- **`spawnFrom` prototype cloning**: creeps and bullets are `structuredClone`d with unique ids and independent per-entity state (`__wp`, `__age`, `__aimCd`) — no shared mutation, no stacking.
- **Custom `tower-build`**: funds checked before grid-occupancy (an occupied/again-tapped cell denies the build **without** deducting gold — verified by the exact `220-200=20` balance after 4 of 5 taps), grid-snaps to 40-px cells, stamps the upgraded range/cooldown onto each new tower, and globally re-stamps live towers on `upgrade-purchased`.
- **Host shell**: fixed-step loop, the gold/wave/leaked HUD binds, pause (`P`), and the title/pause cards all functioned in the real browser; the win/lose game-over card uses the same verified card path via `gameOverEvent:"gameover"` + `outcomeText`.

## Coverage / limits

- **`wave-spawner` round-robin (Bucket B, helicopter H1) — checked, not applicable.** TD authors a single `spawnPoints` entry (the one path entrance), so `spawnedThisWave % 1 === 0` always; there is no per-wave spawn-point variety to lose. The defect is real in the library but cannot manifest in this game. (TD is therefore "unaffected" in H1's blast radius, consistent with the helicopter audit.)
- **Win shown in-browser:** the win was proven **headless** (Scenario E: `outcome=win`, `waves-complete`+`gameover` fired). I did **not** sit through the ~137 s real-time browser run to capture the win *card*; the card path is identical to the pause/title cards that were captured working, and the `gameover→toGameOver` wiring was confirmed.
- **Mobile/touch:** TD defines no on-screen touch pad (it passes no `touch` controls to `GameShell`); building is via canvas `pointerdown` and the upgrade bar via button `pointerdown`, which I exercised with synthetic pointer (mouse) events. Real multi-touch `touchstart` emulation was not run.
- **Storage bridge:** TD persists no high score (it's a win/lose game, not a score-chaser), so the storage/score-persistence path is not exercised by this game — nothing to audit there.
- **Determinism:** TD's logic uses no RNG on the gameplay path (spawn placement, pathing, aiming all deterministic), which is why the findings above are total/structural, not intermittent. The only `Math.random` consumer is `explosion` particle scatter (cosmetic).
- **Balance:** I confirmed the win is *reachable* by a reasonable strategy (10 towers + a few upgrades). I did not exhaustively characterize the difficulty curve or the minimum-tower win — that's a tuning question, not a correctness one, and all balance lives in `config.json` for exactly that reason.
