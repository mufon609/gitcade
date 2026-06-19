import type { SystemFn, World } from "@gitcade/sdk";

/**
 * A top-level entry in the `conditions` list: a predicate (see {@link matches})
 * plus the OUTCOME applied when it fires. Predicate-only sub-conditions inside an
 * `all`/`any` carry no outcome (it's read from the composite that contains them).
 */
interface Condition {
  // --- predicate (one of: state-threshold, state-truthy, entity-count, composite) ---
  /** `world.state` key to test (state-threshold / truthy / falsy). */
  key?: string;
  /** Comparison against `value` for a state-threshold: `"gte"` | `"lte"` | `"eq"`. */
  cmp?: "gte" | "lte" | "eq";
  /** Threshold value (balance → `$cfg`). */
  value?: number;
  /** Match when `world.state[key]` is truthy (a latched flag — no numeric literal needed). */
  truthy?: boolean;
  /** Match when `world.state[key]` is falsy. */
  falsy?: boolean;
  /** Tag whose LIVE entity count (`world.query(tag).length`) is tested. */
  tag?: string;
  /** Count comparison: `"eq"` (default) | `"lte"` | `"gte"` | `"lt"` | `"gt"`. */
  count?: "eq" | "lte" | "gte" | "lt" | "gt";
  /** Composite: matches when ALL sub-conditions match. */
  all?: Condition[];
  /** Composite: matches when ANY sub-condition matches. */
  any?: Condition[];
  // --- outcome (top-level entries only) ---
  /** Outcome when this condition fires. */
  outcome?: "win" | "lose";
  /** Optional label stored in `world.state.winner`. */
  winner?: string;
  /** Optional sound key (defaults to win/lose). */
  sound?: string;
}

/**
 * Generalized end-of-game check. Evaluates a list of conditions in order; the first
 * MATCHING one ends the game: sets `gameOver`, `outcome`, and `winner`, plays a
 * sound, and emits `"gameover"`. Idempotent once the game is over.
 *
 * The condition VOCABULARY:
 *  - **state threshold** `{ key, cmp?, value }` — `world.state[key]` vs a `$cfg`
 *    value with `gte` (default) / `lte` / `eq`. (The base condition.)
 *  - **state truthy/falsy** `{ key, truthy }` / `{ key, falsy }` — a latched flag,
 *    no numeric literal required.
 *  - **entity count** `{ tag, count?, value? }` — `world.query(tag).length` vs
 *    `value` (default `0`, so "field cleared" needs no literal; a non-zero target
 *    must be a `$cfg` ref) with `eq` (default) / `lte` / `gte` / `lt` / `gt`.
 *  - **composition** `{ all: [...] }` / `{ any: [...] }` — boolean AND / OR over
 *    sub-conditions (any of the above, nestable). The outcome lives on the
 *    composite; sub-conditions are predicate-only.
 *
 * A win like tower-defense's "all waves complete AND zero live creeps" is DATA —
 * `{ all: [ {key,truthy}, {tag,count} ] }` — instead of hand-rolled in a custom
 * system.
 *
 * Conditions reference `world.state` keys and tags maintained by other parts
 * (`health-and-death` tallies, `score`, `currency`, a `wave-spawner`'s done flag),
 * keeping all thresholds in `$cfg`.
 *
 * Params:
 *  - `conditions`: array of `{ …predicate…, outcome?, winner?, sound? }`
 */
export const winLoseConditions: SystemFn = (world, params) => {
  if (world.state.gameOver) return;
  const conditions = (Array.isArray(params.conditions) ? params.conditions : []) as Condition[];

  for (const c of conditions) {
    if (!matches(world, c)) continue;

    const outcome = c.outcome ?? "win";
    world.state.gameOver = true;
    world.state.outcome = outcome;
    world.state.winner = c.winner ?? (outcome === "win" ? "player" : "none");
    world.audio.play(c.sound ?? (outcome === "win" ? "win" : "lose"));
    const by = typeof c.key === "string" ? c.key : typeof c.tag === "string" ? c.tag : "composite";
    world.events.emit("gameover", { outcome, winner: world.state.winner, by });
    return;
  }
};

/**
 * Evaluate a condition's PREDICATE (no side effects). Returns false for anything
 * malformed/unrecognized — so a junk entry is simply skipped, exactly as the
 * original per-condition validity guard did.
 */
function matches(world: World, c: Condition | null | undefined): boolean {
  if (!c || typeof c !== "object") return false;

  // Composition first (a composite carries no key/tag of its own).
  if (Array.isArray(c.all)) return c.all.length > 0 && c.all.every((sub) => matches(world, sub));
  if (Array.isArray(c.any)) return c.any.some((sub) => matches(world, sub));

  // Entity-count: compare the live count of a tag to `value` (default 0).
  if (typeof c.tag === "string") {
    const n = world.query(c.tag).length;
    const target = typeof c.value === "number" ? c.value : 0;
    switch (c.count ?? "eq") {
      case "lte":
        return n <= target;
      case "gte":
        return n >= target;
      case "lt":
        return n < target;
      case "gt":
        return n > target;
      default:
        return n === target;
    }
  }

  // State key: truthy/falsy flag, or the original numeric threshold (byte-identical).
  if (typeof c.key === "string") {
    if (c.truthy === true) return !!world.state[c.key];
    if (c.falsy === true) return !world.state[c.key];
    if (typeof c.value !== "number") return false; // the original validity guard
    const v = (world.state[c.key] as number) ?? 0;
    const cmp = c.cmp ?? "gte";
    return cmp === "lte" ? v <= c.value : cmp === "eq" ? v === c.value : v >= c.value;
  }

  return false;
}
