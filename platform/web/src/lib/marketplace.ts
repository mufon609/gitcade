// Marketplace query helpers (server-side). Read the Part mirror and shape it for
// the browse + detail pages. The library catalog is the source of truth; these
// only read the ingested mirror (self-healed by ensureCatalogIngested).
import { prisma } from "./prisma";
import { ensureCatalogIngested } from "./catalog-ingest";
import { MARKETPLACE_BUCKETS, type MarketplaceBucket } from "./catalog";
import { usageCountForPart } from "./usage";

export interface PartListItem {
  partId: string;
  version: string;
  kind: string;
  category: string;
  bucket: MarketplaceBucket;
  tags: string[];
  description: string;
  license: string;
  source: "catalog" | "user";
  preview: unknown;
  ownerLogin?: string | null;
}

function bucketOf(preview: unknown, kind: string, category: string): MarketplaceBucket {
  const b = (preview as { bucket?: string })?.bucket;
  if (b && (MARKETPLACE_BUCKETS as readonly string[]).includes(b)) return b as MarketplaceBucket;
  // Fallback for user parts whose preview has no stored bucket.
  if (kind === "behavior") return "Behaviors";
  if (kind === "system") return "Systems";
  if (kind === "entity") return "Entities";
  if (kind === "ui") return "UI";
  if (kind === "fx") return "FX";
  return category === "audio" ? "Audio" : "World";
}

/** All parts (catalog + user), newest user parts first within their bucket. */
export async function listParts(): Promise<PartListItem[]> {
  await ensureCatalogIngested();
  const rows = await prisma.part.findMany({
    orderBy: [{ source: "asc" }, { partId: "asc" }],
    include: { owner: { select: { githubLogin: true } } },
  });
  return rows.map((r) => ({
    partId: r.partId,
    version: r.version,
    kind: r.kind,
    category: r.category,
    bucket: bucketOf(r.preview, r.kind, r.category),
    tags: r.tags,
    description: r.description,
    license: r.license,
    source: r.source as "catalog" | "user",
    preview: r.preview,
    ownerLogin: r.owner?.githubLogin ?? null,
  }));
}

/** All distinct tags across the catalog, for the filter UI. */
export async function allTags(): Promise<string[]> {
  const parts = await listParts();
  const set = new Set<string>();
  for (const p of parts) for (const t of p.tags) set.add(t);
  return [...set].sort();
}

export interface PartDetail extends PartListItem {
  dependencies: string[];
  paramsDoc: Record<string, { type: string; balance?: boolean; description: string }> | null;
  definition: unknown;
  sourceRepoUrl?: string | null;
  sourcePath?: string | null;
  sandboxLog?: string | null;
  usedInCount: number;
}

/** A single part by id (prefers the catalog row; falls back to a user row). */
export async function getPartDetail(partId: string): Promise<PartDetail | null> {
  await ensureCatalogIngested();
  const r =
    (await prisma.part.findFirst({
      where: { partId, source: "catalog" },
      include: { owner: { select: { githubLogin: true } } },
    })) ??
    (await prisma.part.findFirst({
      where: { partId },
      include: { owner: { select: { githubLogin: true } } },
    }));
  if (!r) return null;
  return {
    partId: r.partId,
    version: r.version,
    kind: r.kind,
    category: r.category,
    bucket: bucketOf(r.preview, r.kind, r.category),
    tags: r.tags,
    description: r.description,
    license: r.license,
    source: r.source as "catalog" | "user",
    preview: r.preview,
    ownerLogin: r.owner?.githubLogin ?? null,
    dependencies: r.dependencies,
    paramsDoc: (r.paramsDoc as PartDetail["paramsDoc"]) ?? null,
    definition: r.definition,
    sourceRepoUrl: r.sourceRepoUrl,
    sourcePath: r.sourcePath,
    sandboxLog: r.sandboxLog,
    usedInCount: await usageCountForPart(partId),
  };
}
