// INTEGRATION: enqueue → 4A worker → live, against a LOCAL repo fixture.
//
// Stands up a docker git-daemon serving a VALID copy of the snake seed game (under
// a throwaway slug), then drives the REAL flow the web app uses: create the Game
// row + enqueueBuild() (the frozen contract) + lastJobId, exactly as publishGame
// does internally (minus the GitHub manifest pre-fetch, which can't reach a local
// repo). The REAL worker builds it; we poll the Build row to SUCCESS, confirm
// refreshGameStatus() flips the Game to LIVE, and confirm the artifact server
// serves the built index.html.
//
// REQUIRES (see DECISIONS.md): Postgres + MinIO + Docker + the builder image + a
// RUNNING worker poller + the artifact server. If the build does not progress, the
// test fails with a clear message rather than hanging forever.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, execFileSync } from "node:child_process";
import { cpSync, rmSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "../../src/lib/prisma";
import { enqueueBuild } from "../../src/lib/queue";
import { refreshGameStatus } from "../../src/lib/publish";
import { env } from "../../src/lib/env";

const SLUG = "itest-snake";
const CONTAINER = "gc-itest-gitserve";
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const sh = (cmd: string) => execSync(cmd, { stdio: "pipe" }).toString();

let serveDir = "";
let daemonIp = "";
let dockerOk = true;

function setupFixture() {
  // Copy the snake seed game, rename its slug, and serve it from a git-daemon.
  serveDir = mkdtempSync(path.join(os.tmpdir(), "gc-itest-"));
  const work = path.join(serveDir, "game");
  cpSync(path.join(repoRoot, "games", "snake"), work, {
    recursive: true,
    filter: (src) => !/node_modules|[/\\]dist|[/\\]public[/\\]assets|[/\\]\.git/.test(src),
  });
  const gjPath = path.join(work, "game.json");
  const gj = JSON.parse(readFileSync(gjPath, "utf8"));
  gj.slug = SLUG;
  gj.name = "Integration Test Snake";
  writeFileSync(gjPath, JSON.stringify(gj, null, 2));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: work });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: work });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "itest"], {
    cwd: work,
  });
  execFileSync("git", ["clone", "--bare", "-q", work, path.join(serveDir, `${SLUG}.git`)]);

  sh(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`);
  sh(
    `docker run -d --name ${CONTAINER} -v ${serveDir}:/srv:ro -w /srv --entrypoint sh ` +
      `${env_builderImage()} -c "git config --system --add safe.directory '*'; ` +
      `exec git daemon --reuseaddr --base-path=/srv --export-all" >/dev/null`,
  );
  daemonIp = sh(
    `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CONTAINER}`,
  ).trim();
}

function env_builderImage(): string {
  return process.env.BUILDER_IMAGE || "gitcade-builder:local";
}

beforeAll(() => {
  try {
    sh("docker info >/dev/null 2>&1");
    setupFixture();
  } catch (e) {
    dockerOk = false;
    console.warn("Skipping integration test — docker/fixture unavailable:", (e as Error).message);
  }
}, 120000);

afterAll(async () => {
  try {
    sh(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`);
    if (serveDir) rmSync(serveDir, { recursive: true, force: true });
    await prisma.game.deleteMany({ where: { slug: SLUG } });
  } catch {
    /* best effort */
  }
  await prisma.$disconnect();
});

describe("enqueue → worker → live (local fixture)", () => {
  it("builds a freshly-enqueued local game green and serves its artifact", async () => {
    if (!dockerOk) {
      console.warn("docker unavailable — test skipped");
      return;
    }
    const repoUrl = `git://${daemonIp}:9418/${SLUG}.git`;

    // Mirror publishGame's internal steps (Game BUILDING + enqueue + lastJobId).
    const owner = await prisma.user.upsert({
      where: { email: "itest@gitcade.local" },
      update: {},
      create: { email: "itest@gitcade.local", name: "itest", isSeed: false },
    });
    await prisma.game.upsert({
      where: { slug: SLUG },
      create: {
        slug: SLUG,
        name: "Integration Test Snake",
        repoUrl,
        ownerId: owner.id,
        tier: "ecosystem",
        status: "BUILDING",
        manifest: { slug: SLUG, name: "Integration Test Snake", tier: "ecosystem" },
      },
      update: { status: "BUILDING", repoUrl, lastJobId: null },
    });

    const { id: jobId } = await enqueueBuild({ repoUrl, gameSlug: SLUG });
    const game = await prisma.game.update({
      where: { slug: SLUG },
      data: { lastJobId: jobId },
    });

    // Poll the real worker's Build outcome (the poller must be running).
    const deadline = Date.now() + 12 * 60 * 1000;
    let st = await refreshGameStatus(game.id);
    while (st.state === "BUILDING" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      st = await refreshGameStatus(game.id);
    }

    if (st.state === "BUILDING") {
      throw new Error(
        "Build never completed — is the worker poller running? (tsx platform/worker/src/cli.ts start)",
      );
    }

    // THE VALIDATOR IS THE GATE: a valid game must end LIVE.
    expect(st.state, `build logs:\n${st.logs}`).toBe("LIVE");
    expect(st.artifactPath).toBe(`${SLUG}/main`);

    const reloaded = await prisma.game.findUnique({ where: { slug: SLUG } });
    expect(reloaded?.status).toBe("LIVE");

    // The artifact server serves the built entry.
    const indexUrl = `${env.artifactBaseUrl.replace(/\/+$/, "")}/artifacts/${SLUG}/main/index.html`;
    const res = await fetch(indexUrl);
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain("<!doctype html");
  }, 15 * 60 * 1000);
});
