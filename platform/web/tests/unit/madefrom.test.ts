import { describe, it, expect } from "vitest";
import { extractPartRefs, parsePartRef, extractPartRefsFromScenes } from "@/lib/madefrom";

describe("madefrom — part ref parsing", () => {
  it("parses a well-formed id@version ref", () => {
    expect(parsePartRef("move-grid-step@1.0.0")).toEqual({ id: "move-grid-step", version: "1.0.0" });
  });

  it("rejects malformed refs", () => {
    expect(parsePartRef("move-grid-step")).toBeNull();
    expect(parsePartRef("Move@1.0.0")).toBeNull(); // not kebab-case
    expect(parsePartRef(42)).toBeNull();
  });

  it("collects refs across nested behaviors, systems, and prototype params", () => {
    const scene = {
      id: "main",
      entities: [
        {
          id: "head",
          behaviors: [
            { type: "sprite-animate", params: {} }, // no provenance
            { type: "move-grid-step", part: "move-grid-step@1.0.0", params: {} },
          ],
        },
      ],
      systems: [
        { type: "score", part: "score@1.0.0", params: {} },
        {
          type: "wave-spawner",
          params: {
            // nested prototype carrying provenance refs deep in params
            prototype: {
              behaviors: [{ type: "health-and-death", part: "health-and-death@1.0.0", params: {} }],
            },
          },
        },
      ],
    };
    const refs = extractPartRefs(scene);
    const ids = refs.map((r) => `${r.id}@${r.version}`);
    expect(ids).toContain("move-grid-step@1.0.0");
    expect(ids).toContain("score@1.0.0");
    expect(ids).toContain("health-and-death@1.0.0");
    expect(ids).not.toContain("sprite-animate@1.0.0");
  });

  it("counts repeated refs", () => {
    const scene = {
      systems: [
        { type: "x", part: "health-and-death@1.0.0", params: {} },
        { type: "y", part: "health-and-death@1.0.0", params: {} },
      ],
    };
    const refs = extractPartRefs(scene);
    const hp = refs.find((r) => r.id === "health-and-death");
    expect(hp?.count).toBe(2);
  });

  it("merges counts across multiple scenes", () => {
    const a = { systems: [{ type: "s", part: "score@1.0.0", params: {} }] };
    const b = { systems: [{ type: "s", part: "score@1.0.0", params: {} }] };
    const merged = extractPartRefsFromScenes([a, b]);
    expect(merged.find((r) => r.id === "score")?.count).toBe(2);
  });
});
