// Backfill Game.installationId from the LIVE GitHub API (verified-not-hardcoded),
// per the Phase 7 contract. For every ecosystem game whose canonical repo lives in
// the GITHUB_ORG, look up the App installation on that repo (GET
// /repos/{owner}/{repo}/installation) and store the id. Forks under user accounts
// (where the App is not installed) are left null → governance disabled there.
//
// Run: npm run backfill-installations
import { prisma } from "../src/lib/prisma";
import { env } from "../src/lib/env";
import { parseRepoUrl } from "../src/lib/github";
import { getRepoInstallationId } from "../src/lib/github-app";

async function main() {
  const games = await prisma.game.findMany({ orderBy: { slug: "asc" } });
  console.log(`Considering ${games.length} games (org=${env.githubOrg}).`);
  for (const g of games) {
    const ref = parseRepoUrl(g.repoUrl);
    if (!ref) {
      console.log(`  ${g.slug}: unparseable repo URL, skip`);
      continue;
    }
    if (ref.owner.toLowerCase() !== env.githubOrg.toLowerCase()) {
      console.log(`  ${g.slug}: repo under ${ref.owner} (not the org) — governance off, skip`);
      continue;
    }
    const res = await getRepoInstallationId(ref);
    if (!res.ok) {
      console.log(`  ${g.slug}: ${res.error}`);
      continue;
    }
    await prisma.game.update({ where: { id: g.id }, data: { installationId: res.id } });
    console.log(`  ${g.slug}: installationId = ${res.id} ✓`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
