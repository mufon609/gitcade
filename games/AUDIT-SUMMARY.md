# AUDIT-SUMMARY — Synthesis of the six seed-game audits

**Synthesizer pass:** read-only. Consolidates the six independent audits
(`AUDIT-{snake,helicopter,breakout,tower-defense,idle-clicker,survival-arena}.md`)
into one decision-ready picture. Every promoted Bucket-B defect was re-verified by
opening the named source file+line; every blast radius was re-grepped across the six
games (not taken from any single report). No code, game, SDK, or library file was
changed. Reasoned against DECISIONS.md (the documented frozen contracts) and
MASTER-PLAN §3 (the patch-release protocol: a behaviour-only fix that changes **no**
contract → PATCH bump 0.1.0→0.1.1 + repin; a fix that needs a contract change → HALT
for a human).

**Corpus completeness:** all six reports present. Synthesis proceeds.

---

## 1. Bucket B — distinct shared-engine defects (verified against source)

Six candidate Bucket-B items appear across the reports. After opening each source
file, **3 are confirmed actionable defects** (in 2 files / 2 packages), **1 is a
real-but-low-priority defect recommended for deferral**, and **1 is informational
(no patch)**. One further item that a report tagged "B" is downgraded — it is
documented design, not a defect (see §1.6).

### B-1 · `wave-spawner` round-robin cursor resets every wave  — CONFIRMED (major)
**Source:** `packages/library/src/systems/wave-spawner.ts:97` selects the spawn point
with `spawnPts[s.spawnedThisWave % spawnPts.length]`; `s.spawnedThisWave` is reset to
`0` at every wave start (`:85`). The round-robin therefore advances **only within a
wave, never across waves**, and there is no persistent cumulative cursor on
`SpawnerState`. Any consumer whose per-wave spawn count is **smaller** than its
`spawnPoints` count silently loses the unreachable points; at `waveSize: 1` it
collapses to index 0 forever. The part's own TSDoc (`:39`) promises spawn points are
"used round-robin" — so this is a genuine defect against its documented behaviour,
not a contract the game must adapt to. (Anchors `:97`/`:85` from the helicopter
report reconciled and confirmed exactly.)

**Consolidated blast radius (re-grepped, with real configs):**
- **helicopter** — `spawnPoints` len **5**, `waveSize 1` → **pathological: only index
  0 (y=30) ever used.** Worst case. (Drives H1/H2.)
- **survival-arena** — `spawnPoints` len **6**, `waveSize 4` (+2/wave) → **mild:**
  the cursor restarts at 0 each wave (slight early-point bias) but waves are large and
  grow, so all points are reached and spatial variety is preserved.
- **tower-defense** — `spawnPoints` len **1** → **inert** (`x % 1 === 0` always).
- snake, breakout, idle-clicker — do not use `wave-spawner`.

**Patch shape (PATCH-eligible, behaviour-only):** maintain a persistent cumulative
spawn cursor on `SpawnerState` (internal `world.state` scratch — not a public
contract) and index with it instead of `spawnedThisWave`. No schema/param/signature
change. → **`@gitcade/library` 0.1.0 → 0.1.1.**

### B-2 · `move-grid-step` reversal guard checks the LIVE dir, not the committed step — CONFIRMED (minor)
**Source:** `packages/library/src/behaviors/move-grid-step.ts:47`
`const reverses = want.x === -dir.x && want.y === -dir.y && …`, where `dir` is
`entity.state.__gridDir` (`:37`) — the **live** heading, which is mutated immediately
on `:50-51` the moment a non-reversing turn is accepted. So two perpendicular taps
inside one step window stack: moving right `{1,0}`, tap Up → guard passes (Up isn't a
reversal of right), `dir` becomes `{0,-1}`; tap Left → guard passes (Left isn't a
reversal of *up*), `dir` becomes `{-1,0}`; the step then drives the head **left into
its own neck → death.** The single-key 180° path is correctly refused; only the
two-tap path leaks. (Anchor `:47` reconciled and confirmed.)

**Consolidated blast radius (re-grepped):** **snake only.** No other seed game uses
`move-grid-step`.

**Patch shape (PATCH-eligible, behaviour-only):** evaluate the reversal guard against
the **last committed step direction** (a new internal `entity.state` scratch value set
when a step actually fires at `:65`), and/or buffer turn intent so two sub-step taps
can't sum to a self-reversal. Internal scratch only — no schema/param/signature
change. → **`@gitcade/library` 0.1.0 → 0.1.1** (same release as B-1).

### B-3 · `reflect-on-hit` cannot reflect off arbitrary faces (no auto axis) — CONFIRMED (major)
**Source:** `packages/sdk/src/runtime/behaviors/reflect-on-hit.ts:20` resolves `axis`
to a single **fixed** `"x"|"y"` and flips only that component (`:28-46`). Breakout's
`breakable` reflect must pick one axis (`axis:"y"` — the only sane single choice), so
a ball approaching a brick from the **side** (vx-driven) is never reflected and tunnels
straight through the row. The SDK already ships the min-translation helper
`overlapAxis()` (`packages/sdk/src/runtime/collision.ts:26`, confirmed present and
correct) but `reflect-on-hit` does not use it and offers no `"auto"` mode.

**Consolidated blast radius (re-grepped):** **breakout only** among the six games
(snake/helicopter/tower-defense/idle-clicker/survival-arena never reflect off blocks).
The `examples/pong` paddle reflect also uses it, but single-faced where a fixed axis
is correct. Structurally inherited by every future brick-breaker/pinball/wall game.

**Patch shape (PATCH-eligible, ADDITIVE — handle with care):** add an opt-in
`axis:"auto"` value that uses `overlapAxis()` to flip the correct component per
collision side. This is **purely additive** (the schema does not enum-constrain
`axis`; existing `"x"`/`"y"` behaviour is preserved byte-for-byte; pong unaffected),
so it qualifies as a patch under the same "additive is minor" reasoning DECISIONS
applies to new sprite kinds / whitelist keys. **It must NOT change how `"x"`/`"y"`
behave** — that would break pong and *would* be contract-breaking. → **`@gitcade/sdk`
0.1.0 → 0.1.1.** (Breakout must then set `axis:"auto"` on its `breakable` reflect in
the same touch — see §3b.)

### B-4 · `reflect-on-hit` `english` bypasses `maxSpeed` (total speed uncapped) — CONFIRMED (minor)
**Source:** same file. `:30`/`:39` clamp only the **reflected** axis to `maxSpeed`;
`english` then adds to the **other** axis (`:33-36`, `:42-45`) **unclamped**, and total
speed is never bounded — breakout measured 864 px/s vs a 560 cap. Note the TSDoc
narrowly documents `maxSpeed` as "cap on **that axis**", so the part technically
matches its own (narrow) doc; the universally-expected semantics is a total-speed cap.

**Consolidated blast radius:** breakout + the pong example (the two `english`+`maxSpeed`
users). Worsens B-3 (faster vx → more tunneling).

**Patch shape (PATCH-eligible, behaviour-only):** also bound the english-imparted
axis (or total speed) by `maxSpeed`, and update the TSDoc to "cap on resulting speed".
This is a behaviour bug-fix (no schema/param/signature change) and **ships in the same
`@gitcade/sdk` 0.1.1 as B-3** (one file). Re-validate the pong example, whose ball feel
this slightly changes.

### B-5 · `upgrade-tree` single-scalar request drops sub-frame double-taps — CONFIRMED (minor) → **DEFER**
**Source:** `packages/library/src/systems/upgrade-tree.ts:47-51` reads one scalar
`world.state[requestKey]`, fulfils ≤1/tick, then clears it to `""`. Two `pointerdown`s
on **different** upgrades within one animation frame: the second overwrites the first
in `world.state` **before** the system runs, so the first intent is lost with no deny
event. Confirmed real, but the window is ~16 ms at 60 fps and was not hit in normal
play by any audit. Clicks are immune (they poll a monotonic counter).

**Consolidated blast radius (re-grepped):** **idle-clicker + tower-defense** (the two
UI-driven `upgrade-tree` consumers). snake/helicopter/breakout/survival-arena don't
use it.

**Patch shape & recommendation:** the system literally cannot recover a value already
overwritten in `world.state` before it ran — the only real fix is to change the request
mechanism to an append-style queue (accept `requestKey` as `string` **or** `string[]`,
draining all valid this tick). That can be made **additive** (scalar path unchanged →
PATCH-eligible), but realising the benefit *also* requires the consuming UI to enqueue.
Given the rarity + low severity + coordinated consumer change, **DEFER it** to a future
enhancement batch rather than the urgent 0.1.1 bug-patch. Not contract-breaking.

### B-6 · `contact-damage` `__dmgCd` map never evicts dead victims — CONFIRMED, INFORMATIONAL (no patch)
**Source:** `packages/library/src/behaviors/contact-damage.ts:48`
`cds[other.id] = world.time` is written per hit and never deleted, so the attacker's
per-target cooldown map gains one entry per victim it ever touches. Bounded by
spawns-per-run and **wiped on `loadScene`** (it lives under `entity.state`) → a cosmetic
micro-leak, never an observable effect.

**Consolidated blast radius (re-grepped — corrects the survival report):**
contact-damage is used by **breakout, survival-arena, tower-defense**. The
AUDIT-survival-arena SA-2 ledger listed *snake* (which does **not** use it — snake uses
`collect-on-touch`) and omitted *breakout* (which does). Corrected here.
**No patch recommended** (matches the survival report's conclusion). If the file is
opened for B-1/B-2 anyway, evicting on victim death is a trivial freebie — optional, not
required.

### 1.6 Classification correction (a report's "B" that is NOT a defect)
- **Breakout F4** (one ball pass breaks several bricks) was tagged **"B (+A layout)"**.
  Re-verified at `contact-damage.ts:42-53`: damaging **all** overlapping `targetTag`
  victims in a loop is the part's **documented, intended** design (auras/AoE). That is a
  frozen-by-design behaviour, **not a defect** → there is no Bucket-B fix here. The only
  real finding is breakout's tightly-packed brick grid (Bucket A, ISOLATED) and it's
  arguably a feature. **Downgraded out of the Bucket-B set.**

---

## 2. Bucket A findings — tagged by relationship to the Bucket-B roots

Legend: **ISOLATED** = game-local, fix in the game · **SYMPTOM-OF-B** = downstream of a
B-root, resolved once the patch lands (do **not** hand-fix first) · **STOPGAP-FOR-B** =
a workaround the B-patch obviates/re-tunes (apply only if we must ship before the patch).

| Game | ID | Sev | Tag | Note |
|---|---|---|---|---|
| snake | S2 phantom-eat on imminent cell | minor | **ISOLATED** | Rooted in the **documented** systems→behaviors tick order — game must adapt (exclude head's predicted next cell in `spawnFood`). Correctly filed A. |
| snake | S3 death fires one step late | minor | **ISOLATED** | Same documented tick-order root; check head's predicted next cell. Correctly filed A. |
| snake | S4 food-respawn fallback may land on snake | polish | **ISOLATED** | Unreachable at normal length; deterministic free-cell fallback. |
| helicopter | H2 obstacles un-collidable / game un-loseable | major | **SYMPTOM-OF-B (B-1)** | Direct consequence of B-1 pinning all spawns to index 0. **Do not hand-fix** — resolved once B-1 lands (helicopter's heights then cycle across waves). |
| helicopter | H1 *proposed config workaround* (`waveSize 1→5`, `waveDelay→0`) | — | **STOPGAP-FOR-B (B-1)** | The audit's config-only variety hack. The real B-1 patch makes the authored `waveSize:1` cadence cycle all five heights, so this stopgap is **obviated/re-tuned** by the patch. Apply only if we must ship helicopter before 0.1.1. |
| helicopter | H3 first spawn height crowds the ceiling | minor | **ISOLATED** | `spawnPoints[0].y 30→~50-70`; pure scene tuning, independent of B-1. |
| helicopter | H4 obstacles linger off-screen | polish | **ISOLATED** | `obstacleLife` vs `scrollVx`. |
| breakout | F1 — *this is the B-3 root manifesting* | major | **(B-3 root)** | Fixed by B-3 + setting `axis:"auto"` (see §3b). |
| breakout | F2 no "next level" | major | **ISOLATED** | Rooted in the **documented** contract that `level-progression` manages a counter, not scene loading (`level-progression.ts` TSDoc + `:47-59` confirmed) — game ships one scene + needs host glue. Correctly filed A; game must adapt. |
| breakout | F5 paddle overshoots wall 1 frame | polish | **ISOLATED** | Scene behaviour order (`clamp-to-world` before `velocity`); not the velocity-setting rule. |
| breakout | F6 no serve-from-paddle | polish | **ISOLATED** | Fixed spawn point/vector. |
| tower-defense | TD2 `totalCreeps` win-threshold decoupled from wave math | minor (governance footgun) | **ISOLATED** | Currently correct (Σ = 140). See §5 — relevant to Phase 7's config-proposal DoD. |
| tower-defense | TD1 creep nudges left 1 frame at spawn | polish | **ISOLATED** | Off-screen spawn/waypoint mismatch. |
| idle-clicker | IC-1 prestige multiplier meaningless | major | **ISOLATED** | Game-local: `prestigeMult` only scales `baseClickPower` in `main.ts`, never auto-income/upgrades/bonus. Not a library bug. |
| idle-clicker | IC-2 hardcoded shop cost labels | minor | **ISOLATED** | `index.html` literals not bound to config. |
| idle-clicker | IC-3 no "can't afford" cue | minor | **ISOLATED** | Wire `upgrade-denied` to a flash/sound. |
| idle-clicker | IC-4 bonus plays the "win" SFX | polish | **ISOLATED** | Custom behaviour SFX key. |
| survival-arena | SA-1 difficulty leans easy early | minor/balance | **ISOLATED** | Pure `config.json` tuning — exactly a governance knob. |

---

## 3. Ordered fix plan

### 3a. Library/SDK patch-release batch (the confirmed Bucket-B set)
Two patch releases (each a behaviour-only, no-contract bump per MASTER-PLAN §3). Land
both, then repin in §3b.

| Release | Defects | Files | Games functionally affected → MUST repin | Other consumers to repin/re-validate |
|---|---|---|---|---|
| **`@gitcade/library` 0.1.1** | **B-1** wave-spawner cursor · **B-2** move-grid-step guard | `systems/wave-spawner.ts`, `behaviors/move-grid-step.ts` | **helicopter** (B-1, restores varied pillars — core mechanic), **snake** (B-2, kills the two-tap self-fold) | **survival-arena** repin (B-1 mild improvement); **tower-defense** repin for version hygiene (wave-spawner inert at 1 point → no behaviour change); idle-clicker only needed if B-5 were included (it is **not**) |
| **`@gitcade/sdk` 0.1.1** | **B-3** `axis:"auto"` (additive) · **B-4** english/total-speed clamp | `runtime/behaviors/reflect-on-hit.ts` | **breakout** (B-3+B-4 — fixes side-hit tunneling + speed cap; also set `axis:"auto"`) | re-validate **examples/pong** (B-4 changes its ball feel; B-3 leaves it unchanged); other games don't use reflect-on-hit → SDK repin optional/hygiene |

**Deferred (not in this batch):** B-5 `upgrade-tree` queue (low priority, needs a
coordinated UI change). **No action:** B-6 `contact-damage` map (cosmetic).

### 3b. Per-game fix pass (ISOLATED Bucket-A + the 0.1.1 repin, one touch per game)
Ship each game's repin + its genuinely-isolated A fixes + re-validate + re-playtest
together. **Skip every SYMPTOM-OF-B and STOPGAP-FOR-B item** — they vanish with the
patch.

- **snake** — repin library 0.1.1 (B-2). Fix **S2**, **S3**, **S4** (all ISOLATED).
- **helicopter** — repin library 0.1.1 (B-1; **H2 resolves automatically**, do not hand-
  fix; **skip the `waveSize 1→5` stopgap**). Fix **H3**, **H4** (ISOLATED). Re-verify in
  browser that pillars now appear at multiple heights and a y≈280 hover is no longer safe.
- **breakout** — repin SDK 0.1.1 (B-3+B-4) **and set `axis:"auto"`** on the `breakable`
  reflect (F1 resolves). Fix **F2** (decide real levels vs honest single-screen win),
  **F5**, **F6** (ISOLATED).
- **tower-defense** — repin library 0.1.1 (hygiene; no behaviour change). Fix **TD2**
  (decouple the win from `totalCreeps`, or assert the invariant in the smoke test — see
  §5) and **TD1** (ISOLATED).
- **idle-clicker** — no functional repin needed (uses neither patched part; B-5 deferred).
  Fix **IC-1** (make the prestige multiplier scale income), **IC-2/IC-3/IC-4** (ISOLATED).
- **survival-arena** — repin library 0.1.1 (B-1 mild). **SA-1** is optional config tuning.

---

## 4. Per-game verdict

| Game | Verdict | Single deciding reason |
|---|---|---|
| **snake** | **LAUNCH-READY** | Every core mechanic verified working; the only library issue (B-2) is a minor edge-case death from a fast two-tap U-turn, and the rest are polish. |
| **helicopter** | **DEGRADED-BUT-PLAYABLE** | B-1 pins every obstacle to the ceiling band → the advertised varied-pillar dodging doesn't exist and the game is un-loseable except via walls (H2). Playable flyer, wrong game. |
| **breakout** | **DEGRADED-BUT-PLAYABLE** | Ball tunnels through bricks on side/horizontal hits (B-3/F1) — a visible core-physics defect — and there is no real level progression (F2). Core loop is winnable. |
| **tower-defense** | **LAUNCH-READY** | Cleanest seed; all mechanics verified, reaches a real win; TD2 is a *latent* rebalance footgun that is currently correct. |
| **idle-clicker** | **DEGRADED-BUT-PLAYABLE** | The headline prestige reward (IC-1) only scales base click value, never auto-income — the retry-reward loop is a near-no-op. Active loop is fully correct. |
| **survival-arena** | **LAUNCH-READY** | Every mechanic verified working and winnable; the only finding (SA-1) is pure config difficulty tuning. |

**Tally:** LAUNCH-READY ×3 (snake, tower-defense, survival-arena) · DEGRADED-BUT-PLAYABLE
×3 (helicopter, breakout, idle-clicker) · BROKEN ×0.

---

## 5. Decision support — build sequencing

**Phase-7 governance flagships (its DoD runs a config-change proposal on Tower Defense):**
- **TOWER-DEFENSE — LAUNCH-READY, not broken/degraded.** The governance flagship is
  healthy: it reaches a real win, the upgrade tree + economy are correct, and it is 100%
  config-driven. **Caveat for the Phase-7 DoD:** TD2 means the win threshold
  (`totalCreeps:140`) is a hand-computed duplicate of the wave math, decoupled from
  `waveSize/waveSizeGrowth/maxWaves`. A config-change *proposal* (exactly what Phase 7
  demos) that raises spawn count without recomputing `totalCreeps` → premature win; one
  that lowers it below 140 → neither win nor lose ever fires → **softlock**. TD2 is a
  game-local Bucket-A fix, **not** a Bucket-B blocker — but **fix it as part of /before
  the Phase-7 demo** to de-risk the governance proposal that edits TD's config.
- **IDLE-CLICKER — DEGRADED (IC-1), but not a governance blocker.** IC-1 is game-local
  (prestige math in `main.ts`), not a library defect. The config-driven economy that a
  governance proposal would rebalance works correctly, so idle's degradation does **not**
  impede Phase-7 mechanics. Fix IC-1 in the per-game pass; no stop-and-patch needed.

**→ Neither governance flagship is BROKEN or seriously degraded in a way that blocks
Phase 7.** No STOP-AND-PATCH-before-Phase-7 is required.

**Overall Bucket-B assessment — SMALL + NARROW + NON-BLOCKING → SAFE TO INTERLEAVE.**
Evidence: only **3 actionable defects** in **2 files / 2 packages** (`@gitcade/library`
wave-spawner + move-grid-step; `@gitcade/sdk` reflect-on-hit), each with a tight blast
radius (move-grid-step → snake only; reflect-on-hit → breakout only; wave-spawner →
helicopter pathological / survival mild / TD inert); one further B item is deferred and
one is cosmetic. None blocks a later platform phase — the platform build (worker,
artifact server, web, fork/marketplace/governance) depends on game *manifests and
artifacts*, not on these internals. **Recommendation: do NOT stop and patch. Continue
the platform build (Phase 7), and ship the two 0.1.1 patch releases + the per-game
repin/fix pass as a batch before Phase 8** — opportunistically folding in the
game-local TD2 and IC-1 fixes since they touch the governance flagships.

---

## 6. Coverage ledger — what remains UNVERIFIED corpus-wide

Aggregated from every report's honestly-stated gaps. None of these were exercised by any
of the six audits:

- **Full `gitcade validate` gate / Phase-4A production build-worker path** — **not
  re-run end-to-end** by any audit. All six exercised the *headless boot the validator
  defers to* + the dev server; none re-ran the publish gate or a clean-clone worker build.
  (Explicit in snake, helicopter, breakout.)
- **Production `postMessage` storage bridge** — **not round-tripped** in any game audit.
  All used the `MemoryStorage` dev-shim; the parent-side `BridgeStorage` round-trip is
  Phase-4B territory (verified there, not re-proven here). High-score / offline-progress /
  prestige *persistence* is taken as wired-correctly, not re-proven. (snake, breakout,
  idle, survival.)
- **Real multi-touch** — **not driven** on any game. Touch was verified only
  structurally / via synthesized `KeyboardEvent`s or synthetic *mouse* pointer events;
  no real `touchstart`/multi-touch on a device. (All six; TD/idle use canvas pointer
  events, real touch not emulated.)
- **Audio output** — verified only as *wired*, not *heard* (`LibraryAudioPlayer` no-ops
  without an `AudioContext` under Node/jsdom). (survival; applies corpus-wide.)
- **Win shown in a real browser** — TD's win and breakout's win were proven **headless**
  only; neither win *card* was watched in-browser (the card path is shared with the
  verified pause/title cards).
- **Reasoned-not-exercised / unreachable paths** — snake **S4** board-full food fallback
  (unreachable at normal length); idle **offline-progress** math (replicated from
  `main.ts` + code-read, not driven via a live wall clock); idle **`coinCap:0`** unbounded
  growth (generic idle property, untested).
- **Difficulty curves** — only *reachability* of win/lose was confirmed (TD win,
  survival win/lose, breakout win); no game's full difficulty curve or minimum-strategy
  win was characterised (a tuning question, all in `config.json`).
- **Dev-tooling note (not a gameplay gap):** every game's `npm run dev` prints a benign
  `[sync-assets] @gitcade/library assets not found … run npm install first`; sprites are
  present in `public/assets`/`dist` so play is unaffected — flagged only for clean-clone
  reproducibility.
