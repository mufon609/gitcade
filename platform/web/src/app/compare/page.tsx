// /compare — load two branches OR forks of (usually) the same game side by side,
// each in its own sandboxed iframe with its OWN storage-bridge channel (routed by
// event.source identity). This is the demo moment; the URL fully encodes both
// sides so it is shareable:
//   /compare?a=<slug>&ab=<branch>&b=<slug>&bb=<branch>
//   b=__parent__  → resolves to game A's parent (fork-vs-parent compare).
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { buildArtifactIndexUrl } from "@/lib/artifact-url";
import { parseRepoUrl, getRepoFile } from "@/lib/github";
import { diffConfigs, meaningfulChanges, type ConfigChange } from "@/lib/configdiff";
import { CompareClient } from "./CompareClient";

export const dynamic = "force-dynamic";

interface Side {
  slug: string;
  name: string;
  branch: string;
  repoUrl: string;
  playable: boolean;
  indexUrl: string;
}

async function resolveSide(slug: string | undefined, branch: string | undefined): Promise<Side | null> {
  if (!slug) return null;
  const game = await prisma.game.findUnique({
    where: { slug },
    select: { slug: true, name: true, branch: true, repoUrl: true },
  });
  if (!game) return null;
  const b = branch || game.branch;
  // Playable iff the latest finished build for (slug, branch) succeeded.
  const job = await prisma.buildJob.findFirst({
    where: { gameSlug: slug, branch: b, status: "DONE" },
    orderBy: { createdAt: "desc" },
    include: { build: true },
  });
  const playable = job?.build?.status === "SUCCESS";
  return {
    slug,
    name: game.name,
    branch: b,
    repoUrl: game.repoUrl,
    playable,
    indexUrl: buildArtifactIndexUrl(env.artifactBaseUrl, slug, b),
  };
}

async function configChangesBetween(a: Side, b: Side): Promise<ConfigChange[] | null> {
  const refA = parseRepoUrl(a.repoUrl);
  const refB = parseRepoUrl(b.repoUrl);
  if (!refA || !refB) return null;
  const [cfgA, cfgB] = await Promise.all([
    getRepoFile(refA, "config.json", a.branch),
    getRepoFile(refB, "config.json", b.branch),
  ]);
  if (!cfgA.ok || !cfgB.ok || !cfgA.content || !cfgB.content) return null;
  try {
    return meaningfulChanges(diffConfigs(JSON.parse(cfgA.content), JSON.parse(cfgB.content)));
  } catch {
    return null;
  }
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { a?: string; ab?: string; b?: string; bb?: string };
}) {
  const aSlug = searchParams.a;
  let bSlug = searchParams.b;

  // b=__parent__ → game A's parent.
  if (bSlug === "__parent__" && aSlug) {
    const ga = await prisma.game.findUnique({ where: { slug: aSlug }, select: { parentGameId: true } });
    const parent = ga?.parentGameId
      ? await prisma.game.findUnique({ where: { id: ga.parentGameId }, select: { slug: true } })
      : null;
    bSlug = parent?.slug;
  }

  const sideA = await resolveSide(aSlug, searchParams.ab);
  const sideB = await resolveSide(bSlug, searchParams.bb);

  // A datalist of all games for the picker.
  const allGames = await prisma.game.findMany({ select: { slug: true, name: true }, orderBy: { name: "asc" } });

  const configChanges = sideA && sideB ? await configChangesBetween(sideA, sideB) : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/" className="text-xs text-arcade-mute no-underline">
          ← Arcade
        </Link>
        <h1 className="text-2xl font-bold">Compare-play</h1>
        <p className="text-sm text-arcade-mute">
          Two branches or forks side by side — each with its own isolated storage bridge. This URL is
          shareable.
        </p>
      </div>

      <CompareClient
        sideA={sideA}
        sideB={sideB}
        games={allGames}
        configChanges={configChanges}
        defaults={{ a: aSlug ?? "", ab: searchParams.ab ?? "", b: bSlug ?? "", bb: searchParams.bb ?? "" }}
      />
    </div>
  );
}
