import { describe, it, expect } from "vitest";
import {
  parseManifest,
  parseManifestObject,
  publishGate,
  manifestSnapshot,
} from "@/lib/manifest";

const ECOSYSTEM = {
  name: "Snake",
  slug: "snake",
  description: "Grid snake.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "0.1.0",
  libraryVersion: "0.1.0",
  entryPoint: "src/scenes/main.json",
  license: "MIT",
  authors: [],
  tier: "ecosystem",
};

describe("parseManifest (frozen SDK schema)", () => {
  it("accepts a valid ecosystem manifest and reports its tier", () => {
    const r = parseManifestObject(ECOSYSTEM);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tier).toBe("ecosystem");
  });

  it("rejects invalid JSON with a readable error", () => {
    const r = parseManifest("{ not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not valid JSON/);
  });

  it("rejects an ecosystem manifest missing libraryVersion (schema superRefine)", () => {
    const { libraryVersion, ...bad } = ECOSYSTEM;
    void libraryVersion;
    const r = parseManifestObject(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/libraryVersion/);
  });

  it("rejects a manifest with the wrong engine literal", () => {
    const r = parseManifestObject({ ...ECOSYSTEM, engine: "unity" });
    expect(r.ok).toBe(false);
  });

  it("accepts an open-tier manifest without libraryVersion", () => {
    const r = parseManifestObject({
      ...ECOSYSTEM,
      slug: "my-open-game",
      tier: "open",
      libraryVersion: undefined,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tier).toBe("open");
  });
});

describe("publishGate (tier gating)", () => {
  it("ecosystem games are offered the governance step + full validation", () => {
    const g = publishGate("ecosystem");
    expect(g.offersGovernanceStep).toBe(true);
    expect(g.fullValidation).toBe(true);
  });

  it("open games get neither the governance step nor full validation", () => {
    const g = publishGate("open");
    expect(g.offersGovernanceStep).toBe(false);
    expect(g.fullValidation).toBe(false);
  });
});

describe("manifestSnapshot", () => {
  it("captures a JSON-serializable snapshot with a normalized license", () => {
    const r = parseManifestObject(ECOSYSTEM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = manifestSnapshot(r.manifest);
    expect(snap.slug).toBe("snake");
    expect(snap.license).toMatchObject({ code: "MIT" });
    expect(() => JSON.stringify(snap)).not.toThrow();
  });
});
