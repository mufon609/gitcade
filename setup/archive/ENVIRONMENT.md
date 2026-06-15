# ENVIRONMENT.md — The Machine Contract
*Every AI session must read this before running any command. This file describes the real machine. Do not assume anything beyond it.*

## The machine
- Kali Linux (rolling), x86_64, bare metal desktop, **no GPU**
- Single non-root user. Internet access available.
- This is a dev box. Production deploys (Vercel/Fly/S3) are configured separately and are NOT reachable from local builds unless `.env` says so.

## What is already installed and configured (do not reinstall)
| Tool | How it was provided | Notes |
|---|---|---|
| Node 22 LTS + npm | nvm (user-space) | Use npm. Never `sudo npm`. Global installs go to nvm's prefix and are allowed. |
| git | apt | Identity configured; default branch `main`. |
| GitHub CLI (`gh`) | apt, **already authenticated** | `gh auth setup-git` done — push/pull/fork/repo-create all work with no password prompt. Prefer `gh` for repo creation and forking. |
| Docker + compose | apt, user in `docker` group | Run docker **without sudo**. The 4A worker runs builds as SIBLING containers by mounting `/var/run/docker.sock` — never Docker-in-Docker. Two traps: (1) inside any container, `localhost` is NOT the host — host services are loopback-bound, so attach to the infra compose network and use service names (`db:5432`, `minio:9000`), or `--network host`; (2) `-v` paths resolve on the HOST — share build workspaces between worker and builder via NAMED volumes, never the worker's internal paths. docker-group membership is root-equivalent; acceptable on this dedicated dev box. |
| Postgres 16 | Docker container, always running | `postgresql://gitcade:gitcade@localhost:5432/gitcade` |
| MinIO (S3-compatible) | Docker container, always running | `http://localhost:9000`, keys `gitcade` / `gitcade-secret`. Use as the artifact store locally; the S3 client config must work for both MinIO and real S3/R2 via env vars. |
| Chromium (Chrome for Testing) | Playwright-managed, user-space | Headless **and** headed browser for rendering tests. The Debian/Kali `chromium` apt package is uninstallable on this rolling box (libflac12 / chromium-common conflict) — do **not** try. Instead a Playwright Chrome-for-Testing build lives under `~/.cache/ms-playwright`, exposed on PATH as `chromium` via a `~/.local/bin/chromium` shim (forces software GL). Use `chromium` directly, or point Playwright/chrome-launcher at the same binary via `executablePath`. For manual browsing of the site, `firefox` is also installed. |
| Build toolchain | apt | gcc, make, pkg-config, cairo/pango/jpeg/gif dev libs (node-canvas compiles if needed). |

## Hard rules (permission walls)
1. **NEVER run `sudo` or `apt`.** They will hang or fail in this session. Everything system-level was pre-installed. If something system-level is genuinely missing, do not try to install it — see rule 4.
2. **NEVER prompt-block on credentials.** git/gh are pre-authenticated. If an auth error occurs anyway, do not retry interactively — see rule 4.
3. **No GPU exists.** All headless browser work must use `--headless --disable-gpu --use-gl=swiftshader` (software rendering). Never assume WebGL hardware acceleration; the SDK must run on Canvas 2D with WebGL as optional enhancement.
4. **When blocked, follow the two-tier Escalation protocol below.** Core-path blockers (database, build pipeline, storage, auth, SDK contract) HALT the session loudly with a `[CRITICAL]` entry — never mock the foundation. Peripheral blockers are logged in `BLOCKED.md` and routed around. Never silently skip; never sit waiting on an interactive prompt.
5. **Ports in use:** 5432 (Postgres), 9000/9001 (MinIO) — all bound to 127.0.0.1 only. 3000 = Next.js app, **3001 = artifact server (reserved)**, 3002+ for anything else; bind dev services to loopback. Check before binding.
5b. **S3 client config:** always honor `S3_FORCE_PATH_STYLE` from env — MinIO requires path-style addressing, real S3 doesn't. Hardcoding either breaks the other.
5c. **GitHub webhooks cannot reach this machine.** Local webhook testing goes through the smee.io proxy URL in env; the polling fallback covers everything else.
6. **Disk hygiene:** node_modules are fine; do not pull multi-GB Docker images without noting it in DECISIONS.md.

## Testing constraints
- Headless smoke tests: prefer Vitest + jsdom for logic; for real rendering checks use the Playwright-managed Chrome-for-Testing — either the `chromium` shim on PATH, or Playwright/chrome-launcher with `executablePath` pointed at the binary under `~/.cache/ms-playwright` (set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to reuse it rather than re-download). Do not run `npx playwright install-deps` (needs sudo); system deps already exist. To **watch** a run live, launch the same binary headed (omit `--headless`) — an X11 session is present.
- node-canvas may be compiled (build deps present) but prefer browser-based rendering tests.

## Environment variables
A populated `.env` exists in the repo root (gitignored). `setup/.env.example` documents every key. If a key you need is missing from `.env`, treat it as a BLOCKED.md event — do not invent values for external services. Local Postgres/MinIO values may be used freely.

## Escalation protocol (two tiers)

**Tier 1 — CORE PATH: HALT AND ASK. Do not route around.**
A blocker is core if it touches: the database, the build/validation pipeline, artifact storage, GitHub auth/repo operations, the SDK schema, or anything a later phase will inherit as a frozen contract. Stubbing these creates a fake foundation — that is worse than stopping.

On a core blocker:
1. STOP feature work immediately.
2. Write a `BLOCKED.md` entry marked `[CRITICAL]` at the TOP of the file: what failed, the exact error, the precise human action needed (command to run, key to provide, approval to grant), and what is safe to do in the meantime.
3. Print the same summary as your final output and END THE SESSION so the human sees it now — not buried after three hours of work built on a mock.
4. The only permitted interim work: things provably independent of the blocker (docs, tests for already-working code, isolated pure modules). When in doubt, it is not independent.

**Tier 2 — PERIPHERAL: LOG AND CONTINUE.**
Non-core blockers (an optional tool, a nice-to-have asset step, a flaky non-critical dependency): append a normal `BLOCKED.md` entry and keep building. Stubs are allowed here ONLY behind an interface, ONLY marked with `// STUB:` comments, and ONLY listed in the BLOCKED.md entry so they are findable and replaceable.

**Quick reference:**
- sudo wall on core tooling → `[CRITICAL]` halt.
- auth wall (git/gh/API) → `[CRITICAL]` halt — auth is always core.
- missing env key for DB/storage/GitHub → `[CRITICAL]` halt. Never mock the database or artifact store.
- missing env key for a peripheral service → Tier 2: stub behind an interface, log it.
- Anything ambiguous about *requirements* → choose the most reversible option and record it in DECISIONS.md. Ambiguity about *whether something is core* → it is core.

The human's commitment in return: `[CRITICAL]` entries get approved/fixed ASAP, so halting is cheap and lying-with-stubs is never worth it.
