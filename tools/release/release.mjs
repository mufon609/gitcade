#!/usr/bin/env node
// One-command release runbook for a GitCade PATCH/MINOR. Runs the phases in the
// safe order the 0.3.x releases used:
//
//   verify    npm run build + npm test (root) + `gitcade validate` all six games
//   npm       publish @gitcade/sdk@<v> then @gitcade/library@<v> (skips if already live)
//   monorepo  git push origin main
//   repos     sync each game into its gitcade-games/<slug> repo + re-verify + push
//   artifacts build each /dist and (re)publish to MinIO under {slug}/main/
//
// Usage:
//   node tools/release/release.mjs <phase|all> [--only=slug,...] [--dry-run] [--no-verify]
//
//   node tools/release/release.mjs all                 # full release, in order
//   node tools/release/release.mjs artifacts           # just MinIO
//   node tools/release/release.mjs repos --only=snake  # one game's repo
//
// `npm` is irreversible (a published version can't be replaced) — it self-skips a
// version already on npm, and respects --dry-run. The version is read from
// packages/sdk/package.json (sdk + library are released in lockstep).

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, log, parseArgs, run } from "./lib.mjs";

const args = parseArgs();
const phase = args.phase ?? args._[0];
const PHASES = ["verify", "npm", "monorepo", "repos", "artifacts"];
const ALL = ["all", ...PHASES];
if (!phase || !ALL.includes(phase)) {
  console.log(`usage: node tools/release/release.mjs <${ALL.join("|")}> [--only=...] [--dry-run] [--no-verify]`);
  process.exit(phase ? 1 : 0);
}

const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages/sdk/package.json"), "utf8")).version;
const pass = [args.only ? `--only=${args.only.join(",")}` : null, args.dryRun ? "--dry-run" : null].filter(Boolean);
const sub = (script, extra = []) => run("node", [path.join("tools/release", script), ...pass, ...extra]);

function npmLive(pkg) {
  const r = run("npm", ["view", `${pkg}@${version}`, "version"], { capture: true, allowFail: true });
  return r.status === 0 && r.stdout.trim() === version;
}

const run_ = {
  verify() {
    log.banner("VERIFY — build + test + validate");
    run("npm", ["run", "build"]);
    run("npm", ["test"]);
    for (const g of ["snake", "helicopter", "breakout", "tower-defense", "idle-clicker", "survival-arena"]) {
      run("npx", ["gitcade", "validate", `games/${g}`]);
    }
  },
  npm() {
    log.banner(`NPM — publish @gitcade/{sdk,library}@${version}`);
    for (const pkg of ["@gitcade/sdk", "@gitcade/library"]) {
      if (npmLive(pkg)) {
        log.ok(`${pkg}@${version} already published — skipping`);
        continue;
      }
      if (args.dryRun) {
        log.warn(`dry-run: would npm publish ${pkg}@${version}`);
        continue;
      }
      run("npm", ["publish", "-w", pkg]);
      log.ok(`published ${pkg}@${version}`);
    }
  },
  monorepo() {
    log.banner("MONOREPO — push main");
    if (args.dryRun) return log.warn("dry-run: would git push origin main");
    run("git", ["push", "origin", "main"]);
  },
  repos() {
    log.banner("REPOS — sync gitcade-games/<slug>");
    sub("sync-game-repos.mjs", args.message ? [`--message=${args.message}`] : []);
  },
  artifacts() {
    log.banner("ARTIFACTS — (re)publish MinIO");
    sub("publish-artifacts.mjs");
  },
};

const toRun = phase === "all" ? PHASES : [phase];
for (const p of toRun) run_[p]();
log.banner(`Release ${version}: ${toRun.join(" → ")} complete`);
