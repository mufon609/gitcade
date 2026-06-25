import { describe, it, expect } from "vitest";
import { createCampaign } from "../src/campaign.js";

/**
 * 1.13.0 — {@link createCampaign}, the PURE level-navigation policy graduated from lumen's host loop into
 * the library so any campaign game reuses it. No SDK / DOM / Game — just the ordered id list + string
 * keys, so a host's first / next / isFinal / label decisions are unit-testable without a runtime.
 */
describe("createCampaign — ordered level-sequence navigation policy", () => {
  it("exposes the verbatim sequence, the first level, and per-id next/isFinal/label", () => {
    const c = createCampaign(["level-1", "level-2", "level-3"]);
    expect(c.levels).toEqual(["level-1", "level-2", "level-3"]);
    expect(c.first).toBe("level-1");

    expect(c.next("level-1")).toBe("level-2");
    expect(c.next("level-2")).toBe("level-3");
    expect(c.next("level-3")).toBeNull(); // the final level has no successor (the win edge)

    expect(c.isFinal("level-1")).toBe(false);
    expect(c.isFinal("level-2")).toBe(false);
    expect(c.isFinal("level-3")).toBe(true);

    expect(c.label("level-1")).toBe("Level 1");
    expect(c.label("level-3")).toBe("Level 3");
  });

  it("an UNKNOWN id has no next and counts as final (a degenerate, non-advancing edge)", () => {
    const c = createCampaign(["level-1", "level-2"]);
    expect(c.next("nope")).toBeNull();
    expect(c.isFinal("nope")).toBe(true); // next === null ⇒ isFinal true; a host treats it as nowhere-to-advance
    expect(c.label("nope")).toBe("Level 0"); // indexOf -1 + 1 — a host only labels known ids in practice
  });

  it("a SINGLE-level campaign: the lone level is both first and final", () => {
    const c = createCampaign(["only"]);
    expect(c.first).toBe("only");
    expect(c.isFinal("only")).toBe(true);
    expect(c.next("only")).toBeNull();
  });

  it("an EMPTY sequence is coherent (first is undefined; nothing advances) — no throw", () => {
    const c = createCampaign([]);
    expect(c.levels).toEqual([]);
    expect(c.first).toBeUndefined();
    expect(c.next("x")).toBeNull();
    expect(c.isFinal("x")).toBe(true);
  });
});
