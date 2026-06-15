# AUDIT — games/snake

**Auditor pass:** instrumented headless harness (real `createGame` + `createLibraryRegistry` +
`registerCustomBehaviors`, simulated input, hundreds of frames, sampling
`world.entities`/`world.state`/events) **and** a real-browser play-test (Chrome-for-Testing
148 via CDP against `npm run dev`, screenshots + synthetic key events). No code changed.

---

## Verdict

**PLAYABLE — behaves AS INTENDED (degraded only at the edges).**

Every core mechanic the Phase-3 spec and the README claim was verified *working*, not just
"entities exist":

- Grid-step movement: head auto-advances on the 20px grid, turns latch, **direct 180°
  reversal is correctly refused** (harness N).
- Eat → grow → score: collecting a coin emits `collect`, adds `foodValue` to score, and the
  body grows one segment per coin — segment count scaled cleanly **3 → 22** over a long run
  (harness G), max score 190.
- Food management: exactly one food on the board; respawns on a free cell after each eat.
- Death: **wall hit ends the run** (harness C), **self-bite ends the run** with the head
  overlapping a body cell (harness D/J) — neither instant nor never.
- Game-over + replay: the card shows `Score N • Best M`; "Play again" resets cleanly and
  emits **exactly one** `gameover` on the second run — no double-count (harness E).
- High score persists across replays through the SDK storage API (round-trip verified,
  harness K) — never raw `localStorage`.
- Chrome: title ("SNAKE"), 800×600 canvas, Play/Pause(Esc)/Game-Over screens, HUD score
  mirror, and a 4-button touch pad all render and respond (screenshots 1–6).

The issues below are all **minor / polish** — none make the game unplayable or unwinnable.

---

## Findings

| ID | Bucket | Severity | Title | Repro | Observed vs Expected | Root cause | Blast radius (B only) |
|----|--------|----------|-------|-------|----------------------|------------|------------------------|
| **S1** | **B** | minor | Fast two-tap turn nets a 180° and folds the snake into its own neck | Harness L2: moving right, hold **Up** 1 frame then **Left** 1 frame (both inside one ~0.11 s step window, before the head commits a step) | `dir` becomes `{-1,0}` and the head steps **left into its own neck → death** (`gameOver=true`, `outcome=lose`). Expected: a U-turn typed faster than one step should be ignored/buffered, not a death. Direct single-key 180° *is* refused (N), so only the **two-turn** path leaks. | `@gitcade/library` → `packages/library/src/behaviors/move-grid-step.ts`. The reversal guard `want.x===-dir.x && want.y===-dir.y` is evaluated against the **live, already-mutated** `entity.state.__gridDir`, not the heading of the last *committed* step. After the first intra-step turn rewrites `dir`, the guard no longer protects against reversing relative to the body's actual orientation. | Any game using `move-grid-step` in `continuous` mode. **Among the 6 seeds, ONLY snake** uses `move-grid-step` (grep-confirmed: helicopter/breakout/tower-defense/idle-clicker/survival-arena do not). Still a FROZEN published part → **[PUBLISH] candidate** for the triage session (also protects every future grid/worm/light-cycle game). |
| **S2** | **A** | minor | Respawned food can land on the head's *imminent* cell → instant "phantom" eat | Harness H: 71 frames where `food.x===head.x && food.y===head.y`, **0** on a body segment, over ~12 k frames / 54 eats | Food respawns on the cell the head is about to enter **this same tick**; the head then moves onto it and eats it next tick → an unearned **+10** and a ~1-frame food flicker. Expected: food only on a cell the snake must navigate to ("keeps one food on a **free** cell"). | `games/snake/src/custom-behaviors/index.ts` → `spawnFood`: `occupied` is built from `s.cells` only. The head **entity** is up to one cell ahead of `s.cells[0]` because `move-grid-step` (the head's behavior) runs *after* the `snake-body` system in the frozen tick order (systems → behaviors). The head's predicted next cell `s.cells[0] + __gridDir*tile` is never excluded. Fix: add that cell to `occupied`. | — |
| **S3** | **A** | minor / polish | Death fires one step late — head leaves the play field before "Game Over" | Harness C (`head x=800` at death) & I (`head x >= canvas width` ⇒ fully off-screen); game-over screenshot shows the body parked at the wall with the head absent | On a wall hit the head visibly steps a **full cell off-screen** (e.g. x=800 on an 800-wide canvas, box `[800,820]`) and the Game-Over card only appears the *next* tick — ~0.11 s of the head being invisible. Self-collision similarly shows the head overlapping a body cell for one step (acceptable as a "bite", slightly odd at walls). Expected: death at the boundary, head still on-screen. | `snake-body` system reads the head position set by `move-grid-step` on the **previous** tick (system runs before the head behavior). The wall/self checks act on a one-step-stale position. Same ordering root as S2; would be fixed by checking the head's predicted next cell. | — |
| **S4** | **A** | polish | Food respawn gives up after 64 tries and may place on the snake when the board is near-full | Reasoned from `spawnFood` (not reachable in normal play) | After 64 failed random picks the last (possibly occupied) cell is used. The board is 40×30 = 1200 cells, so this only matters at a near-win length far beyond normal play. | `games/snake/src/custom-behaviors/index.ts` → `spawnFood` retry loop has no occupied-cell fallback scan. | — |

### Verified NON-issues (probed because DECISIONS.md flags them)

- **`loadScene` double-listener caveat — correctly avoided.** `world.events` is not cleared by
  `loadScene`, but snake-body uses **poll-based** growth (no event listener) and the GameShell
  registers `gameover`/screen-FX listeners **once at construction**, not per scene-load.
  Result: exactly one `gameover` per run after "Play again" (harness E). No double-count.
- **Velocity-integrator tick order** — N/A: `move-grid-step` writes position directly, no
  `velocity` behavior involved.
- **Score persistence / storage bridge** — `score@1.0.0` round-trips the high score through
  `world.storage` correctly (harness K). (`score@1.0.0` is also used by breakout, helicopter,
  survival-arena — no defect found there from this audit.)
- **spawnFrom / prototype cloning** — segment & food prototypes deep-clone per spawn; no shared
  mutable state observed (no duplicate-position or NaN segments across all runs).

---

## Prioritized fix list

### Game-local fixes (Bucket A — fixable in `games/snake` alone)
1. **S2 (minor):** in `spawnFood`, add the head's predicted next cell
   (`s.cells[0] + head.__gridDir * tile`) to the `occupied` set so fresh food can't land on
   the cell the head is about to enter. Removes the free-point / flicker.
2. **S3 (minor/polish):** evaluate the wall (and optionally self) check against the head's
   predicted next cell so the run ends *at* the boundary instead of one cell past it; the head
   never visibly leaves the field.
3. **S4 (polish):** if all 64 random picks are occupied, fall back to a deterministic scan for
   the first free cell (or end the run as a "win") instead of placing food on the snake.

### Library-patch candidates (Bucket B — FROZEN packages, do NOT fix here)
1. **S1 — `@gitcade/library` `move-grid-step` ([PUBLISH] candidate).** In `continuous` mode,
   buffer turn intent and evaluate the 180°-reversal guard against the **last committed step
   direction**, not the live `__gridDir`, so two quick perpendicular taps can't sum to a
   self-reversing step. Patch-only (no contract/param change), PATCH bump, repin snake.
   Current blast radius among seeds is snake alone, but the fix hardens every future
   grid/worm/snake-like game.

---

## Coverage / honesty

- **Input:** exercised via synthetic keydown/keyup into the real `Input` (harness) and real CDP
  key events in Chrome. The mobile **touch** path was verified to render (4 `.tbtn` buttons) and
  its `synthKey` → keyboard-event bridge was read in code, but I did **not** test true
  multi-touch on a physical device.
- **Not run:** the full `gitcade validate` gate and the Phase-4A production build-worker path. I
  verified the headless boot the validator defers to, the JSON composition, and live dev-server
  play; I did not re-run the publish gate end-to-end.
- **S4** (board-full food) is reasoned from the code, not exercised (unreachable at normal
  lengths).
- **Storage** tested against the `MemoryStorage` dev-shim, not the production `postMessage`
  `BridgeStorage` (the parent side is Phase 4B, outside a standalone game audit).
- **Dev tooling note (not a gameplay finding):** `npm run dev` prints
  `[sync-assets] @gitcade/library assets not found … run npm install first`. Benign here — the
  sprites (player-blob, snake-segment, coin) are committed under `public/assets` and present in
  `dist/`, so the game renders correctly; flagged only for clean-clone reproducibility.

_All harnesses were written under `/tmp` and the temporary vitest config was removed; the repo
tree is left clean (no edits to scenes, config, custom-behaviors, host, SDK, or library)._
