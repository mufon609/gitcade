/**
 * Pong bootstrap — identical to the scaffold's generic bootstrap. Pong's entire
 * implementation is in game.json + config.json + src/scenes/main.json. There is
 * no game logic here and no custom behavior anywhere: it is the proof that the
 * SDK primitives are strong enough to express a real game from data alone.
 */
import { createGame, createDefaultRegistry } from "@gitcade/sdk";
import manifest from "../game.json";
import config from "../config.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";

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

window.addEventListener("pointerdown", () => game.world.audio.resume(), { once: true });
window.addEventListener("keydown", () => game.world.audio.resume(), { once: true });
