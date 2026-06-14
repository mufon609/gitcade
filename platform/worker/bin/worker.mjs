#!/usr/bin/env node
// CLI shim so `gitcade-worker <cmd>` works as a bin. Runs the TypeScript CLI via
// tsx (no build step needed for this internal service). Mirrors the SDK's
// checked-in bin shim pattern.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "src", "cli.ts");
const r = spawnSync(
  process.execPath,
  ["--import", "tsx", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
