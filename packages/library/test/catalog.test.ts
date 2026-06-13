import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { LIBRARY_BEHAVIOR_TYPES } from "../src/behaviors/index.js";
import { LIBRARY_SYSTEM_TYPES } from "../src/systems/index.js";
import { LIBRARY_FX_PARTICLE_TYPES } from "../src/fx/index.js";
import { LIBRARY_UI_RUNTIME_TYPES } from "../src/ui/index.js";
import { createLibraryRegistry } from "../src/registry.js";

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

// Every parts/ subdirectory the build script aggregates (2A logic + 2B presentation).
const PART_DIRS = ["behaviors", "systems", "entities", "assets", "ui", "fx"];

describe("CATALOG.json", () => {
  it("validates against catalog.schema.json", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(catalog);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  it("is in sync with the per-part source files (parts/)", () => {
    const partFiles = PART_DIRS.flatMap((d) =>
      readdirSync(fileURLToPath(new URL(`../parts/${d}`, import.meta.url)))
        .filter((f) => f.endsWith(".json"))
        .map((f) => `../parts/${d}/${f}`),
    );

    expect(partFiles).toHaveLength(catalog.parts.length);

    for (const file of partFiles) {
      const part = readJson(file) as CatalogPart;
      const entry = catalog.parts.find((p) => p.id === part.id);
      expect(entry, `catalog is missing part ${part.id}`).toBeDefined();
      expect(entry!.kind).toBe(part.kind);
      expect(entry!.version).toBe(part.version);
      expect(entry!.category).toBe(part.category);
      expect(entry!.license).toBe(part.license);
      expect(entry!.definition).toEqual(part.definition);
      expect(entry!.tags).toEqual(part.tags);
      expect(entry!.dependencies).toEqual(part.dependencies);
    }
  });

  it("covers every registered behavior/system type as kind behavior/system, and only those", () => {
    // FX/UI parts also register runtime types but are catalogued as kind fx/ui, so
    // the behavior/system KINDS still map 1:1 to the 2A logic library.
    const behaviorIds = catalog.parts.filter((p) => p.kind === "behavior").map((p) => p.id).sort();
    const systemIds = catalog.parts.filter((p) => p.kind === "system").map((p) => p.id).sort();
    expect(behaviorIds).toEqual([...LIBRARY_BEHAVIOR_TYPES].sort());
    expect(systemIds).toEqual([...LIBRARY_SYSTEM_TYPES].sort());
  });

  it("covers all 7 marketplace categories (Behaviors, Systems, Entities, World, Audio, UI, FX)", () => {
    const bucket = (p: CatalogPart): string => {
      if (p.kind === "behavior") return "Behaviors";
      if (p.kind === "system") return "Systems";
      if (p.kind === "entity") return "Entities";
      if (p.kind === "ui") return "UI";
      if (p.kind === "fx") return "FX";
      // kind asset splits into World (tilesets/backgrounds/cameras) and Audio (sfx/music)
      return p.category === "audio" ? "Audio" : "World";
    };
    const buckets = new Set(catalog.parts.map(bucket));
    expect([...buckets].sort()).toEqual(["Audio", "Behaviors", "Entities", "FX", "Systems", "UI", "World"]);
  });

  it("licenses assets CC-BY-4.0 and code MIT (a part referencing a generated PNG is CC-BY)", () => {
    for (const p of catalog.parts) {
      expect(["MIT", "CC-BY-4.0"]).toContain(p.license);
      const referencesGeneratedAsset = JSON.stringify(p.definition).includes("assets/");
      expect(p.license, `${p.id} (${referencesGeneratedAsset ? "ships a PNG" : "code-only"})`).toBe(
        referencesGeneratedAsset ? "CC-BY-4.0" : "MIT",
      );
    }
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
        if (value === undefined) continue;
        if (typeof value === "number") {
          throw new Error(`${p.id}: balance param "${name}" is a numeric literal in its definition — must be a "$cfg.*" reference`);
        }
        if (typeof value === "string") {
          expect(value.startsWith("$cfg."), `${p.id}.${name} should be a $cfg reference`).toBe(true);
        }
      }
    }
  });

  it("registers every FX/UI runtime type referenced by 2B parts", () => {
    const reg = createLibraryRegistry();
    for (const t of LIBRARY_FX_PARTICLE_TYPES) {
      expect(reg.hasBehavior(t) || reg.hasSystem(t), `fx type ${t} not registered`).toBe(true);
    }
    for (const t of LIBRARY_UI_RUNTIME_TYPES) {
      expect(reg.hasBehavior(t), `ui type ${t} not registered`).toBe(true);
    }
    // The internal particle behavior must resolve for spawned particles.
    expect(reg.hasBehavior("particle")).toBe(true);
  });
});
