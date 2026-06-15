// Phase 8A — rate limiter. Unit-tests the PURE pieces (window math, IP extraction,
// the rule registry). The DB-backed atomic counter + the actual 429 are proven by a
// live HTTP probe in SECURITY.md (an infra-free unit test cannot exercise the
// INSERT ... ON CONFLICT path).
import { describe, it, expect } from "vitest";
import { windowStartFor, clientIp, RATE_LIMITS } from "@/lib/ratelimit";
import { NextRequest } from "next/server";

describe("windowStartFor (fixed-window flooring)", () => {
  it("floors `now` to the window boundary", () => {
    expect(windowStartFor(0, 60_000)).toBe(0);
    expect(windowStartFor(59_999, 60_000)).toBe(0);
    expect(windowStartFor(60_000, 60_000)).toBe(60_000);
    expect(windowStartFor(60_001, 60_000)).toBe(60_000);
    expect(windowStartFor(125_000, 60_000)).toBe(120_000);
  });

  it("keeps two timestamps in the same minute in the same window", () => {
    const base = 60_000 * 16_666_666; // a window boundary
    expect(windowStartFor(base + 5_000, 60_000)).toBe(base);
    expect(windowStartFor(base + 30_000, 60_000)).toBe(base);
  });
});

describe("clientIp (proxy header extraction)", () => {
  const mk = (headers: Record<string, string>) =>
    new NextRequest("http://localhost/api/x", { headers });

  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(mk({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIp(mk({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
  });
  it("degrades to a constant when no proxy header is present (one shared bucket, never throws)", () => {
    expect(clientIp(mk({}))).toBe("0.0.0.0");
  });
});

describe("RATE_LIMITS registry", () => {
  it("defines a rule for each of the six endpoints the phase names", () => {
    for (const key of ["publish", "fork", "vote", "proposalCreate", "remixCommit", "bugReport"] as const) {
      expect(RATE_LIMITS[key], key).toBeDefined();
      expect(RATE_LIMITS[key].limit).toBeGreaterThan(0);
      expect(RATE_LIMITS[key].windowMs).toBeGreaterThan(0);
    }
  });
  it("uses unique bucket names so counters never collide across endpoints", () => {
    const buckets = Object.values(RATE_LIMITS).map((r) => r.bucket);
    expect(new Set(buckets).size).toBe(buckets.length);
  });
});
