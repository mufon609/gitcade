/**
 * Campaign navigation — the PURE, scene-agnostic policy a host loop reads off an ordered level
 * sequence (typically `manifest.levels`). It is the host-side companion to the SDK's `@next`/`@first`/
 * `@level:<id>` flow tokens and the library `level-select` projection: where those resolve a transition
 * IN-ENGINE, this answers the same "first / next / is-this-the-final-level / how do I label it" questions
 * in HOST code — for a loop that wraps level entry in its own ceremony (an Echo intro, a between-levels
 * choice card, a level-select hub) and so can't lean on a bare flow edge to advance.
 *
 * Pure data over a string list: no SDK, no DOM, no Game — just the ordered ids + string keys, so a host's
 * progression decisions are unit-testable without a runtime, and any campaign game gets first / next /
 * isFinal / label without re-deriving the index math. Host-side CODE like the `replay/` helpers — it
 * registers no runtime type and adds no CATALOG entry.
 */

/** The bound navigation surface over one ordered level list. */
export interface Campaign {
  /** The ordered level sequence (verbatim). */
  readonly levels: string[];
  /** The first level — the campaign start, and where a win restarts. */
  readonly first: string;
  /** The level after `id`, or `null` when `id` is the final level (the win edge) or unknown. */
  next(id: string): string | null;
  /** True when `id` is the last level (no `next`) — clearing it wins rather than advancing. */
  isFinal(id: string): boolean;
  /** Human label for a level ("level-2" → "Level 2"), for a Continue/next-level button. */
  label(id: string): string;
}

/** Bind the navigation policy to one ordered level list (e.g. `manifest.levels`). */
export function createCampaign(levels: string[]): Campaign {
  const next = (id: string): string | null => {
    const i = levels.indexOf(id);
    return i >= 0 ? (levels[i + 1] ?? null) : null;
  };
  return {
    levels,
    first: levels[0],
    next,
    isFinal: (id) => next(id) === null,
    label: (id) => `Level ${levels.indexOf(id) + 1}`,
  };
}
