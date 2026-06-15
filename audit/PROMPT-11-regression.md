# Session 11 — Stage 5a: repin-to-0.2.1 + full six-game regression (capstone)

> Paste everything below the line into a fresh Claude Code session in the GitCade
> repo root. Self-contained. The capstone of the audit program: all six games are
> already fixed on 0.2.0; this session moves them to 0.2.1, applies the cleanups
> 0.2.1 enabled, and proves the whole set is coherent. NO go-live (no npm publish,
> no GitHub push) — that's deferred Stage 5c.

---

You are running the final regression for the GitCade audit program, in
`/home/samsung/Desktop/gitcade`. Read `README.md`, `CLAUDE.md`,
`audit/SDK-0.2.0-BUILD-NOTES.md` (esp. the **§0.2.1** note listing removable
per-game workarounds), the six `audit/GAME-AUDIT-*.md`, and `games/LIBRARY-GAPS.md`.
**Scope: the six games + the two tracking docs.** Do NOT edit `packages/*` (0.2.1
is frozen-done) or `platform/`. If you find a real engine bug, file it in
`games/LIBRARY-GAPS.md` and halt that thread — don't fix the engine here.

## Method: observe, don't assert
Use the reusable harnesses (`audit/harness/.../probe.mts`/`play.mjs`/`republish.mts`)
+ headless Chrome (`puppeteer-core` + `~/.cache/ms-playwright/chromium-1223/
chrome-linux64/chrome`). Every "works" claim is backed by pasted output. Rebuild
fresh before judging.

## Server handling (project rule)
The user runs `:3000`/`:3001` externally; **leave no server running.** Republish
to MinIO is a direct S3 upload (no server). For headless play, start the artifact
server **ephemerally** and **kill it** after; if `:3001` is already bound (user
started it), use it and don't kill it. Postgres/MinIO are always-on Docker. Don't
touch `:3000`.

## Step 1 — Repin all six to 0.2.1
For each of snake, breakout, helicopter, survival-arena, idle-clicker,
tower-defense: bump `game.json` (`sdkVersion`/`libraryVersion`) and
`package.json` deps to `0.2.1`. Ensure the `node_modules/@gitcade/*` workspace
symlinks resolve. `gitcade validate` must pass for each.

## Step 2 — Apply the workaround cleanups 0.2.1 enabled (SECONDARY — do only with re-verification)
Per `SDK-0.2.0-BUILD-NOTES.md §0.2.1`. For each, make the change AND re-verify
that game by playing it; if a cleanup can't be verified clean, **revert it and
leave the working 0.2.0 workaround** (note it). These are quality, not required:
- **idle-clicker** — collapse the title-scene persistence dance into persistence +
  currency on the play scene (safe now via the #6 hydration claim); verify coins/
  upgrades/prestige still restore on reload.
- **helicopter** — replace custom `scroll-ramp` with the library `scale-by-state`;
  verify the difficulty ramp still climbs.
- **survival-arena** — replace custom `swarm-scale` with `scale-by-state`
  instance(s); verify enemy speed/hp still scale.
- **tower-defense** — import `snapToGrid` instead of the inlined formula; verify
  placement still snaps.
- **snake** — optional `excludeTags` on `place-on-free-cell` for the imminent
  cell; verify food placement.

## Step 3 — Full regression (the required deliverable)
- `gitcade validate` PASS for all six; `npm run build` clean for all six.
- **Replay all six headless** (and confirm 0 console/page errors), explicitly
  re-confirming the original complaints stay fixed: **helicopter** obstacles vary
  in height; **snake** food never on wall/body; **tower-defense** towers cannot be
  placed on the road, economy is real, store/upgrade UI works. Spot-check each
  game's core loop, flow (title→play→over), and persistence (reload restores).
- **Republish all six** fresh 0.2.1 builds to MinIO `<game>/main/`.
- Run the SDK + library suites once more as a sanity check (should be green; you
  did not change packages).

## Step 4 — Update tracking docs
- `games/PUBLISHED.md` — note all six are on 0.2.1 and republished to local MinIO
  (and that npm publish + GitHub push remain the deferred Stage 5c go-live).
- `games/LIBRARY-GAPS.md` — mark `#2/#4/#6/#8` resolved in 0.2.1 (with what shipped),
  leave anything still open clearly open.

## Boundaries & DoD
- Six games + the two docs only. No `packages/*` or `platform/` edits. No npm
  publish, no GitHub push. No server left running. Follow `CLAUDE.md`; halt loudly
  on a real core blocker.
- **Done when:** all six validate, build, replay clean, and are republished on
  0.2.1; the three original complaints are re-confirmed fixed with pasted
  evidence; applied cleanups are verified by playing (or reverted); the two docs
  are updated; and `audit/REGRESSION.md` summarizes per-game status + the
  re-confirmed complaints + which cleanups landed.
- Final message: concise status — per-game validate/build/replay/republish results,
  the three complaints re-confirmed, which cleanups landed vs reverted, docs
  updated, and an explicit statement that the audit program is COMPLETE locally
  (only the deferred Stage 5c go-live — npm publish + push to gitcade-games/* +
  worker-faithful rebuild — remains, at the owner's discretion).
