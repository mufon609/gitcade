# GitCade — Security Checklist (Phase 8A Security Pass)

*Hardening only — no new features, no frozen-contract changes. Every item below is
marked with the **PROBE** that verified it (real output, not assertion). Dated
2026-06-14. Re-run any probe with the services up (infra + artifact-server + web).*

**The security model in one line:** untrusted game code runs in an **opaque-origin
iframe** (`sandbox="allow-scripts"` only) served from a **separate artifact origin**
under a **strict CSP**; builds run in **network-isolated sibling containers**; the
storage bridge authenticates by **source identity + nonce** (never origin); governance
auto-commits use a **GitHub App installation token** (never a user's OAuth token);
every state-changing endpoint is **rate-limited**. None of these may be weakened to
"make something work."

---

## 1. Iframe sandbox + Content-Security-Policy

- [x] **Games run in `sandbox="allow-scripts"` ONLY (opaque origin, no
  `allow-same-origin`).** `platform/web/src/components/PlayPane.tsx:136`. Both the
  single-game player and `/compare` use this one component.
  **PROBE (Chrome-for-Testing):** `/games/snake` iframe attribute is exactly
  `sandbox="allow-scripts"`; `allow-same-origin` absent. ✓
- [x] **Artifacts are served ONLY from the artifact origin (`:3001`), never the
  platform origin (`:3000`).** `indexUrl` is built from `ARTIFACT_BASE_URL`
  (`src/lib/artifact-url.ts`).
  **PROBE (browser):** iframe `src = http://localhost:3001/artifacts/snake/main/index.html`;
  all 3 artifact requests came from `:3001`, none from `:3000`. ✓
- [x] **The strict game CSP is intact and applied by the browser.**
  `platform/artifact-server/src/headers.ts#gameCsp`:
  `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'none'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'none';
  form-action 'none'; frame-ancestors 'self' <PLATFORM_ORIGIN>`.
  **PROBE (curl + browser):** index.html and a JS chunk both return the full CSP;
  `connect-src 'none'` (no network exfiltration) and `frame-ancestors` (embedder
  restricted) present. ✓
- [x] **The ACAO `"*"` patch (Phase 4B) exposes nothing beyond static artifact
  reads.** `Access-Control-Allow-Origin: *` is set ONLY in
  `headers.ts#artifactHeaders`, which is applied ONLY to `GET /artifacts/...` static
  bundle responses. Artifacts are public, credential-free static files; the artifact
  server has no cookies/auth, no write routes, and `connect-src 'none'` in each game's
  own CSP blocks any callback. ACAO governs read access to already-public files — it
  grants no new capability.
  **PROBE:** only `GET`/`HEAD` are accepted (`405` otherwise, `server.ts:23`); the
  only non-artifact routes are `/healthz` and `/favicon.ico` (204); path traversal is
  rejected (see §7). ✓
- [x] **Defense-in-depth headers:** `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: cross-origin`, correct per-type `Content-Type`,
  `immutable` cache on hashed assets / `no-cache` on HTML.
  **PROBE (curl):** all present on index.html + JS asset. ✓

## 2. Build pipeline sandbox

- [x] **Stage 2 (validate + build) runs `--network none`.** `platform/worker/src/build.ts:178`.
  **PROBE (docker, builder image + Stage-2 flags):** a network call
  (`fetch registry.npmjs.org`) **FAILS** under `--network none` (exit 1,
  `NETWORK-BLOCKED`), and **succeeds** under Stage-1's networked config (exit 0,
  status 200) — proving isolation is real and specific to Stage 2. ✓
- [x] **Stage 1 (clone + install) is the only networked stage**, on the default/
  configured bridge. `build.ts:120-125`, `builder/stage1.sh`. ✓
- [x] **CPU / memory / time limits come from env and are enforced.**
  `build.ts:baseRunArgs` passes `--cpus $BUILD_CPU_LIMIT --memory $BUILD_MEMORY_LIMIT`;
  `dockerStream` kills the container at `BUILD_TIMEOUT_MS` (`docker.ts:28-37`).
  Defaults 2 CPU / 2g / 600s (`worker/src/env.ts:51-53`).
  **PROBE:** probe containers ran with `--cpus 2 --memory 2g`; timeout path is the
  `docker kill <name>` in `docker.ts`. ✓
- [x] **The named-volume workspace is destroyed post-build.** `build.ts#finalize`
  calls `removeVolume(volume)` and asserts no labeled containers leak
  (`listBuildContainers`). Containers are `--rm`. ✓
- [x] **The mounted Docker socket is NOT reachable from inside build containers.**
  Only the worker mounts `/var/run/docker.sock`; `baseRunArgs` mounts only the
  workspace volume — never the socket — into stage containers.
  **PROBE (docker):** inside a builder container `/var/run/docker.sock` is absent and
  no `docker` CLI is present. ✓

## 3. Rate limiting (per-user / per-IP)

- [x] **Every state-changing endpoint is rate-limited.** Central limiter
  `platform/web/src/lib/ratelimit.ts` (Postgres-backed fixed-window counter on the
  additive `RateLimit` table; atomic `INSERT ... ON CONFLICT DO UPDATE`). Identity is
  `user:<id>` (authenticated) **and** `ip:<addr>` (always) — neither axis can be
  evaded by rotating the other. Returns `429` + `Retry-After` + `X-RateLimit-*`.
  The check runs **before** the auth/401 check so anonymous floods are throttled too.
  Instrumented routes (18): publish, fork, vote, proposal-create, remix-commit,
  bug-report **(the six named)** + remix-start, part-upload, community-join,
  proposal open/approve/veto/fork-with-patch/finalize, bug-convert, branch-build,
  notifications-read, play-heartbeat.
  **PROBE (live HTTP):** `POST /api/games/snake/bugs` ×13 → req 1–10 = `401`
  (limit allowed, auth gates), req 11–13 = **`429`** with `Retry-After: 58`,
  `X-RateLimit-Limit: 10`, `X-RateLimit-Remaining: 0`. A `vote` request stayed `401`
  (separate counter) — buckets are independent. ✓
- [x] **The counter is durable (survives restart / multi-instance), not in-memory.**
  **PROBE (psql):** `RateLimit` rows present — `bug-report ip:::1 count=14`,
  `vote ip:::1 count=1`. ✓
- [x] **Webhook / OAuth-callback endpoints are deliberately NOT rate-limited** — the
  app-level GitHub webhook is HMAC-verified (`verifyGithubSignature`, fails closed)
  and throttling GitHub's delivery would drop legitimate push events; the NextAuth and
  App-install callbacks are GitHub-driven redirects. Documented, not an omission.

## 4. Storage bridge (cross-game isolation)

- [x] **The parent validates by `event.source === iframe.contentWindow` + the nonce —
  NEVER the origin string.** `platform/web/src/lib/bridge.ts:95` (identity check),
  `:97-117` (handshake mints sessionId + parentNonce; every later request must match).
  Opaque iframes report `origin === "null"`; replies post with `targetOrigin "*"`.
- [x] **One game cannot read another game's saves (namespacing holds).** Keys are
  prefixed `gc\0{gameSlug}\0{branch}\0` (NUL separator, `bridge.ts:58-64`); `keys`/
  `clear` filter by that prefix.
  **PROBE (unit, `tests/unit/bridge.test.ts`, 5/5 green):** "isolates saves across
  branches and games (no cross-talk)", "persists under a gameSlug+branch namespace",
  "drops messages whose source identity is not the expected iframe window",
  "remove/clear scoped to the game". ✓
- [x] **The frozen SDK protocol is unchanged** (`packages/sdk/src/storage/protocol.ts`,
  `v:1`) — the bridge re-audit touched no contract.

## 5. Governance credential

- [x] **Auto-commit ONLY ever mints an installation token from the App key — never the
  owner's OAuth token, and cannot fall back to OAuth.**
  `platform/web/src/lib/governance-service.ts#approveAndCommit`: requires
  `game.installationId` (else `critical` reject, `:286`), mints via
  `getInstallationToken` (`github-app.ts`), and on ANY mint/commit failure returns
  `{ critical: true }` with **no OAuth path** (`:294-297`, `:325-327`). Both
  `loadRemixSources` and `commitFiles` are called with `tok.token` (the installation
  token), `:301`/`:324`.
  **PROBE (code audit + grep):** the only token used in the auto-commit path is the
  installation token; `getUserGitHubToken` is never imported into the approve path.
  Phase 7 already verified the on-wire commit is authored by `gitcade-governance[bot]`,
  GPG-`valid`. ✓
- [x] **`fork-with-patch` (the user's exit door) correctly uses the USER's OAuth token
  on THEIR fork** — a distinct, intended path, not a fallback (`forkWithPatch`). ✓

## 6. Dependency audit

- [x] **`npm audit` run across web / worker / artifact-server; SDK + library noted.**
- [x] **worker + artifact-server: 0 production vulnerabilities** (`npm audit --omit=dev`).
  Their reported criticals/highs (`vitest` UI RCE, `esbuild` dev-server, `tsup`) are
  **dev/test tooling only** — never shipped. The `vitest --ui` server is never run.
- [x] **web: 4 production vulns (1 high `next`, 3 moderate `next-auth`/`uuid`/`postcss`).
  NO non-breaking fix exists** — `npm audit fix` (no `--force`) applies nothing; every
  remediation is SemVer-MAJOR (`next` 14→16, `next-auth` 4→3). Logged, not forced:
  a framework-major upgrade is out of scope for a no-new-features hardening pass and
  would risk the App Router app. Triage:
  - `next@14.2.33` (HIGH): a batch of RSC/cache-poisoning/DoS/SSRF advisories. The app
    uses **no `next/image` and no i18n** (grep-confirmed), which removes the Image-
    Optimizer / disk-cache / i18n-middleware advisories. The remainder are largely
    mitigated behind a CDN/proxy; fix = `next@16` (tracked for a dedicated upgrade).
  - `next-auth`/`uuid`/`postcss` (MODERATE): `uuid` issue triggers only when a caller
    passes a `buf` (next-auth does not in a triggering way); `postcss` is a build-time
    XSS in CSS stringify (trusted CSS only, not runtime). Fixes are major; logged.
  **PROBE:** `npm audit --omit=dev` per service; `npm audit fix --dry-run` confirms
  0 non-breaking fixes; `next` version + feature grep captured. ✓
- [x] **SDK / library (`@gitcade/sdk`, `@gitcade/library`): runtime dep is only `zod`;
  no audit findings of note.** (Frozen packages — not modified this phase.)

## 7. Secrets hygiene

- [x] **No `.env` / `.pem` / `.key` / secret / `.npmrc` / `.git` in any served
  artifact.**
  **PROBE (mc over the full bucket):** "No .env/.pem/.key/secret/.npmrc/.git files in
  any served artifact." ✓
- [x] **No secret files tracked in game repos / templates, and no `.pem`/`.env`/
  private-key tracked anywhere in the monorepo.**
  **PROBE (`git ls-files`):** both scans clean. ✓
- [x] **The App private key is never logged.** It is read in `github-app.ts`
  (`loadAppPrivateKey`) and used only to sign the JWT; a missing key throws
  `[CRITICAL]` (never invents/echoes it).
  **PROBE (grep):** no `console.*` of `privateKey`/`jwt`/`token`/`secret` anywhere in
  `src`. ✓
- [x] **Path traversal on the artifact server is blocked.** `server.ts` rejects any
  `..` segment (`:51`) and the URL parser normalizes the rest.
  **PROBE (curl):** `%2e%2e` encoded traversal → `400`; literal `..` → `404` (never
  serves outside `{game}/{branch}/`). ✓

---

## How to re-run the probes

```
# infra (always up): Postgres :5432, MinIO :9000  (docker compose in setup/)
# 1. artifact server
cd platform/artifact-server && npx tsx src/server.ts            # :3001
# 2. web (build first so routes include the limiter)
cd platform/web && npm run build && npm run start               # :3000
# 3. build-sandbox isolation (needs gitcade-builder:local)
docker run --rm --network none gitcade-builder:local sh -c 'node -e "fetch(\"https://registry.npmjs.org/\").then(()=>process.exit(0)).catch(()=>process.exit(1))"'   # exit 1 = isolated
# 4. rate limit
for i in $(seq 1 13); do curl -s -o /dev/null -w "%{http_code}\n" -X POST -d '{}' localhost:3000/api/games/snake/bugs; done   # 401x10 then 429
# 5. CSP/sandbox in a real browser
node /tmp/csp-sandbox-probe.mjs snake     # (probe script; see DECISIONS Phase 8A)
# 6. dependency audit
(cd platform/web && npm audit --omit=dev)
# 7. unit tests (bridge isolation + rate-limit helpers)
cd platform/web && npm test
```
