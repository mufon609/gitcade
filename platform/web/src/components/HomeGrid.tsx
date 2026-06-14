"use client";

import { useMemo, useState } from "react";
import { GameCard, type GameCardData } from "./GameCard";

/** Home arcade grid with client-side search + filter (tier, tags). */
export function HomeGrid({ games }: { games: GameCardData[] }) {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"all" | "ecosystem" | "open">("all");
  const [tag, setTag] = useState<string>("all");

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const g of games) for (const t of g.tags) s.add(t);
    return ["all", ...[...s].sort()];
  }, [games]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return games.filter((g) => {
      if (tier !== "all" && g.tier !== tier) return false;
      if (tag !== "all" && !g.tags.includes(tag)) return false;
      if (!needle) return true;
      return (
        g.name.toLowerCase().includes(needle) ||
        g.slug.toLowerCase().includes(needle) ||
        (g.description ?? "").toLowerCase().includes(needle) ||
        g.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [games, q, tier, tag]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="gc-input sm:max-w-xs"
          placeholder="Search games…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search games"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-arcade-mute">Tier</label>
          <select
            className="gc-input w-auto"
            value={tier}
            onChange={(e) => setTier(e.target.value as typeof tier)}
            aria-label="Filter by tier"
          >
            <option value="all">all</option>
            <option value="ecosystem">ecosystem</option>
            <option value="open">open</option>
          </select>
        </div>
        {allTags.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-arcade-mute">Tag</label>
            <select
              className="gc-input w-auto"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              aria-label="Filter by tag"
            >
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="text-xs text-arcade-mute sm:ml-auto">
          {filtered.length} / {games.length} games
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-arcade-mute">No games match. Try publishing one →</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      )}
    </div>
  );
}
