// Worker queue tests: slug derivation (pure) + per-(game,branch) dedup against
// the real Postgres queue. Dedup is requirement #5 (rapid pushes must not stack
// redundant builds), so it ships tested.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { slugFromRepoUrl, enqueueBuild } from "../src/queue.js";

const TEST_SLUG = "__test_dedup__";

afterAll(async () => {
  await prisma.buildJob.deleteMany({ where: { gameSlug: TEST_SLUG } });
  await prisma.$disconnect();
});

describe("slugFromRepoUrl", () => {
  it("derives the slug from a .git URL", () => {
    expect(slugFromRepoUrl("https://github.com/gitcade-games/snake.git")).toBe("snake");
  });
  it("handles trailing slashes and no .git", () => {
    expect(slugFromRepoUrl("https://github.com/org/Tower-Defense/")).toBe("tower-defense");
    expect(slugFromRepoUrl("git://host:9418/breakout")).toBe("breakout");
  });
});

describe("per-(game,branch) dedup", () => {
  it("coalesces a second active enqueue for the same game+branch", async () => {
    const repo = `https://example.test/${TEST_SLUG}.git`;
    const first = await enqueueBuild({ repoUrl: repo, branch: "main", gameSlug: TEST_SLUG });
    const second = await enqueueBuild({ repoUrl: repo, branch: "main", gameSlug: TEST_SLUG });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    // A different branch is NOT deduped.
    const otherBranch = await enqueueBuild({ repoUrl: repo, branch: "dev", gameSlug: TEST_SLUG });
    expect(otherBranch.deduped).toBe(false);
    expect(otherBranch.id).not.toBe(first.id);

    const active = await prisma.buildJob.count({
      where: { gameSlug: TEST_SLUG, status: { in: ["PENDING", "RUNNING"] } },
    });
    expect(active).toBe(2); // one per branch, not three
  });
});
