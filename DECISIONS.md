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

---

## Phase 2B — Component Library: Entities, Art, Audio, UI, FX — 2026-06-13

Scope this session: built the PRESENTATIONAL half of `@gitcade/library` (still
v0.1.0) — 54 new parts across `entities/` (19), `assets/` (world: 4 tilesets +
3 backgrounds + 3 camera presets; audio: 8 SFX + 2 music = 20), `ui/` (8), `fx/`
(7) — plus the deterministic procedural asset pipeline, the audio/fx/ui runtime
modules, an extended `CATALOG.json` (now **81 parts**, all 7 marketplace
categories), and the re-skin proof. The SDK schema and the Phase 2A logic parts
were NOT touched; everything new registers only as new TYPES via the frozen
registration API or is pure data/host-glue. No CORE blockers; no BLOCKED.md
entries this session.

### What Phase 3 inherits (conventions established here)
- **Generated assets are byte-deterministic.** `scripts/gen-assets.ts` →
  `packages/library/assets/` (27 PNGs + `manifest.json`) via a dependency-free
  PNG encoder (raw scanlines → `node:zlib.deflateSync`, fixed level 9) on the
  fixed 8-color palette. Re-running reproduces identical bytes (verified: two runs
  diff-clean). Runs on Node 22 directly (`node scripts/gen-assets.ts`, built-in
  type-stripping — the script uses erasable syntax + zero imports beyond `node:*`).
  Verify with `npm run gen-assets` twice + `git diff assets/`.
- **The fixed 8-color palette** (`src/palette.ts` `LIBRARY_PALETTE`, mirrored as a
  literal inside `gen-assets.ts`; a unit test asserts they match via
  `assets/manifest.json`). All sprites/tiles/backgrounds AND runtime-drawn shapes
  (particles, HUD bars) draw from it.
- **2B part files use the SAME single-file convention as 2A** (`parts/<kind>/<id>.json`
  with metadata + `definition`). The build script (`scripts/build-catalog.mjs`)
  now reads all six subdirs (`PART_DIRS`); the catalog/schema were NOT reshaped —
  every part still satisfies `definition.type === id` and `definition: { type,
  params }`. For non-behavior/system kinds, `definition.params` carries the
  payload: an **entity template** (entities, HUD widgets), an **asset descriptor**
  (tilesets/backgrounds/audio), a **scene fragment** (menus), or **system/behavior
  params** (fx). `kind` + `category` disambiguate the 7 marketplace buckets
  (Behaviors, Systems, Entities, World, Audio, UI, FX) — `kind: asset` splits into
  World vs Audio by `category`.

### Decisions / assumptions made this session (reversible unless noted)
- **License rule: a part is `CC-BY-4.0` iff it references a generated PNG
  (`assets/…png`), else `MIT`.** So entities + tilesets + backgrounds are CC-BY
  (art-bearing); audio (synthesized, zero binary), camera presets, UI, and FX are
  MIT (code/data). A catalog test enforces this mechanically. Updated the prior
  2A "all parts MIT" test accordingly.
- **Audio extends the SDK, never modifies it.** `LibraryAudioPlayer extends
  AudioPlayer` (SDK frozen, but its `audio.ts` explicitly reserves a stable
  `play(key)` for 2B to enrich). A game wires it via
  `createGame(..., { audio: new LibraryAudioPlayer() })`; every behavior's
  `world.audio.play(key)` then routes to richer synthesis. Adds
  `startMusic`/`stopMusic` for two generative chiptune loops. Subclass fields are
  named distinctly from the base's privates to avoid TS collision. **Zero binary
  audio**; everything no-ops with no `AudioContext` (jsdom/Node).
- **FX particles are short-lived entities, not a renderer change.**
  `explosion`/`sparkle` are event-driven SYSTEMS (attach a `world.events` listener
  exactly once per world via a module-level `WeakMap<World,Set>` — the listener
  fires synchronously inside the emitting behavior, so it spawns at the dying
  entity's still-live position); `trail`/`dust` are per-entity BEHAVIORS. All spawn
  particle entities carrying an internal **`particle`** behavior (self-contained
  motion + gravity + shrink-fade + **silent** destroy — it deliberately does NOT
  use `health-and-death`, whose death always plays a sound). `particle` is
  registered infra with no catalog part. Particle bursts use `world.rng` so they
  are deterministic under a seed.
- **Screen effects are a host-side controller, not a runtime system.** The frozen
  renderer draws in absolute coords with no camera, so `ScreenEffects`
  (shake/flash/fade) is a pure, deterministic controller the page applies to the
  canvas (`attachScreenEffects`); the `screen-*` fx parts are presets, register no
  runtime type, and their params are presentational literals (never validated, as
  they never enter a scene's behaviors/systems).
- **Camera presets are likewise host hints** (no SDK camera exists; renderer is
  absolute). `camera-fixed/follow/auto-scroll` are descriptor parts (MIT), category
  `world`; `auto-scroll` real scrolling is the existing 2A behavior.
- **FX/UI register on SEPARATE maps** (`registerLibraryFx`/`registerLibraryUi`,
  both called by `registerLibrary`) so the catalog's behavior/system-KIND coverage
  check stays exactly the 18+9 logic parts — FX/UI register runtime types but are
  catalogued as kind `fx`/`ui`. The code-backed UI widgets are `hud-bar` (drives a
  rect's width from `world.state[valueKey]/maxKey`) and `touch-dpad`/`touch-button`
  (read SDK Input pointers; pure helpers `dpadVector`/`buttonPressed` are unit-
  tested directly). Touch geometry uses nested whitelisted keys (`zone:{x,y,radius}`,
  `rect:{x,y,w,h}`) so templates pass the no-magic-numbers rule as structural.
- **Entities reference assets via the SDK `image`/`sheet` sprite `src`** (path
  `assets/…png`, resolved by the host page). A couple ship animated sheets
  (`player-blob` 2-frame idle, `coin` 4-frame spin) to exercise `sprite-animate`;
  the rest are single-frame images. Entity behavior balance is `$cfg`; structural
  fields (size/layer/position/sprite) are literals — same rule as 2A prototypes.
- **HUD text widgets need no code** — they are `text` sprites with a live `bind`
  to a `world.state` key (the SDK's frozen text feature). Only the health BAR needs
  the `hud-bar` behavior.
- **The re-skin proof is a NEW workspace member** `proofs/arena-reskin/` (additive;
  the 2A `arena-mobs` proof is left intact). It re-skins that demo with generated
  sprites (player-blob, enemy-chaser, coins), a starfield backdrop + space-tileset
  accents, the synthesized `LibraryAudioPlayer` + `action` music loop, and the
  `explosion`/`sparkle` particle systems + host screen-shake. Same four logic parts,
  same deterministic win outcome (verified headless). It is a Vite app for the
  visual check; its `public/assets/` is a build-time copy of the library assets
  (gitignored, recreated by a `sync-assets` script) — the canonical, shipped copy
  is `packages/library/assets/`.
- **The library tarball ships the assets.** `package.json#files` now includes
  `assets`, `scripts/gen-assets.ts` (reproducibility), `parts`, `dist`, and the
  catalog files. `npm pack --dry-run` = clean tarball, 120 files incl. all 27 PNGs
  (per the Library-distribution locked decision; human publishes v0.1.0 at the gate).
- **`tsx`/loaders avoided** — Node 22's built-in TypeScript stripping runs
  `gen-assets.ts` directly, so the library gains no new devDependency for the asset
  pipeline.

---

## Phase 3 — Seed Games — 2026-06-13

Scope this session: built six complete, polished seed games in `games/` (snake,
helicopter, breakout, tower-defense, idle-clicker, survival-arena), each composed
ONLY from `@gitcade/sdk@0.1.0` + `@gitcade/library@0.1.0` parts (pinned, resolved
from public npm — not workspace links), plus a minimal per-game custom part where a
mechanic genuinely had no catalog equivalent. Published all six + the scaffold as
standalone public repos in `gitcade-games`. SDK, library, examples, docs, and
`setup/` were left untouched. No CORE blockers; no SDK/library bugs found, so no
`[PUBLISH]` patch entries.

### What Phase 4 inherits
- **Six standalone public repos + a template repo** — URLs in `games/PUBLISHED.md`.
  Each builds from a clean clone against the npm SDK/library and passes
  `gitcade validate` (verified by copying each game outside the monorepo, `npm
  install`, `npm run build`, `npx gitcade validate .` — all green). The 4A worker
  reproduces exactly this path.
- **`games/LIBRARY-GAPS.md`** — six generalization candidates from the custom parts.

### Decisions / assumptions made this session (reversible unless noted)
- **One shared host shell, copied per game** (`src/host/shell.ts` `GameShell`). It
  owns the title→playing⇄paused→game-over state machine, the HTML menu overlays,
  the mobile pad, library audio + `ScreenEffects`, and a per-frame HUD-mirror hook.
  It is HOST GLUE, not game logic and not a custom behavior — the validated game is
  pure data + (optionally) one custom system. Each standalone repo carries its own
  copy (no monorepo import). The shell runs its OWN fixed-step loop (calling
  `game.update`/`game.render` directly, NOT `game.start()`) so pause freezes the
  simulation while still rendering the frozen frame, and `beforeFrame` can mirror
  e.g. player HP into a HUD key every frame.
- **Mobile touch = synthesized `KeyboardEvent`s.** On-screen DOM buttons dispatch
  real `keydown`/`keyup` (with `.code`) on `window`, which the SDK `Input` already
  listens to. This drives EVERY key-reading part (move-grid-step, move-4dir,
  move-platformer, shoot, the custom thrust) uniformly without touching the
  validated scene or adding the in-scene `touch-dpad` part (which sets velocity
  directly and would conflict with key movers). Tap-based games (tower-defense,
  idle-clicker) use canvas pointer events instead.
- **Storage adapter selection** (`src/host/storage.ts` `makeStorage`): `BridgeStorage`
  when embedded (`window.parent !== window`), else `MemoryStorage` (the dev-shim).
  ALL persistence (high scores via the library `score` system; idle offline progress
  in `idle-clicker/src/main.ts`) goes through `world.storage` — so it satisfies the
  no-raw-storage rule and works unchanged once Phase 4B implements the parent side
  of the bridge. Standalone it uses the in-memory shim (resets across reloads, by
  design); on the platform the bridge persists by `gameSlug + branch`.
- **The validator's no-raw-storage scan is a literal regex over ALL `.ts`/`.js`
  source — including comments.** The tokens `localStorage`/`sessionStorage`/
  `indexedDB` must not appear anywhere in source (they may appear in `.md`, which is
  not scanned). Host comments were worded to avoid them ("raw browser stores").
- **`part` provenance refs (`partId@1.0.0`) ARE used** in the seed scenes (the path
  DECISIONS reserved for "Phase 3 standalone-repo games"). The validator resolves
  them only against `node_modules/@gitcade/library/CATALOG.json` **in the game's own
  dir**, so the CLEAN CLONE (real npm install) is the authoritative validation gate.
  For fast in-monorepo iteration a correct `games/<g>/node_modules/@gitcade` symlink
  to `packages/{sdk,library}` is created by hand (npm hoists workspace links to the
  root `node_modules`, which the validator does not walk up to). That symlink lives
  under the gitignored `node_modules/` and is never committed.
- **Library art is synced, never committed.** `scripts/sync-assets.mjs` copies
  `node_modules/@gitcade/library/assets` → `public/assets` on `predev`/`prebuild`/
  `pretest`; `public/assets` is gitignored in each game (the art's canonical home is
  the pinned library). Vite copies `public/` into `dist/`, so the artifact ships the
  sprites. Library entities keep their PNG-sprite `src` paths (`assets/sprites/…`);
  Breakout's bricks use palette-coloured `shape` sprites (classic look, no asset
  dependency) while still composing the `health-and-death` part.
- **The validator deferral runs each game's `npm test`.** Because the seed scenes
  use library/custom parts the default SDK registry lacks, the validator's fast-path
  boot throws "unknown … type" and defers to `npm test` — so every game ships a
  headless smoke test booting on `createLibraryRegistry()` (+ custom registration)
  that exercises real gameplay deterministically.
- **`Game.loadScene` does NOT reset `world.events` listeners** (only entities +
  `world.state`). A custom system that re-attaches a listener on each run therefore
  double-counts after "Play again". Resolved by: Snake/idle systems POLL (no
  listener); tower-defense systems attach ONCE per `World` via a
  `WeakMap<World,Set>` (the same pattern the library FX parts use) and read live
  `world.state`. Recorded as a caveat for any LIBRARY-GAP promotion.
- **Tower Defense + Idle Clicker are 100% config-driven** — zero balance literals in
  any scene behavior/system params (validator-enforced by the no-magic-numbers rule,
  plus an explicit audit script). Custom-system numeric params are all `$cfg`; only
  structural keys (positions, sizes, layers, `tileSize`) are inline literals. Idle's
  custom `click-to-earn`/`auto-income`/`interval-bonus` and TD's `tower-build`/
  `creep-accounting` take every balance value from config.
- **Per-game custom parts (logged in LIBRARY-GAPS.md):** snake `snake-body`;
  helicopter `thrust-lift`; tower-defense `tower-build` + `creep-accounting`;
  idle-clicker `click-to-earn` + `auto-income` + `interval-bonus`. Breakout and
  Survival Arena needed NONE (pure library/SDK composition) — evidence the
  action-game library is complete and the gaps are in economy/control.
- **Game-over per game.** Most use `win-lose-conditions`/`timer-countdown`/
  `lives-respawn` (which set `world.state.gameOver` + emit `gameover`). Helicopter
  ends on a `trigger-zone` `crash` event (endless high-score game, no win). Idle
  Clicker has no natural game-over, so **prestige** is its game-over→retry: it banks
  the run, grants a permanent multiplier (persisted via the storage bridge), and
  restarts — satisfying the title/pause/game-over checklist honestly.
- **Repos published from clean clones**, not from inside the monorepo, so no nested
  `.git` is created under `games/` and the monorepo keeps tracking the game files
  normally. `.github/workflows` exist on none of the seven repos (locked: the
  platform pipeline is the CI). Scaffold marked `isTemplate: true`.

---

## Phase 4A — The Build Worker + Artifact Server — 2026-06-13

Scope this session: built two standalone services — `platform/worker/` (Postgres
queue consumer → sibling-container builds → S3/MinIO artifacts → Build rows) and
`platform/artifact-server/` (serves artifacts with the strict game CSP) — plus the
dedicated **builder image**. No web UI. SDK, library, games, examples, docs, and
`setup/` were left untouched. No CORE blockers; no BLOCKED.md entries. All six seed
repos build green through the CLI, a broken repo is rejected readably, and a real
browser plays a served game.

### What Phase 4B inherits (contracts — additive, do NOT migrate these tables)
- **Queue + Build schema** (`platform/worker/prisma/schema.prisma`): `BuildJob`
  (`id, gameSlug, repoUrl, branch, commit?, status[PENDING|RUNNING|DONE], attempts,
  claimedBy?, timestamps`) and `Build` (`id, jobId@unique, gameSlug, repoUrl,
  branch, commit?, tier?, status[SUCCESS|FAILED], stage, logs@Text, artifactPath?,
  fileCount?, timestamps`). Nothing references a 4B table, so 4B adds
  User/Game/PlaySession/etc. purely additively (e.g. a nullable `Game` relation off
  `BuildJob.gameSlug` later). Schema created with **`prisma db push`** (no migration
  history) — 4B may introduce migrations or keep pushing.
- **Enqueue contract**: `enqueueBuild({ repoUrl, branch?, commit?, gameSlug? })` in
  `src/queue.ts` — 4B calls this to enqueue and reads `Build` rows; **it never
  builds**. Per-(game,branch) DEDUP: a second active (PENDING/RUNNING) enqueue
  coalesces onto the existing job.
- **Artifact URL convention**: artifacts upload to bucket prefix
  `{manifest.slug}/{branch}` and serve at
  `{ARTIFACT_BASE_URL}/artifacts/{slug}/{branch}/{path}` (index.html at the root).
- **Storage headers**: the strict game CSP + content-types + cache live in
  `artifact-server/src/headers.ts` (single source of truth) — 4B's iframe must use
  `sandbox="allow-scripts"` against this opaque origin.

### Decisions / assumptions made this session (reversible unless noted)
- **Worker runs on the HOST for the CLI proof; ships ALSO as a container.** The
  `docker run` sibling-launch code is identical either way (both drive the same host
  daemon via the socket — that IS the "sibling" relationship, not DinD). Verified
  BOTH: host-run via the CLI (reaches Postgres/MinIO at `localhost`) AND the
  containerized topology (`docker-compose.yml`: attaches to `gitcade-infra_default`,
  reaches `db:5432`/`minio:9000` by service name, mounts `/var/run/docker.sock`) —
  the latter built `breakout` green. Networking is env-driven, so switching topology
  is a `.env` change, not a code change.
- **Two ephemeral sibling containers per build sharing ONE named volume**
  (`gitcade-ws-<jobId>`). Stage 1 on the default bridge (internet for clone+npm);
  Stage 2 with `--network none` (loopback only — which the OPEN-tier headless check
  uses to serve `/dist` to its own Chromium). The volume is destroyed after upload;
  containers are `--rm` and labeled `gitcade-build=<jobId>` (cleanup is asserted, not
  assumed). Resource/time limits via `--cpus`/`--memory`/timeout from env
  (defaults 2 CPU / 2g / 600s).
- **`/dist` is exported via `docker create` + `docker cp`** (not tar piping) — works
  identically whether the worker is a host process or a container (cp streams through
  the CLI). The worker reads `commit.txt` + `game.json` from the volume via throwaway
  `cat` containers.
- **Tier + manifest validation is WORKER-SIDE using the frozen SDK schema**
  (`GameManifestSchema` imported from `@gitcade/sdk`, the browser-safe entry). Gives
  readable manifest/license errors before the build container even starts, and yields
  the tier. The manifest `slug` is canonical for the artifact path (reconciled from
  the repo-derived queue slug — they match for compliant repos). NOTE: the frozen
  manifest schema requires `engine: "gitcade-sdk"` + an exact `sdkVersion` + an
  `entryPoint` **even for open tier** — an inherited Phase 1 constraint, not relitigated
  here; open games still skip `gitcade validate`/structure checks.
- **The builder image (`platform/worker/builder/Dockerfile`) is ~2.06 GB** (Node 22 +
  Debian `chromium` 149 + node-canvas build deps + global `puppeteer-core`). The
  worker image is ~1.79 GB. **Logged per the disk-hygiene rule — expected, not a
  blocker.** The verification tool image `minio/mc` (~30 MB) was also pulled.
  `apt-get` inside these Dockerfiles is image-build time (root in the build context),
  NOT the forbidden host `apt`.
- **OPEN-tier headless check** (`builder/headless-check.mjs`): serves `/dist` over
  loopback (works under `--network none`) and loads it in the bundled Chromium via
  `puppeteer-core` (resolved through `createRequire` anchored at
  `/usr/local/lib/node_modules` — ESM ignores the global path). Fails on any
  `console.error`/`pageerror`/`requestfailed`. It (and the artifact server) answer
  `/favicon.ico` with **204** so the browser's automatic favicon probe doesn't
  spuriously fail an otherwise-clean game. Verified end-to-end with a minimal
  open-tier game.
- **Strict game CSP** (`headers.ts`): `default-src 'none'`; `script-src/style-src
  'self' 'unsafe-inline'` (Vite emits an inline modulepreload polyfill — acceptable
  inside an opaque-origin, `connect-src 'none'` sandbox); `img/media 'self' data:
  blob:`; `connect-src 'none'`; `base-uri 'none'`; `form-action 'none'`;
  `frame-ancestors 'self' <PLATFORM_ORIGIN>`. Hashed assets `immutable`; HTML
  `no-cache`. Verified: a host-Chromium load of the served Snake renders the title +
  plays into Game-Over with **zero non-2xx responses**.
- **N-concurrency + dedup** (requirement 5): the poller (`worker start`) claims up to
  `WORKER_CONCURRENCY` PENDING jobs per tick with `FOR UPDATE SKIP LOCKED` (no
  double-claim across workers); the CLI `build` does a targeted atomic claim so a
  running poller can't steal its job. Demonstrated 3 concurrent builds (inFlight=3)
  and same-(game,branch) coalescing.
- **Services run via `tsx`** (no compile step; bin shims spawn `node --import tsx`) —
  they are internal, unpublished, and use the Prisma client + `@aws-sdk/client-s3`.
  `platform/worker/.env` (gitignored) holds `DATABASE_URL` only so the Prisma CLI
  (`db push`/`generate`) works without exporting it; the runtime loads the repo-root
  `.env` via dotenv and passes the URL to PrismaClient explicitly.
- **Broken-repo proof served LOCALLY, not published.** Creating a public GitHub repo
  was (correctly) out of scope, so the deliberately-broken game (Snake with a
  hardcoded `stepInterval: 9`, a no-magic-numbers violation) was served from a git
  daemon running **in a container** on the docker network (host `git daemon` can't
  bind a listening socket under the command sandbox). The worker did a real anonymous
  shallow clone and produced a readable rejection:
  `magic-number: numeric literal 9 under non-structural key "stepInterval" — move it
  to config.json and reference it as "$cfg.<key>"`. Exit 1, no artifact, workspace
  destroyed. The fixtures (git-server container, `/tmp/gitserve`) are not committed.
- **Tests**: artifact-server header-assertion test (8 cases — pure builders + real
  fetch of index.html + a JS asset through MinIO) and worker queue tests (slug
  derivation + per-(game,branch) dedup against the real queue). Both green.

---

## Phase 4B — Platform Site MVP (Publish + Play) — 2026-06-13

Scope this session: built `platform/web/` — a Next.js (App Router) + TypeScript +
Tailwind app with Prisma/Postgres + GitHub OAuth (NextAuth). Publish a public
GitHub game repo → enqueue a 4A build → poll the Build → live (validator is the
gate); play it in a sandboxed iframe implementing the PARENT side of the Phase 1
storage bridge; record PlaySession heartbeats + CommunityMembership. All six seed
games were published through the REAL flow and went LIVE; a broken game was
rejected with the worker's verbatim logs in the UI; the storage bridge round-trips
a save in a real browser. **One CORE blocker found in the frozen 4A artifact
server — see the `[CRITICAL]` entry in BLOCKED.md.** Frozen dirs
(`packages/`, `platform/worker`, `platform/artifact-server`, `games/`, `examples/`,
`setup/`, `templates/`) were left byte-identical (verified via `git status`).

### ⚠ CORE blocker raised (does NOT block the rest of 4B) — see BLOCKED.md `[CRITICAL]`
- The frozen `platform/artifact-server` serves no `Access-Control-Allow-Origin`.
  A game runs in `sandbox="allow-scripts"` (opaque origin → `origin: "null"`), and
  a Vite `<script type="module">` is fetched in CORS mode, so a null-origin
  document loading its module cross-origin from the artifact origin is BLOCKED.
  `Cross-Origin-Resource-Policy` (which the server does send) governs embedding,
  not module-script CORS, so it is insufficient. This is the FIRST time the locked
  opaque-origin embedding ran end-to-end (4A only tested a top-level artifact load,
  where scripts are same-origin). The one-line additive fix (`"Access-Control-
  Allow-Origin": "*"` in `artifact-server/src/headers.ts#artifactHeaders`) changes
  NO contract; I VERIFIED it is correct by serving the artifacts through a throwaway
  proxy that injects the header (non-frozen) and confirming the game renders + the
  storage bridge round-trips a save in a real browser. Filed CRITICAL (not
  self-patched) because the package is explicitly frozen this phase.

### What Phase 5 inherits (contracts + extension points)
- **Schema is a SUPERSET of 4A's**, created with `prisma db push` from
  `platform/web/prisma/schema.prisma`. It COPIES `BuildJob`/`Build`/enums VERBATIM
  (so push is a no-op for them) and adds, purely additively: NextAuth
  (`User`/`Account`/`Session`/`VerificationToken`), `Game`, `PlaySession`,
  `CommunityMembership`, and EMPTY placeholder `Proposal`/`Vote`/`BugReport` (Phase
  7 fills them). **No relation field was added onto `BuildJob`/`Build`** — `Game`
  links to its build via a plain `lastJobId String?` (Build.jobId is @unique), so
  the frozen tables stay untouched. Verified: BuildJob/Build columns byte-identical
  before/after push.
- **`Game`**: `slug @unique` (== manifest slug == artifact path prefix), `name`,
  `description`, `repoUrl`, `branch` (default main), `ownerId→User`, `tier`,
  `status` (BUILDING|LIVE|FAILED), `manifest` (Json snapshot), `tags String[]`,
  `lastJobId`, `parentGameId` (self-relation `GameForks`, nullable — **Phase 5 fork
  extension point**, already wired so forking is additive), `installationId`
  (GitHub App install for governance — **Phase 7**).
- **`PlaySession`** (userId nullable, gameId, branch, startedAt, durationSec) and
  **`CommunityMembership`** (@@unique[userId,gameId]) are populated and ready for
  Phase 7 anti-brigading (account-age + PlaySession + membership signals).
- **The publish service `publishGame()`** (`src/lib/publish.ts`) is the SINGLE
  shared code path — the `/api/publish` route AND the seed script both call it
  (never mocked). `refreshGameStatus()` reconciles Game status from the build and is
  the only place the LIVE/FAILED transition happens.
- **Parent storage bridge** (`src/lib/bridge.ts`, `ParentBridge` + exported
  `bridgeKeyPrefix`) implements the frozen Phase 1 protocol's parent half: matches
  `event.source === iframe.contentWindow` (NEVER origin — opaque iframes report
  "null"), completes the nonce handshake, replies with `targetOrigin "*"`, namespaces
  saves by `gameSlug + branch` (NUL separator). Phase 5 compare-play routes two
  channels by source identity using exactly this.

### Decisions / assumptions made this session (reversible unless noted)
- **The generated Prisma client lives at the hoisted root `node_modules/@prisma/
  client`** (npm workspaces). Running `prisma generate` from the web superset
  schema overwrites it, but the superset is a STRICT superset of the worker schema
  (BuildJob/Build/enums identical), so the frozen worker still resolves
  `prisma.buildJob`/`prisma.build` with identical shapes — both services share one
  client safely. If the worker's `prisma generate` is ever re-run it reverts to the
  worker-only client (fine for the worker, breaks the web); regenerate from the web
  schema (the superset) when in doubt. Reversible.
- **`enqueueBuild` is MIRRORED, not imported** (`src/lib/queue.ts`) — same
  `EnqueueInput`, same slug derivation, same per-(game,branch) dedup as
  `platform/worker/src/queue.ts`, but against the web Prisma client. The real
  interface between the services is the shared `BuildJob` table; the web writes
  byte-identical rows. A cross-package tsx import into the Next bundler is fragile,
  and the worker stays the ONLY builder. If the 4A enqueue contract ever changes,
  that is a CORE blocker (HALT), not a web edit.
- **`refreshGameStatus` gates on `BuildJob.status === "DONE"`, NOT the Build row's
  status.** The worker creates the Build row UP FRONT with a placeholder
  `status:"FAILED", stage:"queued"` and only finalizes it (and flips the job to
  DONE) when the build ends. Reading Build.status directly reports FAILED mid-build.
  **The integration test caught this** — fixed to read the job (include build) and
  treat non-DONE as BUILDING. *Load-bearing; do not revert.*
- **The manifest pre-check is an EARLY, cheap gate; the WORKER is the real gate.**
  Publish fetches `game.json` from raw.githubusercontent, validates it against the
  FROZEN `GameManifestSchema` (readable errors + the tier), enforces public-repos-
  only via the GitHub API (`private` → reject), then enqueues. A Game reaches LIVE
  only on Build SUCCESS — no manual override.
- **Saves persist in the PARENT page's `localStorage`** namespaced by
  `gameSlug + branch` (same-origin platform page; works for anonymous play).
  `localStorageBridgeStore` is swappable for a server-backed per-user cloud-save
  store WITHOUT touching the protocol — **extension point** noted in code.
- **Auth: explicit scopes `read:user user:email public_repo`** (public_repo
  REQUIRED now for Phase 5/6 token ops; never `admin:repo_hook`). NextAuth v4 +
  PrismaAdapter + **database sessions** — the GitHub access token is stored on the
  `Account` row by the adapter (`getUserGitHubToken(userId)` reads it). The GitHub
  `login` is captured into `User.githubLogin` for Phase 5 fork-slug naming.
- **Seed/admin user from env** (`SEED_USER_LOGIN`/`SEED_USER_EMAIL`, defaulted to
  `gitcade-admin`/`admin@gitcade.local` — not in `.env`, so defaulted and logged).
  The seed script (`scripts/seed.ts`) reads repo URLs from `games/PUBLISHED.md`
  (excludes the scaffold) and publishes each via `publishGame`; it decorates Games
  with demo `tags` (manifest has none) purely for the home-grid filter.
- **GitHub App install callback** (`/api/github/app/callback`) captures
  `installation_id` and attaches it to the Game via the `state=gameId` we pass in
  the install URL. Skippable at publish; the UI surfaces that Phase 7 proposals are
  disabled until installed.
- **`.js`-less relative imports in the web app** — Next/webpack does not resolve
  `./x.js` to `./x.ts`; intra-app relative imports are extensionless (unlike the
  SDK/worker ESM packages). `@gitcade/sdk` is `transpilePackages`'d. The SDK's
  guarded `FileStorage` dynamic import surfaces a harmless webpack "Critical
  dependency" warning in the client bundle — expected (noted in Phase 1 DECISIONS).
- **Env loading**: the web shares the repo-root `.env` (one secrets source).
  `src/lib/env.ts` loads it via dotenv (works in tsx/vitest), and `next.config.mjs`
  pre-loads it so the Next server process has it. A LOCAL `platform/web/.env` holds
  only `DATABASE_URL` for the Prisma CLI (mirrors `platform/worker/.env`); gitignored.
- **Next pinned to `14.2.33`** (patched; the initially-resolved 14.2.15 had a
  published security advisory).

### Tests (platform code is no longer exempt)
- **Unit (`npm test`, infra-free, 20 tests):** manifest parsing + tier gating
  (`manifest.test.ts`); publish service with GitHub+DB mocked — public-repo
  enforcement, readable manifest rejection, enqueue, idempotent re-publish, slug
  conflict (`publish.test.ts`); storage-bridge round-trip driving the REAL SDK
  `BridgeStorage` ↔ `ParentBridge` — handshake, namespacing, cross-game isolation,
  remove/clear scoping, source-identity rejection (`bridge.test.ts`).
- **Integration (`npm run test:integration`):** enqueue → worker → live against a
  LOCAL git-daemon fixture (a renamed copy of the snake game) — polls the real
  Build to SUCCESS, asserts Game LIVE + artifact served 200. **Requires the worker
  poller + artifact server running** (see below). This test caught the
  `refreshGameStatus` placeholder-row bug.

### How to run the services (for the integration test + manual verify)
From repo root, with Postgres + MinIO + the `gitcade-builder:local` image present:
1. Artifact server: `cd platform/artifact-server && npx tsx src/server.ts` (port 3001).
2. Worker poller: `cd platform/worker && npx tsx src/cli.ts start`.
3. Web: `npm --prefix platform/web run prisma:generate && npm --prefix platform/web run prisma:push`,
   then `npm --prefix platform/web run build && npm --prefix platform/web run start` (port 3000).
4. Seed the six games through the real flow: `npm --prefix platform/web run seed` (add `-- --wait` to block until built).

### Verification performed this session (REAL output, not assumed)
- **All six seed games published through the real `publishGame` → worker → LIVE**
  (not hand-inserted): seed script enqueued 6 jobs; worker built all 6 SUCCESS
  (30 files each, artifacts at `{slug}/main`); the build-status endpoint + Game rows
  report LIVE for all six.
- **Broken game rejected with the worker's readable errors in the UI**: a snake
  copy with a `stepInterval: 9` magic-number violation, served from a local
  git-daemon, enqueued through the real path → worker FAILED at `validate+build`;
  `GET /api/games/broken-demo/build-status` and the SSR game page render the
  verbatim log incl. `magic-number: numeric literal 9 under non-structural key
  "stepInterval" …`, and NO playable iframe. (Public-repo creation was out of scope/
  denied, so the broken fixture was local — same pattern as 4A's broken proof.)
- **Play + bridge + PlaySession in a real browser** (Chrome-for-Testing via
  puppeteer-core): loading `/games/idle-clicker` created a `PlaySession` row and
  accumulated `durationSec`; with the prescribed CORS fix applied via the throwaway
  proxy, the bridge handshook (`● connected`) and a SAVE round-tripped — parent
  `localStorage` gained `gc⟨NUL⟩idle-clicker⟨NUL⟩main⟨NUL⟩idleSave` = the real save
  JSON. Without the fix the game's module script is CORS-blocked (the `[CRITICAL]`).

---

## Phase 4B addendum — Artifact-server CORS patch (PM, 2026-06-14)

Applied the one-line fix the Phase 4B `[CRITICAL]` prescribed, clearing the only
open blocker. This is a PM-applied patch *between* phases, not a phase build.

- **`platform/artifact-server/src/headers.ts#artifactHeaders` now sends
  `Access-Control-Allow-Origin: "*"`.** Games play in `sandbox="allow-scripts"`
  iframes (opaque origin → `"null"`); ES `<script type="module">` is always fetched
  in CORS mode, so a null-origin document loading its own Vite entry/chunks
  cross-origin from the artifact origin was blocked without ACAO. `Cross-Origin-
  Resource-Policy` governs embedding, not module CORS — both are needed. Safe:
  artifacts are public, credential-free static bundles, and each game's CSP
  (`connect-src 'none'`) still blocks exfiltration.
- **No frozen contract changed** — CSP, content-types, cache policy, and the
  `{slug}/{branch}` URL convention are byte-identical. Non-contract bug fix per the
  patch-release protocol; the artifact server is a service (not a published npm
  package), so there is no version bump or game repin — it takes effect on restart.
- **Regression guard added** to `platform/artifact-server/tests/headers.test.ts`:
  the pure `artifactHeaders` builder test and the served-JS-asset test both assert
  ACAO `*`. Header suite green (8/8) against the real bucket.
- **Verified on the REAL path** (not a proxy this time): after restarting the
  artifact server, `idle-clicker/main/assets/index-BvhM1gEg.js` — the exact module
  that errored in the blocker — returns `200` + `Access-Control-Allow-Origin: *` +
  `Content-Type: text/javascript; charset=utf-8`. The Phase 4B "game playable
  in-browser" DoD item is now green on the shipped path, and Phase 5 branch/compare
  play is unblocked.

---

## Phase 5 — The Fork Engine — 2026-06-14

Scope this session: extended `platform/web/` ONLY with the five Phase 5 features
(fork button, branch switcher, fork tree, compare-play, app-level webhook receiver)
plus the reusable `ConfigDiff` component and a polling fallback. NO schema change
(the 4B `Game.parentGameId` self-relation was the pre-wired extension point —
forking is purely additive). Frozen dirs (`packages/`, `platform/worker`,
`platform/artifact-server`, `games/`, `examples/`, `setup/`, `templates/`) left
byte-identical (verified via `git status` from repo root: zero changes outside
`platform/web/`). No CORE blockers; no BLOCKED.md entries.

### The one load-bearing architecture decision (artifact-namespace collision)
- **The fork flow REWRITES the fork's `game.json` slug + name at fork time.** The
  FROZEN worker derives the artifact path from `manifest.slug` (`build.ts:170,197`
  → `{slug}/{branch}`), NOT the job's `gameSlug`. A git fork of `snake` keeps
  `slug:"snake"`, so without intervention its artifact would overwrite the parent's
  at `snake/main`. So `forkGame` (`src/lib/fork.ts`) commits a one-line manifest
  edit to the new fork — `slug → {original}--{username}`, `name → "Name (username's
  fork)"` — BEFORE enqueueing. This is the locked fork-naming convention made real
  (the SDK `SlugSchema` already allows `--` for exactly this), and it gives every
  fork a collision-free `{forkSlug}/{branch}` artifact namespace. VERIFIED no
  collision: after forking, parent `snake/main` still served 200 while the fork
  built to `snake--mufon609/main`. This is an additive data edit to the user's own
  repo (public_repo token), not a frozen-contract change.

### What Phase 6 inherits (contracts + extension points)
- **`forkGame(input)` (`src/lib/fork.ts`)** — the SHARED fork service (the `/api/fork`
  route AND `scripts/fork-demo.ts` both call it; never mocked). Flow, in this exact
  order: fork via the user's OAuth token → POLL the new repo until clonable
  (`waitForRepoReady`, exponential backoff ~30s cap — the fork API is async/202) →
  rewrite manifest slug+name → create the `Game` row (`parentGameId` set) → enqueue
  the build → return `{slug, timings}`. `forkSlug`/`forkDisplayName` are exported
  pure helpers (the naming convention, unit-tested). Phase 6's remix builds on this.
- **`ConfigDiff` is the reusable governance-grade diff** — `src/lib/configdiff.ts`
  is PURE (`diffConfigs(base, head)` → flattened dotted-leaf changes,
  `formatChange` → `"towerCost.arrow: 50 → 30"`), framework-free, unit-tested; the
  `src/components/ConfigDiff.tsx` React renderer takes either raw config blobs or a
  precomputed change list. The fork tree and compare view both render it; Phase 7
  governance turns a passed config proposal INTO exactly this diff. KEEP the logic
  in the lib so the renderer and the governance engine cannot drift.
- **Fork tree** — `src/lib/lineage.ts#getLineage(slug, token?)` walks `parentGameId`
  up (cycle-guarded, depth cap 32) and direct forks down, annotating each fork edge
  with `computeForkDiff` (GitHub compare API → changed-files count; if `config.json`
  changed, fetch both and inline the value diffs). Served by
  `GET /api/games/[slug]/lineage`; rendered client-side by `ForkTree.tsx`. Diffs are
  LIVE GitHub calls (degrade gracefully) — reversible: Phase 6/7 may cache a config
  snapshot on the `Game` row to avoid them.
- **Branch switcher** — `src/lib/branches.ts#listGameBranches` derives playable
  branches from `Build` rows (LIVE = SUCCESS at `{slug}/{branch}`; FAILED/BUILDING
  shown disabled; `?repo=1` adds never-built repo branches via GitHub). Served by
  `GET /api/games/[slug]/branches`; `GamePlayer.tsx` swaps the iframe artifact per
  branch. Owners can build an unbuilt branch via `POST /api/games/[slug]/branches/build`.
- **Compare-play** — `/compare?a=<slug>&ab=<branch>&b=<slug>&bb=<branch>` (URL-
  shareable; `b=__parent__` resolves to A's parent). Two `PlayPane`s, each with its
  OWN `ParentBridge` bound to its iframe.contentWindow — isolation is by source
  identity (NOT origin) AND by `gameSlug+branch` namespace. `PlayPane.tsx` is the
  extracted single-pane player (iframe + bridge + heartbeat) the game page and
  compare both use (the old `GameFrame.tsx` was subsumed and deleted).
- **App-level webhook** — `POST /api/webhooks/github` verifies `X-Hub-Signature-256`
  (HMAC over the RAW body, `verifyGithubSignature`, fails closed on empty secret),
  parses the push (`parsePushEvent`), maps repo→Game(s) by owner/repo identity, and
  enqueues a rebuild of the PUSHED branch (`processPushEvent`). ONE endpoint, the
  App owns it — NO per-repo hook, NO `admin:repo_hook` scope. `ping` → pong;
  non-push/non-branch → ignored 200. Local dev: `npm run webhook:proxy`
  (`scripts/webhook-proxy.ts`) forwards the smee.io channel (`WEBHOOK_PROXY_URL`) to
  the route.
- **Polling fallback** — `src/lib/poll.ts#pollTrackedRepos({token?})` compares each
  tracked (game, branch)'s GitHub HEAD to the last built commit and enqueues on
  drift (`shouldRebuild` is the pure, unit-tested decision). Covers open-tier repos
  without the App + tunnel downtime. Runner: `npm run poll [--watch]`
  (`scripts/poll-repos.ts`); a token is recommended (anonymous GitHub = 60 req/hr).

### Decisions / assumptions made this session (reversible unless noted)
- **No new env keys required.** Added `githubWebhookSecret` + `webhookProxyUrl` to
  `src/lib/env.ts` reading the EXISTING `.env` keys (`GITHUB_WEBHOOK_SECRET`,
  `WEBHOOK_PROXY_URL`) as `optional("")` — an empty secret makes webhook verify fail
  CLOSED (reject every delivery) rather than throwing app-wide at import.
- **`artifact-url.ts` is a new client-safe pure URL builder** split out of
  `artifact.ts` (which reads server-only env) so the branch switcher + compare panes
  compute per-branch artifact URLs without dragging dotenv into the browser bundle.
  `artifact.ts` now delegates to it (one URL convention, no drift).
- **Fork is per-(repo,user) idempotent.** GitHub's fork endpoint returns the
  existing fork on a re-fork; `forkGame` upserts the `Game` row by the deterministic
  fork slug and skips the manifest commit when unchanged — re-forking is safe.
- **Webhook rebuilds the PUSHED branch, not the game's tracked branch.** A push to
  any branch of a tracked repo refreshes THAT branch's artifact (so branch-switcher
  branches stay current). `enqueueBuild`'s per-(game,branch) dedup coalesces rapid
  pushes — unchanged 4A/4B contract.
- **`fork-demo.ts` / `td-compare-setup.ts` are server-side verification drivers**
  (a script cannot do browser OAuth — same pattern as 4B's seed script): they read
  `gh auth token`, upsert a `User`+github `Account` for the gh login, and drive the
  REAL `forkGame` / GitHub-helper code paths. The created fork repos live under the
  gh-authenticated account `mufon609` (`mufon609/{snake,idle-clicker,tower-defense}`)
  — recorded here per the "record what you created" rule. No secrets were committed
  to any repo; no `.github/workflows` created on any repo (locked).

### Verification performed this session (REAL round trips, not just DB rows)
- **Fork → playable under 10s (DoD):** `forkGame(snake)` as `mufon609` →
  fork+ready+rewrite+enqueue in **~2.0s**; worker built `snake--mufon609@main`
  SUCCESS (30 files) in **6s** → **~8s total click→playable**. Browser (Chrome-for-
  Testing): `/games/snake--mufon609` renders the game `<canvas>` 800×600 IN-IFRAME
  (the opaque-origin module executes via the CORS patch); `idle-clicker--mufon609`
  additionally reached storage-bridge **● connected** (real handshake + `get(idleSave)`
  round-trip on the fork). NO artifact collision: parent `snake/main` still 200.
- **Compare two rebalanced Tower Defense branches, URL-shareable (DoD):** built
  `tower-defense--mufon609` branches `cheap-towers` (towerCost 50→30, dmg 22→30) and
  `dear-towers` (towerCost 50→90, dmg 22→14, startGold 220→300). `/compare?a=…&ab=cheap-towers&b=…&bb=dear-towers`
  loads BOTH panes rendering their canvas, shows the `config.json` ConfigDiff
  (`towerCost …`), and proved **save ISOLATION** (a save under `cheap-towers`'s
  namespace is invisible under `dear-towers`'s).
- **Push → auto-rebuild (DoD), BOTH paths:** (a) webhook — a real HMAC-signed push
  to `/api/webhooks/github` matched `snake--mufon609`, enqueued a rebuild → SUCCESS;
  a tampered signature → 401; ping → pong. (b) polling fallback — pushed a REAL
  commit to `cheap-towers` (HEAD `49d6227→8fff850`); `npm run poll` detected the
  drift among 11 targets, enqueued exactly 1 rebuild, which built SUCCESS at the new
  commit `8fff850`.
- **Tests:** 16 new unit tests (configdiff, webhook verify/parse, fork naming,
  poll decision) — full web suite **43/43 green**. `next build` compiles all new
  routes/components; `git status` confirms zero changes outside `platform/web/`.
