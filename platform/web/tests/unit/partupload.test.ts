import { describe, it, expect, vi } from "vitest";
import { precheckPartUpload, buildPartJson, type PartUploadInput } from "@/lib/partupload";

const base: PartUploadInput = {
  id: "drift-x",
  kind: "behavior",
  category: "movement",
  tags: ["custom"],
  description: "drifts",
  license: "MIT",
  source: "export const x = () => {};",
  test: "import { it } from 'vitest';",
  ownerId: "u1",
};

describe("partupload — precheck", () => {
  it("accepts a well-formed submission", () => {
    expect(precheckPartUpload(base)).toEqual([]);
  });

  it("requires a kebab-case id", () => {
    expect(precheckPartUpload({ ...base, id: "Drift X" }).length).toBeGreaterThan(0);
  });

  it("requires a license selection (mandatory)", () => {
    expect(precheckPartUpload({ ...base, license: "" as unknown as "MIT" }).some((e) => /license/i.test(e))).toBe(true);
  });

  it("requires a unit test (the gate)", () => {
    expect(precheckPartUpload({ ...base, test: "" }).some((e) => /unit test/i.test(e))).toBe(true);
  });
});

describe("partupload — part.json shape feeds the catalog schema", () => {
  it("builds a schema-shaped part object", () => {
    const p = buildPartJson(base);
    expect(p).toMatchObject({
      id: "drift-x",
      kind: "behavior",
      version: "1.0.0",
      license: "MIT",
      definition: { type: "drift-x", params: {} },
    });
    expect(Array.isArray(p.dependencies)).toBe(true);
  });
});

describe("partupload — sandbox gate (injected runner)", () => {
  it("rejects when the sandbox test stage fails, surfacing the verbatim log", async () => {
    // Use the injectable runner so this stays infra-free (no docker in unit tests).
    const { publishUserPart } = await import("@/lib/partupload");
    const runSandbox = vi.fn().mockResolvedValue({ ok: false, stage: "test", log: "FAIL: expected 5" });
    const result = await publishUserPart({ ...base, runSandbox });
    expect(runSandbox).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("test");
      expect(result.log).toContain("FAIL: expected 5");
    }
  });
});
