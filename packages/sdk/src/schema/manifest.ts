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
 * Cross-RUN persistence binding (0.2.0 additive, G6). Declares which
 * `world.state` keys survive a reload, the storage slot they round-trip through
 * (the bridge already namespaces by `gameSlug + branch`), and an autosave cadence.
 * Consumed by the library `persistence` system; absent ⇒ no persistence (0.1.x
 * behavior unchanged). The cross-SCENE/in-session hand-off set lives separately on
 * `scene.flow.persist` (OQ-6 split).
 */
export const PersistSchema = z.object({
  /** `world.state` keys persisted across runs (saved on change/interval, loaded on boot). */
  keys: z.array(z.string()).default([]),
  /** Storage key/namespace suffix for the save blob. */
  slot: z.string().default("save"),
  /** Autosave cadence in seconds (0 = save only on change / scene change / explicit emit). */
  everySeconds: z.number().nonnegative().default(0),
});
export type PersistConfig = z.infer<typeof PersistSchema>;

/**
 * A single machine-readable control hint (additive). Pairs an input label with the
 * action it performs, so the platform can render "Space · Rise" on game cards and the
 * detail page instead of scraping a title scene's prose.
 */
export const ControlHintSchema = z.object({
  /** The input as shown to players, e.g. `"Space"`, `"Arrows / WASD"`, `"Tap"`. */
  input: z.string().min(1),
  /** What that input does, e.g. `"Rise"`, `"Move"`, `"Place tower"`. */
  action: z.string().min(1),
});
export type ControlHint = z.infer<typeof ControlHintSchema>;

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
    /** Cross-run persistence binding (0.2.0 additive, G6); absent ⇒ no persistence. */
    persist: PersistSchema.optional(),
    /** Machine-readable control hints for the platform UI (additive); absent ⇒ none shown. */
    controls: z.array(ControlHintSchema).optional(),
    /**
     * Ordered level sequence (0.6.0 additive, E11). Scene ids that make up the
     * game's playable progression, in order. Makes "this game is a campaign of N
     * levels" a FIRST-CLASS, introspectable fact (a platform can show a level
     * count / level-select; the validator can prove the chain resolves) instead of
     * an emergent chain of `flow.on` string events. Enables the reserved flow
     * targets `"@next"`/`"@first"` (no per-level destination wiring) and makes the
     * runtime set `world.state.level` to the 1-based index of the active level, so
     * the difficulty counter that `scale-by-state` reads tracks the stage for free.
     * Absent ⇒ no campaign concept (every 0.x game), so the field is purely additive.
     */
    levels: z.array(z.string().min(1)).optional(),
    /** Scene id to route to when `"@next"` advances past the last level (e.g. a win screen). */
    levelsComplete: z.string().min(1).optional(),
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
