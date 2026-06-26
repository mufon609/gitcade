import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createGame,
  assertDeterministic,
  scriptedConformanceInput,
  snapshotWorld,
  seededRng,
  type Game,
  type Registry,
  type RawGameSources,
} from "@gitcade/sdk";
import { createLibraryRegistry } from "../src/registry.js";
import { registerCustomBehaviors as registerBreakout } from "../../../games/breakout/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerHelicopter } from "../../../games/helicopter/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerIdleClicker } from "../../../games/idle-clicker/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerLumen } from "../../../games/lumen/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerSnake } from "../../../games/snake/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerSurvivalArena } from "../../../games/survival-arena/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerTowerDefense } from "../../../games/tower-defense/src/custom-behaviors/index.js";

/**
 * 1.12.0 — the DETERMINISM CONFORMANCE suite: the single, authoritative place that proves every
 * shipped game and proof reproduces byte-for-byte under a fixed seed + scripted input. It is the
 * engine-wide generalization of the per-mechanic push-fuzz determinism spot-check — boot twice on
 * the same seed and the same per-frame input, step N frames, and assert the two runs never diverge
 * (the shared {@link assertDeterministic} harness).
 *
 * ONE authority, no scatter: every proof and seed game is one row in the table below, booted exactly
 * as its own smoke test boots it (the library registry, plus each game's `registerCustomBehaviors`
 * and its "start-pressed" nudge into gameplay). Covering a NEW game is a one-line append here, never
 * a fresh per-game assertion — so the determinism contract has a single owner as the catalog grows.
 *
 * The check is registry-agnostic: the proofs run on the library registry alone; the seed games add
 * their custom parts. Both flow through the identical harness. This is the publish-gate advisory's
 * counterpart for the games the SDK validator can't boot itself (it has no library/custom registry).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PROOFS_DIR = path.resolve(here, "../proofs");
const GAMES_DIR = path.resolve(here, "../../../games");

/** Read a game directory's raw sources from disk (the same shape `createGame` parses). */
function loadDir(dir: string): RawGameSources {
  const manifest = readJson(path.join(dir, "game.json"));
  const config = readJson(path.join(dir, "config.json"));
  const sceneDir = path.join(dir, "src", "scenes");
  const scenes = fs
    .readdirSync(sceneDir)
    .filter((f) => f.endsWith(".json"))
    .sort() // stable file order (load is deterministic; createGame picks entry by manifest.entryPoint)
    .map((f) => readJson(path.join(sceneDir, f)));
  return { manifest, config, scenes };
}

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

interface Case {
  name: string;
  frames: number;
  make: (rng: () => number) => Game;
}

// --- Proofs: boot on the library registry alone, single scene, no start nudge. --------------------
const proofCases: Case[] = fs
  .readdirSync(PROOFS_DIR)
  .filter((d) => fs.existsSync(path.join(PROOFS_DIR, d, "game.json")))
  .sort()
  .map((d) => {
    const src = loadDir(path.join(PROOFS_DIR, d));
    return {
      name: `proof:${d}`,
      frames: 120,
      make: (rng: () => number): Game => createGame(src, { canvas: null, registry: createLibraryRegistry(), rng }),
    };
  });

// --- Seed games: library + each game's custom parts, booted as that game's own smoke test boots it. -
// How a seed game enters gameplay is part of the contract, so the conformance boot mirrors it: the
// title games tap their play scene off the "start-pressed" flow edge, while Lumen has no title — it
// boots its first level directly (an `entrySceneId`). One descriptor per game captures that, so
// covering a NEW game stays a one-line append (its register hook + any non-default entry/start).
interface SeedGame {
  register: (registry: Registry) => void;
  /** Boot this scene id directly (Lumen's levels); omit to use the manifest entryPoint title scene. */
  entrySceneId?: string;
  /** Emit the title's "start-pressed" edge to enter play (default); false for a game that boots into play. */
  start?: boolean;
}
const SEED_GAMES: Record<string, SeedGame> = {
  breakout: { register: registerBreakout },
  helicopter: { register: registerHelicopter },
  "idle-clicker": { register: registerIdleClicker },
  // Lumen ships NO custom parts (pure SDK + library composition) and has no title — it boots level-1
  // directly, exactly as its smoke test does. Its cross-engine determinism therefore rides entirely on
  // the library parts already anchored here; this case pins the COMPOSITION, not new transcendental code.
  lumen: { register: registerLumen, entrySceneId: "level-1", start: false },
  snake: { register: registerSnake },
  "survival-arena": { register: registerSurvivalArena },
  "tower-defense": { register: registerTowerDefense },
};

const gameCases: Case[] = Object.keys(SEED_GAMES).map((name) => {
  const spec = SEED_GAMES[name];
  const src = loadDir(path.join(GAMES_DIR, name));
  return {
    name: `game:${name}`,
    frames: 180,
    make: (rng: () => number): Game => {
      const registry = createLibraryRegistry();
      spec.register(registry);
      const game = createGame(src, { canvas: null, registry, rng, entrySceneId: spec.entrySceneId });
      // Nudge into gameplay exactly as each game's smoke boot does: a title game leaves its title off
      // the "start-pressed" edge; a title-less game (Lumen) is already in play. Both settle two ticks,
      // so what the conformance compares is live gameplay either way.
      if (spec.start !== false) game.world.events.emit("start-pressed");
      game.stepFrames(2);
      return game;
    },
  };
});

const CASES: Case[] = [...proofCases, ...gameCases];

/**
 * A SHA-256 fingerprint of an ENTIRE conformance run: boot on the fixed seed, apply the scripted
 * input, step `frames`, and fold every per-frame {@link snapshotWorld} into one digest. Mirrors the
 * `assertDeterministic` run exactly (same seed + script + frame budget), so the digest is a stable
 * function of the simulation's bytes alone.
 */
function fingerprint(make: (rng: () => number) => Game, frames: number): string {
  const game = make(seededRng(0x5eed));
  const script = scriptedConformanceInput();
  const h = createHash("sha256");
  for (let f = 0; f < frames; f++) {
    script(game.world.input, f);
    game.stepFrames(1);
    h.update(snapshotWorld(game.world));
    h.update("\n");
  }
  return h.digest("hex");
}

describe("determinism conformance (seed games + library proofs)", () => {
  it("enumerates every proof and all seven seed games (no silent skip)", () => {
    expect(proofCases.length).toBeGreaterThanOrEqual(12);
    expect(gameCases.length).toBe(7);
  });

  it.each(CASES)(
    "$name reproduces byte-identically under a fixed seed + scripted input",
    ({ make, frames }) => {
      assertDeterministic(make, { seed: 0x5eed, frames, script: scriptedConformanceInput() });
    },
  );
});

/**
 * CROSS-ENGINE GOLDEN (anchored to 1.12.0). `assertDeterministic` proves only SAME-engine
 * reproducibility (it runs both passes in one engine). This table closes that gap: it pins the exact
 * fingerprint each run produces, generated under the canonical `world.math` transcendentals — which
 * are bit-identical on every conformant JS engine. Any engine reproducing these digests is therefore
 * byte-identical to the one that produced them, so a player's run in another browser, a server-side
 * speedrun re-check, and a ghost recorded elsewhere all stay in lockstep.
 *
 * This is also a regression fence: a change to fdmath, a migrated part, or the tick/snapshot shape
 * shifts a digest and trips this. Regenerate ONLY as a DELIBERATE, surfaced determinism re-base
 * (a MAJOR-worthy event for stored replays) with: `UPDATE_GOLDEN=1 npx vitest run` in this package,
 * then commit the new `determinism-golden-1.12.0.json` and say so in the changelog.
 */
const GOLDEN_PATH = path.resolve(here, "determinism-golden-1.12.0.json");

describe("cross-engine determinism golden (committed fingerprints, 1.12.0)", () => {
  const fingerprints: Record<string, string> = {};
  for (const c of CASES) fingerprints[c.name] = fingerprint(c.make, c.frames);

  if (process.env.UPDATE_GOLDEN) {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(fingerprints, null, 2) + "\n");
  }
  const golden: Record<string, string> = fs.existsSync(GOLDEN_PATH)
    ? (JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as Record<string, string>)
    : {};

  it("golden covers exactly the conformance cases (no silent set drift)", () => {
    expect(Object.keys(golden).sort()).toEqual(CASES.map((c) => c.name).sort());
  });

  it.each(CASES)("$name reproduces the committed cross-engine fingerprint", ({ name }) => {
    expect(fingerprints[name]).toBe(golden[name]);
  });
});
