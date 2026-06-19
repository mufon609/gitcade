/**
 * The structural numeric-key whitelist for the mechanical no-magic-numbers rule.
 *
 * GitCade's governance thesis is "most community votes are one-line `config.json`
 * diffs" — which only holds if *balance* numbers (speeds, costs, damage, spawn
 * rates, health, cooldowns) never get hardcoded inside behavior/system params.
 * The validator therefore FAILS any numeric literal appearing in a behavior or
 * system `params` block UNLESS its key is on this whitelist. Everything else
 * must be a `$cfg.<key>` reference resolved from `config.json`.
 *
 * The whitelist is intentionally limited to *structural / presentational* keys —
 * geometry, layout, layering, animation framing, anchors. These describe where a
 * thing is and how it draws, not how it is balanced, so a community would never
 * meaningfully "vote" on them and they belong inline.
 *
 * This list is the single source of truth: the validator imports it directly, so
 * the documented rule and the enforced rule can never drift. It is part of the
 * FROZEN contract — adding keys is a minor (additive) change; removing or
 * repurposing one is a breaking change.
 *
 * Note: the rule applies ONLY to `behaviors[].params` and `systems[].params`.
 * Sprite/tilemap/background fields are presentational data, not balance, and are
 * never subject to the magic-number rule.
 */
export const WHITELISTED_NUMERIC_PARAM_KEYS: ReadonlySet<string> = new Set([
  // --- Position / translation ---
  "x",
  "y",
  "z",
  "position",
  "offset",
  "offsetX",
  "offsetY",
  "dx",
  "dy",

  // --- Size / extent ---
  "w",
  "h",
  "width",
  "height",
  "radius",
  "size",
  "padding",
  "paddingX",
  "paddingY",
  "margin",

  // --- Anchoring / pivot ---
  "anchor",
  "anchorX",
  "anchorY",
  "pivotX",
  "pivotY",

  // --- Transform (presentational) ---
  "rotation",
  "angle",
  "scale",
  "scaleX",
  "scaleY",

  // --- Layering / draw order / opacity ---
  "layer",
  "zIndex",
  "depth",
  "opacity",
  "alpha",

  // --- Sprite-sheet framing / animation indices ---
  "frame",
  "frameIndex",
  "frameStart",
  "frameEnd",
  "frameCount",
  "frameWidth",
  "frameHeight",
  "from",
  "to",
  "fps",

  // --- Grid / tilemap structural indices ---
  "index",
  "row",
  "col",
  "rows",
  "cols",
  "tile",
  "tileSize",
  "tileWidth",
  "tileHeight",

  // --- Misc structural (non-balance) ---
  "strokeWidth",
  "lineWidth",
]);

/**
 * True if a raw numeric literal under `key` is allowed in behavior/system params
 * without a `$cfg` reference (i.e. the key is structural, not balance).
 */
export function isWhitelistedNumericKey(key: string): boolean {
  return WHITELISTED_NUMERIC_PARAM_KEYS.has(key);
}
