// Marketplace catalog model. Pure helpers shared by the ingest script
// and the marketplace pages. The library's CATALOG.json is the FROZEN source of
// truth (READ here, never reshaped); the Part table is a queryable mirror.
//
// The 7 marketplace buckets are derived from the catalog's (kind, category) per the
// Convention: kind `asset` splits into World vs Audio by its category;
// everything else maps 1:1 from kind.

/** A raw part object as it appears in CATALOG.json. */
export interface CatalogPart {
  id: string;
  kind: "behavior" | "system" | "entity" | "asset" | "ui" | "fx";
  version: string;
  category: string;
  tags: string[];
  description: string;
  license: string;
  dependencies?: string[];
  params?: Record<string, { type: string; balance?: boolean; description: string }>;
  definition: { type: string; params?: Record<string, unknown> };
}

export interface Catalog {
  schemaVersion: number;
  library: string;
  version: string;
  generatedFrom?: string;
  parts: CatalogPart[];
}

/** The seven marketplace category buckets (the navigation the prompt specifies). */
export const MARKETPLACE_BUCKETS = [
  "Behaviors",
  "Systems",
  "Entities",
  "World",
  "Audio",
  "UI",
  "FX",
] as const;
export type MarketplaceBucket = (typeof MARKETPLACE_BUCKETS)[number];

/** Map a part's (kind, category) to its marketplace bucket. `asset` is the only
 *  kind that fans out: world tilesets/backgrounds/cameras → World; synthesized SFX
 *  + music → Audio (the `category` field disambiguates). */
export function bucketFor(kind: string, category: string): MarketplaceBucket {
  switch (kind) {
    case "behavior":
      return "Behaviors";
    case "system":
      return "Systems";
    case "entity":
      return "Entities";
    case "ui":
      return "UI";
    case "fx":
      return "FX";
    case "asset":
      return category === "audio" ? "Audio" : "World";
    default:
      // Unknown kinds bucket under the closest sensible heading rather than throwing.
      return "Behaviors";
  }
}

/** A small, serializable descriptor the marketplace renders a live preview from.
 *  Degrades gracefully: a part with no feasible preview gets kind "none". */
export type PartPreview =
  | { kind: "sprite"; src: string; sheet?: { frameWidth: number; frameHeight: number; frameCount: number } }
  | { kind: "sfx"; sfx: string }
  | { kind: "music"; music: string }
  | { kind: "behavior"; behaviorType: string }
  | { kind: "none" };

/** Derive a preview descriptor from a catalog part's definition. */
export function previewFor(part: CatalogPart): PartPreview {
  const def = part.definition ?? ({} as CatalogPart["definition"]);
  const p = (def.params ?? {}) as Record<string, unknown>;

  // Entities + asset descriptors carry a sprite (image | sheet) we can render from
  // the served asset path.
  const sprite = (p.sprite ?? (def as Record<string, unknown>).sprite) as
    | Record<string, unknown>
    | undefined;
  if (sprite && typeof sprite.src === "string") {
    if (sprite.kind === "sheet" && typeof sprite.frameWidth === "number") {
      return {
        kind: "sprite",
        src: sprite.src as string,
        sheet: {
          frameWidth: sprite.frameWidth as number,
          frameHeight: (sprite.frameHeight as number) ?? (sprite.frameWidth as number),
          frameCount: (sprite.frameCount as number) ?? 1,
        },
      };
    }
    return { kind: "sprite", src: sprite.src as string };
  }
  // Tilesets / backgrounds reference a PNG via an asset descriptor `src`.
  if (typeof p.src === "string" && /\.png$/i.test(p.src as string)) {
    return { kind: "sprite", src: p.src as string };
  }

  // Audio parts: the library's runtime Web Audio synth plays them by their synth
  // key (SFX) / track name (music), carried in the part definition's params.
  if (part.kind === "asset" && part.category === "audio") {
    if (part.tags?.includes("music")) {
      const track = typeof p.track === "string" ? (p.track as string) : part.id;
      return { kind: "music", music: track };
    }
    const key = typeof p.key === "string" ? (p.key as string) : part.id;
    return { kind: "sfx", sfx: key };
  }

  // Behaviors can boot a tiny SDK micro-scene demo in the browser.
  if (part.kind === "behavior") return { kind: "behavior", behaviorType: part.id };

  return { kind: "none" };
}

/** Compatibility for the remix "swap a movement behavior" picker: two behaviors are
 *  swap-compatible when they share the SAME category and at least one tag (derive
 *  compatibility from the catalog — never invent a new system). A movement behavior
 *  can be swapped for any other movement behavior. */
export function behaviorCompatible(a: CatalogPart, b: CatalogPart): boolean {
  if (a.kind !== "behavior" || b.kind !== "behavior") return false;
  if (a.category !== b.category) return false;
  if (a.id === b.id) return false;
  const at = new Set(a.tags ?? []);
  return (b.tags ?? []).some((t) => at.has(t));
}
