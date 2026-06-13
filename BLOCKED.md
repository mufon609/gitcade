# BLOCKED.md — GitCade Open Blockers

`[CRITICAL]` and `[PUBLISH]` entries go at the TOP and halt/gate work. Plain
`[PERIPHERAL]` entries are logged-and-routed-around per the ENVIRONMENT.md
two-tier escalation protocol. Resolve and strike through (or delete) entries as
they are cleared.

---

## [PERIPHERAL] System Chromium binary is not actually installed — 2026-06-13 (Phase 1)

**What:** ENVIRONMENT.md lists Chromium as installed via apt for headless
rendering tests. Reality on this box: `dpkg -l chromium` shows state `rc`
(removed; config only) and there is **no binary** at `/usr/bin/chromium`
(`chromium`, `chromium-browser`, `google-chrome` all absent).

**Why it is NOT core for Phase 1:** No Phase 1 Definition-of-Done item needs a
real browser. The SDK is explicitly designed to run headless (Canvas 2D, audio
no-ops without an `AudioContext`), and the "headless smoke test = 60 simulated
frames" runs under Vitest in Node — already green for Pong, the scaffold, and the
SDK runtime. `npm run dev` was verified by starting the Vite dev server and
confirming it serves `index.html` + the entry module over HTTP 200. A pixel-level
browser render check is a nice-to-have, not a gate.

**Routed around by:** Vitest simulation smoke (no browser) + a dev-server HTTP
probe. No stub introduced; nothing mocked.

**Action needed (for Phase 4A, not now):** The build worker bundles Chromium in
its **builder image** (per ENVIRONMENT.md, the host's Chromium is invisible
inside containers anyway), so Phase 4A is unaffected by the host gap. If a host
browser is wanted for local Playwright render checks, install Chromium
(`apt install chromium`, human action — AI sessions may not run apt). Until then,
real-browser rendering verification is deferred.

**Safe in the meantime:** Everything in Phase 1 — done and verified without it.
