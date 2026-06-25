/**
 * Campaign navigation — the PURE, scene-agnostic policy the host loop (main.ts) reads off the ordered
 * level sequence (`manifest.levels`). Factored out of main.ts so it is unit-testable WITHOUT the
 * DOM-laden bootstrap: the loop's "which Echo, advance vs re-enter, is this the final level" decisions
 * are data over the level list, not hard-wired scene ids. No SDK, no DOM — just the list + string keys.
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
  /** Human label for a level ("level-2" → "Level 2"), for the Continue button. */
  label(id: string): string;
}

/** Bind the navigation policy to one ordered level list (`manifest.levels`). */
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
