// Lightweight part JSON (definition + preview) for the client behavior micro-scene
// demo. Read-only; the marketplace pages themselves read the mirror server-side.
import { NextResponse } from "next/server";
import { getPartDetail } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { partId: string } }) {
  const part = await getPartDetail(params.partId);
  if (!part) return NextResponse.json({ ok: false, error: "part not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    partId: part.partId,
    version: part.version,
    kind: part.kind,
    definition: part.definition,
    preview: part.preview,
  });
}
