// Sibling-container orchestration. The worker launches each build BESIDE itself
// via the host Docker CLI/socket (NOT Docker-in-Docker; setup/archive/ENVIRONMENT.md). The
// build workspace is a NAMED Docker volume shared between the two stage
// containers — never the worker's own (host-invisible) filesystem.
import { spawn, spawnSync } from "node:child_process";
import type { BuildLog } from "./logger.js";

export class DockerError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

/** Run `docker <args>`, streaming combined stdout+stderr verbatim into `log`.
 *  Enforces a timeout by killing the named container. Returns the exit code. */
export function dockerStream(
  args: string[],
  log: BuildLog,
  opts: { timeoutMs?: number; containerName?: string } = {},
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          log.note(`TIMEOUT after ${opts.timeoutMs}ms — killing container`);
          if (opts.containerName) {
            spawnSync("docker", ["kill", opts.containerName], { stdio: "ignore" });
          }
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    const onData = (buf: Buffer) => log.write(buf.toString());
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      log.note(`docker spawn error: ${err.message}`);
      resolve(127);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve(timedOut ? 124 : (code ?? 1));
    });
  });
}

/** Capture `docker <args>` stdout as a string (used for short metadata reads). */
function dockerCapture(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function createVolume(name: string): void {
  const r = dockerCapture(["volume", "create", name]);
  if (r.code !== 0) throw new DockerError(`failed to create volume ${name}: ${r.stderr}`, r.code);
}

export function removeVolume(name: string): void {
  // Best-effort cleanup; -f tolerates an already-gone volume.
  spawnSync("docker", ["volume", "rm", "-f", name], { stdio: "ignore" });
}

/** Read a single file from inside the named volume via a throwaway container. */
export function readFromVolume(volume: string, image: string, filePath: string): string {
  const r = dockerCapture([
    "run", "--rm", "--network", "none", "-v", `${volume}:/workspace`, image, "cat", filePath,
  ]);
  if (r.code !== 0) {
    throw new DockerError(`could not read ${filePath} from volume: ${r.stderr.trim()}`, r.code);
  }
  return r.stdout;
}

/** Copy a directory out of the named volume to a host path (worker fs) via a
 *  created (never started) container + `docker cp`. Works identically whether
 *  the worker runs on the host or in a container (cp streams through the CLI). */
export function copyFromVolume(
  volume: string,
  image: string,
  srcDirInVolume: string,
  destHostDir: string,
): void {
  const cname = `gitcade-export-${Math.abs(hash(volume + destHostDir))}`;
  const created = dockerCapture(["create", "--name", cname, "-v", `${volume}:/workspace`, image]);
  if (created.code !== 0) {
    throw new DockerError(`failed to create export container: ${created.stderr}`, created.code);
  }
  try {
    // Trailing "/." copies directory CONTENTS into destHostDir.
    const cp = dockerCapture(["cp", `${cname}:${srcDirInVolume}/.`, destHostDir]);
    if (cp.code !== 0) {
      throw new DockerError(`docker cp from volume failed: ${cp.stderr}`, cp.code);
    }
  } finally {
    spawnSync("docker", ["rm", "-f", cname], { stdio: "ignore" });
  }
}

/** Count + list build containers currently labeled for a job (proof of cleanup). */
export function listBuildContainers(jobId: string): string[] {
  const r = dockerCapture([
    "ps", "-a", "--filter", `label=gitcade-build=${jobId}`, "--format", "{{.Names}}",
  ]);
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

export function imageExists(image: string): boolean {
  return dockerCapture(["image", "inspect", image]).code === 0;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
