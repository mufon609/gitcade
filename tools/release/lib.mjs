// Shared helpers for the GitCade release tooling (tools/release/*).
//
// These scripts automate the OUTWARD-FACING half of a release that the patch
// protocol leaves to a human: pushing each game's source to its standalone
// `gitcade-games/<slug>` repo and republishing the MinIO/S3 artifacts. The
// in-repo half (build, test, validate, npm publish, push monorepo) is plain
// npm + git and is wrapped by release.mjs for a one-command runbook.
//
// Dependency-light on purpose: Node built-ins + @aws-sdk/client-s3 (already a
// workspace dep via platform/worker, hoisted to the root node_modules) + the
// `git`/`rsync`/`gh` CLIs the dev box already has. No new package deps.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORG = "gitcade-games";

/** The six seed games. dir name === manifest slug === gitcade-games repo name. */
export const GAMES = ["snake", "helicopter", "breakout", "tower-defense", "idle-clicker", "survival-arena"];

// ── tiny logger ──────────────────────────────────────────────────────────────
const C = { reset: "\x1b[0m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m" };
export const log = {
  banner: (m) => console.log(`\n${C.bold}${C.cyan}▌ ${m}${C.reset}`),
  note: (m) => console.log(`  ${C.dim}${m}${C.reset}`),
  ok: (m) => console.log(`  ${C.green}✓${C.reset} ${m}`),
  warn: (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`),
  err: (m) => console.log(`  ${C.red}✗${C.reset} ${m}`),
  step: (m) => console.log(`${C.bold}${m}${C.reset}`),
};

/** Parse simple CLI flags: --only=a,b  --dry-run  --message="..."  → { only:[...], dryRun:true, message:"..." }. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { only: null, dryRun: false, noVerify: false, noPush: false, noBuild: false, message: null, phase: null, branch: "main", _: [] };
  for (const a of argv) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-verify") out.noVerify = true;
    else if (a === "--no-push") out.noPush = true;
    else if (a === "--no-build") out.noBuild = true;
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--message=")) out.message = a.slice("--message=".length);
    else if (a.startsWith("--phase=")) out.phase = a.slice("--phase=".length);
    else if (a.startsWith("--branch=")) out.branch = a.slice("--branch=".length);
    else out._.push(a);
  }
  return out;
}

/** The game list after applying an optional --only filter (validates slugs). */
export function selectGames(only) {
  if (!only) return GAMES;
  for (const s of only) if (!GAMES.includes(s)) throw new Error(`unknown game slug "${s}" (known: ${GAMES.join(", ")})`);
  return GAMES.filter((g) => only.includes(g));
}

/** Run a command, inheriting stdio by default. Throws on non-zero unless opts.allowFail. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8", cwd: opts.cwd ?? REPO_ROOT, env: { ...process.env, ...opts.env } });
  if (res.status !== 0 && !opts.allowFail) {
    const detail = opts.capture ? `\n${res.stdout ?? ""}${res.stderr ?? ""}` : "";
    throw new Error(`\`${cmd} ${args.join(" ")}\` exited ${res.status}${detail}`);
  }
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** True if a binary is on PATH. */
export function has(bin) {
  return spawnSync("command", ["-v", bin], { shell: "/bin/bash", stdio: "ignore" }).status === 0;
}

/** Parse the repo-root .env into a plain object (KEY=value lines only; ignores comments/prose). */
export function loadEnv() {
  const file = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(file)) throw new Error(`.env not found at ${file} — copy setup/.env.example and fill it`);
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

/** A scratch dir for cloned game repos (cleared per run unless reused). */
export function workdir() {
  const d = path.join(os.tmpdir(), "gitcade-release");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ── S3 / MinIO (matches platform/worker/src/s3.ts exactly) ───────────────────
// Content types for everything a Vite static build emits. Kept in lockstep with
// the worker + artifact-server maps so the bytes we upload here are byte-for-byte
// what the build worker would have uploaded (the artifact server sets cache/CSP
// headers on SERVE, so uploads only need a correct ContentType).
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};
export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/** Recursively walk a directory yielding [absPath, posixRelPath]. */
export function* walk(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs, base);
    else if (entry.isFile()) yield [abs, path.relative(base, abs).split(path.sep).join("/")];
  }
}

/** Build an S3 client from .env. The SAME config the worker uses; honors S3_FORCE_PATH_STYLE. */
export async function makeS3(env) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || "us-east-1",
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
}
