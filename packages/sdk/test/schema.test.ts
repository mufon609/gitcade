import { describe, it, expect } from "vitest";
import {
  GameManifestSchema,
  ConfigSchema,
  SceneSchema,
  resolveConfigPath,
  isCfgRef,
  cfgRefPath,
  isWhitelistedNumericKey,
} from "../src/index.js";

describe("manifest schema", () => {
  const base = {
    name: "Pong",
    slug: "pong",
    version: "0.1.0",
    engine: "gitcade-sdk",
    sdkVersion: "0.1.0",
    entryPoint: "src/scenes/main.json",
    tier: "ecosystem",
    libraryVersion: "0.1.0",
  };

  it("accepts a valid ecosystem manifest", () => {
    expect(GameManifestSchema.safeParse(base).success).toBe(true);
  });

  it("requires libraryVersion for ecosystem tier", () => {
    const { libraryVersion, ...noLib } = base;
    void libraryVersion;
    const r = GameManifestSchema.safeParse(noLib);
    expect(r.success).toBe(false);
  });

  it("allows omitting libraryVersion for open tier", () => {
    const { libraryVersion, ...noLib } = base;
    void libraryVersion;
    const r = GameManifestSchema.safeParse({ ...noLib, tier: "open" });
    expect(r.success).toBe(true);
  });

  it("rejects a non-exact sdkVersion (range)", () => {
    const r = GameManifestSchema.safeParse({ ...base, sdkVersion: "^0.1.0" });
    expect(r.success).toBe(false);
  });

  it("rejects a wrong engine literal", () => {
    const r = GameManifestSchema.safeParse({ ...base, engine: "unity" });
    expect(r.success).toBe(false);
  });

  it("accepts a fork-style slug with double dashes", () => {
    expect(GameManifestSchema.safeParse({ ...base, slug: "pong--ada" }).success).toBe(true);
  });
});

describe("config resolution", () => {
  const cfg = ConfigSchema.parse({
    playerSpeed: 5,
    "towerCost.arrow": 50,
    towers: { arrow: { cost: 30 } },
  });

  it("resolves a flat key", () => {
    expect(resolveConfigPath(cfg, "playerSpeed")).toBe(5);
  });
  it("resolves a literal dotted key", () => {
    expect(resolveConfigPath(cfg, "towerCost.arrow")).toBe(50);
  });
  it("resolves a nested path", () => {
    expect(resolveConfigPath(cfg, "towers.arrow.cost")).toBe(30);
  });
  it("returns undefined for a missing path", () => {
    expect(resolveConfigPath(cfg, "nope.nope")).toBeUndefined();
  });
  it("recognizes $cfg references", () => {
    expect(isCfgRef("$cfg.playerSpeed")).toBe(true);
    expect(isCfgRef("ArrowUp")).toBe(false);
    expect(cfgRefPath("$cfg.a.b")).toBe("a.b");
  });
});

describe("numeric whitelist", () => {
  it("whitelists structural keys", () => {
    for (const k of ["x", "y", "w", "h", "layer", "padding", "frame", "tileSize", "stepHeight"]) {
      expect(isWhitelistedNumericKey(k)).toBe(true);
    }
  });
  it("does not whitelist balance keys", () => {
    for (const k of ["speed", "cost", "damage", "health", "spawnRate"]) {
      expect(isWhitelistedNumericKey(k)).toBe(false);
    }
  });
});

describe("scene schema defaults", () => {
  it("applies defaults for size and empty arrays", () => {
    const s = SceneSchema.parse({ id: "main" });
    expect(s.size).toEqual({ width: 800, height: 600 });
    expect(s.entities).toEqual([]);
    expect(s.systems).toEqual([]);
  });
});
