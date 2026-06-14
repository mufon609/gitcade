/**
 * Snake bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/main.json composing @gitcade/library + SDK parts, plus the one custom
 * `snake-body` system. This file only wires that data to the runtime and the
 * shared GameShell (title/pause/game-over/touch). No balance or game logic lives
 * here.
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
  title: "SNAKE",
  tagline: "Eat. Grow. Don't bite yourself.",
  howto: [
    "Arrows / WASD or the on-screen d-pad to turn",
    "Eat the spinning coins to grow and score",
    "Avoid the walls and your own tail",
  ],
  gameOverEvent: "gameover",
  outcomeText: (w) => `Score ${num(w.state.score)}  •  Best ${num(w.state.highScore)}`,
  screenFx: {
    collect: (fx) => fx.flash("#ffcd75", 0.08),
    gameover: (fx) => {
      fx.shake(12, 0.45, 36);
      fx.flash("#b13e53", 0.3);
    },
  },
  onEnterPlay: (w) => {
    w.state.score = 0;
  },
  touch: [
    { code: "ArrowUp", label: "▲", cell: "1 / 2" },
    { code: "ArrowLeft", label: "◀", cell: "2 / 1" },
    { code: "ArrowRight", label: "▶", cell: "2 / 3" },
    { code: "ArrowDown", label: "▼", cell: "3 / 2" },
  ],
});

function num(v: unknown): number {
  return typeof v === "number" ? Math.round(v) : 0;
}
