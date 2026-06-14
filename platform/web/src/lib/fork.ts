// THE FORK ENGINE — the killer feature's server half. Shared by the /api/fork
// route (browser, user OAuth token) and the fork-demo script (server, token from
// `gh auth token`) — exactly like publishGame is shared by the publish route + the
// seed script. The flow, in order (the order is load-bearing):
//
//   1. Fork the parent repo under the USER's account (GitHub fork API, user token).
//      The fork API is ASYNC — it returns 202 before the repo exists.
//   2. POLL the new repo with exponential backoff (~30s cap) until its default
//      branch HEAD resolves — i.e. it is actually clonable. Skipping this makes the
//      worker's clone fail intermittently.
//   3. REWRITE the fork's game.json: slug → {parentSlug}--{username}, name →
//      "Name (username's fork)". This is REQUIRED, not cosmetic: the FROZEN worker
//      derives the artifact path from manifest.slug (build.ts), so without a
//      distinct slug the fork's artifact would overwrite the parent's at
//      {slug}/{branch}. Rewriting the slug is the locked fork-naming convention
//      made real, and it gives every fork a collision-free artifact namespace.
//   4. Create the Game row (parentGameId set) and ENQUEUE the build (we never
//      build). Redirect the user to the new game page with honest progress UI.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import {
  parseRepoUrl,
  forkRepo,
  waitForRepoReady,
  getFileWithSha,
  putFile,
  cloneUrl,
  type RepoRef,
} from "./github";
import { parseManifest, manifestSnapshot, type Tier } from "./manifest";

/** Fork slug per the Locked Decision: `{original-slug}--{username}` (lowercased;
 *  GitHub logins are case-insensitive and the SDK slug schema is lowercase-only,
 *  with `--` explicitly allowed for this exact convention). */
export function forkSlug(originalSlug: string, username: string): string {
  return `${originalSlug}--${username.toLowerCase()}`;
}

/** Fork display name per the Locked Decision: "Original Name (username's fork)". */
export function forkDisplayName(originalName: string, username: string): string {
  return `${originalName} (${username}'s fork)`;
}

export interface ForkInput {
  /** Slug of the game being forked (the parent). */
  parentSlug: string;
  /** The platform User.id performing the fork (owns the new fork Game). */
  userId: string;
  /** The user's GitHub OAuth token (public_repo scope). REQUIRED — forking acts as
   *  the user. */
  token: string;
  /** The user's GitHub login, for the fork slug. If omitted we use the login GitHub
   *  reports for the created fork (authoritative — it's where the repo actually lives). */
  username?: string;
  /** Injectable sleeper for deterministic tests of the readiness poll. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ForkSuccess {
  ok: true;
  slug: string;
  gameId: string;
  jobId: string;
  parentSlug: string;
  /** Timing breakdown so the UI / DoD can report honest "click → playable" numbers. */
  timings: { forkMs: number; readyMs: number; rewriteMs: number; totalMs: number; ready: boolean };
}
export interface ForkFailure {
  ok: false;
  stage: "parent" | "auth" | "fork" | "ready" | "manifest" | "rewrite";
  error: string;
}
export type ForkResult = ForkSuccess | ForkFailure;

/** Fork a published game into the acting user's account, rewrite its manifest slug,
 *  register the fork Game, and enqueue its first build. */
export async function forkGame(input: ForkInput): Promise<ForkResult> {
  const t0 = Date.now();
  const parent = await prisma.game.findUnique({ where: { slug: input.parentSlug } });
  if (!parent) return { ok: false, stage: "parent", error: `No game with slug "${input.parentSlug}".` };
  if (!input.token) return { ok: false, stage: "auth", error: "A GitHub token with public_repo scope is required to fork." };

  const parentRef = parseRepoUrl(parent.repoUrl);
  if (!parentRef) return { ok: false, stage: "parent", error: `Parent repo URL is unparseable: ${parent.repoUrl}` };

  // 1. Fork (async on GitHub's side).
  const fork = await forkRepo(parentRef, input.token);
  if (!fork.ok || !fork.ref || !fork.cloneUrl) {
    return { ok: false, stage: "fork", error: fork.error ?? "Fork failed." };
  }
  const forkMs = Date.now() - t0;
  const forkRef = fork.ref;
  // The authoritative username is where GitHub actually put the repo.
  const username = (input.username || forkRef.owner).toLowerCase();

  // 2. Wait until the fork is clonable (poll the default branch HEAD).
  const tReady = Date.now();
  const ready = await waitForRepoReady(forkRef, input.token, { sleep: input.sleep });
  const readyMs = Date.now() - tReady;
  const branch = ready.defaultBranch || fork.defaultBranch || "main";
  if (!ready.ready) {
    // GitHub is slow — surface honest progress rather than enqueueing a build that
    // would fail to clone. (Caller can retry; the fork repo will keep initializing.)
    return {
      ok: false,
      stage: "ready",
      error: `The new fork wasn't clonable within ${Math.round((ready.waitedMs ?? 0) / 1000)}s. GitHub is taking longer than usual — try again in a moment.`,
    };
  }

  // 3. Rewrite the fork's manifest (slug + name) so its artifact path is distinct.
  const tRewrite = Date.now();
  const newSlug = forkSlug(parent.slug, username);
  const file = await getFileWithSha(forkRef, "game.json", branch, input.token);
  if (!file.ok || !file.content) {
    return { ok: false, stage: "manifest", error: file.error ?? "Could not read the fork's game.json." };
  }
  let manifestObj: Record<string, unknown>;
  try {
    manifestObj = JSON.parse(file.content) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, stage: "manifest", error: `Fork game.json is not valid JSON: ${(e as Error).message}` };
  }
  const originalName = typeof manifestObj.name === "string" ? manifestObj.name : parent.name;
  manifestObj.slug = newSlug;
  manifestObj.name = forkDisplayName(originalName, username);
  const rewritten = JSON.stringify(manifestObj, null, 2) + "\n";

  // Validate the rewrite against the FROZEN schema before committing it.
  const parsed = parseManifest(rewritten);
  if (!parsed.ok) {
    return { ok: false, stage: "rewrite", error: `Rewritten manifest is invalid: ${parsed.errors.join("; ")}` };
  }

  // Only commit if something actually changed (idempotent re-forks skip the commit).
  if (file.content.trim() !== rewritten.trim()) {
    const put = await putFile(
      forkRef,
      "game.json",
      branch,
      rewritten,
      `GitCade: initialize fork — slug → ${newSlug}`,
      input.token,
      file.sha,
    );
    if (!put.ok) return { ok: false, stage: "rewrite", error: put.error ?? "Failed to write the fork manifest." };
  }
  const rewriteMs = Date.now() - tRewrite;

  // 4. Register the fork Game (parentGameId set) + enqueue its build.
  const tier = parsed.tier as Tier;
  const snapshot = manifestSnapshot(parsed.manifest);
  const forkCloneUrl = cloneUrl(forkRef);
  const data = {
    name: parsed.manifest.name,
    description: parsed.manifest.description || parent.description || null,
    repoUrl: forkCloneUrl,
    branch,
    ownerId: input.userId,
    tier,
    status: "BUILDING" as const,
    manifest: snapshot as unknown as Prisma.InputJsonValue,
    parentGameId: parent.id,
  };
  const existing = await prisma.game.findUnique({ where: { slug: newSlug } });
  const game = existing
    ? await prisma.game.update({ where: { id: existing.id }, data })
    : await prisma.game.create({ data: { slug: newSlug, ...data } });

  const { id: jobId } = await enqueueBuild({ repoUrl: forkCloneUrl, branch, gameSlug: newSlug });
  await prisma.game.update({ where: { id: game.id }, data: { lastJobId: jobId } });

  return {
    ok: true,
    slug: newSlug,
    gameId: game.id,
    jobId,
    parentSlug: parent.slug,
    timings: { forkMs, readyMs, rewriteMs, totalMs: Date.now() - t0, ready: ready.ready },
  };
}

export type { RepoRef };
