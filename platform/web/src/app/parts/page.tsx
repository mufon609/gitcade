import Link from "next/link";
import { listParts, allTags } from "@/lib/marketplace";
import { PartsBrowser, type BrowsePart } from "./PartsBrowser";
import type { Preview } from "@/components/PartPreview";

export const dynamic = "force-dynamic";

export default async function MarketplacePage() {
  const [parts, tags] = await Promise.all([listParts(), allTags()]);
  const browse: BrowsePart[] = parts.map((p) => ({
    partId: p.partId,
    version: p.version,
    kind: p.kind,
    bucket: p.bucket,
    tags: p.tags,
    description: p.description,
    license: p.license,
    source: p.source,
    preview: (p.preview as Preview) ?? { kind: "none" },
    ownerLogin: p.ownerLogin,
  }));

  const userCount = browse.filter((p) => p.source === "user").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-arcade-mute no-underline">
            ← Arcade
          </Link>
          <h1 className="text-2xl font-bold">Component Marketplace</h1>
          <p className="text-sm text-arcade-mute">
            The interoperable parts every ecosystem game is assembled from. Browse, preview, and
            remix them into a fork — no code.
          </p>
        </div>
        <div className="text-right text-xs text-arcade-mute">
          {browse.length} parts · {userCount} community-published
          <div className="mt-1">
            <Link href="/parts/upload" className="gc-btn gc-btn-primary no-underline">
              + Publish a part
            </Link>
          </div>
        </div>
      </div>

      <PartsBrowser parts={browse} tags={tags} />
    </div>
  );
}
