/**
 * Bundle game-entry.mjs for ONE game, aliasing the GAME_CUSTOM import to that
 * game's src/custom-behaviors/index.ts (TS, bundled by esbuild). Output:
 * dist/game-<slug>.js. Run by play-game.mjs before each boot.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

export async function buildGameBundle(slug) {
  const custom = resolve(repoRoot, "games", slug, "src", "custom-behaviors", "index.ts");
  const outfile = resolve(here, "dist", `game-${slug}.js`);
  await build({
    entryPoints: [resolve(here, "game-entry.mjs")],
    outfile,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
    alias: { GAME_CUSTOM: custom },
  });
  return outfile;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: node build-game-bundle.mjs <slug>");
    process.exit(2);
  }
  await buildGameBundle(slug);
  console.error(`[harness] built dist/game-${slug}.js`);
}
