import { describe, it, expect } from "vitest";
import {
  flattenConfig,
  diffConfigs,
  meaningfulChanges,
  formatChange,
} from "@/lib/configdiff";

describe("flattenConfig", () => {
  it("flattens nested config to dotted leaf paths", () => {
    const m = flattenConfig({ towerCost: { arrow: 50, cannon: 120 }, waves: 10 });
    expect(m.get("towerCost.arrow")).toBe(50);
    expect(m.get("towerCost.cannon")).toBe(120);
    expect(m.get("waves")).toBe(10);
    expect(m.size).toBe(3);
  });

  it("treats nested and flat-dotted forms equivalently", () => {
    const nested = flattenConfig({ a: { b: 1 } });
    const flat = flattenConfig({ "a.b": 1 });
    expect(nested.get("a.b")).toBe(flat.get("a.b"));
  });
});

describe("diffConfigs", () => {
  it("detects the canonical rebalance (towerCost.arrow: 50 → 30)", () => {
    const base = { towerCost: { arrow: 50 }, waves: 10 };
    const head = { towerCost: { arrow: 30 }, waves: 10 };
    const result = diffConfigs(base, head);
    expect(result.changed).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.identical).toBe(false);
    const change = result.changes.find((c) => c.path === "towerCost.arrow");
    expect(change).toMatchObject({ kind: "changed", before: 50, after: 30 });
    expect(formatChange(change!)).toBe("towerCost.arrow: 50 → 30");
  });

  it("reports added and removed leaves", () => {
    const result = diffConfigs({ a: 1 }, { a: 1, b: 2 });
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    const reverse = diffConfigs({ a: 1, b: 2 }, { a: 1 });
    expect(reverse.removed).toBe(1);
  });

  it("is identical for equal configs", () => {
    const cfg = { x: 1, y: "two", z: true };
    expect(diffConfigs(cfg, { ...cfg }).identical).toBe(true);
  });

  it("orders changed/added/removed before unchanged", () => {
    const result = diffConfigs({ keep: 1, drop: 2, mod: 3 }, { keep: 1, mod: 4, add: 5 });
    const kinds = meaningfulChanges(result).map((c) => c.kind);
    expect(kinds).not.toContain("unchanged");
    // first meaningful entry is a "changed" (rank 0)
    expect(result.changes[0].kind).toBe("changed");
  });

  it("distinguishes string vs number leaves and formats strings quoted", () => {
    const change = diffConfigs({ label: "fast" }, { label: "slow" }).changes[0];
    expect(formatChange(change)).toBe('label: "fast" → "slow"');
  });
});
