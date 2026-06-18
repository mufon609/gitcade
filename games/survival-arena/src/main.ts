/**
 * Survival Arena bootstrap (host glue). The GAME is data — game.json + config.json +
 * the three JSON scenes (title → play → over) wired by `flow.on` edges, composing
 * @gitcade/library + SDK parts ONLY. There are NO custom behaviors: the level-driven
 * enemy toughness/speed ramp is pure DATA via two library `scale-by-state` instances
 * in play.json. See custom-behaviors/index.ts.
 *
 * The screen flow is DATA (scene `flow`, `tap-emit`, declarative `persist`). This file
 * keeps ONLY host concerns that have no data primitive: the library audio, the FX
 * SHOWCASE *screen-level* juice (the per-kill burst is DATA — a local `explosion` at
 * each dead enemy; the host owns only the screen-shake/flash the frozen renderer can't
 * do from a behavior: a small shake when the PLAYER is hit, a bigger shake + red flash
 * on death, a blue flash on level-up), and a pause toggle (freezing the sim is a
 * host-loop concern). No balance or game logic lives here.
 *
 * The HUD is DATA too: the library `format-binding` system in each scene derives it
 * (player hp → the bar's `hp`/`maxHp`, the float timer → an integer `clock`, `best` →
 * `bestDisplay`, and the win/lose `outcome` → the game-over headline).
 */
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects, throttle } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "./scenes/title.json";
import play from "./scenes/play.json";
import over from "./scenes/over.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { makeStorage } from "./host/storage.js";

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const cfg = config as Record<string, number>;
const audio = new LibraryAudioPlayer();
// Audio level is data: $cfg.volume (default 0.6), so it's tunable like any balance value.
audio.setVolume(typeof cfg.volume === "number" ? cfg.volume : 0.6);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [title, play, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug), pauseKeys: ["Escape", "KeyP"], pauseScenes: ["play"] },
);

// --- FX showcase: screen juice (presentation only) ---------------------------
// This game is the FX demo. The per-KILL juice is DATA — a local `explosion` burst
// at each dead enemy (play.json), which reads far better at swarm density than a
// global shake: a shake on every kill never settles between kills, so under a dense
// swarm it degrades into a constant rumble that flattens the bigger beats AND hurts
// readability (you can't parse threats through a perpetually-jittering field). So the
// host reserves SCREEN-shake for player-stakes moments the renderer can't express
// from a behavior:
//  - the player taking a hit  → a small shake, rate-limited so a pile-on can't
//    strobe. Deliberately NO full-screen flash: getting hit is a frequent/routine
//    event, and a full-screen flash on a routine action is the exact anti-pattern
//    this audit pass exists to kill — the shake conveys the hit without washing the
//    field. (The "damage" event fires for EVERY contact-damage hit, including the
//    player's bullets hitting enemies, so we gate on the player being the target.)
//  - the player dying         → a big shake + red flash (a rare, decisive beat).
//  - a level-up               → a blue flash (rare, and paired with a sparkle burst).
const fx = new ScreenEffects();
fx.bindToEvents(game.world, {
  // `throttle` caps the shake to once per 220ms so a swarm pile-on can't strobe.
  "damage": throttle(220, (f, data) => {
    if ((data as { target?: unknown } | null)?.target !== "player") return;
    f.shake(7, 0.2, 40);
  }),
  "player-died": (f) => {
    f.shake(18, 0.6, 34);
    f.flash("#b13e53", 0.45);
  },
  "level-up": (f) => f.flash("#41a6f6", 0.22),
});
const fxOverlay = document.getElementById("fx-overlay") as unknown as { style: Record<string, string> } | null;
attachScreenEffects(fx, canvas, fxOverlay);

// --- audio (needs a user gesture before the browser will play sound) ---------
let musicStarted = false;
function resumeAudio(): void {
  audio.resume();
  if (!musicStarted) {
    audio.startMusic("action");
    musicStarted = true;
  }
}
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);

// --- mute (centralized audio gate) -------------------------------------------
// Audio is OFF when the player muted, the sim is paused (manual OR the SDK's tab-hide
// auto-pause, via game.isPaused()), or the tab is hidden — one source of truth so those
// concerns can't fight over the gain. setMuted(true) stops the loop, so re-gate restarts it.
let userMuted = false;
const muteBtn = document.getElementById("mute-btn");
function renderMute(): void {
  if (muteBtn) muteBtn.textContent = userMuted ? "🔇" : "🔊";
}
function syncAudio(): void {
  const off = userMuted || game.isPaused() || document.hidden;
  audio.setMuted(off);
  if (!off && musicStarted) audio.startMusic("action");
}
function toggleMute(): void {
  userMuted = !userMuted;
  renderMute();
  syncAudio();
}
if (muteBtn) muteBtn.onclick = toggleMute;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM") {
    e.preventDefault();
    toggleMute();
  }
});

// Keyboard flow access (Enter/Space → start/retry) is DATA — a `key-emit` behavior on
// each title/over flow button, the keyboard companion to `tap-emit`. No host bridge.

// --- pause overlay + audio ----------------------------------------------------
// `pauseKeys`/`pauseScenes` (createGame opts) make the SDK own the freeze; it emits
// `pause-changed`, and the host just REACTS — show the overlay, re-gate audio — and
// forwards the on-screen button to `togglePause`. No setPaused state machine.
const pauseOverlay = document.getElementById("pause-overlay");
game.world.events.on("pause-changed", (e) => {
  if (pauseOverlay) pauseOverlay.style.display = (e as { paused: boolean }).paused ? "grid" : "none";
  syncAudio();
});
const pauseBtn = document.getElementById("pause-btn");
if (pauseBtn) pauseBtn.onclick = () => game.togglePause();

// The SDK auto-pauses the sim on tab-hide; re-gate audio so the music loop doesn't play
// to an empty room (and comes back on return, unless muted/paused).
document.addEventListener("visibilitychange", syncAudio);

game.start();
