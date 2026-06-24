import type { Game, RunRecording } from "@gitcade/sdk";

/**
 * Restore a recording's captured ENTRY onto a LIVE game — the non-replay counterpart to the restore
 * {@link createReplay} does internally for a REPLAY game. A fresh Game booted DIRECTLY at a
 * mid-campaign level (createGame's `entrySceneId`) starts from DEFAULTS: it carries none of the slice
 * (carriedHp / motes / lives) the level was reached with, and its seeded RNG sits at position 0. This
 * re-applies the recording's {@link RunRecording.entryState} onto `world.state` and fast-forwards the
 * seeded RNG to {@link RunRecording.entryRngCalls}, so a LIVE re-entry of a level (a retry, a
 * level-select) resumes from the SAME start the run was recorded at — and the Echo of that recording
 * and the live run it precedes share one start state.
 *
 * Call it AFTER `createGame` (so `loadScene` has run) and BEFORE `game.start()` / the first `update()`.
 * The live recorder then captures this same entry as the NEW run's frame 0, keeping every re-entry
 * self-consistent (its own recording replays in isolation at the same state + phase). It mirrors
 * {@link createReplay}'s restore EXACTLY — clear-then-assign `world.state`, then `advanceRngTo` — so a
 * live run driven through the recorded input would reproduce the recording byte-for-byte: the
 * determinism contract is SHARED with the replay path, not re-derived.
 *
 * Purely additive + back-compatible: a recording WITHOUT `entryState`/`entryRngCalls` (an older one, or
 * a from-scratch entry-level run that carried nothing) restores nothing — both guards fall through — so
 * it is a safe no-op there, and re-entering the FIRST level (whose captured entry is just the stamped
 * `level` index) restores a slice the fresh boot already established. Host-side CODE like the rest of
 * `replay/` (it orchestrates a Game): it registers no runtime type and adds no CATALOG entry.
 */
export function restoreRecordingEntry(game: Game, recording: RunRecording): void {
  if (recording.entryState) {
    const state = game.world.state;
    // Clear-then-assign (createReplay's own pattern) makes `world.state` EXACTLY the captured slice,
    // not a merge over whatever the fresh boot seeded. The JSON round-trip deep-clones so the live state
    // never aliases the recording as it mutates — anything a recording can carry is JSON-serializable by
    // construction, so the round-trip is total.
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, JSON.parse(JSON.stringify(recording.entryState)) as Record<string, unknown>);
  }
  if (recording.entryRngCalls !== undefined) {
    // Fast-forward the fresh game's seeded stream to the phase the recorded run entered at (no-op when
    // already at/past it). A from-scratch entry level recorded phase 0, so this is a no-op there too.
    game.world.advanceRngTo(recording.entryRngCalls);
  }
}
