// Remix orchestration: ties the pure remix model/apply (lib/remix.ts) to repo I/O
// (read scene+config, commit a single readable change) and the fork-on-demand flow.
// Shared by the /api/remix routes AND the remix-demo verification script (never
// mocked — same pattern as publish/fork).
import { prisma } from "./prisma";
import { enqueueBuild } from "./queue";
import { forkGame, forkSlug } from "./fork";
import { parseRepoUrl, getRepoFile, commitFiles, type RepoRef } from "./github";
import {
  getRemixCatalog,
  buildRemixModel,
  applyRemix,
  type RemixModel,
  type RemixEdits,
  type VendoredFile,
} from "./remix";
import { validateRemix } from "./remix-validate";
import { diffConfigs } from "./configdiff";

export interface RemixSources {
  scene: Record<string, unknown>;
  scenePath: string;
  config: Record<string, unknown>;
  configPath: string;
}

/** Read the entry scene + config.json for a game from its repo branch. */
export async function loadRemixSources(
  game: { repoUrl: string; branch: string; manifest: unknown },
  token?: string,
): Promise<RemixSources> {
  const ref = parseRepoUrl(game.repoUrl);
  if (!ref) throw new Error(`Unparseable repo URL: ${game.repoUrl}`);
  const manifest = (game.manifest ?? {}) as Record<string, unknown>;
  const scenePath = (typeof manifest.entryPoint === "string" ? manifest.entryPoint : "src/scenes/main.json").replace(
    /^\.?\//,
    "",
  );
  const configPath = "config.json";

  const sceneFile = await getRepoFile(ref, scenePath, game.branch, token);
  if (!sceneFile.ok || !sceneFile.content) throw new Error(`Could not read ${scenePath} from the fork.`);
  const configFile = await getRepoFile(ref, configPath, game.branch, token);
  if (!configFile.ok || !configFile.content) throw new Error(`Could not read ${configPath} from the fork.`);

  return {
    scene: JSON.parse(sceneFile.content) as Record<string, unknown>,
    scenePath,
    config: JSON.parse(configFile.content) as Record<string, unknown>,
    configPath,
  };
}

/** Build the point-and-click remix model for a game the user owns. */
export async function loadRemixModel(
  game: { repoUrl: string; branch: string; manifest: unknown },
  token?: string,
): Promise<RemixModel> {
  const sources = await loadRemixSources(game, token);
  const catalog = await getRemixCatalog();
  return buildRemixModel(sources.scene, sources.config, sources.scenePath, sources.configPath, catalog);
}

export interface EnsureForkResult {
  ok: true;
  /** The slug of the game the user owns and can remix (their fork, or the original
   *  if they already own it). */
  slug: string;
  forked: boolean;
}
export interface EnsureForkFailure {
  ok: false;
  error: string;
}

/**
 * Ensure the user has an OWN copy of `parentSlug` to remix. If they already own
 * the game (it's theirs, or they own its fork), return that. Otherwise fork it on
 * demand (reusing the Phase 5 forkGame), so remix mode always operates on a repo
 * the user can commit to.
 */
export async function ensureRemixableFork(
  parentSlug: string,
  userId: string,
  token: string,
  username: string,
): Promise<EnsureForkResult | EnsureForkFailure> {
  const game = await prisma.game.findUnique({ where: { slug: parentSlug } });
  if (!game) return { ok: false, error: `No game with slug "${parentSlug}".` };

  // Already the user's own game → remix in place.
  if (game.ownerId === userId) return { ok: true, slug: game.slug, forked: false };

  // The user may already own a fork of this game (deterministic fork slug).
  const expectedForkSlug = forkSlug(parentSlug, username);
  const existingFork = await prisma.game.findUnique({ where: { slug: expectedForkSlug } });
  if (existingFork && existingFork.ownerId === userId) {
    return { ok: true, slug: existingFork.slug, forked: false };
  }

  // Fork on demand.
  const fork = await forkGame({ parentSlug, userId, token, username });
  if (!fork.ok) return { ok: false, error: `Fork-on-demand failed (${fork.stage}): ${fork.error}` };
  return { ok: true, slug: fork.slug, forked: true };
}

export interface RemixCommitResult {
  ok: true;
  commit?: string;
  jobId: string;
  summary: string[];
  configChanges: ReturnType<typeof diffConfigs>;
  addedConfigKeys: string[];
}
export interface RemixCommitFailure {
  ok: false;
  /** Validation issues that PREVENTED the commit (surfaced in the UI before commit). */
  issues?: { code: string; message: string; where?: string }[];
  error?: string;
}

// Marker in a remix-managed src/custom-behaviors/index.ts (so re-runs are idempotent).
const MANAGED_MARKER = "GitCade remix mode — managed custom-behaviors registry";

// The managed src/custom-behaviors/index.ts a vendoring remix installs. main.ts (and
// every convention-following smoke test) calls registerCustomBehaviors(), so this is
// the single hook that gets vendored marketplace parts REGISTERED with the runtime
// registry — otherwise createGame throws "unknown behavior type" at build/play time.
const MANAGED_CUSTOM_BEHAVIORS_TS = `// ${MANAGED_MARKER}. DO NOT EDIT BY HAND.
//
// A remix swap vendored one or more marketplace parts into ../vendored-parts/. The
// generic game bootstrap (and the smoke test) only call registerCustomBehaviors(), so
// this is the wiring hook: it registers this game's ORIGINAL custom behaviors
// (preserved verbatim in ./_gitcade-original.ts) PLUS every vendored part, keyed by
// its filename — which equals the behavior \`type\` the remixed scene references.
import type { Registry } from "@gitcade/sdk";
import { registerCustomBehaviors as registerOriginalCustomBehaviors } from "./_gitcade-original.js";

// Eagerly import every vendored module so parts from EARLIER remixes stay registered.
const vendoredModules = import.meta.glob("../vendored-parts/*.{ts,js}", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

export function registerCustomBehaviors(registry: Registry): void {
  registerOriginalCustomBehaviors(registry);
  for (const [filePath, mod] of Object.entries(vendoredModules)) {
    const m = filePath.match(/\\/([^/]+)\\.(?:ts|js)$/);
    if (!m) continue;
    // The vendored module's BehaviorFn — default export, else the first exported fn.
    const fn =
      typeof mod.default === "function"
        ? mod.default
        : Object.values(mod).find((v) => typeof v === "function");
    if (typeof fn === "function") registry.registerBehavior(m[1], fn as never);
  }
}
`;

/**
 * Build the extra files a VENDORING remix must commit so the vendored parts are
 * actually REGISTERED with the runtime registry. Without this the build's headless /
 * smoke check boots the scene, hits the unregistered behavior `type`, and throws
 * "unknown behavior type" → the fork builds FAILED. Idempotent: once
 * custom-behaviors/index.ts is the managed wrapper, later remixes just add the new
 * module file (the wrapper's glob registers it). Returns a failure (so we never
 * commit a doomed build) when the fork can't be safely wired.
 */
export type VendoredWiring = { ok: true; files: VendoredFile[] } | { ok: false; error: string };

/** PURE decision for the vendored-part wiring (separated from repo I/O so it is
 *  unit-testable): given the fork's current custom-behaviors/index.ts and — for an
 *  ecosystem fork — its smoke test, return the files to commit, or why it can't be
 *  wired. `null` content means the file is absent. */
export function planVendoredWiring(input: {
  tier: string;
  hasVendored: boolean;
  customBehaviorsIndex: string | null;
  smokeTest: string | null;
}): VendoredWiring {
  if (!input.hasVendored) return { ok: true, files: [] };

  const idxPath = "src/custom-behaviors/index.ts";
  if (input.customBehaviorsIndex == null) {
    return {
      ok: false,
      error: `Cannot wire the vendored community part: ${idxPath} was not found in the fork (it must use the standard custom-behaviors hook to remix a community part in).`,
    };
  }

  // For an ECOSYSTEM fork the build gate is the game's own `npm test` smoke, which
  // must load custom behaviors for the vendored type to register THERE too. main.ts
  // always calls registerCustomBehaviors (covers play + OPEN-tier headless), but a
  // smoke test booting the library registry alone would still throw on the new type.
  if (input.tier === "ecosystem") {
    const smokeLoadsCustom = !!input.smokeTest && /registerCustomBehaviors\s*\(/.test(input.smokeTest);
    if (!smokeLoadsCustom) {
      return {
        ok: false,
        error:
          "Can't remix a community part into this game yet: its test harness " +
          "(tests/smoke.test.ts) doesn't load custom behaviors, so the ecosystem build " +
          "would reject the vendored part. Swapping in a built-in catalog part still works.",
      };
    }
  }

  // Already managed → the new module file alone is enough (the glob registers it).
  if (input.customBehaviorsIndex.includes(MANAGED_MARKER)) return { ok: true, files: [] };

  // First vendoring on this fork: preserve the original verbatim, install the wrapper.
  return {
    ok: true,
    files: [
      { path: "src/custom-behaviors/_gitcade-original.ts", content: input.customBehaviorsIndex },
      { path: idxPath, content: MANAGED_CUSTOM_BEHAVIORS_TS },
    ],
  };
}

/** Fetch the fork files the wiring decision needs, then delegate to {@link planVendoredWiring}. */
export async function vendoredWiringFiles(
  ref: RepoRef,
  branch: string,
  tier: string,
  vendored: VendoredFile[],
  token?: string,
): Promise<VendoredWiring> {
  if (vendored.length === 0) return { ok: true, files: [] };
  const idx = await getRepoFile(ref, "src/custom-behaviors/index.ts", branch, token);
  const smoke = tier === "ecosystem" ? await getRepoFile(ref, "tests/smoke.test.ts", branch, token) : null;
  return planVendoredWiring({
    tier,
    hasVendored: true,
    customBehaviorsIndex: idx.ok ? idx.content ?? null : null,
    smokeTest: smoke?.content ?? null,
  });
}

/**
 * Apply remix edits to the user's fork and COMMIT them as one readable commit, then
 * enqueue a rebuild. The remix is VALIDATED before committing — an edit that would
 * produce an invalid game is rejected here (in the UI), never after a wasted build.
 */
export async function commitRemix(
  game: { id: string; slug: string; repoUrl: string; branch: string; manifest: unknown; tier: string },
  edits: RemixEdits,
  token: string,
): Promise<RemixCommitResult | RemixCommitFailure> {
  const ref = parseRepoUrl(game.repoUrl);
  if (!ref) return { ok: false, error: `Unparseable repo URL: ${game.repoUrl}` };

  const sources = await loadRemixSources(game, token);
  const catalog = await getRemixCatalog();
  const applied = applyRemix(sources.scene, sources.config, edits, catalog);

  if (applied.summary.length === 0) {
    return { ok: false, error: "No changes to commit." };
  }

  // THE GATE: prevent an invalid game in the UI, not after committing.
  const issues = validateRemix(applied.scene, applied.config);
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const configChanges = diffConfigs(sources.config, applied.config);

  // Vendored community parts only run if the fork is wired to register them; refuse
  // to commit a build that would fail on an unregistered behavior type.
  const wiring = await vendoredWiringFiles(ref, game.branch, game.tier, applied.vendored, token);
  if (!wiring.ok) return { ok: false, error: wiring.error };

  // Compose ONE readable commit: scene + config + any vendored parts + their wiring.
  const files = [
    { path: sources.scenePath, content: JSON.stringify(applied.scene, null, 2) + "\n" },
    { path: sources.configPath, content: JSON.stringify(applied.config, null, 2) + "\n" },
    ...applied.vendored,
    ...wiring.files,
  ];
  const title = `Remix: ${applied.summary.slice(0, 2).join("; ")}${applied.summary.length > 2 ? "; …" : ""}`;
  const message = `${title}\n\n${applied.summary.map((s) => `- ${s}`).join("\n")}\n\nvia GitCade remix mode`;

  const commit = await commitFiles(ref, game.branch, files, message, token);
  if (!commit.ok) return { ok: false, error: commit.error ?? "Commit failed." };

  const { id: jobId } = await enqueueBuild({
    repoUrl: game.repoUrl,
    branch: game.branch,
    commit: commit.commit ?? null,
    gameSlug: game.slug,
  });
  await prisma.game.update({ where: { id: game.id }, data: { lastJobId: jobId, status: "BUILDING" } });

  return {
    ok: true,
    commit: commit.commit,
    jobId,
    summary: applied.summary,
    configChanges,
    addedConfigKeys: applied.addedConfigKeys,
  };
}
