#!/usr/bin/env node
// Sync each monorepo game into its standalone `gitcade-games/<slug>` repo, then
// (by default) re-verify from the clean clone against PUBLIC npm and push.
//
// The standalone repos are the artifact source for the build worker: each holds
// ONLY that game and builds against `@gitcade/sdk` + `@gitcade/library` from public
// npm. This mirrors the monorepo's COMMITTED game source into them (via
// `git archive`, so no dist/node_modules/stray build output leaks), updates the
// lockfile, re-runs build + `gitcade validate` exactly as a consumer would, then
// commits + pushes only if something changed.
//
// Usage:
//   node tools/release/sync-game-repos.mjs [--only=snake,helicopter]
//                                          [--message="..."] [--dry-run]
//                                          [--no-verify] [--no-push]
//
// Requires: git, rsync, and `gh`/ssh push access to the gitcade-games org.
// Prereq: the pinned @gitcade/* versions must already be LIVE on npm (run the npm
// publish phase first) or the clean-clone `npm install` verify will fail.

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, ORG, log, parseArgs, selectGames, run, has, workdir } from "./lib.mjs";

const args = parseArgs();
const games = selectGames(args.only);
const message = args.message ?? "chore: sync 0.3.2 from monorepo (repin + engine-capability adoption)";

if (!has("git") || !has("rsync")) {
  log.err("git and rsync are required");
  process.exit(1);
}

const root = workdir();
const results = [];

for (const slug of games) {
  log.banner(`${slug} → ${ORG}/${slug}`);
  const clone = path.join(root, slug);
  const stage = path.join(root, `${slug}.src`);
  try {
    // 1. Fresh clone (cheap; avoids stale local state).
    fs.rmSync(clone, { recursive: true, force: true });
    run("git", ["clone", "--quiet", `git@github.com:${ORG}/${slug}.git`, clone]);

    // 2. Export the monorepo's COMMITTED game source (tracked files only) and
    //    rsync it over the clone, deleting removed files but PRESERVING the repo's
    //    .git and package-lock.json (the lock is refreshed by the verify step).
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    run("bash", ["-c", `git -C "${REPO_ROOT}" archive HEAD:games/${slug} | tar -x -C "${stage}"`]);
    // --checksum (NOT the default size+mtime quick-check): a version bump (0.3.1 →
    // 0.3.2) and same-line-count edits (e.g. a behavior REORDER) are byte-size-
    // identical, and git-archive mtimes are older than the fresh clone's, so the
    // mtime heuristic would silently skip those exact changes. Compare by content.
    run("rsync", ["-a", "--checksum", "--delete", "--exclude=.git", "--exclude=package-lock.json", `${stage}/`, `${clone}/`]);

    // 3. Re-verify from the clean clone against PUBLIC npm (install → build →
    //    validate), exactly the consumer/build-worker path. This also refreshes
    //    package-lock.json to the new pins.
    if (!args.noVerify) {
      log.note("npm install (resolves @gitcade/* from public npm)…");
      run("npm", ["install", "--no-audit", "--no-fund"], { cwd: clone });
      log.note("npm run build…");
      run("npm", ["run", "build"], { cwd: clone });
      log.note("gitcade validate .");
      run("npx", ["gitcade", "validate", "."], { cwd: clone });
      log.ok("clean-clone verify passed");
    }

    // 4. Commit only if something changed; push unless held.
    run("git", ["add", "-A"], { cwd: clone });
    const dirty = run("git", ["status", "--porcelain"], { cwd: clone, capture: true }).stdout.trim();
    if (!dirty) {
      log.ok("no changes — repo already up to date");
      results.push({ slug, status: "unchanged" });
      continue;
    }
    if (args.dryRun) {
      log.warn(`dry-run: would commit + push:\n${dirty.split("\n").map((l) => "      " + l).join("\n")}`);
      results.push({ slug, status: "dry-run" });
      continue;
    }
    run("git", ["commit", "--quiet", "-m", `${message}\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`], { cwd: clone });
    if (args.noPush) {
      log.ok("committed (push held by --no-push)");
      results.push({ slug, status: "committed" });
      continue;
    }
    run("git", ["push", "--quiet", "origin", "HEAD:main"], { cwd: clone });
    log.ok(`pushed to ${ORG}/${slug} (main)`);
    results.push({ slug, status: "pushed" });
  } catch (err) {
    log.err(`${slug} FAILED: ${err.message.split("\n")[0]}`);
    results.push({ slug, status: "failed", error: err.message });
  }
}

log.banner("Summary");
for (const r of results) console.log(`  ${r.status === "failed" ? "✗" : "✓"} ${r.slug.padEnd(16)} ${r.status}`);
const failed = results.filter((r) => r.status === "failed");
if (failed.length) {
  console.log(`\n${failed.length} game(s) failed:`);
  for (const f of failed) console.log(`\n— ${f.slug} —\n${f.error}`);
  process.exit(1);
}
