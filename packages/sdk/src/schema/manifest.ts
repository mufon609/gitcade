import { z } from "zod";
import { ExactSemverSchema, SlugSchema } from "./common.js";

/** Game tier (Locked Decision: two game tiers). */
export const TierSchema = z.enum(["ecosystem", "open"]);
export type Tier = z.infer<typeof TierSchema>;

/**
 * License block. The Locked Decision distinguishes code (MIT) from assets (CC-BY)
 * and enforces them at upload. A plain string is accepted for convenience and
 * normalized to `{ code }`.
 */
export const LicenseSchema = z.union([
  z.string(),
  z.object({
    code: z.string().default("MIT"),
    assets: z.string().default("CC-BY-4.0"),
  }),
]);
export type License = z.infer<typeof LicenseSchema>;

/** An author entry: a bare name or a structured record. */
export const AuthorSchema = z.union([
  z.string(),
  z.object({
    name: z.string().min(1),
    email: z.string().optional(),
    url: z.string().optional(),
    github: z.string().optional(),
  }),
]);
export type Author = z.infer<typeof AuthorSchema>;

/**
 * `game.json` — the manifest every GitCade game ships. This is the ROOT of the
 * frozen contract: the platform, build worker, validator, marketplace and
 * governance all read it.
 *
 * Tier rules (enforced by `superRefine`):
 *  - `engine` is always the literal `"gitcade-sdk"`.
 *  - `sdkVersion` is an exact pin (never a range) — Locked Decision: SDK versioning.
 *  - `libraryVersion` is REQUIRED for the `ecosystem` tier (it pins which catalog
 *    `partId@version` references resolve against) and omitted for the `open` tier.
 *
 * FROZEN at the end of Phase 1.
 */
export const GameManifestSchema = z
  .object({
    name: z.string().min(1),
    slug: SlugSchema,
    description: z.string().default(""),
    /** The game's own version (independent of the SDK). */
    version: ExactSemverSchema,
    engine: z.literal("gitcade-sdk"),
    /** Exact `@gitcade/sdk` version this game is built and validated against. */
    sdkVersion: ExactSemverSchema,
    /** Exact `@gitcade/library` version; required for ecosystem tier. */
    libraryVersion: ExactSemverSchema.optional(),
    /** Path (relative to game root) of the entry scene JSON, e.g. `"src/scenes/main.json"`. */
    entryPoint: z.string().min(1),
    license: LicenseSchema.default("MIT"),
    authors: z.array(AuthorSchema).default([]),
    tier: TierSchema,
  })
  .superRefine((m, ctx) => {
    if (m.tier === "ecosystem" && !m.libraryVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["libraryVersion"],
        message: "libraryVersion (exact semver pin) is required for the ecosystem tier",
      });
    }
  });

export type GameManifest = z.infer<typeof GameManifestSchema>;

/** Normalize a license value to its structured form. */
export function normalizeLicense(license: License): { code: string; assets: string } {
  if (typeof license === "string") return { code: license, assets: "CC-BY-4.0" };
  return { code: license.code ?? "MIT", assets: license.assets ?? "CC-BY-4.0" };
}
