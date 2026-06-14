// Copy @gitcade/library/assets → public/library-assets so the marketplace can
// render sprite previews via plain <img> from the platform origin. Mirrors the
// per-game sync-assets pattern from Phase 3. The canonical asset home stays
// packages/library/assets (pinned in the library release); this copy is gitignored
// and recreated on predev/prebuild. No-ops gracefully if the library has no assets.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "public", "library-assets");

function libraryAssetsDir() {
  const require = createRequire(import.meta.url);
  // Resolve the installed library package root, then its /assets dir.
  const pkgJson = require.resolve("@gitcade/library/package.json");
  return path.join(path.dirname(pkgJson), "assets");
}

try {
  const src = libraryAssetsDir();
  if (!existsSync(src)) {
    console.warn(`[sync-library-assets] no assets at ${src} — skipping (previews degrade).`);
    process.exit(0);
  }
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  cpSync(src, publicDir, { recursive: true });
  console.log(`[sync-library-assets] copied library assets → public/library-assets/`);
} catch (e) {
  console.warn(`[sync-library-assets] skipped: ${e?.message ?? e}`);
}
