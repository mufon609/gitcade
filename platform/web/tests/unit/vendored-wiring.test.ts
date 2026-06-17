import { describe, it, expect } from "vitest";
import { planVendoredWiring } from "@/lib/remix-service";

// The pure decision behind a vendoring remix: when a community (user) part is swapped
// in, the fork must commit the wiring that REGISTERS it at runtime — otherwise the
// build's headless/smoke check throws "unknown behavior type". See the HIGH finding.

const STUB_INDEX = `import type { Registry } from "@gitcade/sdk";
export function registerCustomBehaviors(_registry: Registry): void {}
`;

describe("planVendoredWiring", () => {
  it("no-ops when nothing was vendored", () => {
    const r = planVendoredWiring({ tier: "open", hasVendored: false, customBehaviorsIndex: null, smokeTest: null });
    expect(r).toEqual({ ok: true, files: [] });
  });

  it("fails (does not commit) when the fork has no custom-behaviors hook", () => {
    const r = planVendoredWiring({ tier: "open", hasVendored: true, customBehaviorsIndex: null, smokeTest: null });
    expect(r.ok).toBe(false);
  });

  it("installs the managed wrapper + preserves the original on the first vendoring (open tier)", () => {
    const r = planVendoredWiring({ tier: "open", hasVendored: true, customBehaviorsIndex: STUB_INDEX, smokeTest: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const original = r.files.find((f) => f.path === "src/custom-behaviors/_gitcade-original.ts");
    const index = r.files.find((f) => f.path === "src/custom-behaviors/index.ts");
    expect(original?.content).toBe(STUB_INDEX); // preserved verbatim, not clobbered
    expect(index?.content).toContain("managed custom-behaviors registry");
    expect(index?.content).toContain('import.meta.glob("../vendored-parts/*.{ts,js}"');
    expect(index?.content).toContain('from "./_gitcade-original.js"');
    expect(index?.content).toContain("registry.registerBehavior(");
  });

  it("is idempotent — an already-managed index needs no rewrite (the glob picks new files up)", () => {
    const managed = planVendoredWiring({ tier: "open", hasVendored: true, customBehaviorsIndex: STUB_INDEX, smokeTest: null });
    expect(managed.ok).toBe(true);
    if (!managed.ok) return;
    const managedIndex = managed.files.find((f) => f.path === "src/custom-behaviors/index.ts")!.content;
    const again = planVendoredWiring({ tier: "open", hasVendored: true, customBehaviorsIndex: managedIndex, smokeTest: null });
    expect(again).toEqual({ ok: true, files: [] });
  });

  it("ecosystem: blocks when the smoke test does not load custom behaviors (breakout-class)", () => {
    const smokeNoCustom = `import { createLibraryRegistry } from "@gitcade/library";\nconst registry = createLibraryRegistry();`;
    const r = planVendoredWiring({ tier: "ecosystem", hasVendored: true, customBehaviorsIndex: STUB_INDEX, smokeTest: smokeNoCustom });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/test harness/i);
  });

  it("ecosystem: proceeds when the smoke test loads custom behaviors", () => {
    const smokeCustom = `import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";\nregisterCustomBehaviors(registry);`;
    const r = planVendoredWiring({ tier: "ecosystem", hasVendored: true, customBehaviorsIndex: STUB_INDEX, smokeTest: smokeCustom });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files.map((f) => f.path)).toContain("src/custom-behaviors/index.ts");
  });
});
