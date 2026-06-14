/**
 * Survival Arena bootstrap (host glue). The GAME is data — game.json +
 * config.json + src/scenes/main.json composing only SDK + @gitcade/library parts.
 * This file wires it to the runtime + the shared GameShell, mirrors the player's
 * HP into the HUD bar, and shows an integer clock.
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

const cfg = config as Record<string, number>;

new GameShell({
  game,
  audio,
  music: "action",
  title: "SURVIVAL ARENA",
  tagline: "Outlast the swarm. 75 seconds.",
  howto: [
    "Arrows / WASD / the d-pad to move (or drag toward where you want to go)",
    "You auto-fire at the nearest enemy",
    "Survive the timer to win — one hit too many and it's over",
  ],
  gameOverEvent: "gameover",
  outcomeText: (w) => {
    const won = w.state.outcome === "win";
    return `${won ? "You survived! 🏆" : "Overwhelmed"}  •  Score ${num(w.state.score)}  •  Best ${num(w.state.highScore)}`;
  },
  screenFx: {
    "enemy-died": (fx) => fx.shake(5, 0.16, 44),
    "player-died": (fx) => {
      fx.shake(16, 0.55, 34);
      fx.flash("#b13e53", 0.4);
    },
  },
  onEnterPlay: (w) => {
    w.state.score = 0;
    w.state.maxHp = cfg.playerHp;
    w.state.hp = cfg.playerHp;
    w.state.clock = Math.ceil(cfg.surviveTime);
  },
  beforeFrame: (w) => {
    const player = w.byId("player");
    if (player && typeof player.state.hp === "number") w.state.hp = Math.max(0, Math.round(player.state.hp as number));
    if (typeof w.state.timeLeft === "number") w.state.clock = Math.ceil(w.state.timeLeft as number);
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
