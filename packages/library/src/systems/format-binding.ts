import type { SystemFn } from "@gitcade/sdk";
import { formatCompact } from "../util.js";

/**
 * One display binding: read a source value, optionally scale/format/template it,
 * and write the result to a `world.state` key a text/HUD sprite binds to.
 */
interface FmtBinding {
  /** Source `world.state` key (omit for a const-only output). */
  from?: string;
  /** Read `entity.state[from]` from this id/tag's entity instead of `world.state[from]` (e.g. a player's hp). */
  fromEntity?: string;
  /** Value used when the source is absent/NaN (resolve via `$cfg` for a config default). */
  fallback?: unknown;
  /** Multiply a numeric source by this `world.state` key (e.g. a prestige multiplier). */
  mult?: string;
  /** Numeric format: `floor` | `round` | `ceil` | `compact` | `fixed:N`. Omit ⇒ raw String(). */
  format?: string;
  /** Value→string lookup (e.g. outcome `win`→"YOU SURVIVED"); wins over format/template. */
  map?: Record<string, string>;
  /** Output when `map` misses (default ""). */
  mapDefault?: string;
  /** Output "" when the numeric value is 0/falsy (e.g. hide "Best: wave N" before any run). */
  emptyWhenZero?: boolean;
  /** Wrap the value in a string: `{v}` = formatted value, `{c}` = the resolved `constant`. */
  template?: string;
  /** A resolved constant for `{c}` (resolve via `$cfg` so config stays single-sourced). */
  constant?: unknown;
  /** Destination `world.state` key (required). */
  to: string;
}

/** Format a numeric value per the `format` token. */
function formatNumber(n: number, format: string): string {
  switch (format) {
    case "floor":
      return String(Math.floor(n));
    case "round":
      return String(Math.round(n));
    case "ceil":
      return String(Math.ceil(n));
    case "compact":
      return formatCompact(n);
    default: {
      if (format.startsWith("fixed:")) {
        const d = Number(format.slice("fixed:".length));
        return n.toFixed(Number.isFinite(d) ? d : 0);
      }
      return String(n);
    }
  }
}

/**
 * `format-binding` — the data replacement for a game's per-frame host `mirror()` rAF
 * loop. Each tick it derives presentation strings from live state and writes them to
 * the `world.state` keys text/HUD sprites bind to, so HUD formatting is SCENE DATA
 * instead of hand-written host JS. Handles the recurring needs the seed games hit:
 * flooring a float score, compacting a big currency (`1.23K`/`4.5M`), templating
 * (`Wave {v}/{c}`), scaling by a multiplier (prestige), reading a child entity's state
 * (a player's hp → a HUD bar), and mapping a discrete value to a label (win/lose).
 *
 * It needs NO schema change — the text sprite's `bind` slot has existed since Phase 1;
 * this just gives the bound keys a declarative source. Runs as a SYSTEM (before the
 * behavior phase, so the values are current by render); restart-safe (pure per-tick,
 * no listeners). A key with no source resolves to the sprite's static `text` for the
 * first frame, then the formatted value.
 *
 * Params:
 *  - `bindings`: an array of {@link FmtBinding}. All numeric leaves must be `$cfg`
 *    refs (use `constant`/`fallback` for config values), so the block stays magic-
 *    number-clean.
 */
export const formatBinding: SystemFn = (world, params) => {
  const bindings = Array.isArray(params.bindings) ? (params.bindings as FmtBinding[]) : [];
  for (const b of bindings) {
    if (!b || typeof b.to !== "string") continue;

    // 1. Resolve the source value (world.state, or a named entity's state).
    let raw: unknown;
    if (typeof b.from === "string") {
      if (typeof b.fromEntity === "string") {
        const e = world.byId(b.fromEntity) ?? world.query(b.fromEntity)[0];
        raw = e ? e.state[b.from] : undefined;
      } else {
        raw = world.state[b.from];
      }
    }

    // 2. Fallback for an absent/NaN source.
    if ((raw === undefined || raw === null || (typeof raw === "number" && Number.isNaN(raw))) && b.fallback !== undefined) {
      raw = b.fallback;
    }

    // 3. Optional multiply by a second state value (e.g. a prestige multiplier).
    if (typeof b.mult === "string" && typeof raw === "number") {
      raw = raw * ((world.state[b.mult] as number) ?? 1);
    }

    // 4. Discrete value → label map (outcomes, statuses) wins over numeric formatting.
    if (b.map && typeof b.map === "object") {
      world.state[b.to] = b.map[String(raw)] ?? b.mapDefault ?? "";
      continue;
    }

    // 5. Hide on zero (e.g. "Best: wave N" before any run).
    if (b.emptyWhenZero && !raw) {
      world.state[b.to] = "";
      continue;
    }

    // 6. Format the value, then optionally template it.
    const formatted =
      typeof raw === "number" && typeof b.format === "string" ? formatNumber(raw, b.format) : raw === undefined ? "" : String(raw);
    if (typeof b.template === "string") {
      world.state[b.to] = b.template.replace("{v}", formatted).replace("{c}", b.constant === undefined ? "" : String(b.constant));
    } else if (b.from === undefined && b.constant !== undefined) {
      world.state[b.to] = String(b.constant); // a const-only output (e.g. a HUD bar's max from $cfg)
    } else {
      world.state[b.to] = formatted;
    }
  }
};
