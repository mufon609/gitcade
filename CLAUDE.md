# CLAUDE.md — GitCade Operating Contract

You are working on **GitCade**: a platform where AI-built, open-source browser
games are published, played, forked, and remixed by the community.
The v1 build is complete — this file tells you *how to operate* on the existing
codebase. Read it, read [README.md](./README.md) for what the system is, then
act.

> The original phase-by-phase build plan, the full decision log, the machine
> contract, and the blocker log are archived under
> [`setup/archive/`](./setup/archive/) (`MASTER-PLAN.md`, `DECISIONS.md`,
> `ENVIRONMENT.md`, `BLOCKED.md`). They are history, not active instructions —
> consult them to understand *why* something is the way it is, but the codebase
> is the source of truth now.

---

## The machine (read before running anything)

This is a single-user Kali Linux dev box, **no GPU**. The full machine contract
lives in [`setup/archive/ENVIRONMENT.md`](./setup/archive/ENVIRONMENT.md); the
rules that still bite:

1. **Never run `sudo` or `apt`.** Everything system-level is pre-installed
   (Node 22 via nvm, Docker, `gh` already authenticated, build toolchain). If
   something system-level is genuinely missing, stop and say so — do not try to
   install it.
2. **Postgres and MinIO are always-on Docker containers**, loopback-bound:
   `postgresql://gitcade:gitcade@localhost:5432/gitcade` and
   `http://localhost:9000` (keys `gitcade` / `gitcade-secret`). Use them freely.
3. **No GPU.** Headless browser work uses the Playwright-managed
   Chrome-for-Testing exposed as `chromium` on PATH (the shim forces software
   GL). The Kali `chromium` apt package is uninstallable here — don't try.
4. **Ports:** 3000 web, 3001 artifact server, 5432 Postgres, 9000/9001 MinIO.
   Bind new dev services to loopback on 3002+; check before binding.
5. **S3 client must honor `S3_FORCE_PATH_STYLE`** — `true` for MinIO, `false`
   for real S3. Hardcoding either breaks the other.
6. **The build worker runs builds as SIBLING containers** (mounts the host
   Docker socket), never Docker-in-Docker. Two traps inside containers:
   `localhost` is not the host (address infra by service name on the compose
   network, or `--network host`), and `-v` paths resolve on the *host* (share
   build workspaces via named volumes). See `setup/archive/ENVIRONMENT.md` before touching the
   worker's container plumbing.
7. **`.env`, `*.pem`, and `setup/secrets/` are secret and gitignored.** Never
   commit them; never invent values for external services — if an env key is
   missing, surface it rather than guessing.

---

## Frozen contracts — improve them deliberately, never silently

`@gitcade/sdk` and `@gitcade/library` are **published packages**. The SDK schema
(the `game.json` / `config.json` / scene / entity / behavior / system shapes), the
published exported API, the storage-bridge postMessage protocol, the validator's
rules, and the artifact-server's URL convention + headers are **load-bearing**:
six standalone game repos, every user fork, and the build worker pin specific
versions of them. "Frozen" means *consumers depend on these, so a change to them
is a versioned, visible event* — **not** that they are unimprovable. A cleaner,
faster, or simpler contract is a real improvement worth making; the discipline is
to do it **deliberately and in the open**, never to drift behavior silently under
a bug-fix.

**The release protocol — pick the smallest tier that fits, and surface the cost:**
- A change that keeps the **same observable behavior** — no change to a schema
  shape, exported type, signature, param shape, message protocol, header, return
  shape, or result ordering; whether a bug fix OR an internal rewrite that makes a
  primitive faster or cleaner behind the identical surface — is a **PATCH**. No
  hesitation: fix it, bump the patch version, run `npm pack --dry-run`, and note a
  republish + consumer repin is needed. (Exactly how `sdk@0.1.1` / `library@0.1.1`
  shipped.)
- An **additive** change — a NEW *optional* schema field, a new optional SDK
  method, a new behavior/system part, or new *optional* params on an existing
  part — is sanctioned as a **MINOR** bump. Old games stay byte-valid (they never
  set the new field / never pass the new param), so there is no silent break. A
  part that gains optional params bumps its **own** semver (e.g. `wave-spawner`
  `1.0.0 → 1.1.0`) and consumers repin to the new part version. This is how
  `sdk@0.6.0` / `library@0.6.0` shipped scene `extends`, the manifest `levels`
  sequence, and the level-aware `wave-spawner` density ramp.
- A change that **reshapes or removes** a frozen shape (renames/retypes a field,
  changes a signature, alters the message protocol or header convention, changes
  **result ordering**, or changes the **tick order**) is a legitimate improvement
  when it is the cleanest long-term answer — **do not contort the internals to
  avoid it.** But it breaks anything pinned to the old version, and forks /
  already-published games cannot be migrated from this repo, so treat it as the
  breaking change it is: prefer an additive or internal path when one is *equally*
  clean; otherwise design it as a **MAJOR** bump, migrate every in-repo consumer
  (`games/`, `packages/library/proofs/`, `examples/`, the worker), and **flag the
  break + migration + version bump prominently** in your summary. You do not need
  permission to design and build it — a reshape in the working tree is reversible,
  and the outward-facing step, **publish, is already human-gated** (that is where
  the fork / published-game impact is weighed). The one thing forbidden is shipping
  changed behavior **silently** under a patch, where pinned consumers break
  invisibly. **Determinism is the hard line:** result ordering and tick order feed
  byte-replay, so changing them breaks replays/ghosts for *everyone*, not just
  version-pinned consumers — they may change, but only as a surfaced, deliberate
  MAJOR, never slipped in.
- The worker queue schema (`BuildJob` / `Build` in `platform/worker`) is
  likewise frozen — `platform/web` extends the database **additively** and never
  reshapes those tables.

**Authored layout is scene data, not config.** A multi-level game shares its
stage via scene **`extends`** (the common shell — entities, systems, HUD, flow —
authored ONCE; each level is a thin override of its own layout + a `$cfg`
difficulty slice). Do NOT express levels as duplicated full scenes (the old
Breakout L1/L2/L3), and do NOT push per-level *layout* into `config.json` —
`config.json` stays **balance-only** (the numbers the validator forces off
`$cfg`). Difficulty that scales with the stage rides `world.state.level`, which
the runtime sets to the 1-based index of the active `manifest.levels` entry, so
`scale-by-state` / `wave-spawner` density ramps track the stage for free.

When in doubt about whether something is a contract: treat it as one.

---

## How to run and verify

- **Build everything:** `npm run build` (runs `build` in every workspace).
- **Test everything:** `npm test` (every workspace's Vitest suite). Run the
  suite for the package you touched, not just the root, and paste real output —
  don't claim green you didn't see.
- **Validate a game:** `gitcade validate <dir>` (or `npm run validate:pong`,
  `npm run validate:proofs`). Exit 0 = publishable. This is the same gate the
  platform enforces; if a game change passes locally it'll pass on publish.
- **Run the platform:** see README.md → Quick start. Web on :3000, artifact
  server on :3001, worker consuming the Postgres queue. `platform/web` has demo
  scripts (`npm run fork-demo`, `remix-demo`, `part-upload-demo`) that exercise
  the major flows end-to-end without the UI.
- **See a change in the real browser:** use the `chromium` shim (headless, or
  headed to watch — an X11 session is present). For UI/play verification this
  beats asserting from code.

A change is done when its tests pass, the relevant `gitcade validate` /
Lighthouse / header checks pass, and you've verified the behavior — not assumed
it. If something is incomplete, say so plainly and list what remains.

---

## Working style

- **Keep changes scoped.** This is a layered system; don't refactor a
  neighboring service while fixing one. A platform bug is fixed in `platform/`;
  an SDK bug follows the patch-release protocol.
- **Games are data.** Balance numbers belong in `config.json` (referenced as
  `$cfg.key`), never hardcoded — the validator enforces this, and it's what makes
  a rebalance a one-line diff. Parts are referenced as `partId@version`.
- **Comment the non-obvious**, especially anything touching a frozen contract,
  the storage bridge, or the build worker's container plumbing.
- **Match the surrounding code** — its naming, structure, and comment density.
- **On a wall:** core-path blockers (database, build/validation pipeline,
  artifact storage/serving, auth, a frozen SDK/queue contract) halt loudly with
  the exact failure and the precise human action needed — never mock the
  foundation. Peripheral blockers are routed around behind a marked interface.
  Halting is cheap; a fake foundation is never worth it.
- **Confirm anything hard to reverse or outward-facing** (publishing a package,
  pushing to a game repo, a takedown, a destructive migration) before doing it;
  approval in one context doesn't carry to the next.
