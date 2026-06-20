/**
 * Arena Re-Skin bootstrap (presentational proof, browser host glue).
 *
 * The GAME is data (game.json + config.json + src/scenes/main.json), composing
 * only @gitcade/library + SDK parts. This host wires the PRESENTATIONAL half that
 * lives outside the validated scene:
 *   - the LibraryAudioPlayer (synthesized SFX via every behavior's world.audio.play,
 *     plus a chiptune music loop),
 *   - the host-side ScreenEffects controller (shake on hits, flash on pickups/death),
 *   - and a one-line HP → HUD mirror so the hud-bar widget reflects player health.
 * Particles (explosion/sparkle) are in the scene itself as fx systems.
 */
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";

const sceneModules = import.meta.glob("./scenes/*.json", { eager: true }) as Record<string, { default: unknown }>;
const scenes = Object.values(sceneModules).map((m) => m.default);

const canvas = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;

const audio = new LibraryAudioPlayer();
const registry = createLibraryRegistry();
const game = createGame({ manifest, config, scenes }, { canvas, registry, audio });
const world = game.world;

// Seed HUD-visible health and keep it mirrored from the player each frame.
world.state.maxHp = (config as Record<string, number>).maxHp;
world.state.hp = (config as Record<string, number>).playerHp;

// Host-side screen effects: shake/flash driven by gameplay events.
const fx = new ScreenEffects();
fx.bindToEvents(world, {
  "enemy-died": (f) => f.shake(5, 0.16, 42),
  "player-died": (f) => {
    f.shake(14, 0.5, 36);
    f.flash("#b13e53", 0.35);
  },
  collect: (f) => f.flash("#ffcd75", 0.12),
});
attachScreenEffects(fx, canvas, overlay);

// Mirror the player's live HP into world.state for the hud-bar widget.
function mirrorHp(): void {
  const player = world.byId("player");
  if (player && typeof player.state.hp === "number") world.state.hp = player.state.hp;
  requestAnimationFrame(mirrorHp);
}
requestAnimationFrame(mirrorHp);

// Audio needs a user gesture; start the action loop on first interaction.
function startAudio(): void {
  audio.resume();
  audio.startMusic("action");
}
window.addEventListener("pointerdown", startAudio, { once: true });
window.addEventListener("keydown", startAudio, { once: true });

game.start();
