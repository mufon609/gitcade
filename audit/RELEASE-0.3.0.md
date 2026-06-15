# RELEASE-0.3.0.md — `@gitcade/sdk` + `@gitcade/library` 0.3.0 (PUBLISHED)

**Date:** 2026-06-15 · **Status:** PUBLISHED — `npm publish` (both packages),
the MinIO artifact republish (all six games), and the GitHub pushes (monorepo
`release/0.3.0` + the six `gitcade-games/<slug>` source repos) are all DONE. See
the "PUBLISHED — completed external steps" section below for the verified outcome.

This release lands the input/focus/lifecycle/rendering/data fixes from the three audit
batches that began with the "Space scrolls the page instead of playing" report. See
[`SHARED-ISSUES.md`](./SHARED-ISSUES.md) for the per-item detail.

---

## Why MINOR (0.2.x → 0.3.0)

0.3.0 is a clean **minor**: it ADDS public API and improves runtime behavior, but breaks
no existing pinned game (a game on `0.2.1` keeps its exact behavior; the new behavior is
opt-in by repinning).

- **New public API (additive):** `Game.pause()` / `Game.resume()` / `Game.isPaused()`;
  the `controls` field on `GameManifestSchema` + `ControlHintSchema`/`ControlHint`.
- **Behavior changes (opt-in via repin):** keydown `preventDefault` for scroll keys;
  clear held input on blur; `setPointerCapture` on pointerdown; `visibilitychange`
  auto-pause; **device-pixel-ratio rendering** (the one visible render change — sharper
  on HiDPI); FX overlay tracks screen-shake.
- **No removed/renamed/reshaped exports, schema shapes, message protocol, or headers.**
  The Phase 4A queue schema is untouched.

## What's in it (summary)

- **SDK** (`packages/sdk`): `input.ts` (scroll preventDefault, blur-clear, pointer-capture,
  axis() doc), `game.ts` (pause/resume/isPaused + visibility auto-pause + DPR backing
  store), `schema/manifest.ts` (`controls` field).
- **Library** (`packages/library`): `fx/screen-effects.ts` (overlay tracks shake).
- **Six games**: pause glue + held-key-safe pause; mute button + `M` key + `$cfg.volume`;
  `#stage` shake clip CSS; `controls` metadata; snake `tileSize` → `$cfg`; idle-clicker
  offline-credit race fix; tower-defense pause added + dead `#touch` removed.
- **Platform** (`platform/web/PlayPane.tsx`): focus the game iframe on load/hover (the
  other half of the original scroll-bug fix; not part of the npm release).

## Local prep — DONE & verified

- [x] `@gitcade/sdk` `0.2.2 → 0.3.0` (`package.json`).
- [x] `@gitcade/library` `0.2.1 → 0.3.0`; peerDep `@gitcade/sdk` `0.2.x → 0.3.x`; devDep
      `0.2.1 → 0.3.0`. `CATALOG.json` regenerated → `0.3.0` (86 parts unchanged; the
      `prepublishOnly` `catalog` script reproduces it from `package.json`).
- [x] All six games repinned `0.2.1 → 0.3.0` (`package.json` deps + `game.json`
      `sdkVersion`/`libraryVersion`). Game `version` stays `1.0.0`.
- [x] Full rebuild + tests green: **SDK 59/59, library 95/95**, root `npm run build` +
      `npm test` all pass.
- [x] All six `gitcade validate` PASS (incl. the new `library-version-mismatch` check now
      satisfied at 0.3.0).
- [x] `npm pack --dry-run`: `gitcade-sdk-0.3.0.tgz` (21 files), `gitcade-library-0.3.0.tgz`
      (125 files).

---

## PUBLISHED — completed external steps (2026-06-15)

Done in this order (library's peer range needs the SDK on npm first; the game repos build
from clean clones against public npm):

1. **SDK published** — `@gitcade/sdk@0.3.0` live on npm (`npm view @gitcade/sdk version`
   → `0.3.0`).
2. **Library published** — `@gitcade/library@0.3.0` live on npm (its `prepublishOnly`
   re-ran `catalog` + `build`).
3. **Game source pushed** — all six `gitcade-games/<slug>` repos (snake, helicopter,
   breakout, tower-defense, idle-clicker, survival-arena — URLs in `games/PUBLISHED.md`)
   updated `0.1.x → 0.3.0`. Each repo holds ONLY that game's tree; each was re-verified
   from a clean clone (`npm install` from public npm → `npm run build` → `npm test` →
   `gitcade validate .` PASS) before push.
4. **MinIO artifacts republished** — all six `<slug>/main/` prefixes serve the fresh 0.3.0
   `/dist` (bundle hashes verified identical to the local 0.3.0 build). Done via the local
   bridge (`node audit/harness/republish.mjs <slug…>`), same key layout the build worker
   uses.
5. **Monorepo pushed** — `release/0.3.0` pushed to `origin` and merged to `main`.

### Notes / cautions
- **Order mattered:** SDK before library before games — a game rebuilt from npm before the
  packages were live would fail to resolve `0.3.0`.
- **Forks/older games on `0.2.1` are unaffected** — 0.3.0 is additive; they keep resolving
  `0.2.1` from npm.
- `.env` / npm credentials are gitignored and owner-held; this machine is `npm login`'d as a
  `@gitcade` publisher.
