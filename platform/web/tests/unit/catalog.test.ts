import { describe, it, expect } from "vitest";
import { bucketFor, previewFor, behaviorCompatible, type CatalogPart } from "@/lib/catalog";

describe("catalog — marketplace bucketing", () => {
  it("maps kinds to the 7 buckets, splitting assets by category", () => {
    expect(bucketFor("behavior", "movement")).toBe("Behaviors");
    expect(bucketFor("system", "rules")).toBe("Systems");
    expect(bucketFor("entity", "entities")).toBe("Entities");
    expect(bucketFor("ui", "ui")).toBe("UI");
    expect(bucketFor("fx", "fx")).toBe("FX");
    expect(bucketFor("asset", "world")).toBe("World");
    expect(bucketFor("asset", "audio")).toBe("Audio");
  });
});

const entity = (id: string, sprite: unknown): CatalogPart => ({
  id,
  kind: "entity",
  version: "1.0.0",
  category: "entities",
  tags: [],
  description: "",
  license: "CC-BY-4.0",
  definition: { type: id, params: { sprite } as Record<string, unknown> },
});

describe("catalog — preview derivation", () => {
  it("derives a sprite preview from an entity image", () => {
    const p = previewFor(entity("wall", { kind: "image", src: "assets/sprites/wall.png" }));
    expect(p).toEqual({ kind: "sprite", src: "assets/sprites/wall.png" });
  });

  it("derives a sheet sprite preview", () => {
    const p = previewFor(
      entity("coin", { kind: "sheet", src: "assets/sprites/coin.png", frameWidth: 16, frameHeight: 16, frameCount: 4 }),
    );
    expect(p.kind).toBe("sprite");
    if (p.kind === "sprite") expect(p.sheet?.frameCount).toBe(4);
  });

  it("derives sfx/music previews from audio definition keys", () => {
    const sfx: CatalogPart = {
      id: "sfx-jump",
      kind: "asset",
      version: "1.0.0",
      category: "audio",
      tags: ["audio", "sfx"],
      description: "",
      license: "MIT",
      definition: { type: "sfx-jump", params: { key: "jump" } },
    };
    expect(previewFor(sfx)).toEqual({ kind: "sfx", sfx: "jump" });

    const music: CatalogPart = {
      id: "music-action",
      kind: "asset",
      version: "1.0.0",
      category: "audio",
      tags: ["audio", "music"],
      description: "",
      license: "MIT",
      definition: { type: "music-action", params: { track: "action" } },
    };
    expect(previewFor(music)).toEqual({ kind: "music", music: "action" });
  });

  it("derives a behavior demo preview", () => {
    const b: CatalogPart = {
      id: "move-4dir",
      kind: "behavior",
      version: "1.0.0",
      category: "movement",
      tags: ["movement"],
      description: "",
      license: "MIT",
      definition: { type: "move-4dir", params: {} },
    };
    expect(previewFor(b)).toEqual({ kind: "behavior", behaviorType: "move-4dir" });
  });
});

const beh = (id: string, tags: string[], category = "movement"): CatalogPart => ({
  id,
  kind: "behavior",
  version: "1.0.0",
  category,
  tags,
  description: "",
  license: "MIT",
  definition: { type: id, params: {} },
});

describe("catalog — behavior swap compatibility", () => {
  it("is compatible when same category + shared tag, different id", () => {
    const a = beh("move-grid-step", ["movement", "grid"]);
    const b = beh("move-4dir", ["movement", "topdown"]);
    expect(behaviorCompatible(a, b)).toBe(true);
  });

  it("is incompatible across categories", () => {
    const a = beh("move-4dir", ["movement"], "movement");
    const b = beh("shoot", ["movement"], "combat");
    expect(behaviorCompatible(a, b)).toBe(false);
  });

  it("is incompatible with itself", () => {
    const a = beh("move-4dir", ["movement"]);
    expect(behaviorCompatible(a, a)).toBe(false);
  });

  it("is incompatible with no shared tags", () => {
    const a = beh("move-4dir", ["topdown"]);
    const b = beh("move-platformer", ["platformer"]);
    expect(behaviorCompatible(a, b)).toBe(false);
  });
});
