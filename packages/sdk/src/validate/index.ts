import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { GameManifestSchema, type GameManifest } from "../schema/manifest.js";
import { ConfigSchema, type Config } from "../schema/config.js";
import { SceneSchema, type Scene } from "../schema/scene.js";
import { createGame } from "../load.js";
import {
  type Issue,
  checkParams,
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
}

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SMOKE_FRAMES = 60;

/**
 * Validate a GitCade game directory. Performs, in order:
 *  1. manifest (`game.json`) schema validation
 *  2. `config.json` schema validation
 *  3. scene schema validation (every `src/scenes/*.json`)
 *  4. the storage rule — ecosystem games must not touch raw localStorage/indexedDB
 *  5. the mechanical no-magic-numbers rule + `$cfg` resolution
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

  // 5. No-magic-numbers + $cfg resolution
  if (scenes.length > 0) {
    issues.push(...checkParams(scenes, config));
  }

  // 6. Part catalog resolution
  if (scenes.length > 0) {
    const refs = collectPartRefs(scenes);
    const catalog = manifest?.libraryVersion ? loadLibraryCatalog(absDir) : null;
    issues.push(...checkPartRefs(refs, manifest?.libraryVersion, catalog));
  }

  // 6b. Non-failing presentation advisories (0.3.1): HUD-under-corner-button and
  //     full-field-rect-at-center-coords. Warnings only — never affect `ok`.
  if (scenes.length > 0) {
    issues.push(...checkAdvisories(scenes));
  }

  // 7. Smoke boot — only attempt if the structural checks passed (errors so far
  //    would otherwise mask a confusing runtime failure).
  const hasErrors = issues.some((i) => i.level === "error");
  if (!hasErrors && manifest && scenes.length > 0) {
    const smoke = await runSmoke(absDir, manifest, config, scenes);
    framesRun = smoke.framesRun;
    issues.push(...smoke.issues);
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    dir: absDir,
    manifestOk,
    tier,
    issues,
    framesRun,
  };
}

// ---------------------------------------------------------------------------
// Smoke boot
// ---------------------------------------------------------------------------

interface SmokeOutcome {
  framesRun: number;
  issues: Issue[];
}

async function runSmoke(
  dir: string,
  manifest: GameManifest,
  config: Config,
  scenes: Scene[],
): Promise<SmokeOutcome> {
  // Fast path: boot with the default registry (works for any game using only
  // built-in/SDK behaviors — e.g. pure-JSON games like Pong).
  try {
    const game = createGame(
      { manifest, config, scenes },
      { canvas: null },
    );
    game.stepFrames(SMOKE_FRAMES);
    return { framesRun: SMOKE_FRAMES, issues: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const usesCustom = /unknown (behavior|system) type/.test(msg);
    if (!usesCustom) {
      return {
        framesRun: 0,
        issues: [{ level: "error", code: "smoke-failed", message: `smoke boot threw: ${msg}` }],
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
    };
  }
  // Deferred to the game's own runner, which imports the custom behaviors.
  const res = spawnSync("npm", ["test", "--silent"], {
    cwd: dir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (res.status === 0) return { framesRun: SMOKE_FRAMES, issues: [] };
  return {
    framesRun: 0,
    issues: [
      {
        level: "error",
        code: "smoke-test-failed",
        message: `game smoke test (npm test) failed:\n${(res.stdout ?? "") + (res.stderr ?? "")}`.trim(),
      },
    ],
  };
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

function loadLibraryCatalog(gameDir: string): LibraryCatalog | null {
  // Phase 1: no @gitcade/library exists. From Phase 2 on, the pinned library is
  // installed in node_modules and ships CATALOG.json. Resolve from the game's
  // own node_modules (the build worker installs the pin there).
  const candidates = [
    path.join(gameDir, "node_modules", "@gitcade", "library", "CATALOG.json"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8")) as LibraryCatalog;
    } catch {
      /* fall through */
    }
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
