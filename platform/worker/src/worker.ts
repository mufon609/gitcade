// The long-running queue consumer: polls the Postgres queue and processes up to
// WORKER_CONCURRENCY jobs at once. Each job runs in its own sibling containers,
// so concurrent builds are isolated. `worker build` (the CLI harness) bypasses
// the poll loop and runs one job inline; this is the production service entry.
import { env } from "./env.js";
import { prisma } from "./db.js";
import { claimJobs, getJob } from "./queue.js";
import { processJob } from "./build.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runWorker(): Promise<void> {
  let inFlight = 0;
  let stopping = false;

  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n[worker] ${sig} received — finishing ${inFlight} in-flight build(s), no new claims.`);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  console.log(
    `[worker] started. concurrency=${env.concurrency} poll=${env.queuePollIntervalMs}ms image=${env.builderImage}`,
  );

  while (!stopping) {
    const capacity = env.concurrency - inFlight;
    if (capacity > 0) {
      const ids = await claimJobs(capacity);
      for (const id of ids) {
        const job = await getJob(id);
        if (!job) continue;
        inFlight++;
        console.log(`[worker] ▶ build ${job.gameSlug}@${job.branch} (job ${id}) [inFlight=${inFlight}]`);
        // Fire-and-track: do not await, so we fill remaining capacity this tick.
        void processJob(
          { id: job.id, gameSlug: job.gameSlug, repoUrl: job.repoUrl, branch: job.branch, commit: job.commit },
          { echo: false },
        )
          .then((res) => {
            console.log(`[worker] ✔ ${job.gameSlug}@${job.branch} → ${res.status} (stage=${res.stage}, build ${res.buildId})`);
          })
          .catch((err) => {
            console.error(`[worker] ✖ ${job.gameSlug}@${job.branch} crashed: ${err?.message || err}`);
          })
          .finally(() => {
            inFlight--;
          });
      }
    }
    await sleep(env.queuePollIntervalMs);
  }

  // Drain in-flight builds before exit.
  while (inFlight > 0) await sleep(200);
  await prisma.$disconnect();
  console.log("[worker] stopped cleanly.");
}
