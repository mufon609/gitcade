#!/usr/bin/env node
// GitCade release runbook — four idempotent, dry-runnable commands driven by the
// role→pin POLICY in policy.mjs (the one source of truth). See RELEASE.md.
//
//   doctor   audit role→pin invariants + creds (read-only; non-zero on problems)
//   sync     apply the pin policy + regen catalog + refresh lockfile (idempotent)
//   gate     clean `npm ci` install + build + test + validate + npm pack --dry-run
//   publish  divergence-aware npm (per-package version, skip-if-live) + monorepo
//            push + game-repos + MinIO artifacts; first-class --dry-run
//
// Usage: node tools/release/release.mjs <cmd> [--dry-run] [--only=slug,...]

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, log, parseArgs, run, loadEnv } from "./lib.mjs";
import {
  SDK_PEER,
  coreVersions,
  catalogVersion,
  auditPackages,
  computeRepins,
  planNpmPublish,
  runNpmPublish,
  resolveDryRun,
} from "./policy.mjs";

const args = parseArgs();
const cmd = args._[0];
// `npm run release:* --dry-run` makes npm consume --dry-run as ITS OWN flag (it never
// reaches the script's argv) and export `npm_config_dry_run=true` to children. Honor it
// so a dry-run works WITH or WITHOUT the `--` separator — never silently a real run.
const npmDryRun = process.env.npm_config_dry_run === "true";

// ── creds (read-only, best-effort) ───────────────────────────────────────────
function credChecks() {
  const out = [];
  const npm = run("npm", ["whoami"], { capture: true, allowFail: true });
  out.push({ name: "npm login", ok: npm.status === 0, detail: npm.status === 0 ? npm.stdout.trim() : "run `npm login`" });
  const ssh = run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-T", "git@github.com"], { capture: true, allowFail: true });
  const sshOk = /successfully authenticated/i.test(`${ssh.stdout}${ssh.stderr}`);
  out.push({ name: "github ssh (gitcade-games push)", ok: sshOk, detail: sshOk ? "authenticated" : "no ssh access to github" });
  let envOk = false, envDetail;
  try {
    const e = loadEnv();
    const miss = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !e[k]);
    envOk = miss.length === 0;
    envDetail = envOk ? "S3_* present" : `missing ${miss.join(", ")}`;
  } catch (err) {
    envDetail = err.message.split("\n")[0];
  }
  out.push({ name: ".env S3 keys", ok: envOk, detail: envDetail });
  return out;
}

// ── doctor ───────────────────────────────────────────────────────────────────
function doctor() {
  log.banner("DOCTOR — role-classified pin audit");
  const { versions, catalog, rows, issues } = auditPackages();
  log.note(`core: sdk ${versions.sdk} · library ${versions.library} · catalog ${catalog} · SDK_PEER ${SDK_PEER}`);
  for (const role of ["core", "game", "internal"]) {
    const list = rows.filter((r) => r.role === role);
    console.log(`\n  ${role} (${list.length}):`);
    for (const r of list) {
      const pins = Object.entries(r.pins).map(([k, v]) => `${k.split(".").pop()}=${v}`).join(" ");
      console.log(`    ${r.dir.padEnd(42)} ${pins || "(no @gitcade deps)"}`);
    }
  }
  log.banner("Invariants");
  if (issues.length === 0) log.ok("all pin/version invariants hold");
  else for (const i of issues) log.err(`${i.pkg}: ${i.msg}  → ${i.fix}`);

  log.banner("Credentials (read-only; needed only for publish)");
  for (const c of credChecks()) (c.ok ? log.ok : log.warn)(`${c.name}: ${c.detail}`);

  if (issues.length) {
    log.err(`${issues.length} invariant issue(s) — run \`npm run release:sync\``);
    process.exit(1);
  }
  log.ok("doctor PASS — repo is policy-clean");
}

// ── sync ───────────────────────────────────────────────────────────────────
function sync() {
  const dryRun = args.dryRun || npmDryRun;
  log.banner(`SYNC — apply role pin policy${dryRun ? " (dry-run)" : ""}`);
  const repins = computeRepins();
  if (repins.length === 0) log.note("pins already clean");
  for (const { path: rel, after } of repins) {
    if (dryRun) log.warn(`dry-run: would repin ${rel}`);
    else { fs.writeFileSync(path.join(REPO_ROOT, rel), after); log.ok(`repinned ${rel}`); }
  }
  if (catalogVersion() !== coreVersions().library) {
    if (dryRun) log.warn("dry-run: would regenerate CATALOG.json");
    else { run("node", ["packages/library/scripts/build-catalog.mjs"]); log.ok("regenerated CATALOG.json"); }
  } else log.note("catalog already in sync");
  if (dryRun) return log.warn("dry-run: skipping npm install");
  if (repins.length) { log.note("npm install (refresh lockfile)…"); run("npm", ["install", "--no-audit", "--no-fund"]); }
  log.ok("sync complete — repo installable + publish-ready");
}

// ── gate ───────────────────────────────────────────────────────────────────
function gate() {
  log.banner("GATE — clean install + build + test + validate + pack");
  run("npm", ["ci"]); // canonical fresh-clone clean install (no flags; runs the prisma postinstall)
  run("npm", ["run", "build"]);
  run("npm", ["test"]);
  run("npm", ["run", "validate:pong"]);
  run("npm", ["run", "validate:proofs"]);
  log.banner("npm pack --dry-run (per publishable, at its OWN version)");
  const { sdk, library } = coreVersions();
  for (const [name, ws, v] of [["@gitcade/sdk", "packages/sdk", sdk], ["@gitcade/library", "packages/library", library]]) {
    run("npm", ["pack", "--dry-run"], { cwd: path.join(REPO_ROOT, ws) });
    log.ok(`${name}@${v} packs`);
  }
  log.ok("gate PASS");
}

// ── publish (divergence-aware, idempotent, SAFE-BY-DEFAULT dry-run) ──────────
function publish() {
  // SAFE BY DEFAULT: a real publish happens ONLY with an explicit `-- --yes` and no
  // dry-run signal. Bare, `--dry-run`, or a `--yes` npm swallows → a rehearsal that
  // mutates nothing (resolveDryRun). An irreversible action never runs by accident.
  const dryRun = resolveDryRun({ dryRun: args.dryRun, yes: args.yes, npmDryRun });
  log.banner(`PUBLISH${dryRun ? " — DRY-RUN (mutates nothing)" : ""}`);

  // Preflight: doctor must be clean, and creds present (creds only enforced on a real run).
  const { issues } = auditPackages();
  if (issues.length) {
    log.err(`refusing: ${issues.length} doctor issue(s) — run \`npm run release:sync\` first`);
    process.exit(1);
  }
  const creds = credChecks();
  for (const c of creds) (c.ok ? log.ok : log.warn)(`${c.name}: ${c.detail}`);
  const missing = creds.filter((c) => !c.ok);
  if (missing.length && !dryRun) {
    log.err(`refusing: missing credentials — ${missing.map((c) => c.name).join(", ")}. Resolve, then re-run.`);
    process.exit(1);
  }

  const { sdk, library } = coreVersions();

  // 1. npm — read EACH package's OWN version; skip a version already live (idempotent/resumable).
  log.banner("npm — publish core packages (skip if already live)");
  const isLive = (name, version) => {
    const r = run("npm", ["view", `${name}@${version}`, "version"], { capture: true, allowFail: true });
    return r.status === 0 && r.stdout.trim() === version;
  };
  const steps = planNpmPublish([{ name: "@gitcade/sdk", version: sdk }, { name: "@gitcade/library", version: library }], isLive);
  runNpmPublish(steps, { dryRun, exec: (c, a) => run(c, a), log: (m) => log.ok(m) });

  // 2. monorepo push.
  log.banner("monorepo — push main");
  if (dryRun) log.warn("dry-run: would git push origin main");
  else run("git", ["push", "origin", "main"]);

  // 3. game repos (idempotent; needs npm live first → skip the clean-clone verify in dry-run).
  log.banner("repos — sync gitcade-games/<slug>");
  const repoArgs = [
    dryRun ? "--dry-run" : null,
    dryRun ? "--no-verify" : null, // public npm can't have the new versions until step 1 actually runs
    args.only ? `--only=${args.only.join(",")}` : null,
    `--message=chore: sync sdk ${sdk} + library ${library} from monorepo`,
  ].filter(Boolean);
  run("node", ["tools/release/sync-game-repos.mjs", ...repoArgs]);

  // 4. MinIO artifacts.
  log.banner("artifacts — (re)publish MinIO");
  const artArgs = [dryRun ? "--dry-run" : null, args.only ? `--only=${args.only.join(",")}` : null].filter(Boolean);
  run("node", ["tools/release/publish-artifacts.mjs", ...artArgs]);

  if (dryRun) log.warn("DRY-RUN complete — nothing was published. Re-run with `npm run release:publish -- --yes` to publish for real.");
  else log.ok("publish complete");
}

const COMMANDS = { doctor, sync, gate, publish };
if (!cmd || !COMMANDS[cmd]) {
  console.log(
    `usage: node tools/release/release.mjs <doctor|sync|gate|publish> [--dry-run] [--only=slug,...]\n\n` +
      `  doctor   audit role→pin invariants + creds (read-only)\n` +
      `  sync     apply the pin policy + regen catalog + refresh lockfile (idempotent)\n` +
      `  gate     clean install + build + test + validate + pack dry-run\n` +
      `  publish  divergence-aware npm + repos + MinIO. SAFE BY DEFAULT (dry-run);\n` +
      `           pass \`-- --yes\` to publish for real.`,
  );
  process.exit(cmd ? 1 : 0);
}
try {
  COMMANDS[cmd]();
} catch (e) {
  log.err(e.message.split("\n")[0]);
  process.exit(1);
}
