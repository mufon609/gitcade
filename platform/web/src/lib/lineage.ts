// THE FORK TREE — a game's lineage: the parent chain upward and its direct forks
// downward. Each fork edge carries a HEADLINE DIFF: the changed-files count, and
// when config.json is the only changed file, the inline value diffs
// ("towerCost.arrow: 50 → 30") computed by the reusable ConfigDiff core. This is
// the Phase 7 governance preview surface, built once here.
//
// Diffs are computed live via the GitHub compare + contents APIs (with the acting
// user's token when available to lift the rate limit) and degrade gracefully — a
// tree always renders even if GitHub is unreachable; only the diff annotation is
// omitted. (Reversible: Phase 6/7 may cache a config snapshot on the Game row to
// avoid the live calls.)
import { prisma } from "./prisma";
import { parseRepoUrl, compareRefs, getRepoFile } from "./github";
import { diffConfigs, meaningfulChanges, type ConfigChange } from "./configdiff";

const CONFIG_PATH = "config.json";

export interface ForkDiff {
  changedFiles: number;
  /** True when config.json is the ONLY changed file → inline value diffs apply. */
  onlyConfig: boolean;
  /** The meaningful config value changes (present when config.json changed). */
  configChanges?: ConfigChange[];
  /** Set when GitHub couldn't be reached / compared — the tree still renders. */
  error?: string;
}

export interface LineageNode {
  slug: string;
  name: string;
  tier: string;
  status: string;
  /** Diff of THIS node against its parent (null for the root / non-forks). */
  diffVsParent?: ForkDiff | null;
}

export interface Lineage {
  current: LineageNode;
  /** Root → immediate parent (the upward chain above `current`). */
  ancestors: LineageNode[];
  /** Direct forks of `current` (each annotated with its diff vs `current`). */
  forks: LineageNode[];
}

type GameRow = {
  id: string;
  slug: string;
  name: string;
  tier: string;
  status: string;
  repoUrl: string;
  branch: string;
  parentGameId: string | null;
};

const SELECT = {
  id: true,
  slug: true,
  name: true,
  tier: true,
  status: true,
  repoUrl: true,
  branch: true,
  parentGameId: true,
} as const;

/** Compute the headline diff of `child` against `parent` via GitHub. */
export async function computeForkDiff(parent: GameRow, child: GameRow, token?: string): Promise<ForkDiff> {
  const baseRef = parseRepoUrl(parent.repoUrl);
  const headRef = parseRepoUrl(child.repoUrl);
  if (!baseRef || !headRef) return { changedFiles: 0, onlyConfig: false, error: "unparseable repo URL" };

  const cmp = await compareRefs(baseRef, parent.branch, headRef, child.branch, token);
  if (!cmp.ok) return { changedFiles: 0, onlyConfig: false, error: cmp.error };

  const onlyConfig = cmp.files.length === 1 && cmp.files[0] === CONFIG_PATH;
  const touchedConfig = cmp.files.includes(CONFIG_PATH);

  const diff: ForkDiff = { changedFiles: cmp.files.length, onlyConfig };
  if (touchedConfig) {
    // Fetch both config.jsons and diff the leaf values.
    const [baseCfg, headCfg] = await Promise.all([
      getRepoFile(baseRef, CONFIG_PATH, parent.branch, token),
      getRepoFile(headRef, CONFIG_PATH, child.branch, token),
    ]);
    if (baseCfg.ok && headCfg.ok && baseCfg.content && headCfg.content) {
      try {
        const result = diffConfigs(JSON.parse(baseCfg.content), JSON.parse(headCfg.content));
        diff.configChanges = meaningfulChanges(result);
      } catch {
        /* leave configChanges undefined on parse error */
      }
    }
  }
  return diff;
}

/** Build the lineage tree for a game by slug. `token` (optional) lifts GitHub rate
 *  limits when computing diffs. */
export async function getLineage(slug: string, token?: string): Promise<Lineage | null> {
  const current = (await prisma.game.findUnique({ where: { slug }, select: SELECT })) as GameRow | null;
  if (!current) return null;

  // Walk up the parent chain (guard against cycles with a seen-set + depth cap).
  const ancestors: GameRow[] = [];
  const seen = new Set<string>([current.id]);
  let cursor: GameRow | null = current;
  while (cursor?.parentGameId && ancestors.length < 32) {
    const parent = (await prisma.game.findUnique({
      where: { id: cursor.parentGameId },
      select: SELECT,
    })) as GameRow | null;
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    ancestors.push(parent);
    cursor = parent;
  }
  ancestors.reverse(); // root → immediate parent

  // Direct forks of current.
  const forkRows = (await prisma.game.findMany({
    where: { parentGameId: current.id },
    select: SELECT,
    orderBy: { createdAt: "asc" },
  })) as GameRow[];

  const toNode = (g: GameRow, diff?: ForkDiff | null): LineageNode => ({
    slug: g.slug,
    name: g.name,
    tier: g.tier,
    status: g.status,
    diffVsParent: diff ?? null,
  });

  // Diff current vs its immediate parent (last ancestor), and each fork vs current.
  const immediateParent = ancestors.length ? ancestors[ancestors.length - 1] : null;
  const currentDiff = immediateParent ? await computeForkDiff(immediateParent, current, token) : null;
  const forkDiffs = await Promise.all(forkRows.map((f) => computeForkDiff(current, f, token)));

  return {
    current: toNode(current, currentDiff),
    ancestors: ancestors.map((a) => toNode(a)),
    forks: forkRows.map((f, i) => toNode(f, forkDiffs[i])),
  };
}
