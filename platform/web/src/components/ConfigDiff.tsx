// REUSABLE config.json diff renderer — the foundation of Phase 7 governance (a
// config-change proposal IS one of these diffs). It takes two parsed config blobs
// (or a precomputed change list) and renders the leaf-value changes as
// "towerCost.arrow: 50 → 30" rows. Used by the fork tree (inline, compact) and the
// compare view (full), and reused verbatim by Phase 7's proposal UI.
import {
  diffConfigs,
  meaningfulChanges,
  formatChange,
  type ConfigChange,
  type ConfigTree,
} from "@/lib/configdiff";

function ChangeRow({ c }: { c: ConfigChange }) {
  const color =
    c.kind === "added"
      ? "text-arcade-good"
      : c.kind === "removed"
        ? "text-arcade-bad"
        : c.kind === "changed"
          ? "text-arcade-warn"
          : "text-arcade-mute";
  const mark = c.kind === "added" ? "+" : c.kind === "removed" ? "−" : c.kind === "changed" ? "~" : " ";
  return (
    <li className="flex gap-2 font-mono text-xs leading-5">
      <span className={`${color} w-3 shrink-0 select-none`}>{mark}</span>
      <span className="text-arcade-ink">{formatChange(c)}</span>
    </li>
  );
}

/**
 * Render a config diff. Provide EITHER `base`+`head` (raw config trees, diffed
 * here) OR a precomputed `changes` list (the fork-tree API already computed it).
 * `compact` shows only the meaningful changes with no surrounding chrome.
 */
export function ConfigDiff({
  base,
  head,
  changes,
  compact = false,
  emptyLabel = "No config changes.",
}: {
  base?: ConfigTree | unknown;
  head?: ConfigTree | unknown;
  changes?: ConfigChange[];
  compact?: boolean;
  emptyLabel?: string;
}) {
  const list = changes ?? meaningfulChanges(diffConfigs(base, head));

  if (list.length === 0) {
    return <p className="text-xs text-arcade-mute">{emptyLabel}</p>;
  }

  if (compact) {
    return (
      <ul className="flex flex-col gap-0.5">
        {list.map((c) => (
          <ChangeRow key={c.path} c={c} />
        ))}
      </ul>
    );
  }

  const changed = list.filter((c) => c.kind === "changed").length;
  const added = list.filter((c) => c.kind === "added").length;
  const removed = list.filter((c) => c.kind === "removed").length;

  return (
    <div className="gc-panel p-3">
      <div className="mb-2 flex items-center gap-3 text-xs text-arcade-mute">
        <span className="font-bold text-arcade-ink">config.json</span>
        {changed > 0 && <span className="text-arcade-warn">~{changed} changed</span>}
        {added > 0 && <span className="text-arcade-good">+{added} added</span>}
        {removed > 0 && <span className="text-arcade-bad">−{removed} removed</span>}
      </div>
      <ul className="flex flex-col gap-0.5">
        {list.map((c) => (
          <ChangeRow key={c.path} c={c} />
        ))}
      </ul>
    </div>
  );
}
