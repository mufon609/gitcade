/**
 * Generic GitCade game bootstrap. This file is IDENTICAL for every ecosystem
 * game — it wires the JSON definitions (game.json, config.json, scenes) to the
 * SDK runtime and starts the loop. Your game lives in the JSON + config + any
 * custom behaviors, never here. Do not put game logic in this file.
 */
import { createGame, createDefaultRegistry } from "@gitcade/sdk";
import manifest from "../game.json";
import config from "../config.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";

// Vite eagerly imports every scene JSON so games can ship multiple scenes.
const sceneModules = import.meta.glob("./scenes/*.json", { eager: true }) as Record<
  string,
  { default: unknown }
>;
const scenes = Object.values(sceneModules).map((m) => m.default);

const registry = createDefaultRegistry();
registerCustomBehaviors(registry);

const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame({ manifest, config, scenes }, { canvas, registry });
game.start();

// Browsers require a user gesture before audio can start.
window.addEventListener("pointerdown", () => game.world.audio.resume(), { once: true });
window.addEventListener("keydown", () => game.world.audio.resume(), { once: true });
