# AUDIT — survival-arena

**Auditor pass:** Phase-3 seed-game audit (read-only; no code changed).
**Date:** 2026-06-14
**Method:** headless instrumentation (real `createGame` + `createLibraryRegistry`,
simulated input, ~4500-frame runs, multi-scenario) **+** real-browser play
(Chrome-for-Testing 148 against `npm run dev`, screenshots) **+** static read of
every part the scene composes.

---

## Verdict

**PLAYABLE: yes.  Behaves AS INTENDED: yes (with one minor difficulty-balance caveat).**

Every mechanic the game is supposed to PROVE was observed working on the real
runtime:

| Intended behavior (MASTER-PLAN / README) | Observed | Status |
|---|---|---|
| Player moves (twin-stick) + auto-shoots | Browser: arrows move the blob; auto-fire spawns bullets at nearest enemy (145 shots / 40 s headless) | ✅ |
| Scaling waves of `ai-chase` swarms close in | Waves 1→8 over 75 s; **enemy velocity points at the player every tick (convergence ratio 1.000, 6147/6147)** — no jitter/drift/stack | ✅ |
| Shots hit + kill (shoot → health-and-death) | 38 kills in 40 s; score accrues 10/kill; `enemy-died` fires | ✅ |
| Contact-damage reduces player HP to a real death (one-tick seed delay) | Kiting run: HP 100 → −8 → `playerDeaths=1` → **lose** at 71.4 s | ✅ |
| Survive the clock → win | Isolated timer run: **win at exactly 75.0 s**, `timeLeft=0` | ✅ |
| Waves scale without unbounded blow-up | Peak **5–6 concurrent** enemies (cap `maxAlive=40` never approached); **0 NaN, 0 off-screen** entities over the whole run | ✅ |
| FX showcase (particles + screen-shake) | 14-particle `explosion` burst per kill; shake/flash wired in the shell (`enemy-died`/`player-died`) | ✅ |
| Score + high-score persistence | `score` system tallies + writes through `world.storage` (`arenaHigh`) | ✅ |
| Title / pause / game-over | Browser: title card, `P`/`Esc` pause overlay, replay all correct | ✅ |

**Spawn-distribution probe (explicitly requested):** *genuinely fine here, not
masked by movement.* 78 spawns landed across all six points
`[16, 16, 13, 13, 10, 10]`. The `wave-spawner` round-robins on
`spawnedThisWave % spawnPoints.length`; because `waveSize` is **4** (≥ several
points) and grows +2/wave, the index sweeps 0→5 within every wave. This is the
exact opposite of the helicopter bug (where `waveSize=1` pinned the index at 0).
**No Bucket-B spawner finding applies to this game.**

**Replay integrity:** play → game-over → `loadScene("main")` → play again produced
**byte-identical** results (score 780 both runs, no listener leak, no
double-count). The `explosion` system de-dupes its listener via the
`WeakMap<World>` `attachOnce`, and every other stateful part (`wave-spawner`,
`timer-countdown`, `score`, `win-lose-conditions`) keys its scratch on
`world.state`, which `loadScene` clears — so the documented "Game.loadScene does
not reset world.events" hazard does **not** bite this game.

---

## Findings

| ID | Bucket | Severity | Title | Repro | Observed vs Expected | Root cause |
|----|--------|----------|-------|-------|----------------------|------------|
| SA-1 | A | minor / polish | Difficulty leans easy early; the "dodge" mechanic it should *prove* is under-incentivized | Boot, press Play, **don't move** | A stationary, auto-firing player survives to a **WIN** (ends ~19/100 HP). Auto-aim + high per-bullet damage (34 vs `enemyHp` 100) clears the gently drip-fed swarm before most enemies land a hit; an invincible center player took **0** contact-damage events in the first 40 s. Expected (intent): a Vampire-Survivors-lite where you *must* move/dodge. | `config.json` balance: `fireCooldown 0.26` + `bulletDamage 34` + `spawnInterval 0.7`/`waveDelay 3`/`waveSizeGrowth 2`/`maxAlive 40` make early waves trivially clearable from a standstill. 100% config-tunable (the README itself frames difficulty as a governance knob). |
| SA-2 | B | polish (no action) | `contact-damage` per-target cooldown map never evicts dead victims | n/a (memory, not behavior) | `entity.state.__dmgCd[other.id]` is written on each hit and **never deleted**, so the player's map gains one entry per enemy that ever touched it (~tens per run). Bounded by spawns-per-run and reset on `loadScene`; no observable effect. | `packages/library/src/behaviors/contact-damage.ts:48` (`cds[other.id] = world.time`). |

### SA-2 blast radius (Bucket B — informational only, **not** a `[PUBLISH]` candidate)
The non-evicting `__dmgCd` map is in the shared `contact-damage` part, so it exists
in **every** game using it with `cooldown > 0` and many transient victims:
**survival-arena** (enemies→player), **tower-defense** (creeps→core),
**snake** (per the swarm), and any space-invaders-style consumer. In all of them
the growth is bounded by the number of distinct attackers in a single run and is
wiped on scene reload, so it is a cosmetic micro-leak, not a defect. Listed for
completeness per the audit's Bucket-B discipline; **no patch recommended**.

No other Bucket-B issue manifests. The five marquee shared parts
(`ai-chase`, `shoot`, `contact-damage`, `health-and-death`, `wave-spawner`) and the
`explosion` FX system all behaved correctly under real load here.

---

## Prioritized fix list

### Game-local (Bucket A)
1. **SA-1 (optional, minor):** if the design goal is "movement must matter," nudge
   `config.json` toward the README's own bullet-hell direction — e.g. lower
   `fireCooldown`/`bulletDamage` headroom or raise `spawnInterval` cadence /
   `waveSizeGrowth` so a standstill is punished. This is a pure config change and
   exactly the kind of edit the governance-vote flow is built for; ship-blocking it
   is **not** warranted (the game is playable and winnable as-is).

### Library-patch candidates (Bucket B)
- **None.** SA-2 is documented above as informational; no published-package change
  is recommended from this game.

---

## Coverage & honesty

- **Exercised headlessly:** start-delay → wave escalation to wave 8; auto-fire aim
  + bullet flight + kills; contact-damage accrual to a real player death (lose);
  the timer-win path (isolated by healing the player); NaN/off-screen/stacking
  sweep over all entities; enemy convergence vectors; replay (loadScene) integrity;
  spawn-point distribution.
- **Exercised in a real browser:** title screen, Play, keyboard movement, auto-fire
  rendering, HUD (score/wave/timer/health-bar), pause overlay (`P`), sprite loading.
  Only network error was `GET /favicon.ico → 404`, which is benign in `dev` (the
  production artifact server answers favicon with 204 per DECISIONS §4A).
- **Could NOT fully exercise:** (a) **mobile touch / drag-to-steer** —
  `pointerFollow` and the synthesized-key d-pad were read statically and confirmed
  sound (`activePointers()` only returns pointers with `down=true`, matching the
  README's "drag" wording), but I did not drive real touch events; (b) **audio** —
  `LibraryAudioPlayer` no-ops without an `AudioContext` (Node), so SFX/music were
  verified only as wired, not heard; (c) the **storage-bridge** high-score persist
  was verified as code-path (writes go through `world.storage`), not round-tripped
  through the platform parent frame (that is Phase 4B's tested surface, not this
  game's).
- **Bot caveat:** my "kiting" movement bot died at 71 s, but that reflects a naive
  cycle-the-arrows pattern blundering into enemies, **not** that the game is hard —
  the idle run (SA-1) winning is the load-bearing balance signal.
