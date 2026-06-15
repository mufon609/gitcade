import { describe, it, expect } from "vitest";
import { SceneSchema, GameManifestSchema } from "../src/index.js";

// Every 0.2.0 schema change is an OPTIONAL field: a 0.1.x artifact must parse
// byte-identically, and the new fields parse when present.
describe("0.2.0 schema additivity", () => {
  it("a 0.1.x scene (no flow / no tilemap.properties) parses unchanged", () => {
    const parsed = SceneSchema.parse({ id: "s", entities: [], systems: [] });
    expect(parsed.flow).toBeUndefined();
    expect(parsed.tilemap).toBeUndefined();
    expect(parsed.size).toEqual({ width: 800, height: 600 }); // existing default intact
  });

  it("parses the additive scene flow block with its defaults", () => {
    const parsed = SceneSchema.parse({ id: "s", flow: { on: { "go-two": "two" } } });
    expect(parsed.flow).toEqual({ on: { "go-two": "two" }, persist: [] }); // persist defaults []
  });

  it("parses additive per-index tilemap properties (open-ended flags)", () => {
    const parsed = SceneSchema.parse({
      id: "s",
      tilemap: {
        tileSize: 50,
        cols: 2,
        rows: 1,
        tiles: [0, 1],
        properties: { "1": { buildable: false, lane: true, custom: "road" } },
      },
    });
    expect(parsed.tilemap?.properties?.["1"]).toEqual({ buildable: false, lane: true, custom: "road" });
  });

  it("a 0.1.x manifest (no persist) parses unchanged; persist parses with defaults when present", () => {
    const base = {
      name: "G",
      slug: "g",
      version: "1.0.0",
      engine: "gitcade-sdk",
      sdkVersion: "0.2.0",
      entryPoint: "main.json",
      tier: "open",
    };
    expect(GameManifestSchema.parse(base).persist).toBeUndefined();
    const withPersist = GameManifestSchema.parse({ ...base, persist: { keys: ["best"] } });
    expect(withPersist.persist).toEqual({ keys: ["best"], slot: "save", everySeconds: 0 });
  });

  it("a manifest without `controls` parses unchanged; `controls` parses when present (additive)", () => {
    const base = {
      name: "G",
      slug: "g",
      version: "1.0.0",
      engine: "gitcade-sdk",
      sdkVersion: "0.2.2",
      entryPoint: "main.json",
      tier: "open",
    };
    expect(GameManifestSchema.parse(base).controls).toBeUndefined();
    const withControls = GameManifestSchema.parse({
      ...base,
      controls: [{ input: "Space", action: "Rise" }],
    });
    expect(withControls.controls).toEqual([{ input: "Space", action: "Rise" }]);
    // Each entry requires both fields.
    expect(GameManifestSchema.safeParse({ ...base, controls: [{ input: "Space" }] }).success).toBe(false);
  });
});
