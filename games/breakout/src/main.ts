/**
 * Breakout bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/main.json composing only SDK built-ins + @gitcade/library parts (no
 * custom code). This file wires the data to the runtime and the shared GameShell.
 */
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "./scenes/main.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { GameShell } from "./host/shell.js";
import { makeStorage } from "./host/storage.js";

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [main] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug) },
);

new GameShell({
  game,
  audio,
  music: "action",
  title: "BREAKOUT",
  tagline: "Smash every brick. Don't drop the ball.",
  howto: [
    "Arrows / A·D or the ◀ ▶ pad to move the paddle",
    "Clear all the bricks to win — you have 3 lives",
    "Hit the ball with the paddle edge for spin",
  ],
  gameOverEvent: "gameover",
  outcomeText: (w) => {
    const won = w.state.outcome === "win";
    return `${won ? "You cleared the wall! 🎉" : "Out of lives"}  •  Score ${num(w.state.score)}`;
  },
  screenFx: {
    "block-broken": (fx) => fx.shake(4, 0.12, 50),
    "ball-lost": (fx) => {
      fx.shake(10, 0.35, 34);
      fx.flash("#b13e53", 0.25);
    },
    gameover: (fx) => fx.shake(12, 0.45, 36),
  },
  onEnterPlay: (w) => {
    w.state.score = 0;
  },
  touch: [
    { code: "ArrowLeft", label: "◀", cell: "2 / 1" },
    { code: "ArrowRight", label: "▶", cell: "2 / 3" },
  ],
});

function num(v: unknown): number {
  return typeof v === "number" ? Math.round(v) : 0;
}
