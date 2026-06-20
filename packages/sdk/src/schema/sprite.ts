import { z } from "zod";

/**
 * Sprite definitions. A discriminated union on `kind` so the renderer can switch
 * cheaply and procedural assets can extend `image`/`sheet` without
 * touching the contract. Colors are CSS color strings; v1 art is geometric.
 *
 * NOTE: sprite numbers (frame sizes, stroke widths) are presentational data and
 * are NOT subject to the no-magic-numbers rule — that rule applies only to
 * behavior/system params.
 */

/** A flat geometric shape — the v1 placeholder art style (Locked Decision: art). */
export const ShapeSpriteSchema = z.strictObject({
  kind: z.literal("shape"),
  shape: z.enum(["rect", "circle", "ellipse", "triangle", "line"]),
  /** CSS fill color, e.g. `"#e5e5e5"`. */
  color: z.string().default("#e5e5e5"),
  /** Optional stroke color. */
  stroke: z.string().optional(),
  /** Stroke width in px (structural). */
  strokeWidth: z.number().nonnegative().optional(),
});

/** A static image referenced by path, resolved relative to the game root/assets. */
export const ImageSpriteSchema = z.strictObject({
  kind: z.literal("image"),
  src: z.string(),
});

/** A sprite sheet with named animations (generated procedurally by the asset pipeline). */
export const SheetSpriteSchema = z.strictObject({
  kind: z.literal("sheet"),
  src: z.string(),
  frameWidth: z.number().positive(),
  frameHeight: z.number().positive(),
  /** Total frames in the sheet (row-major). */
  frameCount: z.number().int().positive(),
  /** Default playback rate. */
  fps: z.number().positive().default(8),
  /** Named animations as inclusive frame ranges. */
  animations: z
    .record(
      z.string(),
      z.strictObject({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        fps: z.number().positive().optional(),
        loop: z.boolean().default(true),
      }),
    )
    .optional(),
});

/**
 * A text sprite. Either a static `text`, or a live binding to a `world.state`
 * key via `bind` (e.g. `bind: "scoreLeft"`). This is how HUD/score readouts are
 * drawn without a special rendering-system signature — a score is just a text
 * entity bound to game state. The library's HUD widgets build on this.
 */
export const TextSpriteSchema = z.strictObject({
  kind: z.literal("text"),
  /** Static text; ignored if `bind` resolves to a value. */
  text: z.string().optional(),
  /** A `world.state` key whose value is rendered live. */
  bind: z.string().optional(),
  /** CSS font string, e.g. `"48px monospace"`. */
  font: z.string().default("24px monospace"),
  color: z.string().default("#e5e5e5"),
  align: z.enum(["left", "center", "right"]).default("left"),
});

/** An explicitly invisible entity (logic-only, triggers, spawners). */
export const NoneSpriteSchema = z.strictObject({ kind: z.literal("none") });

export const SpriteSchema = z
  .discriminatedUnion("kind", [
    ShapeSpriteSchema,
    ImageSpriteSchema,
    SheetSpriteSchema,
    TextSpriteSchema,
    NoneSpriteSchema,
  ])
  // Cross-field range check for sheet animations: the per-clip `from`/`to` are each bounded
  // (nonnegative ints) in isolation, but their RELATIONSHIP to each other and to `frameCount` is
  // not — and `advanceAnim`'s loop math depends on it. A clip is an INCLUSIVE range, so its span is
  // `to - from + 1`; the playhead wraps via `frame % span`. `to < from` makes span ≤ 0 (span 0 →
  // `% 0` → a NaN frame; span < 0 → frames oscillate out of the clip), and `to >= frameCount` runs
  // the playhead off the sheet (the renderer reads a source rect that isn't there). Both pass the
  // per-field schema yet produce a broken animation, so they are caught here, at parse — failing
  // `gitcade validate` and the runtime load rather than corrupting a frame at tick time.
  //
  // This lives on the UNION, not on SheetSpriteSchema, because Zod's discriminatedUnion requires
  // raw ZodObject members (it reads the `kind` discriminator) and rejects a refined (ZodEffects)
  // one; the refine narrows on `kind === "sheet"`, so the other variants are untouched. `from >= 0`
  // is already enforced, and `0 <= from <= to < frameCount` follows from the two checks below, so a
  // separate `from` bound would be redundant (it can never fire alone).
  .superRefine((sprite, ctx) => {
    if (sprite.kind !== "sheet" || !sprite.animations) return;
    for (const [name, clip] of Object.entries(sprite.animations)) {
      if (clip.to < clip.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["animations", name, "to"],
          message: `sheet animation "${name}" has to=${clip.to} < from=${clip.from} — a clip is an inclusive frame range, so to must be >= from (use to===from for a single-frame clip)`,
        });
      }
      if (clip.to >= sprite.frameCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["animations", name, "to"],
          message: `sheet animation "${name}" to=${clip.to} is out of range for a ${sprite.frameCount}-frame sheet (valid frames 0..${sprite.frameCount - 1})`,
        });
      }
    }
  });

export type Sprite = z.infer<typeof SpriteSchema>;
export type ShapeSprite = z.infer<typeof ShapeSpriteSchema>;
export type SheetSprite = z.infer<typeof SheetSpriteSchema>;
export type TextSprite = z.infer<typeof TextSpriteSchema>;
