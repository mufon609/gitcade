// POST /api/webhooks/github — the GitHub App's ONE app-level webhook (Locked
// Decision). Receives push events for every repo the app is installed on, verified
// with GITHUB_WEBHOOK_SECRET. Maps the pushed repo → Game row(s) → enqueues a
// rebuild of the pushed branch. NO per-repo hook creation, NO admin:repo_hook.
//
// LOCAL DEV: GitHub can't reach localhost, so events arrive via the smee.io channel
// (WEBHOOK_PROXY_URL) forwarded to this route — run `npm run webhook:proxy`. The
// polling fallback (scripts/poll-repos.ts) covers repos without the app + downtime.
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyGithubSignature, parsePushEvent, processPushEvent } from "@/lib/webhook";

// Read the RAW body for HMAC — must not be parsed/transformed first.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const eventType = req.headers.get("x-github-event");

  if (!verifyGithubSignature(env.githubWebhookSecret, raw, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }

  // GitHub pings the webhook on (re)install — ack it so the UI shows green.
  if (eventType === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }
  if (eventType !== "push") {
    return NextResponse.json({ ok: true, ignored: `event "${eventType}"` });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = parsePushEvent(payload);
  if (!parsed) return NextResponse.json({ ok: true, ignored: "non-branch push" });

  const outcome = await processPushEvent(parsed);
  return NextResponse.json({
    ok: true,
    branch: parsed.branch,
    repo: parsed.repoFullName,
    matched: outcome.matched,
    enqueued: outcome.enqueued,
    ignored: outcome.ignored,
  });
}
