import { describe, it, expect } from "vitest";
import {
  SceneSchema,
  EntityDefSchema,
  ColliderSchema,
  SpriteSchema,
  BehaviorDefSchema,
  SystemDefSchema,
  GameManifestSchema,
  ConfigSchema,
  TilePropsSchema,
} from "../src/index.js";

/**
 * 1.11.0 — strict structural schemas. The fixed-shape object schemas (entity, scene, sprite,
 * collider, behavior/system INSTANCE, manifest, …) now reject UNKNOWN keys instead of silently
 * stripping them (Zod's default), so a typo'd field is a loud parse error at `gitcade validate` AND
 * runtime `createGame` — the "data not code" contract made honest. The OPEN bags stay loose by
 * design: behavior/system `params`, entity `state`, `config.json`, and the tile-props `.catchall`
 * all carry author/part-defined keys, so they accept anything. Valid data is byte-identical (strict
 * only rejects what strip would have dropped), so every shipped game/proof still validates.
 */

function err(schema: { safeParse: (v: unknown) => { success: boolean; error?: any } }, value: unknown) {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  return r.error.issues[0];
}

describe("strict structural schemas — typo'd fields are rejected, not dropped", () => {
  it("EntityDefSchema rejects an unknown key", () => {
    const i = err(EntityDefSchema, { id: "e", layr: 3, colour: "red" }); // layer/color typos
    expect(i.code).toBe("unrecognized_keys");
  });

  it("ColliderSchema rejects an unknown key", () => {
    expect(err(ColliderSchema, { role: "solid", carryable: true }).code).toBe("unrecognized_keys"); // carriable typo
  });

  it("SpriteSchema (a discriminated union of strict members) rejects an unknown key", () => {
    expect(err(SpriteSchema, { kind: "shape", shape: "rect", colour: "#fff" }).code).toBe("unrecognized_keys");
  });

  it("Behavior/System INSTANCE schemas reject an unknown key (but not their params bag)", () => {
    expect(err(BehaviorDefSchema, { type: "velocity", parms: {} }).code).toBe("unrecognized_keys"); // params typo
    expect(err(SystemDefSchema, { type: "score", paramz: {} }).code).toBe("unrecognized_keys");
  });

  it("GameManifestSchema rejects an unknown key", () => {
    const base = {
      name: "G", slug: "g", version: "1.0.0", engine: "gitcade-sdk", sdkVersion: "1.0.0",
      entryPoint: "src/scenes/main.json", tier: "open",
    };
    expect(GameManifestSchema.safeParse(base).success).toBe(true); // clean manifest is fine
    expect(err(GameManifestSchema, { ...base, repostory: "x" }).code).toBe("unrecognized_keys"); // repository typo
  });

  it("SceneSchema reports the PATH of a nested typo (so the author knows where)", () => {
    const i = err(SceneSchema, { id: "s", entities: [{ id: "e", tags: ["x"], speeed: 5 }], systems: [] });
    expect(i.code).toBe("unrecognized_keys");
    expect(i.path).toContain("entities");
    expect(i.path).toContain(0); // entities[0]
  });
});

describe("open bags stay loose by design", () => {
  it("entity `state` accepts arbitrary keys", () => {
    const r = EntityDefSchema.safeParse({ id: "e", state: { hp: 3, comboTimer: 0, anyAuthorKey: true } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.state).toEqual({ hp: 3, comboTimer: 0, anyAuthorKey: true });
  });

  it("behavior `params` accept arbitrary (part-defined) keys", () => {
    const r = BehaviorDefSchema.safeParse({ type: "custom-part", params: { whatever: 1, nested: { deep: "x" } } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.params).toEqual({ whatever: 1, nested: { deep: "x" } });
  });

  it("config.json accepts arbitrary balance keys (flat and nested)", () => {
    expect(ConfigSchema.safeParse({ playerSpeed: 230, towerCost: { arrow: 50 }, anyKey: true }).success).toBe(true);
  });

  it("tile properties keep their catchall (game-specific markers)", () => {
    const r = TilePropsSchema.safeParse({ buildable: true, lane: true, customMarker: 5, zone: "north" });
    expect(r.success).toBe(true);
  });
});

describe("valid data is unaffected (defaults applied, nothing rejected)", () => {
  it("a clean entity parses with its schema defaults", () => {
    const r = EntityDefSchema.safeParse({ id: "ball", tags: ["ball"], layer: 2 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.id).toBe("ball");
      expect(r.data.layer).toBe(2);
      expect(r.data.sprite).toEqual({ kind: "none" }); // default
      expect(r.data.size).toEqual({ w: 16, h: 16 }); // default
      expect(r.data.behaviors).toEqual([]); // default
    }
  });
});
