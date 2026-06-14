"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MARKETPLACE_BUCKETS } from "@/lib/catalog";
import { PartPreview, type Preview } from "@/components/PartPreview";

export interface BrowsePart {
  partId: string;
  version: string;
  kind: string;
  bucket: string;
  tags: string[];
  description: string;
  license: string;
  source: "catalog" | "user";
  preview: Preview;
  ownerLogin?: string | null;
}

/** Marketplace browse: group by the 7 buckets, filter by tag, free-text search. */
export function PartsBrowser({ parts, tags }: { parts: BrowsePart[]; tags: string[] }) {
  const [query, setQuery] = useState("");
  const [activeBucket, setActiveBucket] = useState<string>("All");
  const [activeTag, setActiveTag] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parts.filter((p) => {
      if (activeBucket !== "All" && p.bucket !== activeBucket) return false;
      if (activeTag && !p.tags.includes(activeTag)) return false;
      if (q) {
        const hay = `${p.partId} ${p.description} ${p.tags.join(" ")} ${p.kind}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [parts, query, activeBucket, activeTag]);

  const buckets = ["All", ...MARKETPLACE_BUCKETS];
  const grouped = useMemo(() => {
    const map = new Map<string, BrowsePart[]>();
    for (const p of filtered) {
      const arr = map.get(p.bucket) ?? [];
      arr.push(p);
      map.set(p.bucket, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="gc-input min-w-[16rem] flex-1"
          placeholder="Search parts (name, tag, description)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-xs text-arcade-mute">
          {filtered.length} / {parts.length} parts
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {buckets.map((b) => (
          <button
            key={b}
            onClick={() => setActiveBucket(b)}
            className={`gc-chip ${activeBucket === b ? "border-arcade-accent text-arcade-accent" : ""}`}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveTag("")}
          className={`gc-chip ${!activeTag ? "border-arcade-accent text-arcade-accent" : ""}`}
        >
          all tags
        </button>
        {tags.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTag(t === activeTag ? "" : t)}
            className={`gc-chip ${activeTag === t ? "border-arcade-accent text-arcade-accent" : ""}`}
          >
            #{t}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="gc-panel p-6 text-center text-sm text-arcade-mute">
          No parts match your filters.
        </div>
      )}

      {(activeBucket === "All" ? MARKETPLACE_BUCKETS : [activeBucket]).map((bucket) => {
        const items = grouped.get(bucket) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={bucket} className="flex flex-col gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-arcade-mute">
              {bucket} <span className="text-arcade-edge">({items.length})</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <PartCard key={`${p.partId}@${p.version}@${p.source}`} part={p} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PartCard({ part }: { part: BrowsePart }) {
  // Inline preview only for sprites/audio (cheap, no SDK). Behaviors link to the
  // detail page where the live micro-scene runs.
  const inlinePreview =
    part.preview.kind === "sprite" || part.preview.kind === "sfx" || part.preview.kind === "music";
  return (
    <div className="gc-panel flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/parts/${part.partId}`} className="font-bold no-underline hover:text-arcade-accent">
          {part.partId}
        </Link>
        <span className="gc-chip">{part.license}</span>
      </div>
      {inlinePreview && <PartPreview preview={part.preview} size={72} />}
      <p className="line-clamp-2 min-h-[2.5rem] text-xs text-arcade-mute">{part.description}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <span className="gc-chip">{part.kind}</span>
        {part.source === "user" && (
          <span className="gc-chip border-arcade-accent text-arcade-accent">
            by {part.ownerLogin ?? "user"}
          </span>
        )}
        {part.tags.slice(0, 2).map((t) => (
          <span key={t} className="gc-chip">
            #{t}
          </span>
        ))}
      </div>
    </div>
  );
}
