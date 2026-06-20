import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { GameManifestSchema, type GameManifest } from "../schema/manifest.js";
import { ConfigSchema, type Config } from "../schema/config.js";
import { SceneSchema, type Scene } from "../schema/scene.js";
import { createGame } from "../load.js";
import {
  runDeterminismCheck,
  scriptedConformanceInput,
  seededRng,
  type DeterminismReport,
} from "../runtime/determinism.js";
import {
  type Issue,
  checkParams,
  checkUniqueIds,
  checkSceneRefs,
  collectPartRefs,
  checkPartRefs,
  checkAdvisories,
  type LibraryCatalog,
} from "./rules.js";

export type { Issue } from "./rules.js";

/** The outcome of validating a game directory. */
export interface ValidationResult {
  ok: boolean;
  dir: string;
  /** `true` once the manifest parsed; some checks are skipped if it didn't. */
  manifestOk: boolean;
  tier?: "ecosystem" | "open";
  issues: Issue[];
  /** Number of fixed frames the smoke boot ran (0 if it didn't run). */
  framesRun: number;
  /**
   * Determinism-conformance ADVISORY outcome (additive). Present only when the check ran — i.e. the
   * game booted on the default registry (a custom-part game is covered by its own suite). `checked`
   * is then true; `deterministic` is the verdict and `divergedAtFrame` the first mismatching frame.
   * A non-deterministic verdict is a WARNING only — it never affects {@link ValidationResult.ok}.
   */
  determinism?: { checked: boolean; deterministic?: boolean; divergedAtFrame?: number };
}

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SMOKE_FRAMES = 60;
/** Determinism advisory: fixed seed + frame budget for the twice-run conformance check. */
const DETERMINISM_SEED = 0x5eed;
const DETERMINISM_FRAMES = 120;

/**
 * Validate a GitCade game directory. Performs, in order:
 *  1. manifest (`game.json`) schema validation
 *  2. `config.json` schema validation
 *  3. scene schema validation (every `src/scenes/*.json`)
 *  4. the storage rule — ecosystem games must not touch raw localStorage/indexedDB
 *  5. the mechanical no-magic-numbers rule + `$cfg` resolution
 *  5b. cross-scene reference integrity — flow.on targets, `extends`, `levels`,
 *     `levelsComplete`, and `entryPoint` must resolve to a real scene id
 *  6. `partId@version` catalog resolution against the pinned libraryVersion
 *  7. the smoke boot — build the entry scene and run {@link SMOKE_FRAMES} fixed
 *     frames headless (falls back to the game's own `npm test` when the game
 *     uses custom behaviors the default registry can't supply)
 *
 * `result.ok` is true iff there are zero error-level issues. Exit 0 = publishable.
 */
export async function validateGame(dir: string): Promise<ValidationResult> {
  const issues: Issue[] = [];
  const absDir = path.resolve(dir);
  let manifestOk = false;
  let tier: "ecosystem" | "open" | undefined;
  let framesRun = 0;

  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    return {
      ok: false,
      dir: absDir,
      manifestOk: false,
      issues: [{ level: "error", code: "no-dir", message: `not a directory: ${absDir}` }],
      framesRun: 0,
    };
  }

  // 1. Manifest
  let manifest: GameManifest | null = null;
  const manifestRaw = readJson(absDir, "game.json", issues, "manifest");
  if (manifestRaw !== undefined) {
    const parsed = GameManifestSchema.safeParse(manifestRaw);
    if (parsed.success) {
      manifest = parsed.data;
      manifestOk = true;
      tier = manifest.tier;
    } else {
      pushZod(issues, parsed.error, "game.json");
    }
  }

  // 2. Config
  let config: Config = {};
  const configRaw = readJson(absDir, "config.json", issues, "config");
  if (configRaw !== undefined) {
    const parsed = ConfigSchema.safeParse(configRaw);
    if (parsed.success) config = parsed.data;
    else pushZod(issues, parsed.error, "config.json");
  }

  // 3. Scenes
  const sceneDir = path.join(absDir, "src", "scenes");
  const scenes: Scene[] = [];
  const sceneFiles = fs.existsSync(sceneDir)
    ? fs.readdirSync(sceneDir).filter((f) => f.endsWith(".json"))
    : [];
  if (sceneFiles.length === 0) {
    issues.push({
      level: "error",
      code: "no-scenes",
      message: "no scene files found in src/scenes/*.json",
    });
  }
  for (const file of sceneFiles) {
    const raw = readJsonAt(path.join(sceneDir, file), issues, `scene ${file}`);
    if (raw === undefined) continue;
    const parsed = SceneSchema.safeParse(raw);
    if (parsed.success) scenes.push(parsed.data);
    else pushZod(issues, parsed.error, `src/scenes/${file}`);
  }

  // 4. Storage rule (ecosystem tier only)
  if (tier === "ecosystem") {
    issues.push(...scanRawStorage(absDir));
  }

  // 4b. Determinism source scan (warning-only, all tiers): wall-clock / Math.random in a
  //     game's simulation source desyncs replays/ghosts. The twice-run advisory below catches
  //     this for default-registry games, but a CUSTOM-part game skips that advisory — so scan
  //     the source directly, the root-cause companion to the runtime check. `main.ts` host glue
  //     is exempt (it legitimately reads the wall clock for non-sim concerns like offline credit).
  issues.push(...scanNonDeterministicSource(absDir));

  // 5. No-magic-numbers + $cfg resolution
  if (scenes.length > 0) {
    issues.push(...checkParams(scenes, config));
  }

  // 5b. Cross-scene reference integrity: flow.on targets, scene `extends`,
  //     manifest `levels`/`levelsComplete`, and `entryPoint` must all resolve to a
  //     real scene id — a broken link would otherwise slip through to runtime.
  if (scenes.length > 0) {
    issues.push(...checkSceneRefs(scenes, manifest));
  }

  // 5c. Identifier uniqueness: duplicate scene ids (a whole scene silently dropped)
  //     and duplicate entity ids within a scene (byId/parent/tag resolution collapses)
  //     — runtime-corrupting states the per-file schema structurally cannot see.
  if (scenes.length > 0) {
    issues.push(...checkUniqueIds(scenes));
  }

  // 6. Part catalog resolution
  if (scenes.length > 0) {
    const refs = collectPartRefs(scenes);
    const catalog = manifest?.libraryVersion ? loadLibraryCatalog(absDir) : null;
    issues.push(...checkPartRefs(refs, manifest?.libraryVersion, catalog));
  }

  // 6b. Non-failing presentation advisories: HUD-under-corner-button and
  //     full-field-rect-at-center-coords. Warnings only — never affect `ok`.
  if (scenes.length > 0) {
    issues.push(...checkAdvisories(scenes));
  }

  // 7. Smoke boot — only attempt if the structural checks passed (errors so far
  //    would otherwise mask a confusing runtime failure).
  const hasErrors = issues.some((i) => i.level === "error");
  let determinism: ValidationResult["determinism"];
  if (!hasErrors && manifest && scenes.length > 0) {
    const smoke = await runSmoke(absDir, manifest, config, scenes);
    framesRun = smoke.framesRun;
    issues.push(...smoke.issues);

    // 7b. Determinism-conformance ADVISORY (warning-only; never affects `ok`). Only on the
    //     default-registry fast path — a custom-part game is covered by its own determinism
    //     suite, and this Node validator can't construct its custom registry.
    if (smoke.usedDefaultRegistry && !smoke.issues.some((i) => i.level === "error")) {
      const adv = runDeterminismAdvisory(manifest, config, scenes);
      issues.push(...adv.issues);
      determinism = {
        checked: true,
        deterministic: adv.report?.deterministic,
        divergedAtFrame: adv.report?.divergedAtFrame,
      };
    }
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    dir: absDir,
    manifestOk,
    tier,
    issues,
    framesRun,
    determinism,
  };
}

// ---------------------------------------------------------------------------
// Smoke boot
// ---------------------------------------------------------------------------

interface SmokeOutcome {
  framesRun: number;
  issues: Issue[];
  /**
   * True iff the game booted on the DEFAULT registry (the fast path) — i.e. it uses only
   * built-in/SDK parts. The determinism advisory runs only in this case; a custom-part game
   * (the `npm test` fallback) is covered by its own determinism suite, not from here.
   */
  usedDefaultRegistry: boolean;
}

async function runSmoke(
  dir: string,
  manifest: GameManifest,
  config: Config,
  scenes: Scene[],
): Promise<SmokeOutcome> {
  // Fast path: boot with the default registry (works for any game using only
  // built-in/SDK behaviors — e.g. pure-JSON games like Pong). Seed the boot so the
  // smoke run is itself reproducible (it only asserts no-throw, so this changes no outcome).
  try {
    const game = createGame(
      { manifest, config, scenes },
      { canvas: null, rng: seededRng(DETERMINISM_SEED) },
    );
    game.stepFrames(SMOKE_FRAMES);
    return { framesRun: SMOKE_FRAMES, issues: [], usedDefaultRegistry: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const usesCustom = /unknown (behavior|system) type/.test(msg);
    if (!usesCustom) {
      return {
        framesRun: 0,
        issues: [{ level: "error", code: "smoke-failed", message: `smoke boot threw: ${msg}` }],
        usedDefaultRegistry: false,
      };
    }
    // Custom-behavior path: the default registry can't supply the game's custom
    // types. Defer to the game's own smoke test, which imports them via its
    // bundler/test runner.
    return runNpmSmoke(dir);
  }
}

function runNpmSmoke(dir: string): SmokeOutcome {
  const pkgPath = path.join(dir, "package.json");
  let hasTest = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    hasTest = Boolean(pkg.scripts?.test);
  } catch {
    /* no package.json */
  }
  if (!hasTest) {
    return {
      framesRun: 0,
      issues: [
        {
          level: "error",
          code: "smoke-custom-no-test",
          message:
            "game uses custom behaviors but has no `test` script for the validator to run as its smoke test",
        },
      ],
      usedDefaultRegistry: false,
    };
  }
  // Deferred to the game's own runner, which imports the custom behaviors.
  const res = spawnSync("npm", ["test", "--silent"], {
    cwd: dir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (res.status === 0) return { framesRun: SMOKE_FRAMES, issues: [], usedDefaultRegistry: false };
  return {
    framesRun: 0,
    issues: [
      {
        level: "error",
        code: "smoke-test-failed",
        message: `game smoke test (npm test) failed:\n${(res.stdout ?? "") + (res.stderr ?? "")}`.trim(),
      },
    ],
    usedDefaultRegistry: false,
  };
}

/**
 * The determinism-conformance ADVISORY (warning-only). Boots the game twice on the same seed +
 * the same scripted input, steps {@link DETERMINISM_FRAMES} fixed frames, and confirms the two
 * runs are byte-identical at every frame. A divergence is the reproducibility track's enemy
 * (replays, ghosts, seeded challenges all need a run to re-play identically), so it is surfaced —
 * but only as a WARNING, never an error: this check must not reject a previously-publishable game.
 *
 * Runs only on the default-registry fast path (the caller gates on `usedDefaultRegistry`); a
 * custom-part game is proven deterministic by its own suite instead. Any unexpected throw is
 * swallowed to a "no advisory" result — a non-authoritative check must never fail a validation.
 */
function runDeterminismAdvisory(
  manifest: GameManifest,
  config: Config,
  scenes: Scene[],
): { issues: Issue[]; report?: DeterminismReport } {
  try {
    const report = runDeterminismCheck(
      (rng) => createGame({ manifest, config, scenes }, { canvas: null, rng }),
      { seed: DETERMINISM_SEED, frames: DETERMINISM_FRAMES, script: scriptedConformanceInput() },
    );
    if (report.deterministic) return { issues: [], report };
    return {
      report,
      issues: [
        {
          level: "warning",
          code: "nondeterministic",
          message:
            `determinism advisory: two headless runs on the same seed + input diverged at frame ` +
            `${report.divergedAtFrame}/${report.frames}. Replays, ghosts, and seeded challenges need a ` +
            `run to reproduce byte-for-byte — route all simulation randomness through world.rng and keep ` +
            `wall-clock reads (Date.now/performance.now) out of behaviors/systems. (Advisory only — does ` +
            `not affect publishability.)`,
        },
      ],
    };
  } catch {
    return { issues: [] };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scanRawStorage(dir: string): Issue[] {
  const issues: Issue[] = [];
  const banned = /\b(localStorage|sessionStorage|indexedDB)\b/;
  const skip = new Set(["node_modules", "dist", ".git", ".next"]);

  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.isDirectory()) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) walk(full);
      } else if (SOURCE_EXTS.has(path.extname(ent.name))) {
        let text: string;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (banned.test(text)) {
          issues.push({
            level: "error",
            code: "raw-storage",
            message:
              "ecosystem games must persist via the SDK storage bridge (world.storage), not raw localStorage/sessionStorage/indexedDB — branch/fork switching would corrupt saves",
            where: path.relative(dir, full),
          });
        }
      }
    }
  };
  walk(dir);
  return issues;
}

/**
 * Scan a game's `src/` simulation source for entropy that desyncs a replay: `Math.random`
 * (route randomness through `world.rng`), and wall-clock reads `Date.now`/`performance.now`/
 * `new Date` (a fixed-timestep sim must derive time from `world.time`/`world.frame`). WARNING
 * only — never fails a publish — and exempts `main.ts` (host glue, allowed non-sim timing).
 * Mirrors {@link scanRawStorage}: the determinism advisory is a runtime check, this is its
 * static root-cause companion (and the only determinism signal for custom-part games, which
 * the twice-run advisory skips).
 */
function scanNonDeterministicSource(dir: string): Issue[] {
  const issues: Issue[] = [];
  const banned = /\b(Math\.random|Date\.now|performance\.now|new Date)\b/;
  const srcDir = path.join(dir, "src");
  if (!fs.existsSync(srcDir)) return issues;
  const skip = new Set(["node_modules", "dist", ".git", ".next"]);

  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.isDirectory()) continue;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) walk(full);
      } else if (SOURCE_EXTS.has(path.extname(ent.name)) && ent.name !== "main.ts") {
        let text: string;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (banned.test(text)) {
          issues.push({
            level: "warning",
            code: "nondeterministic-source",
            message:
              "simulation source reads the wall clock or Math.random — these desync replays, ghosts, and seeded challenges. Route randomness through world.rng and derive time from world.time/world.frame (main.ts host glue is exempt)",
            where: path.relative(dir, full),
          });
        }
      }
    }
  };
  walk(srcDir);
  return issues;
}

function loadLibraryCatalog(gameDir: string): LibraryCatalog | null {
  // The pinned library ships CATALOG.json in its package root. Resolve it the way
  // Node resolves a dependency: check the game's own node_modules first (the build
  // worker installs the pin there), then walk UP each parent's node_modules. The
  // walk-up matters in a workspace, where npm HOISTS @gitcade/library to the repo
  // root node_modules and leaves the game-local folder empty — without it, a
  // freshly-installed monorepo would report every part as `catalog-unavailable`.
  let dir = path.resolve(gameDir);
  for (;;) {
    const candidate = path.join(dir, "node_modules", "@gitcade", "library", "CATALOG.json");
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8")) as LibraryCatalog;
    } catch {
      /* fall through to the next parent */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return null;
}

function readJson(dir: string, file: string, issues: Issue[], label: string): unknown | undefined {
  return readJsonAt(path.join(dir, file), issues, label, file);
}

function readJsonAt(
  filePath: string,
  issues: Issue[],
  label: string,
  displayName?: string,
): unknown | undefined {
  const name = displayName ?? path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    issues.push({ level: "error", code: "missing-file", message: `missing ${label} file: ${name}` });
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    issues.push({
      level: "error",
      code: "invalid-json",
      message: `${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return undefined;
  }
}

function pushZod(issues: Issue[], error: z.ZodError, file: string): void {
  for (const e of error.errors) {
    const loc = e.path.length ? `${file}:${e.path.join(".")}` : file;
    issues.push({ level: "error", code: "schema", message: e.message, where: loc });
  }
}
