// POST /api/parts/upload — publish a custom behavior/entity to the public catalog.
// Auth required. Runs schema validation + the unit test in the build SANDBOX
// (publishUserPart), then upserts a user Part row on success. Returns readable
// errors + the verbatim sandbox log on failure.
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { publishUserPart, type PartUploadInput } from "@/lib/partupload";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

// Sandbox builds can take a couple minutes (npm install + vitest in a container).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const ownerLogin = (session?.user as { githubLogin?: string | null } | undefined)?.githubLogin ?? null;
  const limited = await enforceRateLimit(req, RATE_LIMITS.partUpload, userId);
  if (limited) return limited;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in to publish a part." }, { status: 401 });

  let body: Partial<PartUploadInput>;
  try {
    body = (await req.json()) as Partial<PartUploadInput>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.license !== "MIT" && body.license !== "CC-BY-4.0") {
    return NextResponse.json(
      { ok: false, stage: "precheck", errors: ["License selection is mandatory (MIT or CC-BY-4.0)."] },
      { status: 422 },
    );
  }

  const result = await publishUserPart({
    id: String(body.id ?? ""),
    kind: body.kind === "entity" ? "entity" : "behavior",
    category: String(body.category ?? ""),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    description: String(body.description ?? ""),
    license: body.license,
    source: String(body.source ?? ""),
    test: String(body.test ?? ""),
    params: (body.params as Record<string, unknown>) ?? {},
    ownerId: userId,
    ownerLogin,
    sourceRepoUrl: body.sourceRepoUrl ? String(body.sourceRepoUrl) : null,
    sourcePath: body.sourcePath ? String(body.sourcePath) : null,
  });

  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json(result);
}
