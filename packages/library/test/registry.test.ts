import { describe, it, expect } from "vitest";
import { createDefaultRegistry } from "@gitcade/sdk";
import { registerLibrary, createLibraryRegistry } from "../src/registry.js";
import { LIBRARY_BEHAVIOR_TYPES } from "../src/behaviors/index.js";
import { LIBRARY_SYSTEM_TYPES } from "../src/systems/index.js";

describe("library registration", () => {
  it("registers all 18 behaviors and 12 systems as new TYPES", () => {
    expect(LIBRARY_BEHAVIOR_TYPES).toHaveLength(18);
    // 9 (0.1.x) + 3 new 0.2.0 economy/spawning systems: transaction, persistence, place-on-free-cell.
    expect(LIBRARY_SYSTEM_TYPES).toHaveLength(12);

    const registry = createDefaultRegistry();
    registerLibrary(registry);
    for (const type of LIBRARY_BEHAVIOR_TYPES) expect(registry.hasBehavior(type)).toBe(true);
    for (const type of LIBRARY_SYSTEM_TYPES) expect(registry.hasSystem(type)).toBe(true);
  });

  it("keeps the SDK built-ins available alongside the library", () => {
    const registry = createLibraryRegistry();
    // SDK built-ins (the proofs reuse these directly).
    expect(registry.hasBehavior("velocity")).toBe(true);
    expect(registry.hasSystem("aabb-collision")).toBe(true);
    // Plus a library part.
    expect(registry.hasBehavior("ai-chase")).toBe(true);
    expect(registry.hasSystem("wave-spawner")).toBe(true);
  });

  it("does not mutate the SDK schema — only registers onto a registry instance", () => {
    // A fresh default registry must NOT contain library types (no global leakage).
    const clean = createDefaultRegistry();
    expect(clean.hasBehavior("ai-chase")).toBe(false);
    expect(clean.hasSystem("wave-spawner")).toBe(false);
  });
});
