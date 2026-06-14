// Catalog ingest — read packages/library/CATALOG.json, VALIDATE it against the
// library's catalog.schema.json (the catalog is the source of truth; the DB is a
// queryable mirror), then UPSERT every part into the Part table idempotently.
//
// Server-only (reads the monorepo files + ajv). Called by scripts/ingest-catalog.ts
// and lazily by the marketplace pages when the mirror is empty, so a fresh DB
// self-populates on first marketplace visit.
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { bucketFor, previewFor, type Catalog, type CatalogPart } from "./catalog";

/** Locate the frozen library catalog + its schema in the monorepo. */
function libraryDir(): string {
  return path.join(env.repoRoot, "packages", "library");
}

export function readCatalog(): Catalog {
  const file = path.join(libraryDir(), "CATALOG.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as Catalog;
}

/** Validate a parsed catalog against packages/library/catalog.schema.json. Throws a
 *  readable error if it does not conform — we never ingest an invalid catalog. */
export function validateCatalog(catalog: unknown): { ok: true } | { ok: false; errors: string[] } {
  const schemaPath = path.join(libraryDir(), "catalog.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(catalog)) return { ok: true };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`,
  );
  return { ok: false, errors };
}

export interface IngestResult {
  libraryVersion: string;
  total: number;
  upserted: number;
}

/** Ingest (re-ingest) the library catalog into the Part table. Idempotent: each
 *  part is UPSERTed by its (partId, version, source=catalog) unique key, so running
 *  it twice converges to the same rows. */
export async function ingestCatalog(): Promise<IngestResult> {
  const catalog = readCatalog();
  const valid = validateCatalog(catalog);
  if (!valid.ok) {
    throw new Error(
      `CATALOG.json failed schema validation — refusing to ingest:\n  ${valid.errors.join("\n  ")}`,
    );
  }

  let upserted = 0;
  for (const part of catalog.parts as CatalogPart[]) {
    const bucket = bucketFor(part.kind, part.category);
    const preview = previewFor(part);
    const data = {
      kind: part.kind,
      category: part.category,
      tags: part.tags ?? [],
      description: part.description,
      license: part.license,
      source: "catalog" as const,
      libraryVersion: catalog.version,
      dependencies: part.dependencies ?? [],
      paramsDoc: (part.params ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      definition: (part.definition ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      // Stash the marketplace bucket on the preview blob so pages need no recompute.
      preview: { ...preview, bucket } as unknown as Prisma.InputJsonValue,
    };
    await prisma.part.upsert({
      where: { partId_version_source: { partId: part.id, version: part.version, source: "catalog" } },
      create: { partId: part.id, version: part.version, ...data },
      update: data,
    });
    upserted++;
  }

  return { libraryVersion: catalog.version, total: catalog.parts.length, upserted };
}

/** Ensure the catalog mirror is populated (lazy self-heal for a fresh DB). Returns
 *  the catalog-part count. Safe to call on every marketplace request — it no-ops
 *  once rows exist. */
export async function ensureCatalogIngested(): Promise<number> {
  const count = await prisma.part.count({ where: { source: "catalog" } });
  if (count > 0) return count;
  const res = await ingestCatalog();
  return res.upserted;
}
