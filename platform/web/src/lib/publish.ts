// THE PUBLISH SERVICE — the single internal code path for turning a GitHub repo
// into a published Game. The API route (browser OAuth) and the seed script
// (server-side, no browser) BOTH call `publishGame` — the flow is shared, never
// mocked (per the phase contract). The worker is the only thing that builds; this
// service only: validates the manifest early, enforces public-repos-only, creates
// the Game row, and ENQUEUES a 4A build job. THE VALIDATOR IS THE GATE — a Game
// reaches LIVE only when its Build row is SUCCESS (see refreshGameStatus).
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import {
  parseRepoUrl,
  cloneUrl,
  getRepoMeta,
  getRepoFile,
  type RepoRef,
} from "./github";
import {
  parseManifest,
  publishGate,
  manifestSnapshot,
  type Tier,
  type PublishGate,
} from "./manifest";

export interface PublishInput {
  repoUrl: string;
  /** Branch to publish; defaults to the repo's default branch. */
  branch?: string;
  /** The owning platform User.id (the seed/admin user for seeded games). */
  ownerUserId: string;
  /** Optional GitHub token (a user's OAuth token) to raise rate limits / read a
   *  repo the user can see. Public repos need none. */
  token?: string;
}

export interface PublishSuccess {
  ok: true;
  gameId: string;
  slug: string;
  tier: Tier;
  jobId: string;
  deduped: boolean;
  gate: PublishGate;
  reused: boolean;
}
export interface PublishFailure {
  ok: false;
  /** Stage that rejected, so the UI can be specific. */
  stage: "repo-url" | "visibility" | "manifest" | "slug-conflict";
  errors: string[];
}
export type PublishResult = PublishSuccess | PublishFailure;

/**
 * Publish (or re-publish) a game from a public GitHub repo. Idempotent per slug
 * for the same owner: re-publishing an owned game updates its snapshot and
 * re-enqueues a build rather than erroring.
 */
export async function publishGame(input: PublishInput): Promise<PublishResult> {
  const ref = parseRepoUrl(input.repoUrl);
  if (!ref) {
    return {
      ok: false,
      stage: "repo-url",
      errors: [`"${input.repoUrl}" is not a recognizable public GitHub repo URL.`],
    };
  }

  // 1. Public-repos-only (Locked Decision) + resolve the branch to build.
  const meta = await getRepoMeta(ref, input.token);
  if (!meta.ok) {
    return { ok: false, stage: "visibility", errors: [meta.error ?? "Could not read repository."] };
  }
  if (meta.isPrivate) {
    return {
      ok: false,
      stage: "visibility",
      errors: [
        "This repository is private. GitCade v1 publishes PUBLIC repos only — open-source games are the product.",
      ],
    };
  }
  const branch = input.branch?.trim() || meta.defaultBranch || "main";

  // 2. Early manifest pre-check against the FROZEN SDK schema (readable errors,
  //    and the tier we gate on). The worker still runs the real validation gate.
  const file = await getRepoFile(ref, "game.json", branch, input.token);
  if (!file.ok || !file.content) {
    return {
      ok: false,
      stage: "manifest",
      errors: [file.error ?? "game.json not found — is this a GitCade game repo?"],
    };
  }
  const parsed = parseManifest(file.content);
  if (!parsed.ok) {
    return { ok: false, stage: "manifest", errors: parsed.errors };
  }
  const { manifest, tier } = parsed;
  const slug = manifest.slug; // canonical: matches the worker's artifact path prefix

  // 3. Slug conflict guard (forks get distinct slugs in Phase 5).
  const existing = await prisma.game.findUnique({ where: { slug } });
  if (existing && existing.ownerId !== input.ownerUserId) {
    return {
      ok: false,
      stage: "slug-conflict",
      errors: [
        `A game with slug "${slug}" is already published by another user. (Forks get a distinct slug — that lands in Phase 5.)`,
      ],
    };
  }

  // 4. Create or update the Game row (status BUILDING until the worker reports).
  const snapshot = manifestSnapshot(manifest);
  const data = {
    name: manifest.name,
    description: manifest.description || null,
    repoUrl: cloneUrl(ref),
    branch,
    ownerId: input.ownerUserId,
    tier: tier,
    status: "BUILDING" as const,
    // snapshot is JSON-serializable by construction (manifestSnapshot); cast to
    // Prisma's Json input type.
    manifest: snapshot as unknown as Prisma.InputJsonValue,
  };
  const game = existing
    ? await prisma.game.update({ where: { id: existing.id }, data })
    : await prisma.game.create({ data: { slug, ...data } });

  // 5. ENQUEUE the real 4A build job (we never build). gameSlug is the manifest
  //    slug so the worker's artifact path == this Game's slug.
  const { id: jobId, deduped } = await enqueueBuild({
    repoUrl: cloneUrl(ref),
    branch,
    gameSlug: slug,
  });
  await prisma.game.update({ where: { id: game.id }, data: { lastJobId: jobId } });

  return {
    ok: true,
    gameId: game.id,
    slug,
    tier,
    jobId,
    deduped,
    gate: publishGate(tier),
    reused: !!existing,
  };
}

export interface GameBuildStatus {
  /** Build worker outcome for the game's latest enqueued job. */
  state: "BUILDING" | "LIVE" | "FAILED";
  stage?: string | null;
  /** Verbatim worker logs (present on failure; surfaced in the UI as-is). */
  logs?: string | null;
  artifactPath?: string | null;
  commit?: string | null;
}

/**
 * Reconcile a Game's status from its latest Build row and persist the transition.
 * THE VALIDATOR IS THE GATE: the Game flips to LIVE only on Build SUCCESS, and to
 * FAILED (with the worker's verbatim logs) on Build FAILED. No manual override.
 */
export async function refreshGameStatus(gameId: string): Promise<GameBuildStatus> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) return { state: "FAILED", logs: "Game not found." };
  if (!game.lastJobId) return { state: game.status as GameBuildStatus["state"] };

  // The authoritative terminal signal is the JOB, not the Build row. The worker
  // creates the Build row UP FRONT with a placeholder status ("FAILED"/stage
  // "queued") and only finalizes it — and flips the job to DONE — when the build
  // actually finishes (see platform/worker/src/build.ts). Reading Build.status
  // directly would report FAILED mid-build. So we gate on BuildJob.status === DONE.
  const job = await prisma.buildJob.findUnique({
    where: { id: game.lastJobId },
    include: { build: true },
  });
  if (!job || job.status !== "DONE" || !job.build) {
    // Still queued/running (or the Build row not yet finalized).
    return { state: "BUILDING", stage: job?.build?.stage ?? null };
  }
  const build = job.build;

  const next = build.status === "SUCCESS" ? "LIVE" : "FAILED";
  if (game.status !== next) {
    await prisma.game.update({ where: { id: gameId }, data: { status: next } });
  }
  return {
    state: next,
    stage: build.stage,
    logs: build.logs,
    artifactPath: build.artifactPath,
    commit: build.commit,
  };
}

/** Look up the slug→Game and reconcile in one go (used by the play page). */
export async function getGameBySlug(slug: string) {
  return prisma.game.findUnique({ where: { slug } });
}

export type { RepoRef };
