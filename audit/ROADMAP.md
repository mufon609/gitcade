# GitCade Audit Roadmap

**Why this exists:** the six seed games look published and "green," but playing
them reveals real defects (helicopter obstacles pin to the top, towers buildable
on the road, snake's first food spawns against a wall, no levels/progression
anywhere). The previous per-game audit corpus (since deleted) declared fixes that
the *running* games contradict — so it was code-reading-only and shallow. This
roadmap replaces it with an **observation-driven, engine-first** audit.

**Core thesis (preliminary, to be confirmed in Stage 1):** most of these defects
are not game bugs — they are *engine capability gaps* that force every game to
hand-roll core gameplay (placement validation, click-to-place, free-cell spawn,
economy transactions, level transitions) in `src/custom-behaviors/`, which is
exactly where the bugs live. **Audit the engine before the games**, or we'll
"fix" symptoms in six places instead of the cause in one.

---

## Operating principles (apply to every stage)

1. **Observe, don't assert.** Every claim of "works" / "broken" must be backed by
   actually running the thing in a browser and capturing output (console,
   `world.state`, canvas frames over time). No conclusion from reading code alone
   — that is how the last audit got it wrong.
2. **Audit the real artifact.** Rebuild from current source before judging; don't
   audit stale blobs sitting in MinIO. Confirm source ↔ deployed-artifact parity.
3. **Triage every defect** into one of: `[ENGINE]` (SDK runtime), `[LIBRARY]`
   (a `@gitcade/library` part), or `[GAME-DATA]` (this game's config/scene/custom
   code). Engine/library defects are fixed once, centrally.
4. **The freeze is relaxed — we may cut a clean `0.2.0`.** (Owner decision,
   2026-06-15: pre-launch, no third-party games exist, so schema/contract changes
   are on the table.) Still classify each engine/library fix by remediation
   class so we sequence and version correctly: `ADDITIVE` (new library part),
   `PATCH` (behavior-only SDK fix, no contract change), or `SCHEMA-CHANGE`
   (alters a contract → lands in `@gitcade/sdk 0.2.0`). Auditors should
   **recommend the cleanest design even when it needs a schema change**, and note
   the migration/repin cost; prioritization happens at the Stage 2 gate.
5. **One session per stage; one game per session in Stage 4.** Don't cross
   boundaries. Each session ends at a named artifact the next session consumes.

---

## The stages

### Stage 0 — Audit harness + ground truth *(enabling, small)*
- Build a reusable **observation harness** (`audit/harness/`): load an arbitrary
  SDK scene headless, drive scripted input (keys, pointer clicks at world coords),
  and sample canvas-pixel hashes, console errors, and `world.state` over time.
  A working puppeteer-core approach is already proven (see the first prompt).
- **Rebuild all six games** from current source → fresh artifacts; record
  source↔artifact parity so later stages audit the real code.
- **Output:** `audit/harness/` + a one-page parity note.

### Stage 1 — Engine & library capability audit *(FIRST real audit)*
- Produce the authoritative map of what the SDK runtime + library **can and
  cannot express**, every claim verified by running a minimal repro scene.
- Confirm/refute the specific suspected engine defects (wave-spawner round-robin,
  scene-transition reachability + state wipe, tilemap-not-queryable, no
  click-pick, no free-cell spawn, passive currency).
- Answer the headline question: *what capabilities do good versions of these six
  games require that the engine lacks?*
- **Output:** `audit/ENGINE-AUDIT.md` — capability matrix + confirmed-defect list
  (each with a runnable repro) + gap register (each gap classified + remediation
  class + which games it blocks). **This is the first prompt** —
  `audit/PROMPT-01-engine-audit.md`.

### Stage 2 — Remediation decision gate — ✅ SETTLED 2026-06-15
Outcome of the gate (against `audit/ENGINE-AUDIT.md` §C/§D):
- **All three `SCHEMA-CHANGE-0.2.0` items approved** — G1 scene-flow + state
  hand-off, G3 tilemap query, G6 persistence. (Freeze already lifted.)
- **G2 / G4 / G5** (no-contract / additive) approved too — all of G1–G6 ship in
  **one coherent `sdk@0.2.0` + `library@0.2.0` release**, **design-first**
  (cleanest long-term; one repin wave, not several).
- **GameShell removal = per-game in Stage 4.** 0.2.0 only *adds* flow-as-data;
  each game deletes its host `GameShell` when it adopts it during its Stage 4 fix.
- **Re-baseline republish: DONE this session** (manual upload of fresh 0.1.1
  builds for all six → MinIO; verified: helicopter served bundle now has the
  `spawnCursor` fix, buggy `spawnedThisWave%` gone, all six render clean). This
  clears the stale-blob ghosts now; the *formal* worker-driven republish is still
  Stage 5. Stage 4 re-baselines each game on a fresh artifact before triage.

### Stage 3a — `0.2.0` design spec — ✅ DONE 2026-06-15
- `audit/SDK-0.2.0-DESIGN.md` written and reviewed. All 7 open questions resolved
  at the gate (§5): per-scene flow; add `world.canAfford/spend`; **tilemap
  rendering IN scope (OQ-3)**; **offline-credit OUT (OQ-4)**; drain scene queue at
  `update()` end; split `persist` (scene in-session / manifest cross-run); add a
  `tap-emit` UI part. Spec is settled; Stage 3b builds to it.

### Stage 3b — `0.2.0` implementation — ✅ DONE 2026-06-15
- `@gitcade/sdk 0.2.0` + `@gitcade/library 0.2.0` built to spec. All `g*` probes
  PASS; `g0` regression proves 0.1.x byte-identical; SDK 51 / library 84 tests
  green; pong + the 5 library proofs validate on 0.2.0; both packages pack-clean.
  Contracts honored (storage wire untouched, tick order unchanged, all randomness
  via `world.rng`, no shipped game source/pins touched). New parts: `transaction`,
  `persistence`, `place-on-free-cell`, `tap-emit`, `wave-spawner placement`.
  Notes in `audit/SDK-0.2.0-BUILD-NOTES.md`.
- **`[PUBLISH]` gate (human):** `npm publish` `@gitcade/sdk@0.2.0` then
  `@gitcade/library@0.2.0` (npm currently has 0.1.1). Needed for worker-faithful
  builds, standalone repos, and the Stage 5 republish. **Not** needed for local
  Stage 4 iteration — the monorepo resolves the SDK via a workspace symlink to
  `packages/sdk@0.2.0` regardless of a game's pin.

### Stage 4 — Per-game deep audit + fix, ONE game per session — ✅ COMPLETE 2026-06-15
- Per game: repin to 0.2.0, play it thoroughly (harness + manual), enumerate every
  defect with a repro, triage, fix (game-data first; adopt 0.2.0 primitives where
  the root cause was an engine gap; delete that game's GameShell), republish, and
  **re-verify by playing it**, not by reading the diff.
- **Output per game:** `audit/GAME-AUDIT-<name>.md` + fixes + captured green replay.
- **Order** (simple→complex, heaviest last) + progress:
  - ✅ **Snake** — `PROMPT-04-snake.md` / `GAME-AUDIT-snake.md`. Done & live: flow
    as data (GameShell −305 lines), `place-on-free-cell` food, declarative `best`
    persistence. Food-on-wall was a stale-blob ghost (refuted on fresh build).
  - ✅ **Breakout** — `PROMPT-05-breakout.md` / `GAME-AUDIT-breakout.md`. Done &
    live: real **L1→L2→L3→win** via per-level scenes + `flow.on`, GameShell −305,
    declarative `best`. The "no progression" headline gap is closed.
  - ✅ **Helicopter** — `PROMPT-06-helicopter.md` / `GAME-AUDIT-helicopter.md`.
    Done & republished: obstacle-height variation confirmed fixed (stale ghost),
    flow-as-data, single-scene `level-progression` scroll-speed ramp, declarative
    `best`, GameShell −305. Filed `LIBRARY-GAPS #8` (scale speed by live state key).
  - ✅ **Survival Arena** — `PROMPT-07-survival-arena.md` /
    `GAME-AUDIT-survival-arena.md`. Done & republished: real difficulty scaling
    (lvl 1→8, speed/hp climb), free-cell swarm scatter, FX showcase verified (79
    particles, no perf cliff), flow-as-data, GameShell −305.
  - ✅ **Idle Clicker** — `PROMPT-08-idle-clicker.md` /
    `GAME-AUDIT-idle-clicker.md`. Done & republished: G2 click-edge earn, G5 via
    `upgrade-tree`, G6 declarative persistence, GameShell −305, offline-credit
    minimized to a ~30-line shim. Filed `LIBRARY-GAPS #6` (persistence-vs-seeding
    race + workaround).
  - ✅ **Tower Defense** — `PROMPT-09-tower-defense.md` /
    `GAME-AUDIT-tower-defense.md`. Done & republished. All three original
    complaints fixed + verified: towers-on-road impossible (data tilemap, drawn +
    `isBuildable`); economy re-tuned + G5 transaction; store/upgrade UI works (was
    the GameShell-own-loop bug); GameShell −305. Filed `LIBRARY-GAPS #4`.

All six fixed, repinned to 0.2.0, validated, and republished to local MinIO;
GameShell deleted from every game. The user's original complaints
(helicopter top-spawn, snake food-on-wall, TD towers-on-road/free/store) are all
resolved on the live local platform.

**Carried 0.2.x engine candidates** (batch a small follow-up): `LIBRARY-GAPS #2`
head-cell exclusion · `#4` re-export `snapToGrid` (trivial) · `#6`
persistence-vs-seeding race (real correctness) · `#8` scale a live state key from
data. None blocked Stage 4.
- **Carried gap (future 0.2.x):** `place-on-free-cell` can't exclude the snake
  head's imminent cell (~0.08% harmless re-eat) — logged `games/LIBRARY-GAPS.md` #2.
  Not blocking; batch with other 0.2.x tweaks.

### Stage 5 — Consistency, regression, and go-live *(next; gated on owner)*
Stage 4 fixed the games **locally** (monorepo workspace links + manual MinIO
republish). Making it production-faithful has outward-facing steps that need the
owner's call. Sub-steps, separable:

- **5a — Local full regression (no outward actions, recommended first):** full
  `gitcade validate` on all six; replay all six end-to-end through the web app on
  the local platform; confirm the three original complaints stay fixed; update
  `games/PUBLISHED.md` + `games/LIBRARY-GAPS.md`. Output: a regression report.
- **5b — 0.2.x engine cleanup (optional):** a small `sdk`/`library` follow-up for
  the carried gaps — at least `#4` (re-export `snapToGrid`, trivial) and `#6`
  (persistence-vs-seeding race, real correctness); `#2`/`#8` optional. Would bump
  to `0.2.1` and lightly repin.
- **5c — Go-live (outward-facing, owner-gated):** `npm publish`
  `@gitcade/sdk@0.2.0` + `@gitcade/library@0.2.0`; **push the six fixed games to
  their `gitcade-games/*` GitHub repos** (they still hold 0.1.x); then a
  worker-faithful rebuild (clone → npm-install pinned 0.2.0 → build → upload) to
  prove the real publish path, not just local workspace builds.
- **Output:** all six demonstrably good; production path proven if 5c is run.

**Owner decision 2026-06-15:** do **5b then 5a** (engine cleanup first, then regress
the final 0.2.1 state). **5c (go-live) deferred** — stays local for now.
- ✅ **5b** — DONE. `0.2.1` cut: `#6` persistence race fixed (hydration-claim
  primitive), `#4` `snapToGrid` re-exported, `#8` `scale-by-state` behavior, `#2`
  head-cell exclusion. Additive; 51+92 tests green; pack-clean. (commit `e813a18`)
- ▶ **5a** — `PROMPT-11-regression.md` (capstone): repin all six to 0.2.1, apply
  the now-removable workarounds (verify by playing), full validate + replay +
  republish all six, update `PUBLISHED.md`/`LIBRARY-GAPS.md`. Output
  `audit/REGRESSION.md`.

---

## Parallel workstream — Platform IA: "one game, versions inside"

*Independent of the engine/game audit; touches only `platform/web`. Can run
alongside Stage 1.* See `audit/PROMPT-platform-ia.md`.

**Problem:** the home grid renders every `Game` row, so forks
(`snake--mufon609`, `tower-defense--mufon609`) appear as their own top-level
cards next to the originals. That's not the intended IA.

**Intended IA (owner, 2026-06-15):**
- **Home grid = one card per *root* game** (`parentGameId == null`). Forks never
  appear as independent home cards.
- **Game page = the version hub.** The canonical/current version plays up top
  (hosted, one-click). A **"Versions" dropdown lists this game's forks**, newest
  first; each fork entry **links to its GitHub repo** (for reference, and to fork
  & replay/reuse). Only the current version is hosted-playable; forks are GitHub
  pointers, not hosted builds.
- Build on what exists: Phase 5 already shipped a fork-tree/lineage view and a
  branch switcher on the game page — fold those into the new Versions selector
  rather than starting over.
- Don't break fork *creation* or the governance "fork-with-patch" exit door —
  those still create `Game` rows with `parentGameId`; they just surface in the
  dropdown now instead of on the home grid.

**Design note / mild tension to flag:** this narrows the Phase 5 "play any branch
or fork in one click" thesis — forks become GitHub links rather than hosted plays.
That's the owner's call (avoids hosting a sprawl of versions); revisit if "replay
a fork on-platform" turns out to matter.

---

## Owner decision (settled 2026-06-15): freeze relaxed → target `0.2.0`

The SDK schema freeze is **lifted** for this effort. Rationale: the platform is
not publicly launched and no third party has published a game, so there is no one
to break. The engine audit and remediation may therefore add the missing
primitives properly (scene transitions, tilemap queries, pointer-pick, spawn
helpers, economy/progression) in a clean `@gitcade/sdk 0.2.0` rather than
contorting around a frozen contract. Stage 1 should still tag which fixes need a
schema change (so 0.2.0's scope is explicit) and estimate the repin/migration
cost; Stage 2 sequences and prioritizes.

---

## Preliminary engine-gap hypothesis (to confirm in Stage 1)

The reconnaissance points at six engine-rooted gaps the games need and lack:
1. **Levels / scene transitions** — `loadScene()` exists but isn't reachable from
   game data and wipes all state → no levels or progression anywhere.
2. **Spatial / buildable-zone queries** — `tilemap` is parsed but never queryable
   at runtime → nothing can stop a tower on the road; every game reinvents
   placement checks.
3. **Click / pointer-pick** — pointers have world coords but no "what did I click"
   query → click-to-place is hand-rolled per game.
4. **Spawn placement helpers** — `spawn()` takes a literal position only; no
   grid-snap / free-cell / occupied-cell logic → snake food on the wall.
5. **Economy transactions** — `currency` is a passive accumulator; only
   `upgrade-tree` has a buy flow → buying/placing towers is custom and inconsistent.
6. **Progression / difficulty scaling + state persistence** — only an ad-hoc
   `world.state` bag; no level index, no cross-scene persistence.
