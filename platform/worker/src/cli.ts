// CLI harness — how Phase 4A is tested with NO web app.
//
//   worker build <repoUrl> [branch]   enqueue + run ONE job end-to-end, stream
//                                      logs, exit 0 on SUCCESS / 1 on FAILED.
//   worker enqueue <repoUrl> [branch]  enqueue only (for testing the poller).
//   worker start                       run the long-running queue consumer.
//   worker list [n]                    show recent Build rows.
import os from "node:os";
import { prisma } from "./db.js";
import { enqueueBuild, getJob } from "./queue.js";
import { processJob } from "./build.js";
import { runWorker } from "./worker.js";

const WORKER_ID = `${os.hostname()}:${process.pid}`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "build": {
      const [repoUrl, branch = "main"] = rest;
      if (!repoUrl) die("usage: worker build <repoUrl> [branch]");
      const { id, deduped } = await enqueueBuild({ repoUrl, branch });
      if (deduped) console.log(`[cli] coalesced onto existing job ${id} for this game+branch`);

      // Targeted atomic claim so a running poller can't also grab it.
      const claimed = await prisma.buildJob.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "RUNNING", claimedBy: WORKER_ID, startedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count === 0) {
        const j = await getJob(id);
        console.log(`[cli] job ${id} is already ${j?.status ?? "gone"} (claimed elsewhere) — not re-running.`);
        process.exit(0);
      }

      const job = (await getJob(id))!;
      const res = await processJob(
        { id: job.id, gameSlug: job.gameSlug, repoUrl: job.repoUrl, branch: job.branch, commit: job.commit },
        { echo: true },
      );
      console.log(`\n[cli] RESULT: ${res.status}  stage=${res.stage}  artifact=${res.artifactPath ?? "(none)"}  files=${res.fileCount ?? 0}`);
      await prisma.$disconnect();
      process.exit(res.status === "SUCCESS" ? 0 : 1);
      break;
    }

    case "enqueue": {
      const [repoUrl, branch = "main"] = rest;
      if (!repoUrl) die("usage: worker enqueue <repoUrl> [branch]");
      const { id, deduped } = await enqueueBuild({ repoUrl, branch });
      console.log(deduped ? `coalesced onto existing job ${id}` : `enqueued job ${id}`);
      await prisma.$disconnect();
      break;
    }

    case "start": {
      await runWorker();
      break;
    }

    case "list": {
      const n = Number(rest[0] || "10");
      const builds = await prisma.build.findMany({ orderBy: { createdAt: "desc" }, take: n });
      for (const b of builds) {
        console.log(
          `${b.createdAt.toISOString()}  ${b.status.padEnd(7)}  ${b.gameSlug}@${b.branch}  stage=${b.stage}  files=${b.fileCount ?? "-"}  artifact=${b.artifactPath ?? "-"}`,
        );
      }
      await prisma.$disconnect();
      break;
    }

    default:
      die("commands: build <repoUrl> [branch] | enqueue <repoUrl> [branch] | start | list [n]");
  }
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
