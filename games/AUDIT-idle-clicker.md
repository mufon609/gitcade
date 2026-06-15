# AUDIT — idle-clicker

**Auditor session date:** 2026-06-14
**Scope:** `games/idle-clicker` only. No code changed. Instrumentation harness lived in `/tmp` (never committed); repo tree left clean.

---

## Verdict

**PLAYABLE: yes. AS INTENDED: DEGRADED.**

The active loop is correct and fun-complete: tapping earns the configured amount, clicks scale with the `Stronger tap` upgrade, generators (`Cursor`/`Factory`) accrue passive income at the right per-second rate, purchases deduct the (growth-scaled) cost and apply their effect exactly once, the periodic bonus fires on schedule, and offline-progress math is correct and capped. Title → play → pause → prestige(game-over) → play-again all work; the game renders and takes input in a real browser with no console errors (only a benign `favicon.ico` 404 in dev).

It is **degraded**, not broken, because of one headline-feature defect: **prestige — the game's only game-over→retry reward loop — grants a "permanent multiplier" that only ever multiplies the base click value of 1.** It never scales auto-income (the dominant late game), the click upgrades, or the bonus, so prestiging a productive run is a near-total loss for a +0.25 base-click gain. The mechanic *mechanically* works (banks, resets, persists) but does not deliver the progression incentive the README/MASTER-PLAN promise.

No Bucket B (shared-engine) **bugs** were found: `currency` and `upgrade-tree` behave correctly here. One low-severity Bucket B *design* observation is logged below.

---

## How it was exercised

1. **Instrumented headless harness** (`/tmp/idle-harness.mjs`): booted the real game (`createGame` + `createLibraryRegistry` + `registerCustomBehaviors`), drove simulated clicks/upgrade-requests, and sampled `world.state` across hundreds of fixed `1/60` frames. Eight scenarios — all passed (results inline below).
2. **Real browser** (Chrome-for-Testing via puppeteer-core against `npm run dev`): clicked Play, tapped the coin, bought upgrades, prestiged, replayed, paused. Screenshots at each step; captured console/network. Only `favicon.ico` 404 (benign — the artifact server answers it 204 in prod).
3. **Compared** observed behavior to README + MASTER-PLAN Phase 3 "what idle-clicker must prove".

### Harness results (abridged, real output)
```
S1 click+scale:  3 clicks@1 -> +3; buy click -> coins 1000->975, power 2; 5 clicks@2 -> +10; buy#2 cost 25*1.18=30 -> coins 970, power 3   ✓
S2 auto-income:  cursor -> autoRate 1, 1s -> +1.0000 coins; factory -> autoRate 9, coins -400                                              ✓
S3 prereq:       factory w/o cursor -> autoRate 0, coins unchanged, denied{reason:"requires"}                                              ✓
S4 no double:    1 request then 5 idle frames -> power unchanged, request cleared to ""                                                    ✓
S5 bonus:        period 25s, amount 50 -> +50 at the period boundary, exactly one "bonus" event                                            ✓
S6 seed-safety:  preset coins=5000 before frame -> currency does NOT reset it to 0                                                         ✓
S7 offline math: rate10/100s=1000; 1e9s capped to 10*28800=288000; rate0=0; 0s=0; negative skew=-500 (main.ts guards gain>0)              ✓
S8 unlimited:    max=0 -> 30 click buys all apply (level 30)                                                                               ✓
```

---

## Findings

| ID | Bucket | Severity | Title | Repro | Observed vs Expected | Root cause |
|----|--------|----------|-------|-------|----------------------|------------|
| IC-1 | A | **major** | Prestige multiplier is effectively meaningless | Earn coins + buy a cursor/factory (autoRate>0), then Prestige; Play again | **Observed:** prestige resets coins, autoRate, and all upgrade levels, but the only carried-over benefit is `clickPower` base raised by `prestigeBonus` (0.25) × `baseClickPower` (1). Auto-income, click-upgrade effects, and the bonus are unaffected. Banking a high-autoRate run for +0.25 base click is a net loss. **Expected:** a "permanent multiplier" that scales overall income (README: "Prestige to reset for a permanent multiplier"; MASTER-PLAN: prestige reward loop). | `src/main.ts` — `prestigeMult` is applied **only** as `cfg.baseClickPower * prestigeMult` (lines 105, 132, 145). It never multiplies `autoRate` (always `cfg.baseAutoRate`, line 105/133/146) nor the upgrade-tree `effectAmount`s nor `interval-bonus.amount`. |
| IC-2 | A | minor | Shop-bar cost labels are hardcoded, not config-driven and never update | Change `upgradeCursorCost` in `config.json` (README's own worked example sets it to 30); or buy `Stronger tap` several times | **Observed:** buttons read static `25+ / 50+ / 400+` regardless of config or of the live (growth-scaled) cost; after purchases the cost grows but the label never changes, and there is no owned-level or affordability indicator. **Expected:** for a "100% config-driven" flagship, the displayed cost should track `config.json` and the current level. (Purchases themselves use the correct `$cfg` cost — verified S1.) | `index.html` lines 40-43 — literal `<b>…</b>NN+` text in the `#idlebar` buttons; nothing binds them to `config.json` or `world.state.upgrades`. Purely cosmetic. |
| IC-3 | A | minor | "Can't afford" purchase has no UI feedback | During play, tap an upgrade you cannot afford | **Observed:** `upgrade-tree` emits `upgrade-denied`, but `main.ts` wires no sound/flash for it (`screenFx` maps only `click`/`bonus`), so the tap is silently ignored. (Browser repro: the `Cursor` buy in the run silently no-op'd at 35 coins.) **Expected:** a small cue (sound/flash) so the player knows why nothing happened. | `src/main.ts` `screenFx`/shop-button handler (lines 92-97, 124-127) — `upgrade-denied` is never observed. Polish. |
| IC-4 | A | polish | Periodic bonus plays the **win** SFX | Idle ~25s | `interval-bonus` calls `world.audio.play("win")` on every recurring bonus — a "win" cue for a routine trickle. Harmless mis-cue. | `src/custom-behaviors/index.ts` line 68. |
| IC-5 | B | minor | `upgrade-tree` buy request is a single scalar, not a queue — sub-frame double-taps on *different* upgrades drop one | In the same animation frame (<16 ms) tap two *different* shop buttons before the next `game.update` | **Observed:** `world.state[requestKey]` is a single string; the second `pointerdown` overwrites the first, so only the last upgrade is considered that tick (the first request is lost with no deny event). At 60 fps the window is ~16 ms, so it is rare in real play and was not hit by normal tapping. **Expected:** queued/per-upgrade requests so no intent is silently dropped. (Clicks are immune — `click-to-earn` polls a monotonic counter, so no taps are lost.) | `@gitcade/library` `upgrade-tree` — `src/systems/upgrade-tree.ts` lines 40-51: reads one scalar `requestKey`, fulfils ≤1/tick, sets it to `""`. Frozen part; **library-patch candidate ([PUBLISH])**, low priority. **Blast radius:** every game driving `upgrade-tree` from UI = **idle-clicker** + **tower-defense**. snake/helicopter/breakout/survival-arena do not use it. |

### Things verified CORRECT (so they are not findings)
- **Click earning + scaling** (S1, browser HUD `x2 / click`): exact configured amount, scales with click upgrades.
- **Auto-income per-second** (S2): `coins += rate·dt`, `Cursor` +1/s, `Factory` +8/s.
- **Upgrade purchase integrity** (S1/S3/S4): deducts the growth-scaled cost (`Math.round(cost·growth^owned)`), applies effect once, clears the request, enforces `requires` (factory→cursor) and `maxLevel` (0 = unlimited).
- **Interval-bonus** (S5): grants `amount` exactly at each `period`, exposes the countdown for the HUD, self-resets — one event per period (poll-based, so no double-count after "Play again").
- **Offline progress math** (S7, mirrors `main.ts` `onEnterPlay`): `floor(autoRate · min(elapsed, offlineCapSeconds))`; capped against huge elapsed; `0`/no-generator → `0`; negative clock-skew produces a negative intermediate but is gated by `if (gain > 0)` so no phantom credit; no overflow at the 8h cap.
- **Currency seeding is save-safe** (S6): `currency` seeds `startAmount` only when the key is not yet a number, so `onEnterPlay` loading a saved balance is never clobbered. Tick order (currency → click → auto → bonus → upgrade) is correct for this game.
- **No-raw-storage rule**: all persistence routes through `world.storage` (`src/host/storage.ts` selects `BridgeStorage` when embedded, `MemoryStorage` standalone). No `localStorage`/`sessionStorage`/`indexedDB` tokens in source.
- **Shell lifecycle**: title/play/pause(Esc·P)/prestige-game-over/Play-again all function; the shell's event listeners are bound once in its constructor, so `loadScene` not resetting `world.events` causes no double-counting here.

---

## Prioritized fix list

### Game-local fixes (Bucket A)
1. **IC-1 (major) — make the prestige multiplier actually multiply income.** Option that keeps everything config-driven and in `world.state`: expose `prestigeMult` to the economy systems — e.g. multiply earned coins in `click-to-earn` and `auto-income` by a `multKey` (`world.state.prestigeMult`) that `main.ts` seeds in `onEnterPlay`. This makes prestige a real income multiplier instead of a +0.25-to-base-click no-op. (Touches `main.ts` + the two custom systems, both game-local.)
2. **IC-2 (minor) — bind shop-bar labels to `config.json` + live cost/level.** Render the button cost from the resolved config (and ideally the growth-scaled next cost / owned level) instead of hardcoded `25+/50+/400+`, so the "100% config-driven" claim holds for the UI too.
3. **IC-3 (minor) — give denied purchases a cue.** Observe `upgrade-denied` in `main.ts` and flash/sound it.
4. **IC-4 (polish) — use a non-"win" SFX for the periodic bonus** (e.g. `collect` or a dedicated cue).

### Library-patch candidates (Bucket B, [PUBLISH] — do NOT fix in this game)
- **IC-5 (minor) — `upgrade-tree` single-scalar request can drop sub-frame double-taps.** Consider a queue or set-of-pending-ids in `@gitcade/library` `src/systems/upgrade-tree.ts`. Frozen part → triage as a patch-release. Blast radius: idle-clicker + tower-defense. Low priority (rare at 60 fps).

---

## Coverage / caveats (honest gaps)
- **Cross-reload persistence + slug+branch namespacing was verified only on the standalone path.** Standalone uses `MemoryStorage` (resets per reload — intended per DECISIONS), so I confirmed offline-credit and prestige *math/code path* there and confirmed `makeStorage` selects `BridgeStorage` when embedded. I did **not** re-boot the full Phase-4B platform iframe to watch a save survive a real reload through the postMessage bridge; that path (and `gameSlug+branch` namespacing) is the one Phase 4B already verified end-to-end with this exact game. So IC-1's *persistence* is taken as wired-correctly, not re-proven here.
- **Offline progress** was exercised by replicating the `main.ts` `onEnterPlay` formula in the harness (the function is host glue, not importable in isolation) and reading the code, not by manipulating the wall clock in a live browser.
- **`coinCap: 0` (uncapped)** means a game left running indefinitely grows `coins` unbounded toward float limits — a generic idle-genre property, not specific to this game; not flagged as a defect.
- The two harness/driver scripts are in `/tmp` (`idle-harness.mjs`, `idle-browser.mjs`) and are not committed.
