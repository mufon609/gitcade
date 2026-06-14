# BLOCKED.md — GitCade Open Blockers

`[CRITICAL]` and `[PUBLISH]` entries go at the TOP and halt/gate work. Plain
`[PERIPHERAL]` entries are logged-and-routed-around per the ENVIRONMENT.md
two-tier escalation protocol. Resolve and strike through (or delete) entries as
they are cleared.

---

## [RESOLVED 2026-06-14] Artifact server is missing CORS for opaque-origin game iframes — raised 2026-06-13 (Phase 4B)

**Status:** RESOLVED 2026-06-14 (PM patch). The one-line additive fix below was
applied to `platform/artifact-server/src/headers.ts#artifactHeaders` —
`"Access-Control-Allow-Origin": "*"`. Verified on the REAL path: the module
script that errored (`idle-clicker/main/assets/index-BvhM1gEg.js`) now returns
`200` + `Access-Control-Allow-Origin: *` + `Content-Type: text/javascript`. A
regression assertion was added to `tests/headers.test.ts` (pure builder + served
JS asset both assert ACAO `*`); the header suite is green (8/8). No frozen
contract changed (CSP, content-types, cache, URL convention all identical) — a
non-contract bug fix under the patch-release protocol; no npm repin needed (the
artifact server is a service, not a published package), effective on restart.
Phase 5 branch/compare play is now unblocked. *Original diagnosis kept below.*

**Was — Status:** OPEN. Needed a human to apply a one-line ADDITIVE fix to the
frozen `platform/artifact-server` (the build agent was instructed not to modify
it; the auto-mode classifier also denied the edit). **This blocked the Phase 4B
"game is playable in-browser + storage bridge round-trips a save" DoD item** —
and it would have blocked Phase 5 branch/compare play too, since every game plays
through this path.

**What fails (reproduced in a real browser via Chrome-for-Testing):** loading a
LIVE seed game (`/games/idle-clicker`) renders a BLANK iframe. The game's Vite
entry `<script type="module" src="/assets/index-*.js">` never executes. Console:

```
Access to script at 'http://localhost:3001/artifacts/idle-clicker/main/assets/index-BvhM1gEg.js'
from origin 'null' has been blocked by CORS policy: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
Failed to load resource: net::ERR_FAILED
```

**Root cause (a genuine gap in the frozen 4A foundation, not a 4B web bug):** the
locked decision serves games in `sandbox="allow-scripts"` (opaque origin →
`document.origin === "null"`). An ES `<script type="module">` (and its
dynamic-import chunks) is ALWAYS fetched in **CORS mode**. A null-origin document
fetching its module cross-origin from the artifact origin (`:3001`) is blocked
unless the response carries `Access-Control-Allow-Origin`. The server sends
`Cross-Origin-Resource-Policy: cross-origin`, but **CORP governs embedding, not
module-script CORS** — it is insufficient. This is the FIRST time the locked
opaque-origin embedding actually runs end-to-end (4A only verified a *top-level*
load of the artifact, where the document origin is `:3001` and scripts are
same-origin, so the bug was invisible). The `allow-same-origin` escape hatch is
explicitly forbidden by the locked decision, so the ONLY correct fix is on the
server.

**Exact fix (additive; changes NO frozen contract — CSP, content-types, cache,
URL convention all unchanged):** in `platform/artifact-server/src/headers.ts`,
add one header to `artifactHeaders()`:

```ts
"Access-Control-Allow-Origin": "*",
```

Safe because artifacts are public, credential-free static bundles (CDN-standard
practice), and each game's own CSP (`connect-src 'none'`) still blocks any
exfiltration. After adding it, restart the artifact server. Verified-equivalent
patch confirmed locally then reverted to keep the frozen package untouched.

**Why this is filed CRITICAL rather than self-patched:** artifact serving is an
explicit CORE-path item AND `platform/artifact-server` is explicitly FROZEN this
phase. Even though this qualifies as a non-contract bug fix under the
patch-release protocol, the package is off-limits to me, so it HALTS for a human
decision per the escalation protocol.

**What is NOT blocked (and is done):** the parent-side storage bridge protocol is
proven by a unit test driving the REAL SDK `BridgeStorage` (game side) against the
new `ParentBridge` (parent side) — handshake, namespacing, isolation, set/get/
remove/clear all round-trip. The play heartbeat is proven end-to-end in the real
browser: loading the game created a `PlaySession` row (0 → 1). Only the in-iframe
*rendering* of the game (and therefore the game-driven save) is blocked, and only
by this server header.

**Interim:** everything else in Phase 4B is complete and verified. Apply the
one-liner above and the play path is immediately green (re-run
`node play-proof.mjs idle-clicker` from the repo root with all services up).

---

## [RESOLVED 2026-06-13] System Chromium binary is not actually installed — raised 2026-06-13 (Phase 1)

**Was:** ENVIRONMENT.md listed Chromium as apt-installed, but the apt package is
uninstallable on this rolling box (`dpkg -l chromium` state `rc`; a reinstall
fails on a `libflac12` / `chromium-common` dependency conflict — not a sudo
issue, the package simply isn't installable). No binary existed on PATH.

**Resolution:** A working headless **and** headed browser already exists in
user-space — Playwright's Chrome-for-Testing 148 under `~/.cache/ms-playwright`,
verified launching with `--disable-gpu --use-gl=swiftshader` and rendering DOM.
A `~/.local/bin/chromium` shim (on PATH) now exposes it as `chromium`, resolving
the newest cached build dynamically. ENVIRONMENT.md's tool table + testing-
constraints section were corrected to describe this instead of apt. The apt
package is **not needed**: Phase 4A's builder image bundles its own Chromium, and
manual site browsing uses the installed `firefox`. Phase 1 was completed and
verified without a browser regardless (Node-simulation smoke + dev-server HTTP
probe). No follow-up required.
