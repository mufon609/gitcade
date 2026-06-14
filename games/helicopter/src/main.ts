/**
 * Helicopter bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/main.json composing SDK + @gitcade/library parts plus the one custom
 * `thrust-lift` behavior. This file wires it to the runtime + the shared GameShell
 * and shows an integer score.
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
  title: "HELICOPTER",
  tagline: "Hold to rise. Release to fall. Don't crash.",
  howto: [
    "Hold Space / tap-and-hold the screen to rise",
    "Release to drop — thread the scrolling pillars",
    "Your score is how long you last",
  ],
  gameOverEvent: "crash",
  outcomeText: (w) => `Score ${num(w.state.score)}  •  Best ${num(w.state.highScore)}`,
  screenFx: {
    crash: (fx) => {
      fx.shake(16, 0.55, 34);
      fx.flash("#b13e53", 0.4);
    },
  },
  onEnterPlay: (w) => {
    w.state.scoreDisplay = 0;
  },
  beforeFrame: (w) => {
    if (typeof w.state.score === "number") w.state.scoreDisplay = Math.floor(w.state.score as number);
  },
  touch: [{ code: "Space", label: "HOLD TO FLY", cell: "1 / 1 / 4 / 4", color: "rgba(65,166,246,.45)" }],
});

function num(v: unknown): number {
  return typeof v === "number" ? Math.floor(v) : 0;
}
