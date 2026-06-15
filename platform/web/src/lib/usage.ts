// The "made from" usage indexer. Fetches a game's scene JSON from its repo, parses
// the `partId@version` provenance refs, resolves them against the catalog mirror,
// and UPSERTs the GamePart edges. The result drives both the game-page "Made from"
// panel and the part-page "used in N games" count.
//
// We read scenes from the REPO (the source of truth), not the built artifact (which
// is bundled JS). All seed games keep their scenes under src/scenes/*.json with the
// entry scene at manifest.entryPoint; we list that directory and also always
// include the entryPoint, so multi-scene games index fully.
import { prisma } from "./prisma";
import { parseRepoUrl, getRepoFile, listDir } from "./github";
import { extractPartRefsFromScenes, type PartRefCount } from "./madefrom";

/** Pull the scene-bearing source files for a game from its repo and return parsed
 *  JSON objects. Best-effort: unreadable/unparseable files are skipped. */
async function fetchScenes(
  repoUrl: string,
  branch: string,
  entryPoint: string | undefined,
  token?: string,
): Promise<unknown[]> {
  const ref = parseRepoUrl(repoUrl);
  if (!ref) return [];

  const paths = new Set<string>();
  if (entryPoint) paths.add(entryPoint.replace(/^\.?\//, ""));
  // Discover all JSON scenes under src/scenes/ (covers multi-scene games).
  const dir = entryPoint?.includes("/")
    ? entryPoint.slice(0, entryPoint.lastIndexOf("/"))
    : "src/scenes";
  for (const e of await listDir(ref, dir, branch, token)) {
    if (e.type === "file" && e.name.endsWith(".json")) paths.add(e.path);
  }

  const scenes: unknown[] = [];
  for (const p of paths) {
    const file = await getRepoFile(ref, p, branch, token);
    if (!file.ok || !file.content) continue;
    try {
      scenes.push(JSON.parse(file.content));
    } catch {
      /* skip non-JSON */
    }
  }
  return scenes;
}

export interface MadeFromEntry extends PartRefCount {
  /** Resolved catalog Part row id (null if the ref doesn't resolve in the mirror). */
  partRef: string | null;
  kind?: string;
  category?: string;
  description?: string;
  license?: string;
}

/** (Re)index a game's composed parts. Fetches scenes, parses refs, resolves them to
 *  Part rows, and replaces the game's GamePart edges. Returns the resolved list. */
export async function indexGameParts(
  game: { id: string; repoUrl: string; branch: string; manifest: unknown },
  token?: string,
): Promise<MadeFromEntry[]> {
  const manifest = (game.manifest ?? {}) as Record<string, unknown>;
  const entryPoint = typeof manifest.entryPoint === "string" ? manifest.entryPoint : undefined;
  const scenes = await fetchScenes(game.repoUrl, game.branch, entryPoint, token);
  const refs = extractPartRefsFromScenes(scenes);

  // Resolve ALL refs to catalog Part rows in ONE query (collapses the per-ref
  // N+1: was up to 2 `part.findFirst` per ref). Best match per ref: exact version,
  // else any version of that partId. Backed by Part @@unique([partId,version,source]).
  const ids = [...new Set(refs.map((r) => r.id))];
  const rows = ids.length
    ? await prisma.part.findMany({ where: { partId: { in: ids }, source: "catalog" } })
    : [];
  const byId = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byId.get(row.partId);
    if (list) list.push(row);
    else byId.set(row.partId, [row]);
  }
  const resolved: MadeFromEntry[] = refs.map((ref) => {
    const candidates = byId.get(ref.id) ?? [];
    const part = candidates.find((c) => c.version === ref.version) ?? candidates[0];
    return {
      ...ref,
      partRef: part?.id ?? null,
      kind: part?.kind,
      category: part?.category,
      description: part?.description,
      license: part?.license,
    };
  });

  // Replace this game's edges in one transaction (idempotent re-index).
  await prisma.$transaction([
    prisma.gamePart.deleteMany({ where: { gameId: game.id } }),
    ...resolved.map((r) =>
      prisma.gamePart.create({
        data: {
          gameId: game.id,
          partId: r.id,
          version: r.version,
          partRef: r.partRef,
          count: r.count,
        },
      }),
    ),
  ]);

  return resolved;
}

/** Read a game's "made from" panel data from the GamePart mirror, joined to Part
 *  rows. If the game has never been indexed, returns []. */
export async function getMadeFrom(gameId: string): Promise<MadeFromEntry[]> {
  const edges = await prisma.gamePart.findMany({
    where: { gameId },
    include: { part: true },
    orderBy: { partId: "asc" },
  });
  return edges.map((e) => ({
    id: e.partId,
    version: e.version,
    count: e.count,
    partRef: e.partRef,
    kind: e.part?.kind,
    category: e.part?.category,
    description: e.part?.description,
    license: e.part?.license,
  }));
}

/** How many distinct games reference a part id (the part page's "used in N games").
 *  Counts via the indexed GamePart edges. */
export async function usageCountForPart(partId: string): Promise<number> {
  const rows = await prisma.gamePart.findMany({
    where: { partId },
    select: { gameId: true },
    distinct: ["gameId"],
  });
  return rows.length;
}

/** The games that use a part id (for the part page's "used in" list). */
export async function gamesUsingPart(partId: string) {
  const rows = await prisma.gamePart.findMany({
    where: { partId },
    distinct: ["gameId"],
    include: { game: { select: { slug: true, name: true, tier: true, status: true } } },
  });
  return rows.map((r) => r.game).filter(Boolean);
}
