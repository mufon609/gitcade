// tools/release/policy.mjs — the ONE source of truth for package ROLE → pin POLICY.
//
// Every workspace package's @gitcade/* pins are determined by its ROLE, and role is
// DERIVED FROM PATH (paths are unambiguous, so there is no per-package data file to
// drift). The ONE fact not derivable from path or the current core versions —
// @gitcade/library's @gitcade/sdk compatibility FLOOR — is the single explicit
// constant {@link SDK_PEER} below. A human widens it only on a real compat decision
// (e.g. an SDK MAJOR); everything else follows automatically.
//
// This module is PURE + root-parameterized (every reader takes a `root`, default the
// repo root) so the release commands AND the tests run the identical logic — the tests
// point it at temp fixtures. No file writes happen here; the `sync` command does I/O.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The ONLY non-derivable policy value: @gitcade/library's declared @gitcade/sdk
 * compatibility floor, as a caret range. library@1.10.x is additively compatible with
 * any sdk in [1.10.0, 2.0.0), so the peer is `^1.10.0` — NOT a narrow `1.10.x` that a
 * later SDK MINOR (1.11.0) would fall outside of. `doctor` verifies the current sdk
 * still satisfies this; if an SDK MAJOR ever lands, it fails loud so a human re-decides.
 */
export const SDK_PEER = "^1.10.0";

export const GITCADE_DEPS = ["@gitcade/sdk", "@gitcade/library"];
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];

const toPosix = (p) => p.split(path.sep).join("/");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/**
 * CLOSED role classifier over the known workspace roots. THROWS on any package whose
 * path matches none — it never silently defaults to "internal", so a new or moved
 * package fails loud (caught + reported by `doctor`) until it is classified here.
 *   core     = the published engine packages (sdk, library)
 *   game     = a published game artifact (frozen, pins exact versions)
 *   internal = never-published (proofs, platform services, examples, templates)
 */
export function roleOf(relDir) {
  const d = toPosix(relDir);
  if (d === "packages/sdk" || d === "packages/library") return "core";
  if (d.startsWith("packages/library/proofs/")) return "internal";
  if (d.startsWith("games/")) return "game";
  if (d.startsWith("platform/") || d.startsWith("examples/") || d.startsWith("templates/")) return "internal";
  throw new Error(`unclassified workspace package "${d}" — add it to roleOf() in tools/release/policy.mjs (closed classifier; no silent default)`);
}

/** Current core versions — the human-set source of truth the consumers must match. */
export function coreVersions(root = REPO_ROOT) {
  return {
    sdk: readJson(path.join(root, "packages/sdk/package.json")).version,
    library: readJson(path.join(root, "packages/library/package.json")).version,
  };
}

/** The generated catalog's version (must equal the library package version). */
export function catalogVersion(root = REPO_ROOT) {
  return readJson(path.join(root, "packages/library/CATALOG.json")).version;
}

/** Enumerate workspace member dirs (relative, posix) from the root package.json `workspaces` globs. */
export function listPackageDirs(root = REPO_ROOT) {
  const ws = readJson(path.join(root, "package.json")).workspaces ?? [];
  const dirs = new Set();
  for (const glob of ws) {
    if (glob.endsWith("/*")) {
      const base = path.join(root, glob.slice(0, -2));
      if (!fs.existsSync(base)) continue;
      for (const name of fs.readdirSync(base)) {
        const abs = path.join(base, name);
        if (fs.statSync(abs).isDirectory() && fs.existsSync(path.join(abs, "package.json"))) dirs.add(toPosix(path.relative(root, abs)));
      }
    } else if (fs.existsSync(path.join(root, glob, "package.json"))) {
      dirs.add(toPosix(glob));
    }
  }
  return [...dirs].sort();
}

/**
 * The expected @gitcade/* package.json pin VALUES for a role:
 *   internal → "*"      (always resolve the local workspace; never the registry)
 *   game     → EXACT current sdk + library  (a published artifact is frozen)
 *   core     → library's @gitcade/sdk peer+dev = the {@link SDK_PEER} caret (sdk itself has none)
 */
export function expectedPins(role, versions) {
  if (role === "internal") return { "@gitcade/sdk": "*", "@gitcade/library": "*" };
  if (role === "game") return { "@gitcade/sdk": versions.sdk, "@gitcade/library": versions.library };
  if (role === "core") return { "@gitcade/sdk": SDK_PEER };
  throw new Error(`no pin policy for role "${role}"`);
}

/** Byte-preserving: rewrite ONLY the value of each `"@gitcade/*": "..."` entry (every section). */
export function repinText(text, role, versions) {
  let out = text;
  for (const [dep, val] of Object.entries(expectedPins(role, versions))) {
    out = out.replace(new RegExp(`("${dep}"\\s*:\\s*)"[^"]*"`, "g"), `$1"${val}"`);
  }
  return out;
}

/** Byte-preserving: rewrite a game.json's sdkVersion / libraryVersion to the current core versions. */
export function repinGameManifest(text, versions) {
  return text
    .replace(/("sdkVersion"\s*:\s*)"[^"]*"/, `$1"${versions.sdk}"`)
    .replace(/("libraryVersion"\s*:\s*)"[^"]*"/, `$1"${versions.library}"`);
}

/** Does `version` fall inside a `^X.Y.Z` caret range? (Minimal — only carets, which is all the policy uses.) */
export function caretIncludes(version, range) {
  if (typeof range !== "string" || !range.startsWith("^")) return false;
  const v = version.replace(/^[^0-9]*/, "").split(".").map(Number);
  const r = range.slice(1).split(".").map(Number);
  if (v[0] !== r[0]) return false; // caret (major ≥ 1): same major
  if (v[1] !== r[1]) return v[1] > r[1]; // higher minor included
  return v[2] >= r[2]; // same minor → patch at/above floor
}

/**
 * Compute the file repins the repo NEEDS to be policy-clean — a PURE diff (no writes).
 * Returns `[{ path, before, after }]` for every package.json / game.json whose pinned
 * values are off-policy. Empty ⇒ already clean (so `sync` is a no-op). Drives both the
 * `sync` fixer and its idempotency test.
 */
export function computeRepins(root = REPO_ROOT) {
  const versions = coreVersions(root);
  const out = [];
  const diff = (rel, transform) => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) return;
    const before = fs.readFileSync(p, "utf8");
    const after = transform(before);
    if (before !== after) out.push({ path: rel, before, after });
  };
  for (const dir of listPackageDirs(root)) {
    const role = roleOf(dir); // throws on unknown (sync surfaces it)
    diff(`${dir}/package.json`, (t) => repinText(t, role, versions));
    if (role === "game") diff(`${dir}/game.json`, (t) => repinGameManifest(t, versions));
  }
  return out;
}

/**
 * The full read-only audit: the role-classified pin matrix + every invariant violation.
 * Issues carry the fix command. Pure (root-parameterized) so tests run it on fixtures.
 */
export function auditPackages(root = REPO_ROOT) {
  const versions = coreVersions(root);
  const cat = catalogVersion(root);
  const rows = [];
  const issues = [];
  const fail = (pkg, msg) => issues.push({ pkg, msg, fix: "release:sync" });

  // Catalog ↔ library version.
  if (cat !== versions.library) fail("packages/library/CATALOG.json", `catalog.version "${cat}" !== library version "${versions.library}"`);

  for (const dir of listPackageDirs(root)) {
    let role;
    try {
      role = roleOf(dir);
    } catch (e) {
      issues.push({ pkg: dir, msg: e.message, fix: "classify it in roleOf()" });
      continue;
    }
    const pkg = readJson(path.join(root, dir, "package.json"));
    const pins = {};
    for (const sec of DEP_SECTIONS) for (const dep of GITCADE_DEPS) if (pkg[sec]?.[dep]) pins[`${sec}.${dep}`] = pkg[sec][dep];
    rows.push({ dir, role, pins });

    if (role === "internal") {
      for (const [k, v] of Object.entries(pins)) if (v !== "*") fail(dir, `${k} = "${v}" — internal packages must pin @gitcade/* as "*"`);
    } else if (role === "game") {
      const dep = pkg.dependencies ?? {};
      if (dep["@gitcade/sdk"] !== versions.sdk) fail(dir, `dependencies.@gitcade/sdk = "${dep["@gitcade/sdk"]}" — game must pin exact "${versions.sdk}"`);
      if (dep["@gitcade/library"] !== versions.library) fail(dir, `dependencies.@gitcade/library = "${dep["@gitcade/library"]}" — game must pin exact "${versions.library}"`);
      const gjPath = path.join(root, dir, "game.json");
      if (fs.existsSync(gjPath)) {
        const gj = readJson(gjPath);
        if (gj.sdkVersion !== versions.sdk) fail(`${dir}/game.json`, `sdkVersion "${gj.sdkVersion}" !== sdk "${versions.sdk}"`);
        if (gj.libraryVersion !== versions.library) fail(`${dir}/game.json`, `libraryVersion "${gj.libraryVersion}" !== library "${versions.library}"`);
        if (gj.libraryVersion !== cat) fail(`${dir}/game.json`, `libraryVersion "${gj.libraryVersion}" !== catalog "${cat}" (validator enforces this for part: refs)`);
      }
    } else if (dir === "packages/library") {
      const peer = pkg.peerDependencies?.["@gitcade/sdk"];
      const dev = pkg.devDependencies?.["@gitcade/sdk"];
      if (peer !== SDK_PEER) fail(dir, `peerDependencies.@gitcade/sdk = "${peer}" — must be "${SDK_PEER}"`);
      if (dev !== SDK_PEER) fail(dir, `devDependencies.@gitcade/sdk = "${dev}" — must be "${SDK_PEER}"`);
      if (!caretIncludes(versions.sdk, SDK_PEER)) fail(dir, `SDK_PEER "${SDK_PEER}" excludes current sdk "${versions.sdk}" — widen SDK_PEER in policy.mjs (a human compat decision)`);
    }
  }
  return { versions, catalog: cat, rows, issues };
}

/**
 * Resolve whether `publish` should run as a DRY-RUN. Publish is SAFE BY DEFAULT: it
 * mutates ONLY when `--yes` is explicitly passed AND no dry-run signal is present.
 *   - `npm run release:publish`                 → dry-run (no --yes)
 *   - `npm run release:publish --dry-run`       → dry-run (npm swallows --dry-run → npmDryRun)
 *   - `npm run release:publish --yes`           → dry-run (npm swallows --yes; the script never sees it)
 *   - `npm run release:publish -- --dry-run`    → dry-run (explicit)
 *   - `npm run release:publish -- --yes`        → REAL  (the only way to actually publish)
 * A dry-run signal always WINS over `--yes`, so `-- --yes --dry-run` is still a rehearsal.
 */
export function resolveDryRun({ dryRun = false, yes = false, npmDryRun = false } = {}) {
  return dryRun || npmDryRun || !yes;
}

/**
 * Plan the npm-publish step per publishable package, reading EACH package's OWN version
 * independently (no single-`<v>` lockstep). A version already live on npm is SKIPPED
 * (idempotent/resumable). `isLive(name, version) → boolean` is injected so tests can mock it.
 */
export function planNpmPublish(pkgs, isLive) {
  return pkgs.map((p) => ({ ...p, action: isLive(p.name, p.version) ? "skip" : "publish" }));
}

/**
 * Execute a publish plan. `exec(cmd, args)` runs a mutating command — injected so a test
 * can record calls. In `dryRun` mode NOTHING mutating runs (exec is never called); skips
 * are no-ops. Returns the names actually published.
 */
export function runNpmPublish(steps, { dryRun = false, exec, log = () => {} } = {}) {
  const published = [];
  for (const s of steps) {
    if (s.action === "skip") {
      log(`skip ${s.name}@${s.version} — already on npm`);
      continue;
    }
    if (dryRun) {
      log(`dry-run: would npm publish ${s.name}@${s.version}`);
      continue;
    }
    exec("npm", ["publish", "-w", s.name]);
    log(`published ${s.name}@${s.version}`);
    published.push(s.name);
  }
  return published;
}
