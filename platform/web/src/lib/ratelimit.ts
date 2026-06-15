// Per-user / per-IP rate limiting for state-changing endpoints (Phase 8A — Security
// pass). Postgres-backed FIXED-WINDOW counter (the additive `RateLimit` table): one
// row per (bucket, identity, windowStart), incremented ATOMICALLY via
// INSERT ... ON CONFLICT DO UPDATE so it is correct under concurrency and survives a
// process restart / multiple app instances — an in-memory map would not, and the
// deployment topology is serverless/multi-instance (Locked Decision). No external
// service (Redis) is introduced; the queue is already a Postgres table by the same
// reasoning.
//
// USAGE in a route handler (place it BEFORE the auth/401 check so an unauthenticated
// flood is throttled by IP too, and so the limit is independent of session state):
//
//   const session = await getServerSession(authOptions);
//   const userId = (session?.user as { id?: string } | undefined)?.id;
//   const limited = await enforceRateLimit(req, RATE_LIMITS.publish, userId);
//   if (limited) return limited;            // 429 with Retry-After
//   if (!userId) return NextResponse.json(..., { status: 401 });
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";

export interface RateLimitRule {
  /** Endpoint class — namespaces the counter (stored in RateLimit.bucket). */
  bucket: string;
  /** Max requests allowed per identity per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Central registry of every rate limit, so SECURITY.md and the code cannot drift.
 *  Limits are deliberately generous for real use yet trivially exceeded by a tight
 *  abuse loop (so a 429 is demonstrable). Window is one minute unless noted. */
const MIN = 60_000;
export const RATE_LIMITS = {
  // The six the phase names explicitly:
  publish: { bucket: "publish", limit: 10, windowMs: MIN },
  fork: { bucket: "fork", limit: 15, windowMs: MIN },
  vote: { bucket: "vote", limit: 30, windowMs: MIN },
  proposalCreate: { bucket: "proposal-create", limit: 10, windowMs: MIN },
  remixCommit: { bucket: "remix-commit", limit: 20, windowMs: MIN },
  bugReport: { bucket: "bug-report", limit: 10, windowMs: MIN },
  // Other state-changing endpoints (every mutation route is covered):
  remixStart: { bucket: "remix-start", limit: 20, windowMs: MIN },
  partUpload: { bucket: "part-upload", limit: 5, windowMs: MIN },
  communityJoin: { bucket: "community-join", limit: 30, windowMs: MIN },
  proposalOpen: { bucket: "proposal-open", limit: 20, windowMs: MIN },
  proposalApprove: { bucket: "proposal-approve", limit: 20, windowMs: MIN },
  proposalVeto: { bucket: "proposal-veto", limit: 20, windowMs: MIN },
  proposalForkPatch: { bucket: "proposal-fork-patch", limit: 15, windowMs: MIN },
  proposalFinalize: { bucket: "proposal-finalize", limit: 60, windowMs: MIN },
  bugConvert: { bucket: "bug-convert", limit: 20, windowMs: MIN },
  branchBuild: { bucket: "branch-build", limit: 20, windowMs: MIN },
  notificationsRead: { bucket: "notifications-read", limit: 60, windowMs: MIN },
  // High-frequency by design (a heartbeat every ~10s per open pane); generous.
  heartbeat: { bucket: "heartbeat", limit: 120, windowMs: MIN },
} as const;

/** Best-effort client IP from the standard proxy headers (Vercel/NGINX set these).
 *  Falls back to a constant so a missing header degrades to a single shared bucket
 *  rather than throwing. NEVER trust this for authz — it is only a throttle key. */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

/** The floored start (ms) of the fixed window `now` falls in. Pure — unit-tested. */
export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/** Atomically increment and check the counter for one (bucket, identity, window).
 *  Returns whether this request is within the limit. */
export async function checkRateLimit(
  identity: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStartMs = windowStartFor(now, rule.windowMs);
  const windowStart = new Date(windowStartMs);
  // Atomic upsert+increment: two concurrent requests can never both "see zero" and
  // race — the second hits ON CONFLICT and increments the row the first inserted.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("id", "bucket", "identity", "windowStart", "count")
    VALUES (${randomUUID()}, ${rule.bucket}, ${identity}, ${windowStart}, 1)
    ON CONFLICT ("bucket", "identity", "windowStart")
    DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"
  `;
  const count = Number(rows[0]?.count ?? 1);
  const allowed = count <= rule.limit;
  const remaining = Math.max(0, rule.limit - count);
  const retryAfterSec = Math.max(1, Math.ceil((windowStartMs + rule.windowMs - now) / 1000));
  return { allowed, limit: rule.limit, remaining, retryAfterSec };
}

function tooMany(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: `Rate limit exceeded — try again in ${result.retryAfterSec}s.`,
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

/** Enforce a rule for a request. Checks BOTH a per-IP counter (always) AND a per-user
 *  counter (when authenticated) under the same bucket — so one account can't dodge the
 *  IP limit and one IP can't dodge the per-user limit by rotating accounts. Returns a
 *  429 NextResponse if either is exceeded, else null (caller proceeds). On a DB error
 *  it FAILS OPEN (returns null) — a throttle must never take the whole API down. */
export async function enforceRateLimit(
  req: NextRequest,
  rule: RateLimitRule,
  userId?: string | null,
): Promise<NextResponse | null> {
  const now = Date.now();
  const identities = [`ip:${clientIp(req)}`];
  if (userId) identities.push(`user:${userId}`);
  try {
    let exceeded: RateLimitResult | null = null;
    for (const identity of identities) {
      const r = await checkRateLimit(identity, rule, now);
      if (!r.allowed && (!exceeded || r.retryAfterSec > exceeded.retryAfterSec)) exceeded = r;
    }
    return exceeded ? tooMany(exceeded) : null;
  } catch (err) {
    console.error(`[ratelimit] check failed for bucket=${rule.bucket} (failing open):`, err);
    return null;
  }
}
