#!/usr/bin/env node
/**
 * Build CATALOG.json from the per-part definition files in parts/.
 *
 * parts/{behaviors,systems}/<id>.json are the single source of truth — each part
 * ships its own metadata + JSON definition. This script aggregates them into the
 * machine-readable catalog index the platform marketplace ingests, with a STABLE key order and
 * ordering (kind, then id) so re-running it is a no-op diff. The catalog test
 * asserts CATALOG.json is exactly what this script would (re)produce, so the file
 * and the parts can never drift.
 *
 * Run: `npm run catalog` (from packages/library).
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const KIND_ORDER = { behavior: 0, system: 1, entity: 2, asset: 3, ui: 4, fx: 5 };
// Deterministic field order for each catalog part entry.
const PART_KEYS = ["id", "kind", "version", "category", "tags", "description", "license", "dependencies", "params", "definition"];

/** Read every *.json part file under a parts/ subdirectory. */
function readParts(subdir) {
  const dir = join(root, "parts", subdir);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files.map((f) => {
    const part = JSON.parse(readFileSync(join(dir, f), "utf8"));
    validatePart(part, `${subdir}/${f}`);
    return part;
  });
}

function validatePart(part, where) {
  for (const key of ["id", "kind", "version", "category", "tags", "description", "license", "dependencies", "definition"]) {
    if (part[key] === undefined) throw new Error(`${where}: part is missing required field "${key}"`);
  }
  if (part.definition.type !== part.id) {
    throw new Error(`${where}: definition.type "${part.definition.type}" must equal part id "${part.id}"`);
  }
}

/** Re-emit a part with keys in the canonical order (dropping undefined optionals). */
function orderPart(part) {
  const out = {};
  for (const key of PART_KEYS) {
    if (part[key] !== undefined) out[key] = part[key];
  }
  return out;
}

// Phase 2A authored behaviors/ + systems/; Phase 2B extends with the presentational
// half (entities/, assets/ [world + audio], ui/, fx/). Each subdir maps to a `kind`
// the catalog schema already allows; the kind itself comes from each part file.
const PART_DIRS = ["behaviors", "systems", "entities", "assets", "ui", "fx"];
const parts = PART_DIRS.flatMap((d) => readParts(d))
  .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id))
  .map(orderPart);

const catalog = {
  schemaVersion: 1,
  library: "@gitcade/library",
  version: pkg.version,
  generatedFrom: "parts/",
  parts,
};

const outPath = join(root, "CATALOG.json");
writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`Wrote CATALOG.json — ${parts.length} parts (@gitcade/library@${pkg.version}).`);
