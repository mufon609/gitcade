import { z } from "zod";

/**
 * Sprite definitions. A discriminated union on `kind` so the renderer can switch
 * cheaply and Phase 2 (procedural assets) can extend `image`/`sheet` without
 * touching the contract. Colors are CSS color strings; v1 art is geometric.
 *
 * NOTE: sprite numbers (frame sizes, stroke widths) are presentational data and
 * are NOT subject to the no-magic-numbers rule — that rule applies only to
 * behavior/system params.
 */

/** A flat geometric shape — the v1 placeholder art style (Locked Decision: art). */
export const ShapeSpriteSchema = z.object({
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
export const ImageSpriteSchema = z.object({
  kind: z.literal("image"),
  src: z.string(),
});

/** A sprite sheet with named animations. Phase 2 generates these procedurally. */
export const SheetSpriteSchema = z.object({
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
      z.object({
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
 * entity bound to game state. Phase 2B's HUD widgets build on this.
 */
export const TextSpriteSchema = z.object({
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
export const NoneSpriteSchema = z.object({ kind: z.literal("none") });

export const SpriteSchema = z.discriminatedUnion("kind", [
  ShapeSpriteSchema,
  ImageSpriteSchema,
  SheetSpriteSchema,
  TextSpriteSchema,
  NoneSpriteSchema,
]);

export type Sprite = z.infer<typeof SpriteSchema>;
export type ShapeSprite = z.infer<typeof ShapeSpriteSchema>;
export type SheetSprite = z.infer<typeof SheetSpriteSchema>;
export type TextSprite = z.infer<typeof TextSpriteSchema>;
