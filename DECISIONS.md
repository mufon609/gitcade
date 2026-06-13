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

---

## Phase 2A — Component Library: Behaviors + Systems — 2026-06-13

Scope this session: built the LOGIC half of `@gitcade/library` (v0.1.0) —
18 behaviors + 9 systems, each with implementation + JSON definition/metadata +
unit test — plus `CATALOG.json`, the reuse proof (4 demos), and registration
patterns. The SDK schema was NOT touched; parts register only as new TYPES via the
frozen registration API. SDK, `examples/pong`, docs, and `setup/` left intact.
No CORE blockers; no BLOCKED.md entries this session.

### What Phase 2B inherits (frozen-ish conventions established here)
- **Part = one JSON file in `parts/{behaviors,systems}/<id>.json`** holding both
  metadata (`id, kind, version, category, tags, license, description,
  dependencies`) AND a ready-to-use `definition` instance template + a `params`
  doc. This single file is the source of truth.
- **`CATALOG.json` is GENERATED** from `parts/*.json` by
  `scripts/build-catalog.mjs` (`npm run catalog`), with a stable key order and
  `(kind, id)` sort. Never hand-edit it. A test asserts it is in sync with the
  part files and valid against `catalog.schema.json`. **2B extends CATALOG by
  adding part files and re-running the script** — its `kind` enum already allows
  `entity | asset | ui | fx`.
- **`catalog.schema.json`** is a draft-07 JSON Schema (validated with `ajv`, a
  devDependency). Phase 6 ingests `CATALOG.json` against this schema. The
  catalog/library `version` field tracks the package version.
- **Registration API**: `registerLibrary(registry)` and `createLibraryRegistry()`
  (SDK built-ins + library on a fresh registry). 2B's parts register the same way.
- **Part `type` ids are the keys** of `LIBRARY_BEHAVIORS` / `LIBRARY_SYSTEMS`
  maps in `src/{behaviors,systems}/index.ts` — the single id↔impl mapping shared
  by catalog, registration, and runtime.

### Decisions / assumptions made this session (reversible unless noted)
- **`@gitcade/sdk` is a PEER dependency of the library** (exact `0.1.0`), with a
  matching devDependency for local build/test. Avoids a duplicate SDK instance in
  a consuming game; games already pin both versions per the locked decisions.
- **Movement/AI behaviors SET velocity and require an SDK `velocity` integrator
  ordered AFTER them** (the Pong composition pattern). `move-grid-step` and the
  platformer floor-snap write position directly. Documented per part.
- **Stateful systems take a `stateKey` param** to namespace their scratch under
  `world.state` (since `SystemFn` gets no per-instance handle), so multiple
  instances of the same system coexist. `wave-spawner`/`lives-respawn`/
  `timer-countdown`/`level-progression` use this; economy systems use semantic
  keys (`currencyKey`, `inventoryKey`, `levelsKey`).
- **`health-and-death` seeds `state.hp` on its first tick**; `contact-damage`
  SKIPS a victim whose `damageKey` is not yet a number (avoids
  `undefined - dmg = NaN` making a victim unkillable). Because collisions persist
  while overlapping, the hit simply lands one tick later. *Load-bearing
  robustness; documented in both parts.*
- **`health-and-death.lifespan`** is the generalization that expires
  bullets/hitboxes (no separate TTL part). **`ai-chase.lockAxis`** is the
  generalization that yields space-invaders descent. These were added under
  reuse-proof pressure rather than writing one-off behaviors — exactly the test
  the phase prescribes.
- **`spawnFrom` (in `src/util.ts`)** deep-clones a resolved entity-def embedded in
  a part's params, assigns a unique id (`world.state.__spawnSeq`), and backfills
  the fields `buildEntity` reads (runtime-spawned defs bypass the schema's default
  application). `shoot`/`melee-swing`/`ai-aim-and-fire` recenter the spawn on the
  muzzle point (params position is a center; entity coords are top-left).
- **`wave-spawner` and `lives-respawn` carry the spawn `prototype` as a nested
  object param.** The SDK resolves its `$cfg` refs at scene load (deep resolve),
  so the cloned prototype is already numeric at spawn time. The prototype's
  balance params are `$cfg`; only structural keys (size/position/layer) are
  literals — so the embedded prototype passes the no-magic-numbers rule.
- **Reuse-proof demos are workspace-member mini-games** under
  `packages/library/proofs/*` (added that glob to the root `package.json`
  workspaces — a reversible change parallel to Phase 1 adding `examples/*`). Each
  has its own `vitest.config.ts` (so `gitcade validate`'s deferred `npm test`
  finds the proof's smoke test rather than walking up to the library config) and
  its own `package.json` (deps on `@gitcade/sdk` + `@gitcade/library`).
- **Proof scenes reference parts by `type` only, NOT `partId@version` `part`
  provenance.** This keeps them validatable in-monorepo without a published
  catalog in `node_modules` (the validator's catalog lookup only checks the
  game's own `node_modules/@gitcade/library/CATALOG.json`). Pong proved an
  ecosystem game can pin `libraryVersion` with zero `part` refs and validate. The
  `part` provenance path is exercised later by Phase 3 standalone-repo games.
- **Proof demos are tier `ecosystem`** with `libraryVersion: "0.1.0"`. Each runs
  to a DETERMINISTIC outcome headlessly (idle input): snake-threat → loss
  (swarmed); creep-wave/arena-mobs/invaders-descent → win. The smoke tests assert
  the specific outcome, proving the four parts integrate end-to-end.
- **Categories**: behaviors use `movement | combat | ai | interaction`; systems
  use `progression | spawning | rules | economy`. Phase 6 can group by these.
- **`level-progression` manages a counter, not scene loading** (the SDK's scene
  loader is a host concern not reachable from a `SystemFn`); other parts read the
  level key. **`upgrade-tree` is request-driven**: UI/game code sets
  `world.state[requestKey]` to an upgrade id; the system fulfils one per tick.
