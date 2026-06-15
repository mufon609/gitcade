/**
 * Bundle entry.mjs (which pulls in @gitcade/sdk + @gitcade/library from the
 * monorepo's built dist via workspace symlinks) into a single browser script the
 * host page can <script>-load with no module resolution. Run automatically by
 * harness.mjs, or standalone: `node audit/harness/build-bundle.mjs`.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, "entry.mjs")],
  outfile: resolve(here, "dist/gitcade-bundle.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
});

console.error("[harness] bundle written to dist/gitcade-bundle.js");
