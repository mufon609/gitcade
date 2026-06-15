import { describe, it, expect } from "vitest";
import {
  tally,
  windowState,
  computeClosesAt,
  decideOutcome,
} from "@/lib/governance-tally";

const CFG = { thresholdPct: 70, quorum: 10 };

describe("tally — 70% of votes cast", () => {
  it("passes at the threshold boundary EXACTLY (7 yes / 3 no = 70%)", () => {
    const r = tally({ yes: 7, no: 3 }, CFG);
    expect(r.total).toBe(10);
    expect(r.yesPct).toBe(70);
    expect(r.thresholdMet).toBe(true);
    expect(r.quorumMet).toBe(true);
    expect(r.passing).toBe(true);
  });

  it("fails one vote below the threshold (69.2% with 9/4)", () => {
    const r = tally({ yes: 9, no: 4 }, CFG); // 9/13 = 69.2%
    expect(r.thresholdMet).toBe(false);
    expect(r.passing).toBe(false);
  });

  it("uses votes CAST as the denominator, not membership (abstentions excluded)", () => {
    // 14 yes, 6 no = 70% of the 20 who voted; non-voters are irrelevant.
    const r = tally({ yes: 14, no: 6 }, CFG);
    expect(r.yesPct).toBe(70);
    expect(r.passing).toBe(true);
  });

  it("is robust to float dust at the boundary (no false fail at 0.6999999…)", () => {
    // 70/100 must read as ≥ 0.70 despite IEEE754.
    expect(tally({ yes: 70, no: 30 }, CFG).thresholdMet).toBe(true);
    expect(tally({ yes: 700, no: 300 }, CFG).thresholdMet).toBe(true);
  });

  it("respects a non-default threshold", () => {
    expect(tally({ yes: 6, no: 4 }, { thresholdPct: 60, quorum: 10 }).passing).toBe(true);
    expect(tally({ yes: 5, no: 5 }, { thresholdPct: 60, quorum: 10 }).passing).toBe(false);
  });
});

describe("tally — quorum", () => {
  it("does NOT pass when quorum is not met even at 100% yes", () => {
    const r = tally({ yes: 9, no: 0 }, CFG); // unanimous but only 9 < 10
    expect(r.thresholdMet).toBe(true);
    expect(r.quorumMet).toBe(false);
    expect(r.passing).toBe(false);
  });

  it("passes exactly at quorum (10 votes) when threshold is met", () => {
    const r = tally({ yes: 8, no: 2 }, CFG); // 80%, total 10
    expect(r.quorumMet).toBe(true);
    expect(r.passing).toBe(true);
  });

  it("zero votes: no threshold, no quorum, not passing", () => {
    const r = tally({ yes: 0, no: 0 }, CFG);
    expect(r.yesRatio).toBe(0);
    expect(r.thresholdMet).toBe(false);
    expect(r.quorumMet).toBe(false);
    expect(r.passing).toBe(false);
  });
});

describe("windowState — open/closed edges", () => {
  const opened = new Date("2026-06-10T00:00:00Z");
  const closes = new Date("2026-06-15T00:00:00Z"); // 5-day window

  it("is OPEN strictly before closesAt", () => {
    expect(windowState(new Date("2026-06-14T23:59:59Z").getTime(), opened, closes)).toBe("open");
  });

  it("is CLOSED at the exact closesAt tick (boundary counts as closed)", () => {
    expect(windowState(closes.getTime(), opened, closes)).toBe("closed");
  });

  it("is CLOSED after closesAt", () => {
    expect(windowState(new Date("2026-06-15T00:00:01Z").getTime(), opened, closes)).toBe("closed");
  });

  it("treats a never-opened proposal (null dates) as closed (not accepting votes)", () => {
    expect(windowState(Date.now(), null, null)).toBe("closed");
    expect(windowState(Date.now(), opened, null)).toBe("closed");
  });
});

describe("computeClosesAt — window length + 1–14 day clamp", () => {
  const opened = new Date("2026-06-10T00:00:00Z");
  it("default 5-day window", () => {
    expect(computeClosesAt(opened, 5).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
  it("clamps below 1 day up to 1", () => {
    expect(computeClosesAt(opened, 0).toISOString()).toBe("2026-06-11T00:00:00.000Z");
  });
  it("clamps above 14 days down to 14", () => {
    expect(computeClosesAt(opened, 30).toISOString()).toBe("2026-06-24T00:00:00.000Z");
  });
});

describe("decideOutcome — only decides once the window closes", () => {
  const opened = new Date("2026-06-10T00:00:00Z");
  const closes = new Date("2026-06-15T00:00:00Z");

  it("returns null while the window is still open (even if currently passing)", () => {
    const now = new Date("2026-06-12T00:00:00Z").getTime();
    expect(decideOutcome(now, opened, closes, { yes: 9, no: 1 }, CFG)).toBeNull();
  });

  it("passes after close when quorum + threshold are met", () => {
    const now = closes.getTime();
    expect(decideOutcome(now, opened, closes, { yes: 8, no: 2 }, CFG)).toBe("passed");
  });

  it("fails after close when quorum is not met", () => {
    const now = new Date("2026-06-16T00:00:00Z").getTime();
    expect(decideOutcome(now, opened, closes, { yes: 5, no: 0 }, CFG)).toBe("failed");
  });

  it("fails after close when threshold is not met", () => {
    const now = new Date("2026-06-16T00:00:00Z").getTime();
    expect(decideOutcome(now, opened, closes, { yes: 6, no: 6 }, CFG)).toBe("failed");
  });
});
