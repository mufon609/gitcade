// THE TALLY — trust-critical, PURE, and unit-tested (it ships tested or not at all).
//
// Locked voting rules (MASTER-PLAN §2 + Phase 7 prompt):
//   • Pass threshold: 70% of votes CAST (yes / (yes + no)), owner-tunable.
//   • Quorum: a minimum total number of votes (default 10, owner-configurable).
//   • Window: a fixed voting period (default 5 days, owner-configurable 1–14). A
//     proposal is only DECIDED once its window has closed.
//
// "70% of votes cast" means the denominator is (yes + no) — abstentions don't count,
// there are no abstention rows. A proposal PASSES iff the window has closed AND
// quorum is met AND the yes-ratio is ≥ threshold. Everything here is a pure function
// of its inputs so the math can be exhaustively tested away from the DB/clock.

export interface TallyConfig {
  /** Percent of votes cast required to pass (e.g. 70). */
  thresholdPct: number;
  /** Minimum total votes for the result to count. */
  quorum: number;
}

export interface VoteCounts {
  yes: number;
  no: number;
}

export interface TallyResult {
  yes: number;
  no: number;
  total: number;
  /** yes / total in [0,1]; 0 when no votes are cast. */
  yesRatio: number;
  /** yesRatio as a rounded percent for display. */
  yesPct: number;
  quorumMet: boolean;
  thresholdMet: boolean;
  /** Would this tally PASS *if the window were closed*? (quorum AND threshold). */
  passing: boolean;
}

/** Compute the tally from raw yes/no counts. Pure; no time, no DB. The boundary is
 *  INCLUSIVE: a yes-ratio exactly equal to the threshold passes (70% of votes cast,
 *  ≥, not >). */
export function tally(counts: VoteCounts, config: TallyConfig): TallyResult {
  const yes = Math.max(0, Math.floor(counts.yes));
  const no = Math.max(0, Math.floor(counts.no));
  const total = yes + no;
  const yesRatio = total === 0 ? 0 : yes / total;
  // Compare in integer-percent space too, to avoid float dust at the 0.70 boundary
  // (e.g. 7/10 = 0.69999999). thresholdMet iff yesRatio ≥ thresholdPct/100.
  const quorumMet = total >= config.quorum;
  const thresholdMet = total > 0 && yesRatio + 1e-9 >= config.thresholdPct / 100;
  return {
    yes,
    no,
    total,
    yesRatio,
    yesPct: Math.round(yesRatio * 100),
    quorumMet,
    thresholdMet,
    passing: quorumMet && thresholdMet,
  };
}

export type WindowState = "open" | "closed";

/** Is the voting window open at `now`? The window is half-open: [openedAt, closesAt).
 *  At or after closesAt the window is CLOSED (the boundary tick counts as closed, so
 *  a proposal can be finalized the instant its window elapses). A proposal with no
 *  openedAt/closesAt (still DRAFT) reports "open" is false — it isn't accepting votes
 *  yet; callers gate on status separately. */
export function windowState(
  now: number,
  openedAt: Date | null | undefined,
  closesAt: Date | null | undefined,
): WindowState {
  if (!openedAt || !closesAt) return "closed";
  return now >= closesAt.getTime() ? "closed" : "open";
}

/** Compute closesAt from an open time + a window length in days, clamped to the
 *  locked 1–14 day bounds. */
export function computeClosesAt(openedAt: Date, windowDays: number): Date {
  const clamped = Math.min(14, Math.max(1, Math.floor(windowDays)));
  return new Date(openedAt.getTime() + clamped * 24 * 60 * 60 * 1000);
}

export type ProposalOutcome = "passed" | "failed";

/** The DECISION: only meaningful once the window has closed. Returns "passed" iff
 *  the tally is passing (quorum + threshold), else "failed". Open windows have no
 *  outcome yet (returns null). */
export function decideOutcome(
  now: number,
  openedAt: Date | null | undefined,
  closesAt: Date | null | undefined,
  counts: VoteCounts,
  config: TallyConfig,
): ProposalOutcome | null {
  if (windowState(now, openedAt, closesAt) !== "closed") return null;
  return tally(counts, config).passing ? "passed" : "failed";
}
