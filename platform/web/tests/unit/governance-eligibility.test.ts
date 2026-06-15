import { describe, it, expect } from "vitest";
import {
  checkEligibility,
  accountAgeDays,
  MIN_ACCOUNT_AGE_DAYS,
} from "@/lib/governance-eligibility";

const eligible = {
  isMember: true,
  accountAgeDays: 30,
  hasPlaySession: true,
  hasPriorContribution: false,
};

describe("checkEligibility — all three signals required", () => {
  it("eligible when member, old enough, and has played", () => {
    const r = checkEligibility(eligible);
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("a prior contribution substitutes for a PlaySession", () => {
    const r = checkEligibility({ ...eligible, hasPlaySession: false, hasPriorContribution: true });
    expect(r.eligible).toBe(true);
  });

  it("BLOCKS a non-member (anti-brigading)", () => {
    const r = checkEligibility({ ...eligible, isMember: false });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/community/i);
  });

  it("BLOCKS an account that has neither played nor contributed", () => {
    const r = checkEligibility({ ...eligible, hasPlaySession: false, hasPriorContribution: false });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/played/i);
  });

  it("accumulates ALL failing reasons", () => {
    const r = checkEligibility({
      isMember: false,
      accountAgeDays: 1,
      hasPlaySession: false,
      hasPriorContribution: false,
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.length).toBe(3);
  });
});

describe("checkEligibility — account-age boundary is STRICT (> 7 days)", () => {
  it("blocks an account younger than 7 days", () => {
    const r = checkEligibility({ ...eligible, accountAgeDays: 3 });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/7 days/);
  });

  it("blocks an account EXACTLY 7 days old (strict greater-than)", () => {
    const r = checkEligibility({ ...eligible, accountAgeDays: MIN_ACCOUNT_AGE_DAYS });
    expect(r.eligible).toBe(false);
  });

  it("allows an account just over 7 days old", () => {
    const r = checkEligibility({ ...eligible, accountAgeDays: 7.01 });
    expect(r.eligible).toBe(true);
  });
});

describe("accountAgeDays", () => {
  it("computes whole days from createdAt to now", () => {
    const created = new Date("2026-06-01T00:00:00Z");
    const now = new Date("2026-06-11T00:00:00Z").getTime();
    expect(accountAgeDays(created, now)).toBe(10);
  });

  it("is fractional for partial days", () => {
    const created = new Date("2026-06-10T00:00:00Z");
    const now = new Date("2026-06-10T12:00:00Z").getTime();
    expect(accountAgeDays(created, now)).toBeCloseTo(0.5, 5);
  });
});
