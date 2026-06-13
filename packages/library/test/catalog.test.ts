import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { LIBRARY_BEHAVIOR_TYPES } from "../src/behaviors/index.js";
import { LIBRARY_SYSTEM_TYPES } from "../src/systems/index.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const readJson = (rel: string): unknown => JSON.parse(read(rel));

interface CatalogPart {
  id: string;
  kind: string;
  version: string;
  category: string;
  tags: string[];
  description: string;
  license: string;
  dependencies: string[];
  params?: Record<string, { type: string; balance?: boolean; description: string }>;
  definition: { type: string; params: Record<string, unknown> };
}
interface Catalog {
  schemaVersion: number;
  library: string;
  version: string;
  parts: CatalogPart[];
}

const catalog = readJson("../CATALOG.json") as Catalog;
const schema = readJson("../catalog.schema.json") as object;

describe("CATALOG.json", () => {
  it("validates against catalog.schema.json", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(catalog);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  it("is in sync with the per-part source files (parts/)", () => {
    // Re-read every part file and assert the catalog entry matches it exactly.
    const partFiles = [
      ...readdirSync(fileURLToPath(new URL("../parts/behaviors", import.meta.url))).map((f) => `../parts/behaviors/${f}`),
      ...readdirSync(fileURLToPath(new URL("../parts/systems", import.meta.url))).map((f) => `../parts/systems/${f}`),
    ].filter((f) => f.endsWith(".json"));

    expect(partFiles).toHaveLength(catalog.parts.length);

    for (const file of partFiles) {
      const part = readJson(file) as CatalogPart;
      const entry = catalog.parts.find((p) => p.id === part.id);
      expect(entry, `catalog is missing part ${part.id}`).toBeDefined();
      // Compare the load-bearing fields (the script only re-orders keys).
      expect(entry!.kind).toBe(part.kind);
      expect(entry!.version).toBe(part.version);
      expect(entry!.category).toBe(part.category);
      expect(entry!.definition).toEqual(part.definition);
      expect(entry!.tags).toEqual(part.tags);
      expect(entry!.dependencies).toEqual(part.dependencies);
    }
  });

  it("covers every registered behavior/system type, and only those", () => {
    const behaviorIds = catalog.parts.filter((p) => p.kind === "behavior").map((p) => p.id).sort();
    const systemIds = catalog.parts.filter((p) => p.kind === "system").map((p) => p.id).sort();
    expect(behaviorIds).toEqual([...LIBRARY_BEHAVIOR_TYPES].sort());
    expect(systemIds).toEqual([...LIBRARY_SYSTEM_TYPES].sort());
  });

  it("licenses every part MIT (logic parts; assets are CC-BY in Phase 2B)", () => {
    for (const p of catalog.parts) expect(p.license).toBe("MIT");
  });

  it("every part has a semver version and the definition type matches its id", () => {
    for (const p of catalog.parts) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.definition.type).toBe(p.id);
    }
  });

  it("authors every BALANCE param in a default definition as a $cfg reference, never a literal", () => {
    for (const p of catalog.parts) {
      if (!p.params) continue;
      for (const [name, spec] of Object.entries(p.params)) {
        if (!spec.balance) continue;
        const value = p.definition.params[name];
        if (value === undefined) continue; // optional param omitted from the template
        if (typeof value === "number") {
          throw new Error(`${p.id}: balance param "${name}" is a numeric literal in its definition — must be a "$cfg.*" reference`);
        }
        if (typeof value === "string") {
          expect(value.startsWith("$cfg."), `${p.id}.${name} should be a $cfg reference`).toBe(true);
        }
      }
    }
  });
});
