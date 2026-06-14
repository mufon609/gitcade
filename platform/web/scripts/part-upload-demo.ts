// REAL part-upload driver (Phase 6 DoD proof: ONE custom part published through the
// upload flow — schema validation + the unit test run IN THE SANDBOX, license chosen).
// Drives the SHARED publishUserPart service (the same one the API route calls). The
// worker's builder image + the docker-sibling pattern are reused; the frozen worker
// is not modified.
//
// Usage: npx tsx scripts/part-upload-demo.ts
import { execFileSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { publishUserPart } from "../src/lib/partupload";

function ghLogin(): string {
  try {
    return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim();
  } catch {
    return "gitcade-admin";
  }
}

const SOURCE = `import type { BehaviorFn } from "@gitcade/sdk";

/** drift-x — nudges horizontal velocity by a tunable acceleration each tick. */
export const driftX: BehaviorFn = (entity, _world, params, _dt) => {
  const ax = (params.ax as number) ?? 0;
  (entity as unknown as { vx: number }).vx += ax;
};

export default driftX;
`;

const TEST = `import { describe, it, expect } from "vitest";
import driftX from "../src/drift-x";

describe("drift-x", () => {
  it("adds horizontal acceleration to the entity velocity", () => {
    const entity = { vx: 0, vy: 0 } as unknown as Parameters<typeof driftX>[0];
    driftX(entity, {} as never, { ax: 5 } as never, 1 / 60);
    expect((entity as unknown as { vx: number }).vx).toBe(5);
  });
});
`;

async function main() {
  const login = ghLogin();
  const email = `${login}@users.noreply.github.com`;
  const user = await prisma.user.upsert({
    where: { email },
    update: { githubLogin: login },
    create: { email, name: login, githubLogin: login },
  });

  console.log(`[part-upload] publishing "drift-x" (MIT) as ${login} — running schema + unit test in the sandbox…`);
  const t0 = Date.now();
  const result = await publishUserPart({
    id: "drift-x",
    kind: "behavior",
    category: "movement",
    tags: ["movement", "custom", "demo"],
    description: "Nudges an entity's horizontal velocity by a tunable acceleration each tick.",
    license: "MIT",
    source: SOURCE,
    test: TEST,
    ownerId: user.id,
    ownerLogin: login,
  });

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!result.ok) {
    console.error(`✗ rejected at stage "${result.stage}" in ${secs}s:`);
    for (const e of result.errors) console.error("   -", e);
    if (result.log) console.error("\n--- sandbox log (tail) ---\n" + result.log.slice(-2000));
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`✓ published ${result.partId}@${result.version} → bucket ${result.bucket} in ${secs}s`);
  console.log("--- sandbox log (tail) ---\n" + result.log.slice(-1200));
  await prisma.$disconnect();
}

void main();
