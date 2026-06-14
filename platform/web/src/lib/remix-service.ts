// Remix orchestration: ties the pure remix model/apply (lib/remix.ts) to repo I/O
// (read scene+config, commit a single readable change) and the fork-on-demand flow.
// Shared by the /api/remix routes AND the remix-demo verification script (never
// mocked — same pattern as publish/fork).
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import { forkGame, forkSlug } from "./fork";
import { parseRepoUrl, getRepoFile, commitFiles } from "./github";
import {
  getRemixCatalog,
  buildRemixModel,
  applyRemix,
  type RemixModel,
  type RemixEdits,
} from "./remix";
import { validateRemix } from "./remix-validate";
import { diffConfigs } from "./configdiff";

export interface RemixSources {
  scene: Record<string, unknown>;
  scenePath: string;
  config: Record<string, unknown>;
  configPath: string;
}

/** Read the entry scene + config.json for a game from its repo branch. */
export async function loadRemixSources(
  game: { repoUrl: string; branch: string; manifest: unknown },
  token?: string,
): Promise<RemixSources> {
  const ref = parseRepoUrl(game.repoUrl);
  if (!ref) throw new Error(`Unparseable repo URL: ${game.repoUrl}`);
  const manifest = (game.manifest ?? {}) as Record<string, unknown>;
  const scenePath = (typeof manifest.entryPoint === "string" ? manifest.entryPoint : "src/scenes/main.json").replace(
    /^\.?\//,
    "",
  );
  const configPath = "config.json";

  const sceneFile = await getRepoFile(ref, scenePath, game.branch, token);
  if (!sceneFile.ok || !sceneFile.content) throw new Error(`Could not read ${scenePath} from the fork.`);
  const configFile = await getRepoFile(ref, configPath, game.branch, token);
  if (!configFile.ok || !configFile.content) throw new Error(`Could not read ${configPath} from the fork.`);

  return {
    scene: JSON.parse(sceneFile.content) as Record<string, unknown>,
    scenePath,
    config: JSON.parse(configFile.content) as Record<string, unknown>,
    configPath,
  };
}

/** Build the point-and-click remix model for a game the user owns. */
export async function loadRemixModel(
  game: { repoUrl: string; branch: string; manifest: unknown },
  token?: string,
): Promise<RemixModel> {
  const sources = await loadRemixSources(game, token);
  const catalog = await getRemixCatalog();
  return buildRemixModel(sources.scene, sources.config, sources.scenePath, sources.configPath, catalog);
}

export interface EnsureForkResult {
  ok: true;
  /** The slug of the game the user owns and can remix (their fork, or the original
   *  if they already own it). */
  slug: string;
  forked: boolean;
}
export interface EnsureForkFailure {
  ok: false;
  error: string;
}

/**
 * Ensure the user has an OWN copy of `parentSlug` to remix. If they already own
 * the game (it's theirs, or they own its fork), return that. Otherwise fork it on
 * demand (reusing the Phase 5 forkGame), so remix mode always operates on a repo
 * the user can commit to.
 */
export async function ensureRemixableFork(
  parentSlug: string,
  userId: string,
  token: string,
  username: string,
): Promise<EnsureForkResult | EnsureForkFailure> {
  const game = await prisma.game.findUnique({ where: { slug: parentSlug } });
  if (!game) return { ok: false, error: `No game with slug "${parentSlug}".` };

  // Already the user's own game → remix in place.
  if (game.ownerId === userId) return { ok: true, slug: game.slug, forked: false };

  // The user may already own a fork of this game (deterministic fork slug).
  const expectedForkSlug = forkSlug(parentSlug, username);
  const existingFork = await prisma.game.findUnique({ where: { slug: expectedForkSlug } });
  if (existingFork && existingFork.ownerId === userId) {
    return { ok: true, slug: existingFork.slug, forked: false };
  }

  // Fork on demand.
  const fork = await forkGame({ parentSlug, userId, token, username });
  if (!fork.ok) return { ok: false, error: `Fork-on-demand failed (${fork.stage}): ${fork.error}` };
  return { ok: true, slug: fork.slug, forked: true };
}

export interface RemixCommitResult {
  ok: true;
  commit?: string;
  jobId: string;
  summary: string[];
  configChanges: ReturnType<typeof diffConfigs>;
  addedConfigKeys: string[];
}
export interface RemixCommitFailure {
  ok: false;
  /** Validation issues that PREVENTED the commit (surfaced in the UI before commit). */
  issues?: { code: string; message: string; where?: string }[];
  error?: string;
}

/**
 * Apply remix edits to the user's fork and COMMIT them as one readable commit, then
 * enqueue a rebuild. The remix is VALIDATED before committing — an edit that would
 * produce an invalid game is rejected here (in the UI), never after a wasted build.
 */
export async function commitRemix(
  game: { id: string; slug: string; repoUrl: string; branch: string; manifest: unknown },
  edits: RemixEdits,
  token: string,
): Promise<RemixCommitResult | RemixCommitFailure> {
  const ref = parseRepoUrl(game.repoUrl);
  if (!ref) return { ok: false, error: `Unparseable repo URL: ${game.repoUrl}` };

  const sources = await loadRemixSources(game, token);
  const catalog = await getRemixCatalog();
  const applied = applyRemix(sources.scene, sources.config, edits, catalog);

  if (applied.summary.length === 0) {
    return { ok: false, error: "No changes to commit." };
  }

  // THE GATE: prevent an invalid game in the UI, not after committing.
  const issues = validateRemix(applied.scene, applied.config);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const configChanges = diffConfigs(sources.config, applied.config);

  // Compose ONE readable commit: scene + config + any vendored parts.
  const files = [
    { path: sources.scenePath, content: JSON.stringify(applied.scene, null, 2) + "\n" },
    { path: sources.configPath, content: JSON.stringify(applied.config, null, 2) + "\n" },
    ...applied.vendored,
  ];
  const title = `Remix: ${applied.summary.slice(0, 2).join("; ")}${applied.summary.length > 2 ? "; …" : ""}`;
  const message = `${title}\n\n${applied.summary.map((s) => `- ${s}`).join("\n")}\n\nvia GitCade remix mode`;

  const commit = await commitFiles(ref, game.branch, files, message, token);
  if (!commit.ok) return { ok: false, error: commit.error ?? "Commit failed." };

  const { id: jobId } = await enqueueBuild({
    repoUrl: game.repoUrl,
    branch: game.branch,
    commit: commit.commit ?? null,
    gameSlug: game.slug,
  });
  await prisma.game.update({ where: { id: game.id }, data: { lastJobId: jobId, status: "BUILDING" } });

  return {
    ok: true,
    commit: commit.commit,
    jobId,
    summary: applied.summary,
    configChanges,
    addedConfigKeys: applied.addedConfigKeys,
  };
}
