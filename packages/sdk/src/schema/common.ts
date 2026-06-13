import { z } from "zod";

/**
 * Exact semver string (no ranges, no `^`/`~`/`*`). Used for `sdkVersion` and
 * `libraryVersion` pins in {@link GameManifestSchema}. A pin must resolve to one
 * immutable published version so a later SDK/library release can never silently
 * change a published game (Locked Decision: SDK/part versioning).
 */
export const ExactSemverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/,
    "must be an exact semver version (e.g. \"1.2.3\"), not a range",
  );

/** A slug: lowercase, digits, hyphens. Double-hyphens allowed for fork naming
 * (`{original-slug}--{username}`, Locked Decision: fork naming). */
export const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-+[a-z0-9]+)*$/,
    "must be lowercase letters, digits and hyphens (e.g. \"tower-defense\" or \"snake--ada\")",
  );

/** A 2D position in world (canvas) pixels. */
export const Vec2Schema = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof Vec2Schema>;

/** A 2D size in pixels. */
export const SizeSchema = z.object({ w: z.number(), h: z.number() });
export type Size = z.infer<typeof SizeSchema>;
