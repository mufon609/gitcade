// Pure manifest parsing + tier-gating logic. No I/O — fully unit-testable. The
// web app validates a candidate game.json against the FROZEN SDK manifest schema
// to (a) reject non-GitCade repos early with a readable error, and (b) derive the
// tier that gates the publish UI. THE BUILD WORKER REMAINS THE REAL GATE for
// whether a game goes live (full `gitcade validate` for ecosystem, headless load
// for open) — this is only an early, cheap pre-check + tier read.
import { GameManifestSchema, normalizeLicense, type GameManifest } from "@gitcade/sdk";

export type Tier = "ecosystem" | "open";

export interface ParsedManifest {
  ok: true;
  manifest: GameManifest;
  tier: Tier;
}
export interface ManifestError {
  ok: false;
  /** Human-readable, line-oriented errors safe to surface in the UI. */
  errors: string[];
}
export type ManifestResult = ParsedManifest | ManifestError;

/** Parse a raw game.json string and validate it against the frozen SDK schema. */
export function parseManifest(raw: string): ManifestResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`game.json is not valid JSON: ${(e as Error).message}`] };
  }
  return parseManifestObject(json);
}

/** Validate an already-parsed object against the frozen SDK schema. */
export function parseManifestObject(json: unknown): ManifestResult {
  const result = GameManifestSchema.safeParse(json);
  if (!result.success) {
    const errors = result.error.issues.map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `${path}: ${i.message}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, manifest: result.data, tier: result.data.tier as Tier };
}

export interface PublishGate {
  tier: Tier;
  /** Whether `partId@version` provenance + full structure validation will run in
   *  the worker (ecosystem) vs the lighter open-tier gate. Informational for the
   *  publish UI; the worker enforces it. */
  fullValidation: boolean;
}

/** Tier gating: what the publish flow offers for a given manifest. Pure. */
export function publishGate(tier: Tier): PublishGate {
  return {
    tier,
    fullValidation: tier === "ecosystem",
  };
}

/** A compact, JSON-serializable snapshot stored on the Game row + shown in the UI. */
export function manifestSnapshot(m: GameManifest): Record<string, unknown> {
  const license = normalizeLicense(m.license);
  return {
    name: m.name,
    slug: m.slug,
    description: m.description,
    version: m.version,
    sdkVersion: m.sdkVersion,
    libraryVersion: m.libraryVersion ?? null,
    entryPoint: m.entryPoint,
    tier: m.tier,
    license,
    authors: m.authors,
    // Carried so the game detail page can render a "Controls" strip without re-fetching
    // game.json; null when the manifest declares none (older snapshots simply render nothing).
    controls: m.controls ?? null,
  };
}
