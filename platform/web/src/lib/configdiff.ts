// THE CONFIG DIFF — the most load-bearing piece of Phase 5. A config.json is a
// recursive record of tunable leaves (number | string | boolean); the SDK resolves
// `$cfg.<dotted.path>` references against it. A rebalance is therefore a set of
// leaf-value changes ("towerCost.arrow: 50 → 30"). This module flattens two config
// blobs to dotted leaf paths and diffs them.
//
// It is built as a PURE, framework-free function (no React, no DOM, no I/O) on
// purpose: Phase 7 governance turns a passed proposal INTO exactly this diff and
// commits it. The <ConfigDiff> React component (components/ConfigDiff.tsx) and the
// fork-tree nodes both render the output of `diffConfigs`; keep the logic here so
// the renderer and the governance engine can never drift.

/** A config leaf — the only value types config.json may hold (SDK schema, frozen). */
export type ConfigLeaf = number | string | boolean;

/** A recursive config record (nested objects of leaves), as parsed from config.json. */
export type ConfigTree = { [key: string]: ConfigLeaf | ConfigTree };

export type ChangeKind = "added" | "removed" | "changed" | "unchanged";

export interface ConfigChange {
  /** Dotted leaf path, e.g. "towerCost.arrow". */
  path: string;
  kind: ChangeKind;
  /** Value in the base (left) config — undefined for "added". */
  before?: ConfigLeaf;
  /** Value in the head (right) config — undefined for "removed". */
  after?: ConfigLeaf;
}

export interface ConfigDiffResult {
  changes: ConfigChange[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** True when the two configs are leaf-for-leaf identical. */
  identical: boolean;
}

/** Flatten a config tree to a Map of dotted-path → leaf value. Nested objects
 *  recurse with "." joiners; the SDK already accepts both nested and flat-dotted
 *  config, so this canonical flattening matches `$cfg` resolution. Arrays are not
 *  part of the config schema; if one appears we stringify it as a leaf so the diff
 *  still renders something sensible rather than throwing. */
export function flattenConfig(tree: unknown, prefix = ""): Map<string, ConfigLeaf> {
  const out = new Map<string, ConfigLeaf>();
  if (tree === null || tree === undefined) return out;
  if (typeof tree !== "object") {
    // A bare leaf at the root (shouldn't happen for a real config.json).
    if (prefix) out.set(prefix, tree as ConfigLeaf);
    return out;
  }
  if (Array.isArray(tree)) {
    if (prefix) out.set(prefix, JSON.stringify(tree));
    return out;
  }
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      for (const [kk, vv] of flattenConfig(v, path)) out.set(kk, vv);
    } else if (v !== undefined) {
      out.set(path, v as ConfigLeaf);
    }
  }
  return out;
}

function leafEqual(a: ConfigLeaf | undefined, b: ConfigLeaf | undefined): boolean {
  return a === b;
}

/**
 * Diff two parsed config.json blobs. The result is sorted: changed/added/removed
 * first (alphabetically by path within those), then unchanged — so a renderer can
 * show the meaningful diff up top and collapse the rest.
 */
export function diffConfigs(base: unknown, head: unknown): ConfigDiffResult {
  const a = flattenConfig(base);
  const b = flattenConfig(head);
  const paths = new Set<string>([...a.keys(), ...b.keys()]);

  const changes: ConfigChange[] = [];
  let added = 0,
    removed = 0,
    changed = 0,
    unchanged = 0;

  for (const path of paths) {
    const before = a.get(path);
    const after = b.get(path);
    const inA = a.has(path);
    const inB = b.has(path);
    let kind: ChangeKind;
    if (inA && !inB) {
      kind = "removed";
      removed++;
    } else if (!inA && inB) {
      kind = "added";
      added++;
    } else if (!leafEqual(before, after)) {
      kind = "changed";
      changed++;
    } else {
      kind = "unchanged";
      unchanged++;
    }
    changes.push({ path, kind, before, after });
  }

  const rank: Record<ChangeKind, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  changes.sort((x, y) => rank[x.kind] - rank[y.kind] || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

  return {
    changes,
    added,
    removed,
    changed,
    unchanged,
    identical: added === 0 && removed === 0 && changed === 0,
  };
}

/** Convenience: just the meaningful (non-unchanged) changes. */
export function meaningfulChanges(result: ConfigDiffResult): ConfigChange[] {
  return result.changes.filter((c) => c.kind !== "unchanged");
}

/** Render a single change as the canonical one-liner, e.g. `towerCost.arrow: 50 → 30`. */
export function formatChange(c: ConfigChange): string {
  switch (c.kind) {
    case "changed":
      return `${c.path}: ${fmt(c.before)} → ${fmt(c.after)}`;
    case "added":
      return `${c.path}: + ${fmt(c.after)}`;
    case "removed":
      return `${c.path}: − ${fmt(c.before)}`;
    default:
      return `${c.path}: ${fmt(c.after)}`;
  }
}

function fmt(v: ConfigLeaf | undefined): string {
  if (v === undefined) return "∅";
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}
