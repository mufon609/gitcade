// "Made from" — parse a game's scene/entity JSON for `partId@version` provenance
// refs. PURE + framework-free (no I/O), so it is trivially unit-testable and shared
// by the usage indexer and any preview tooling.
//
// The Phase 3 seed scenes annotate every composed catalog part with a `part`
// provenance ref, e.g. `{ "type": "score", "part": "score@1.0.0", "params": {…} }`.
// Refs appear on behavior instances, system instances, and (per the frozen SDK
// schema) optionally on entities. They can also be nested inside prototype params
// (wave-spawner/lives-respawn embed an entity-def whose behaviors carry refs), so
// we walk the WHOLE tree, not just the top-level entities/systems arrays.

export interface PartRef {
  id: string;
  version: string;
}

export interface PartRefCount extends PartRef {
  count: number;
}

const REF_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?)$/;

/** Parse a single `id@version` provenance string. Returns null if malformed. */
export function parsePartRef(ref: unknown): PartRef | null {
  if (typeof ref !== "string") return null;
  const m = ref.trim().match(REF_RE);
  if (!m) return null;
  return { id: m[1], version: m[2] };
}

/** Recursively collect every `part` provenance ref in a parsed scene/entity object,
 *  counting occurrences. Order-independent; dedupes by (id@version). */
export function extractPartRefs(root: unknown): PartRefCount[] {
  const counts = new Map<string, PartRefCount>();

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    // A `part` key holding an id@version string is a provenance ref.
    if ("part" in obj) {
      const ref = parsePartRef(obj.part);
      if (ref) {
        const key = `${ref.id}@${ref.version}`;
        const existing = counts.get(key);
        if (existing) existing.count++;
        else counts.set(key, { ...ref, count: 1 });
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };

  walk(root);
  return [...counts.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : 1,
  );
}

/** Collect refs across multiple scene objects, merging the per-scene counts. */
export function extractPartRefsFromScenes(scenes: unknown[]): PartRefCount[] {
  const merged = new Map<string, PartRefCount>();
  for (const scene of scenes) {
    for (const ref of extractPartRefs(scene)) {
      const key = `${ref.id}@${ref.version}`;
      const existing = merged.get(key);
      if (existing) existing.count += ref.count;
      else merged.set(key, { ...ref });
    }
  }
  return [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
