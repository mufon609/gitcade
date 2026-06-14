import Link from "next/link";

export interface GameCardData {
  slug: string;
  name: string;
  description: string | null;
  tier: "ecosystem" | "open";
  status: "BUILDING" | "LIVE" | "FAILED";
  tags: string[];
}

const STATUS_LABEL: Record<GameCardData["status"], { text: string; cls: string }> = {
  LIVE: { text: "● live", cls: "text-arcade-good" },
  BUILDING: { text: "◌ building", cls: "text-arcade-warn" },
  FAILED: { text: "✕ failed", cls: "text-arcade-bad" },
};

export function GameCard({ game }: { game: GameCardData }) {
  const status = STATUS_LABEL[game.status];
  return (
    <Link
      href={`/games/${game.slug}`}
      className="gc-panel group flex flex-col gap-2 p-4 no-underline transition-colors hover:border-arcade-accent"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-arcade-ink group-hover:text-arcade-accent">{game.name}</h3>
        <span className={`text-xs ${status.cls}`}>{status.text}</span>
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-arcade-mute">
        {game.description || "No description."}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <span className={`gc-chip ${game.tier === "ecosystem" ? "gc-tier-ecosystem" : "gc-tier-open"}`}>
          {game.tier}
        </span>
        {game.tags.slice(0, 3).map((t) => (
          <span key={t} className="gc-chip">
            #{t}
          </span>
        ))}
      </div>
    </Link>
  );
}
