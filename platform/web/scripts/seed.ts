// SEED SCRIPT — registers the six seed repos from games/PUBLISHED.md through the
// REAL publish code path (the SAME `publishGame` service the API route calls). A
// script can't do browser OAuth, so we share the implementation rather than mock
// the flow. The games are owned by a designated
// seed/admin User from env.
//
// Usage:
//   tsx scripts/seed.ts            # enqueue all six (returns once enqueued)
//   tsx scripts/seed.ts --wait     # also poll until each build is LIVE/FAILED
//
// The build worker MUST be running for builds to progress (see DECISIONS.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma";
import { env } from "../src/lib/env";
import { publishGame, refreshGameStatus } from "../src/lib/publish";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

// Tags per seed slug — purely for the home-grid filter demo (manifest has no tags).
const SEED_TAGS: Record<string, string[]> = {
  snake: ["arcade", "grid"],
  helicopter: ["arcade", "endless"],
  breakout: ["arcade", "physics"],
  "tower-defense": ["strategy"],
  "idle-clicker": ["idle"],
  "survival-arena": ["action", "shooter"],
};

/** Pull the seed game repo URLs out of games/PUBLISHED.md (excludes the scaffold). */
function readSeedRepoUrls(): string[] {
  const md = readFileSync(path.join(repoRoot, "games", "PUBLISHED.md"), "utf8");
  const urls = new Set<string>();
  const re = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g;
  for (const m of md.matchAll(re)) {
    const url = m[0].replace(/\.git$/, "");
    if (/\/game-scaffold$/.test(url)) continue; // template repo is not a game
    urls.add(url);
  }
  return [...urls];
}

async function ensureSeedUser() {
  const existing = await prisma.user.findFirst({ where: { isSeed: true } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      name: "GitCade Seed Admin",
      email: env.seedUserEmail,
      githubLogin: env.seedUserLogin,
      isSeed: true,
    },
  });
}

async function main() {
  const wait = process.argv.includes("--wait");
  const repoUrls = readSeedRepoUrls();
  if (repoUrls.length === 0) throw new Error("No seed repo URLs found in games/PUBLISHED.md");

  const owner = await ensureSeedUser();
  console.log(`Seed owner: ${owner.name} (${owner.id})`);
  console.log(`Publishing ${repoUrls.length} repos through the real publish service:\n`);

  const slugs: string[] = [];
  for (const repoUrl of repoUrls) {
    const result = await publishGame({ repoUrl, ownerUserId: owner.id });
    if (!result.ok) {
      console.log(`  ✕ ${repoUrl}\n      ${result.errors.join("\n      ")}`);
      continue;
    }
    slugs.push(result.slug);
    // Decorate with demo tags (the publish service itself stays manifest-driven).
    const tags = SEED_TAGS[result.slug] ?? [];
    await prisma.game.update({ where: { slug: result.slug }, data: { tags } });
    console.log(
      `  ✓ ${result.slug} [${result.tier}] enqueued job ${result.jobId}` +
        (result.deduped ? " (deduped)" : "") +
        (result.reused ? " (re-published)" : ""),
    );
  }

  if (!wait) {
    console.log(`\nEnqueued ${slugs.length} games. Run the worker to build them, or pass --wait.`);
    return;
  }

  console.log(`\nWaiting for builds (worker must be running)…`);
  const deadlineMs = Date.now() + 20 * 60 * 1000; // 20 min cap for six container builds
  const pending = new Set(slugs);
  while (pending.size > 0 && Date.now() < deadlineMs) {
    await new Promise((r) => setTimeout(r, 5000));
    for (const slug of [...pending]) {
      const game = await prisma.game.findUnique({ where: { slug } });
      if (!game) {
        pending.delete(slug);
        continue;
      }
      const st = await refreshGameStatus(game.id);
      if (st.state === "LIVE") {
        console.log(`  ● LIVE   ${slug}`);
        pending.delete(slug);
      } else if (st.state === "FAILED") {
        console.log(`  ✕ FAILED ${slug} (stage: ${st.stage}) — see logs in the Build row`);
        pending.delete(slug);
      }
    }
  }
  if (pending.size > 0) {
    console.log(`\n⏳ Still building after timeout: ${[...pending].join(", ")}`);
  } else {
    console.log(`\nDone.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
