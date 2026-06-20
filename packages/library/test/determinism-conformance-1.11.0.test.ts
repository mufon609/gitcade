import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGame,
  assertDeterministic,
  scriptedConformanceInput,
  type Game,
  type Registry,
  type RawGameSources,
} from "@gitcade/sdk";
import { createLibraryRegistry } from "../src/registry.js";
import { registerCustomBehaviors as registerBreakout } from "../../../games/breakout/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerHelicopter } from "../../../games/helicopter/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerIdleClicker } from "../../../games/idle-clicker/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerSnake } from "../../../games/snake/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerSurvivalArena } from "../../../games/survival-arena/src/custom-behaviors/index.js";
import { registerCustomBehaviors as registerTowerDefense } from "../../../games/tower-defense/src/custom-behaviors/index.js";

/**
 * 1.11.0 — the DETERMINISM CONFORMANCE suite: the single, authoritative place that proves every
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

// --- Seed games: library + each game's custom parts, nudged into gameplay (mirrors smoke boots). ---
const GAME_CUSTOM: Record<string, (registry: Registry) => void> = {
  breakout: registerBreakout,
  helicopter: registerHelicopter,
  "idle-clicker": registerIdleClicker,
  snake: registerSnake,
  "survival-arena": registerSurvivalArena,
  "tower-defense": registerTowerDefense,
};

const gameCases: Case[] = Object.keys(GAME_CUSTOM).map((name) => {
  const src = loadDir(path.join(GAMES_DIR, name));
  const registerCustom = GAME_CUSTOM[name];
  return {
    name: `game:${name}`,
    frames: 180,
    make: (rng: () => number): Game => {
      const registry = createLibraryRegistry();
      registerCustom(registry);
      const game = createGame(src, { canvas: null, registry, rng });
      // Every seed game's title boots its play scene off the "start-pressed" flow edge (the
      // title's tap-emit button); both runs nudge identically, so gameplay is what's compared.
      game.world.events.emit("start-pressed");
      game.stepFrames(2);
      return game;
    },
  };
});

const CASES: Case[] = [...proofCases, ...gameCases];

describe("determinism conformance (seed games + library proofs)", () => {
  it("enumerates every proof and all six seed games (no silent skip)", () => {
    expect(proofCases.length).toBeGreaterThanOrEqual(12);
    expect(gameCases.length).toBe(6);
  });

  it.each(CASES)(
    "$name reproduces byte-identically under a fixed seed + scripted input",
    ({ make, frames }) => {
      assertDeterministic(make, { seed: 0x5eed, frames, script: scriptedConformanceInput() });
    },
  );
});
