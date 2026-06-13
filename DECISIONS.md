# DECISIONS.md — GitCade Build Log

Every phase **appends** its assumptions and reversible requirement choices here
so later phases inherit full context. Newest phase at the bottom. Never
contradict an earlier entry; if reality forces a change, add a new dated entry
explaining it. This file is created in Phase 0 and is a handoff artifact for
every phase that follows.

Format: one section per phase, dated, listing each assumption/decision with a
one-line rationale. Locked Architecture Decisions live in **MASTER-PLAN.md §2**
and are NOT repeated here — this file is only for choices made *during a build
session* that were not already locked.

---

## Phase 0 — Infrastructure & Skeleton — 2026-06-13

Scope this session: monorepo skeleton + environment plumbing only, no app code.
The repo arrived partially set up (CLAUDE.md, MASTER-PLAN.md, ENVIRONMENT.md,
`setup/`, populated `.env`, `.gitignore`); those were left intact.

- **npm workspaces, not pnpm/yarn/turbo.** ENVIRONMENT.md mandates npm ("Use
  npm. Never `sudo npm`."), so the root `package.json` uses native npm
  workspaces. Reversible: a workspace-aware task runner can be layered on later
  without restructuring.
- **Workspace globs `packages/*`, `games/*`, `platform/*`, `templates/*`.** Glob
  patterns (not an explicit member list) so each later phase can drop in its
  package directory without editing root config. Matches the MASTER-PLAN §3
  layout exactly.
- **Root `package.json` is `private: true`, version `0.0.0`.** The monorepo root
  is never published; only `packages/sdk` and `packages/library` publish, each
  with their own version (SDK starts 0.1.0 in Phase 1). Prevents an accidental
  `npm publish` of the whole tree.
- **Root scripts fan out with `--workspaces --if-present`.** `npm run
  build/test/lint` at the root delegate to whatever members define them; safe to
  run now (no members yet → no-op) and grows automatically.
- **Engines pin `node >=22`.** Matches the installed Node 22 LTS
  (ENVIRONMENT.md); records the floor for clean clones in later phases.
- **Top-level dirs created with placeholder READMEs only.** `packages/`,
  `games/`, `platform/`, `templates/` exist with READMEs describing what each
  later phase fills in. Sub-package dirs (`sdk/`, `library/`, `game-scaffold/`)
  are intentionally **not** created — that is Phase 1+ work and would cross the
  phase boundary.
- **`infra/` holds docs only in v1.** No IaC/compose files committed here yet —
  the local infra stack (Postgres + MinIO) is provisioned by
  `setup/setup-kali.sh` per ENVIRONMENT.md, and prod IaC is out of scope until
  deploy time. `infra/README.md` is the topology contract (app/worker/storage
  three-zone diagram) derived from the Locked Architecture Decisions.
- **`setup/.env.example` left unchanged.** Verified it already documents every
  variable on the Phase 0 key list (DATABASE_URL, GITHUB_ORG,
  GITHUB_OAUTH_ID/SECRET, GITHUB_APP_ID/PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
  WEBHOOK_PROXY_URL, S3_ENDPOINT/BUCKET/KEYS, S3_FORCE_PATH_STYLE,
  ARTIFACT_BASE_URL, ARTIFACT_SERVER_PORT, BUILDER_IMAGE, QUEUE_POLL_INTERVAL_MS,
  NEXTAUTH_SECRET/URL) with per-key comments. Nothing genuinely missing, so
  nothing added — avoids drift from the curated template.
- **`.gitignore`: appended `node_modules/` and build outputs.** The existing
  entries (secrets, `.env`, `*.pem`) were preserved verbatim; an npm-workspaces
  repo must not commit `node_modules/` or `dist/`/`.next/` build output. Additive
  and reversible.
- **No CORE blockers hit.** Node 22, npm 10, git, `gh`, Docker (Postgres + MinIO)
  all present per ENVIRONMENT.md; no BLOCKED.md created this session.

---

## Phase 1 — The SDK: Schema + Runtime Core — 2026-06-13

Scope this session: built `@gitcade/sdk` (schema + runtime + storage bridge +
validator), filled `templates/game-scaffold/`, and built `examples/pong/` as the
pure-JSON proof. **The schema is now FROZEN** (per the Phase 1 → Phase 2 handoff):
Phase 2 may register new behavior/system *types* but must not change any shape
below. Phase 0 files were left intact; `examples/*` was added to the root
workspaces (logged below).

### Frozen contract surface (what Phase 2+ inherits, immutable)
- **`game.json` manifest** — `{ name, slug, description, version, engine:
  "gitcade-sdk", sdkVersion, libraryVersion?, entryPoint, license, authors[],
  tier }`. `sdkVersion`/`libraryVersion` are **exact** semver (regex-rejected
  ranges). `libraryVersion` is required for `ecosystem`, optional for `open`
  (enforced via `superRefine`).
- **entity** — `{ id, sprite, size, position, behaviors[], tags[], layer }` +
  additive optional `{ zIndex, rotation, scale, state, part }`.
- **behavior instance** — `{ id?, type, params, part? }`.
- **system instance** — `{ id?, type, params }` (same shape as behavior).
- **config.json** — recursive record of tunable leaves (number | string |
  boolean), nested OR flat-dotted keys both resolve.
- **scene** — `{ id, entities[], systems[], tilemap?, background?, music? }` +
  additive `size` (defaults 800×600).
- **`$cfg.<path>` convention** — the ONLY way balance numbers enter params.
- **`BehaviorFn = (entity, world, params, dt) => void`** and **`SystemFn =
  (world, params, dt) => void`** — the frozen function signatures. Params are
  `$cfg`-resolved before the function sees them.
- **Storage bridge protocol** (`storage/protocol.ts`, `v: 1`) — the message
  shapes + nonce handshake Phase 4B implements the parent side of.

### Decisions / assumptions made this session (reversible unless noted)
- **`license` is an object `{ code, assets }`** (string also accepted and
  normalized). The Locked Decision distinguishes MIT-code from CC-BY-assets, so
  the manifest models both. `authors[]` accepts bare strings or
  `{ name, email?, url?, github? }`. *Frozen as part of the manifest shape.*
- **`entryPoint` is a path to the entry scene JSON** (e.g.
  `"src/scenes/main.json"`); the loader matches its basename to a scene `id`,
  else falls back to the first scene. Reversible (loader behavior, not schema).
- **Sprite is a discriminated union on `kind`**: `shape | image | sheet | text |
  none`. Added a `text` kind (static or `bind`-to-`world.state`) so HUD/score
  readouts are plain entities — this avoided inventing a second render-time
  system signature and keeps `SystemFn` clean. *Frozen (additive kinds later are
  fine).*
- **The numeric whitelist is a single exported constant**
  (`WHITELISTED_NUMERIC_PARAM_KEYS`) imported by the validator, so the documented
  rule and the enforced rule cannot drift. Limited to structural/presentational
  keys (geometry, layering, frame indices, anchors, tile grid, stroke). The rule
  is intentionally **strict**: even a literal `0` under a non-structural key
  (e.g. `vy: 0`) fails — author it as a `$cfg` tunable. *Frozen; adding keys is
  additive/minor, removing is breaking.*
- **Per-game `Registry` instances** (no global mutable registry). Built-ins are
  registered onto a fresh registry per game; custom/library types register onto a
  clone. Prevents cross-game/test state leakage. *Runtime API, reversible.*
- **Built-in primitive set kept minimal and general** (the full library is Phase
  2A): behaviors `velocity, keyboard-axis, clamp-to-world, bounce-world-edges,
  reflect-on-hit, follow-entity-axis, score-zone, sprite-animate`; systems
  `aabb-collision, win-condition`. These compose Pong with zero custom code.
- **Tick order is deterministic**: clear collisions → run systems (collision
  first) → run each entity's behaviors in array order → prune → advance
  time/frame. Velocity-changing behaviors (reflect/bounce/input) must precede the
  `velocity` integrator in an entity's `behaviors` array; documented and used by
  Pong. *Runtime contract, stable.*
- **The validator's "smoke test" is a self-contained headless boot** (build the
  entry scene, run 60 fixed frames with the default registry). For games using
  custom behaviors the default registry can't supply (Phase 3+), it **defers to
  the game's own `npm test`** (which imports them via its bundler). Self-contained
  for built-in-only games (Pong); forward-compatible for custom ones. Reversible.
- **Validator split into a Node-only subpath `@gitcade/sdk/validate`**; the main
  `.` entry is **browser-safe** (never imports `fs`/`child_process`). Required so
  the SDK bundles cleanly into a browser game (Vite). `FileStorage`'s `node:fs`
  use is a guarded dynamic import (`@vite-ignore`, computed specifier) so it
  never enters a browser graph. *Packaging decision, reversible.*
- **Build tooling**: SDK uses **tsup** (esbuild) → dual ESM+CJS + `.d.ts`, zero
  runtime deps but `zod`. Games/scaffold use **Vite** (`dev` + static `build`) and
  **Vitest** (headless smoke). The CLI ships as a checked-in shim
  (`bin/gitcade.mjs`) importing the built `dist/cli.js` — reliable shebang across
  installs. Reversible.
- **`examples/*` added to root `package.json` workspaces** (allowed reversible
  change per the phase prompt) so Pong resolves `@gitcade/sdk` via the workspace
  link during development. Added a root `validate:pong` convenience script.
- **Storage adapter API is `Promise`-based** (`get/set/remove/keys/clear`) because
  the production `BridgeStorage` round-trips through `postMessage`. Dev-shims
  (`MemoryStorage` in-memory, `FileStorage` JSON) satisfy "dev-shim (in-memory +
  JSON file)". *Frozen interface shape.*

### Peripheral blocker logged (not core; see BLOCKED.md)
- System Chromium binary is absent (apt package in `rc` state) despite
  ENVIRONMENT.md. No Phase 1 DoD needs a real browser — routed around with the
  Vitest simulation smoke + a dev-server HTTP probe. Phase 4A bundles Chromium in
  its builder image regardless, so it is unaffected.
