// Unit tests for the publish SERVICE (the shared code path) with GitHub + DB
// mocked. Proves: public-repo enforcement, readable manifest rejection, tier
// gating on success, the enqueue call, and slug-conflict handling.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the I/O dependencies; keep manifest.ts (pure) real ──
// vi.mock factories are hoisted above imports, so shared mock fns + the prisma
// fake state must live in vi.hoisted to be initialized in time.
type GameRow = Record<string, unknown> & { id: string; slug: string; ownerId: string };
const h = vi.hoisted(() => {
  const games = new Map<string, GameRow>();
  return {
    games,
    seq: { n: 0 },
    enqueueBuild: vi.fn(async () => ({ id: "job-1", deduped: false })),
    getRepoMeta: vi.fn(),
    getRepoFile: vi.fn(),
  };
});
const { games, enqueueBuild, getRepoMeta, getRepoFile } = h;

vi.mock("@/lib/queue", () => ({
  enqueueBuild: h.enqueueBuild,
  slugFromRepoUrl: (u: string) => u.split("/").pop()!.replace(/\.git$/, "").toLowerCase(),
}));

vi.mock("@/lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github")>();
  return { ...actual, getRepoMeta: h.getRepoMeta, getRepoFile: h.getRepoFile };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    game: {
      findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) => {
        if (where.slug) return h.games.get(where.slug) ?? null;
        if (where.id) return [...h.games.values()].find((g) => g.id === where.id) ?? null;
        return null;
      }),
      create: vi.fn(async ({ data }: { data: GameRow }) => {
        const row = { ...data, id: `game-${++h.seq.n}` };
        h.games.set(row.slug, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<GameRow> }) => {
        const row = [...h.games.values()].find((g) => g.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { publishGame } from "@/lib/publish";

const MANIFEST = JSON.stringify({
  name: "Snake",
  slug: "snake",
  description: "Grid snake.",
  version: "1.0.0",
  engine: "gitcade-sdk",
  sdkVersion: "0.1.0",
  libraryVersion: "0.1.0",
  entryPoint: "src/scenes/main.json",
  license: "MIT",
  authors: [],
  tier: "ecosystem",
});

beforeEach(() => {
  games.clear();
  h.seq.n = 0;
  enqueueBuild.mockClear();
  getRepoMeta.mockReset();
  getRepoFile.mockReset();
});

describe("publishGame", () => {
  it("rejects an unrecognizable repo URL", async () => {
    const r = await publishGame({ repoUrl: "not a url", ownerUserId: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("repo-url");
    expect(enqueueBuild).not.toHaveBeenCalled();
  });

  it("rejects a PRIVATE repo (public-repos-only)", async () => {
    getRepoMeta.mockResolvedValue({ ok: true, isPrivate: true, defaultBranch: "main" });
    const r = await publishGame({ repoUrl: "https://github.com/o/snake", ownerUserId: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("visibility");
    expect(enqueueBuild).not.toHaveBeenCalled();
  });

  it("rejects a repo whose game.json is missing, with a readable error", async () => {
    getRepoMeta.mockResolvedValue({ ok: true, isPrivate: false, defaultBranch: "main" });
    getRepoFile.mockResolvedValue({ ok: false, error: "game.json not found on branch \"main\"." });
    const r = await publishGame({ repoUrl: "https://github.com/o/snake", ownerUserId: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe("manifest");
      expect(r.errors[0]).toMatch(/game\.json not found/);
    }
  });

  it("rejects an invalid manifest with schema errors", async () => {
    getRepoMeta.mockResolvedValue({ ok: true, isPrivate: false, defaultBranch: "main" });
    getRepoFile.mockResolvedValue({ ok: true, content: JSON.stringify({ name: "x", tier: "ecosystem" }) });
    const r = await publishGame({ repoUrl: "https://github.com/o/snake", ownerUserId: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("manifest");
  });

  it("publishes a valid ecosystem game: creates the Game, enqueues, offers governance", async () => {
    getRepoMeta.mockResolvedValue({ ok: true, isPrivate: false, defaultBranch: "main" });
    getRepoFile.mockResolvedValue({ ok: true, content: MANIFEST });
    const r = await publishGame({ repoUrl: "https://github.com/gitcade-games/snake", ownerUserId: "u1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slug).toBe("snake");
    expect(r.tier).toBe("ecosystem");
    expect(r.gate.offersGovernanceStep).toBe(true);
    expect(enqueueBuild).toHaveBeenCalledWith(
      expect.objectContaining({ gameSlug: "snake", branch: "main" }),
    );
    // Game row persisted with BUILDING + the enqueued jobId.
    const row = games.get("snake")!;
    expect(row.status).toBe("BUILDING");
    expect(row.lastJobId).toBe("job-1");
  });

  it("re-publishing the SAME owner's game updates + re-enqueues (idempotent)", async () => {
    getRepoMeta.mockResolvedValue({ ok: true, isPrivate: false, defaultBranch: "main" });
    getRepoFile.mockResolvedValue({ ok: true, content: MANIFEST });
    await publishGame({ repoUrl: "https://github.com/gitcade-games/snake", ownerUserId: "u1" });
    const r2 = await publishGame({ repoUrl: "https://github.com/gitcade-games/snake", ownerUserId: "u1" });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.reused).toBe(true);
    expect(games.size).toBe(1);
  });

  it("rejects publishing a slug already owned by a DIFFERENT user", async () => {
    getRepoMeta.mockResolvedValue({ ok: true, isPrivate: false, defaultBranch: "main" });
    getRepoFile.mockResolvedValue({ ok: true, content: MANIFEST });
    await publishGame({ repoUrl: "https://github.com/gitcade-games/snake", ownerUserId: "u1" });
    const r2 = await publishGame({ repoUrl: "https://github.com/someone/snake", ownerUserId: "u2" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.stage).toBe("slug-conflict");
  });
});
