// Ingest packages/library/CATALOG.json into the Part table (idempotent). Run:
//   npm --prefix platform/web run ingest-catalog
// The marketplace pages also lazily self-ingest on first visit, but running this
// explicitly is the deterministic seeding step for verification.
import { ingestCatalog } from "../src/lib/catalog-ingest";
import { prisma } from "../src/lib/prisma";

async function main() {
  const res = await ingestCatalog();
  console.log(
    `✓ Ingested ${res.upserted}/${res.total} parts from @gitcade/library@${res.libraryVersion} into the Part table.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("✗ Catalog ingest failed:\n", e?.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
