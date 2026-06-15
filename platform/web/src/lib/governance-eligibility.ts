// VOTING ELIGIBILITY — trust-critical anti-brigading rule, PURE + unit-tested.
//
// Locked rule (Phase 7 prompt): a user may vote on a game's proposal iff ALL hold:
//   1. They are a member of the game's community (CommunityMembership).
//   2. Their account is older than 7 days.
//   3. They have a recorded PlaySession on THIS game OR a prior contribution to it.
//
// Both signals (PlaySession, CommunityMembership) already exist in the Phase 4B
// schema by design. "Prior contribution" = authored a proposal on this game, or owns
// a fork of it (the service computes these and passes booleans in). The decision is
// a pure function so it can be exhaustively tested; the DB lookups live in the
// service. This rule is documented PROMINENTLY in the voting UI.

export const MIN_ACCOUNT_AGE_DAYS = 7;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EligibilitySignals {
  /** Member of this game's community. */
  isMember: boolean;
  /** Account age in days (now - user.createdAt). */
  accountAgeDays: number;
  /** Has at least one recorded PlaySession on this game. */
  hasPlaySession: boolean;
  /** Has a prior contribution to this game (authored a proposal, owns a fork, …). */
  hasPriorContribution: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Human-readable reasons a user is NOT eligible (empty when eligible). These are
   *  surfaced in the UI so a blocked voter understands why. */
  reasons: string[];
}

/** Decide voting eligibility from pre-computed signals. The account-age check is
 *  STRICT (> 7 days, not ≥) per the locked rule. */
export function checkEligibility(signals: EligibilitySignals): EligibilityResult {
  const reasons: string[] = [];
  if (!signals.isMember) {
    reasons.push("You must join this game's community to vote.");
  }
  if (!(signals.accountAgeDays > MIN_ACCOUNT_AGE_DAYS)) {
    reasons.push(`Your account must be older than ${MIN_ACCOUNT_AGE_DAYS} days to vote (anti-brigading).`);
  }
  if (!signals.hasPlaySession && !signals.hasPriorContribution) {
    reasons.push("You must have played this game (or contributed to it) before voting.");
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Account age in whole-and-fractional days from a creation date to `now`. */
export function accountAgeDays(createdAt: Date, now: number): number {
  return (now - createdAt.getTime()) / MS_PER_DAY;
}
