// PART UPLOAD (v1-simple) — an owner publishes a custom behavior/entity from their
// game's src/custom-behaviors/ to the public catalog. Per the locked decisions:
//   • Submission runs schema validation + the part's UNIT TEST in the SANDBOX (the
//     worker's isolated builder IMAGE + the docker-sibling pattern — NOT the web
//     process). A part that fails validation or its test is rejected with readable
//     errors.
//   • License selection (MIT for code / CC-BY for assets) is MANDATORY.
//   • User parts are VENDORED into forks at remix time (sourceCode stored here);
//     the library stays frozen and is NEVER written to — there is no private registry.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "./prisma";
import { env } from "./env";
import { bucketFor } from "./catalog";
import {
  dockerRun,
  imageExists,
  createVolume,
  removeVolume,
  copyIntoVolume,
  type RunResult,
} from "./sandbox-docker";

export interface PartUploadInput {
  id: string;
  kind: "behavior" | "entity";
  category: string;
  tags: string[];
  description: string;
  license: "MIT" | "CC-BY-4.0";
  /** The implementation module source (a self-contained BehaviorFn / entity def). */
  source: string;
  /** A vitest unit test exercising the implementation. REQUIRED — it is the gate. */
  test: string;
  /** Optional default instance params for the catalog definition. */
  params?: Record<string, unknown>;
  ownerId: string;
  ownerLogin?: string | null;
  sourceRepoUrl?: string | null;
  sourcePath?: string | null;
  /** Injectable sandbox runner for deterministic unit tests of this service. */
  runSandbox?: (input: SandboxInput) => Promise<SandboxResult>;
}

export interface SandboxInput {
  id: string;
  kind: string;
  partJson: unknown;
  source: string;
  test: string;
  fileExt: string;
}
export interface SandboxResult {
  ok: boolean;
  stage: "schema" | "test" | "image" | "infra";
  log: string;
}

const PART_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Cheap web-process pre-checks (instant, readable) BEFORE spinning the sandbox. */
export function precheckPartUpload(input: PartUploadInput): string[] {
  const errors: string[] = [];
  if (!PART_ID_RE.test(input.id)) errors.push(`id "${input.id}" must be kebab-case ([a-z0-9-]).`);
  if (!input.description?.trim()) errors.push("A description is required.");
  if (input.license !== "MIT" && input.license !== "CC-BY-4.0")
    errors.push("A license (MIT for code, CC-BY-4.0 for assets) MUST be selected.");
  if (!input.source?.trim()) errors.push("The implementation source is empty.");
  if (!input.test?.trim()) errors.push("A unit test is required — it is the validation gate.");
  return errors;
}

/** Construct the catalog-part metadata object the schema validates. */
export function buildPartJson(input: PartUploadInput, version = "1.0.0") {
  return {
    id: input.id,
    kind: input.kind,
    version,
    category: input.category || (input.kind === "behavior" ? "custom" : "entities"),
    tags: input.tags ?? [],
    description: input.description,
    license: input.license,
    dependencies: [] as string[],
    definition: { type: input.id, params: input.params ?? {} },
  };
}

/** Write the throwaway sandbox project to a host temp dir + run it in the builder
 *  image: STAGE 1 (network) install, STAGE 2 (network none) schema check + vitest. */
async function defaultRunSandbox(si: SandboxInput): Promise<SandboxResult> {
  if (!imageExists(env.builderImage)) {
    return {
      ok: false,
      stage: "image",
      log: `Builder image '${env.builderImage}' not found. Build it with: npm --prefix platform/worker run build:image`,
    };
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gc-part-"));
  const volume = `gc-part-ws-${path.basename(work)}`;
  const cname1 = `gc-part-s1-${path.basename(work)}`;
  const cname2 = `gc-part-s2-${path.basename(work)}`;
  try {
    // package.json — pinned SDK/library from public npm (same source the worker uses).
    fs.writeFileSync(
      path.join(work, "package.json"),
      JSON.stringify(
        {
          name: `gitcade-part-${si.id}`,
          private: true,
          type: "module",
          scripts: { test: "vitest run" },
          dependencies: { "@gitcade/sdk": "0.1.0", "@gitcade/library": "0.1.0" },
          devDependencies: { vitest: "^2.1.8", ajv: "^8.17.1" },
        },
        null,
        2,
      ),
    );
    fs.mkdirSync(path.join(work, "src"));
    fs.mkdirSync(path.join(work, "tests"));
    fs.writeFileSync(path.join(work, "src", `${si.id}.${si.fileExt}`), si.source);
    fs.writeFileSync(path.join(work, "tests", `${si.id}.test.${si.fileExt}`), si.test);
    fs.writeFileSync(path.join(work, "part.json"), JSON.stringify(si.partJson, null, 2));
    fs.writeFileSync(path.join(work, "catalog.schema.json"), readCatalogSchema());
    fs.writeFileSync(path.join(work, "validate-part.mjs"), VALIDATE_PART_MJS);

    createVolume(volume);
    copyIntoVolume(volume, env.builderImage, work);

    const baseRun = (name: string, network: string[], cmd: string): string[] => [
      "run",
      "--rm",
      "--name",
      name,
      "-v",
      `${volume}:/workspace`,
      "--cpus",
      env.sandboxCpuLimit,
      "--memory",
      env.sandboxMemoryLimit,
      ...network,
      "-w",
      "/workspace",
      env.builderImage,
      "bash",
      "-lc",
      cmd,
    ];

    // STAGE 1 — install (network ON; default bridge unless BUILD_NETWORK is set).
    const net1 = env.sandboxNetwork ? ["--network", env.sandboxNetwork] : [];
    const s1: RunResult = await dockerRun(
      baseRun(cname1, net1, "npm install --no-audit --no-fund"),
      { timeoutMs: env.sandboxTimeoutMs, containerName: cname1 },
    );
    if (s1.code !== 0) {
      return { ok: false, stage: "infra", log: `[stage 1: install]\n${s1.log}` };
    }

    // STAGE 2 — schema check THEN the unit test (NETWORK NONE — no exfiltration).
    const s2: RunResult = await dockerRun(
      baseRun(
        cname2,
        ["--network", "none"],
        "echo '== schema ==' && node validate-part.mjs && echo '== test ==' && npx --no-install vitest run",
      ),
      { timeoutMs: env.sandboxTimeoutMs, containerName: cname2 },
    );
    if (s2.code !== 0) {
      const stage = /schema validation FAILED/.test(s2.log) ? "schema" : "test";
      return { ok: false, stage, log: s2.log };
    }
    return { ok: true, stage: "test", log: s2.log };
  } finally {
    removeVolume(volume);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function readCatalogSchema(): string {
  return fs.readFileSync(path.join(env.repoRoot, "packages", "library", "catalog.schema.json"), "utf8");
}

// A standalone ajv check of part.json against catalog.schema.json's part definition.
const VALIDATE_PART_MJS = `
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const schema = JSON.parse(readFileSync("./catalog.schema.json", "utf8"));
const part = JSON.parse(readFileSync("./part.json", "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema.definitions.part);
if (!validate(part)) {
  console.error("schema validation FAILED:");
  for (const e of validate.errors ?? []) console.error("  -", (e.instancePath || "(root)"), e.message);
  process.exit(1);
}
console.log("part.json is schema-valid:", part.id + "@" + part.version, "(" + part.kind + ")");
`;

export interface PartUploadResult {
  ok: true;
  partId: string;
  version: string;
  bucket: string;
  log: string;
}
export interface PartUploadFailure {
  ok: false;
  stage: SandboxResult["stage"] | "precheck";
  errors: string[];
  log?: string;
}

/**
 * Publish a user part: pre-check → SANDBOX (schema + unit test) → on success, UPSERT
 * a Part row (source=user) carrying the vendored sourceCode. The library is never
 * touched. A failure returns readable errors (and the verbatim sandbox log).
 */
export async function publishUserPart(input: PartUploadInput): Promise<PartUploadResult | PartUploadFailure> {
  const pre = precheckPartUpload(input);
  if (pre.length) return { ok: false, stage: "precheck", errors: pre };

  const version = "1.0.0";
  const partJson = buildPartJson(input, version);
  const fileExt = /\bexport\s+(?:const|function|default)\b|:\s*\w+|<\w+>/.test(input.source) ? "ts" : "js";

  const run = input.runSandbox ?? defaultRunSandbox;
  const sandbox = await run({ id: input.id, kind: input.kind, partJson, source: input.source, test: input.test, fileExt });
  if (!sandbox.ok) {
    return {
      ok: false,
      stage: sandbox.stage,
      errors: [
        sandbox.stage === "schema"
          ? "The part metadata failed schema validation."
          : sandbox.stage === "test"
            ? "The part's unit test failed in the sandbox."
            : sandbox.stage === "image"
              ? "The build sandbox image is missing."
              : "The sandbox could not install/run the part.",
      ],
      log: sandbox.log,
    };
  }

  const bucket = bucketFor(input.kind, partJson.category);
  await prisma.part.upsert({
    where: { partId_version_source: { partId: input.id, version, source: "user" } },
    create: {
      partId: input.id,
      version,
      kind: input.kind,
      category: partJson.category,
      tags: input.tags ?? [],
      description: input.description,
      license: input.license,
      source: "user",
      dependencies: [],
      definition: partJson.definition as object,
      preview: { kind: input.kind === "behavior" ? "behavior" : "none", behaviorType: input.id, bucket } as object,
      ownerId: input.ownerId,
      sourceRepoUrl: input.sourceRepoUrl ?? null,
      sourcePath: input.sourcePath ?? null,
      sandboxLog: sandbox.log.slice(-8000),
      sourceCode: input.source,
    },
    update: {
      kind: input.kind,
      category: partJson.category,
      tags: input.tags ?? [],
      description: input.description,
      license: input.license,
      definition: partJson.definition as object,
      sandboxLog: sandbox.log.slice(-8000),
      sourceCode: input.source,
      sourceRepoUrl: input.sourceRepoUrl ?? null,
      sourcePath: input.sourcePath ?? null,
    },
  });

  return { ok: true, partId: input.id, version, bucket, log: sandbox.log };
}
