// The anti-brigading rule, documented PROMINENTLY wherever voting happens (locked
// Phase 7 requirement). Single source of truth so the rule shown to users matches
// the rule enforced in governance-eligibility.ts.
export function AntiBrigadingNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-xs text-arcade-mute">
        🛡 To vote you must <b>join the community</b>, have an account older than <b>7 days</b>, and have{" "}
        <b>played this game</b> (or contributed to it).
      </p>
    );
  }
  return (
    <div className="gc-panel border-arcade-edge/80 p-4">
      <h3 className="text-sm font-bold text-arcade-ink">🛡 Who can vote — anti-brigading rules</h3>
      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-arcade-mute">
        <li>You must be a <b>member of this game&apos;s community</b> (join below).</li>
        <li>Your account must be <b>older than 7 days</b>.</li>
        <li>
          You must have a <b>recorded play session on this game</b> — or a prior contribution to it (a proposal you
          authored, or a fork you own).
        </li>
      </ul>
      <p className="mt-2 text-xs text-arcade-mute">
        Proposals pass at a <b>70% supermajority</b> of votes cast, with a minimum quorum. Lost the vote? Democracy has
        an <b>exit door</b>: fork the game with the proposal applied and build it anyway.
      </p>
    </div>
  );
}
