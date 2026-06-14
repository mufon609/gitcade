// Thin docker-sibling helpers for the part-upload SANDBOX. This MIRRORS the frozen
// worker's docker.ts pattern (named volume shared between throwaway sibling
// containers, host socket, two-stage network-on/network-none flow) WITHOUT importing
// or modifying the worker — the worker stays the only thing that BUILDS games. Here
// we run a part's schema check + unit test in the SAME isolated builder image.
//
// Server-only (spawns the host `docker` CLI). Never reached from the browser bundle.
import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
  code: number;
  log: string;
  timedOut: boolean;
}

/** Run `docker <args>`, capturing combined stdout+stderr, enforcing a timeout by
 *  killing the named container. */
export function dockerRun(
  args: string[],
  opts: { timeoutMs?: number; containerName?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          if (opts.containerName) spawnSync("docker", ["kill", opts.containerName], { stdio: "ignore" });
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    const onData = (b: Buffer) => {
      log += b.toString();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, log: log + `\n[docker spawn error] ${e.message}`, timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? 124 : code ?? 1, log, timedOut });
    });
  });
}

function cap(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function imageExists(image: string): boolean {
  return cap(["image", "inspect", image]).code === 0;
}

export function createVolume(name: string): void {
  cap(["volume", "create", name]);
}

export function removeVolume(name: string): void {
  spawnSync("docker", ["volume", "rm", "-f", name], { stdio: "ignore" });
}

/** Copy a host directory's CONTENTS into a named volume (host→container cp through a
 *  throwaway container), so the sandbox containers see the project files. */
export function copyIntoVolume(volume: string, image: string, hostDir: string, destInVolume = "/workspace"): void {
  const cname = `gc-part-stage-${Math.abs(hash(volume))}`;
  cap(["rm", "-f", cname]);
  const created = cap(["create", "--name", cname, "-v", `${volume}:/workspace`, image, "true"]);
  if (created.code !== 0) throw new Error(`failed to create staging container: ${created.stderr}`);
  try {
    const cp = cap(["cp", `${hostDir}/.`, `${cname}:${destInVolume}`]);
    if (cp.code !== 0) throw new Error(`docker cp into volume failed: ${cp.stderr}`);
  } finally {
    spawnSync("docker", ["rm", "-f", cname], { stdio: "ignore" });
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
