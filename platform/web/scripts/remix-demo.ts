// REAL remix round-trip driver (DoD proof: dragon-on-Snake in <5 min, zero
// code). A script can't do browser OAuth, so — like fork-demo — it ensures a User +
// stored gh token, then drives the SHARED remix services end-to-end:
//   ensureRemixableFork (fork-on-demand) → commitRemix (sprite + movement + tunable,
//   ONE readable commit) → enqueue rebuild → poll the worker to LIVE.
//
// Usage: npx tsx scripts/remix-demo.ts [parent-slug] [sprite-part] [movement-part]
//   defaults: snake  enemy-shooter  move-topdown-360
import { execFileSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { ingestCatalog } from "../src/lib/catalog-ingest";
import { ensureRemixableFork, commitRemix } from "../src/lib/remix-service";
import { loadRemixModel } from "../src/lib/remix-service";
import { refreshGameStatus } from "../src/lib/publish";

function ghToken(): string {
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}
function ghLogin(): string {
  return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim();
}

async function ensureUser(login: string, token: string): Promise<string> {
  const email = `${login}@users.noreply.github.com`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { githubLogin: login },
    create: { email, name: login, githubLogin: login },
  });
  await prisma.account.upsert({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: login } },
    update: { access_token: token, userId: user.id },
    create: {
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: login,
      access_token: token,
      scope: "read:user user:email public_repo",
    },
  });
  return user.id;
}

async function pollLive(slug: string, timeoutMs = 180_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const game = await prisma.game.findUnique({ where: { slug } });
    if (game) {
      const s = await refreshGameStatus(game.id);
      if (s.state === "LIVE") return "LIVE";
      if (s.state === "FAILED") {
        console.error("✗ rebuild FAILED:\n", (s.logs ?? "").slice(-2000));
        return "FAILED";
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return "TIMEOUT";
}

async function main() {
  const parentSlug = process.argv[2] || "snake";
  const spritePart = process.argv[3] || "enemy-shooter";
  const movementPart = process.argv[4] || "move-topdown-360";

  await ingestCatalog();
  const token = ghToken();
  const login = ghLogin();
  const userId = await ensureUser(login, token);

  const t0 = Date.now();
  console.log(`[remix] ensuring a remixable fork of "${parentSlug}" as ${login}…`);
  const ensure = await ensureRemixableFork(parentSlug, userId, token, login);
  if (!ensure.ok) {
    console.error("✗ fork-on-demand failed:", ensure.error);
    process.exit(1);
  }
  console.log(`  → editing ${ensure.slug}${ensure.forked ? " (forked on demand)" : " (already owned)"}`);

  const game = await prisma.game.findUnique({ where: { slug: ensure.slug } });
  if (!game) throw new Error("fork Game row missing");

  // Discover the first sprite-bearing entity + the first movement slot.
  const model = await loadRemixModel(game, token);
  const entityId = model.entities[0]?.id;
  const slot = model.movementSlots[0]?.key;
  const firstNumericLeaf = model.configLeaves.find((l) => l.kind === "number");
  console.log(`  remix targets: sprite(${entityId}) → ${spritePart}; movement(${slot}) → ${movementPart}; ` +
    `config ${firstNumericLeaf?.path} bump`);

  const edits = {
    spriteSwaps: entityId ? { [entityId]: spritePart } : {},
    movementSwaps: slot ? { [slot]: movementPart } : {},
    configEdits: firstNumericLeaf
      ? { [firstNumericLeaf.path]: Number(firstNumericLeaf.value) + (firstNumericLeaf.step ?? 1) }
      : {},
  };

  const result = await commitRemix(game, edits, token);
  if (!result.ok) {
    console.error("✗ remix rejected (gate):", result.error ?? "");
    if (result.issues) for (const i of result.issues) console.error("   -", i.message, i.where ?? "");
    process.exit(1);
  }
  console.log(`✓ committed ${result.commit?.slice(0, 8)} — ${result.summary.join("; ")}`);
  if (result.addedConfigKeys.length) console.log(`  backfilled config keys: ${result.addedConfigKeys.join(", ")}`);

  console.log(`[remix] rebuilding ${ensure.slug} (job ${result.jobId})…`);
  const state = await pollLive(ensure.slug);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[remix] ${state} in ${secs}s — play: /games/${ensure.slug}`);
  await prisma.$disconnect();
  process.exit(state === "LIVE" ? 0 : 1);
}

void main();
