import { describe, it, expect, vi, afterEach } from "vitest";
import { throttle } from "../src/fx/screen-effects.js";

afterEach(() => vi.restoreAllMocks());

describe("throttle (screen-FX rate limiter)", () => {
  it("runs the first call, suppresses within the window, fires again after it", () => {
    let t = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    let n = 0;
    const f = throttle(220, () => n++);
    f();
    expect(n).toBe(1); // first call always fires
    t = 1100;
    f();
    expect(n).toBe(1); // 100ms < 220ms → suppressed
    t = 1300;
    f();
    expect(n).toBe(2); // 300ms ≥ 220ms since the last FIRE → fires
  });

  it("forwards the handler arguments (fx, data)", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const seen: unknown[][] = [];
    const f = throttle(50, (...args: unknown[]) => seen.push(args));
    f("fx", { target: "player" });
    expect(seen).toEqual([["fx", { target: "player" }]]);
  });
});
