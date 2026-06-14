// THE APP-LEVEL WEBHOOK — one endpoint receiving push events for EVERY repo the
// GitCade GitHub App is installed on (Locked Decision: the App owns the webhook;
// no per-repo hook creation, no admin:repo_hook scope EVER). Verified with
// GITHUB_WEBHOOK_SECRET. We map the pushed repo → Game row(s) → enqueue a rebuild
// of the pushed branch. We never build.
//
// Signature verification + payload parsing are PURE (no I/O) so they unit-test
// without a server. `processPushEvent` does the DB mapping + enqueue.
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import { parseRepoUrl, type RepoRef } from "./github";

/** Constant-time HMAC-SHA256 verification of GitHub's `X-Hub-Signature-256`
 *  header (`sha256=<hex>`) over the RAW request body. Returns false on any
 *  malformed input rather than throwing. */
export function verifyGithubSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  // timingSafeEqual throws if lengths differ — guard first.
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface ParsedPush {
  repoFullName: string; // owner/repo
  repoCloneUrl: string; // https://github.com/owner/repo.git
  ref: RepoRef;
  branch: string;
  commit: string | null;
  /** A branch deletion push (`deleted: true`) — we do NOT rebuild those. */
  deleted: boolean;
}

/** Parse a GitHub `push` event payload into the fields we act on. Returns null if
 *  it is not a branch push (e.g. a tag push, or missing fields). */
export function parsePushEvent(payload: unknown): ParsedPush | null {
  const p = payload as {
    ref?: string;
    after?: string;
    deleted?: boolean;
    repository?: { full_name?: string; clone_url?: string; html_url?: string };
  };
  if (!p || typeof p.ref !== "string") return null;
  // Only branch pushes: refs/heads/<branch>. Ignore tags (refs/tags/...).
  const m = p.ref.match(/^refs\/heads\/(.+)$/);
  if (!m) return null;
  const branch = m[1];
  const repo = p.repository;
  if (!repo?.full_name) return null;
  const cloneUrl = repo.clone_url || (repo.html_url ? `${repo.html_url}.git` : `https://github.com/${repo.full_name}.git`);
  const ref = parseRepoUrl(cloneUrl) ?? parseRepoUrl(repo.full_name);
  if (!ref) return null;
  return {
    repoFullName: repo.full_name,
    repoCloneUrl: cloneUrl,
    ref,
    branch,
    commit: typeof p.after === "string" && /^0+$/.test(p.after) === false ? p.after : null,
    deleted: !!p.deleted,
  };
}

/** Normalize a repo URL/full-name to `owner/repo` (lowercased) for matching. */
function repoKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

export interface PushOutcome {
  matched: number;
  enqueued: Array<{ slug: string; branch: string; jobId: string; deduped: boolean }>;
  ignored?: string;
}

/** Map a parsed push to Game rows (by repo identity) and enqueue a rebuild of the
 *  pushed branch for each. The pushed branch — NOT the game's tracked branch — is
 *  what gets rebuilt, so a push to any branch refreshes that branch's artifact. */
export async function processPushEvent(parsed: ParsedPush): Promise<PushOutcome> {
  if (parsed.deleted) return { matched: 0, enqueued: [], ignored: "branch deletion" };

  const key = repoKey(parsed.ref);
  // Game.repoUrl is the https clone URL; match on parsed owner/repo identity so
  // trailing .git / casing differences don't cause misses.
  const games = await prisma.game.findMany({ select: { id: true, slug: true, repoUrl: true } });
  const matches = games.filter((g) => {
    const r = parseRepoUrl(g.repoUrl);
    return r && repoKey(r) === key;
  });

  const enqueued: PushOutcome["enqueued"] = [];
  for (const g of matches) {
    const job = await enqueueBuild({
      repoUrl: parsed.repoCloneUrl,
      branch: parsed.branch,
      commit: parsed.commit,
      gameSlug: g.slug,
    });
    enqueued.push({ slug: g.slug, branch: parsed.branch, jobId: job.id, deduped: job.deduped });
  }
  return { matched: matches.length, enqueued };
}
