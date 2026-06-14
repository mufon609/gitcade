// Build the "made from" index for every Game: fetch scenes from each repo, parse
// partId@version refs, resolve against the catalog, UPSERT GamePart edges. Run:
//   npm --prefix platform/web run index-parts
// A GitHub token (from `gh auth token`) is recommended to avoid the 60 req/hr
// anonymous rate limit. Pages also index lazily on first view; this is the bulk
// pass used for verification.
import { execSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { ingestCatalog } from "../src/lib/catalog-ingest";
import { indexGameParts } from "../src/lib/usage";

function ghToken(): string | undefined {
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  // Ensure the catalog mirror exists so refs resolve.
  await ingestCatalog();
  const token = ghToken();
  const games = await prisma.game.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Indexing ${games.length} game(s)…${token ? " (authenticated)" : " (anonymous)"}`);
  for (const g of games) {
    try {
      const parts = await indexGameParts(g, token);
      const resolved = parts.filter((p) => p.partRef).length;
      console.log(`  ✓ ${g.slug}: ${parts.length} part ref(s), ${resolved} resolved to catalog`);
    } catch (e) {
      console.log(`  ✗ ${g.slug}: ${(e as Error).message}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
