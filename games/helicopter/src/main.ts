/**
 * Helicopter bootstrap (host glue). The GAME is data — game.json + config.json +
 * the three JSON scenes (title → play → over) wired by `flow.on` edges, composing
 * @gitcade/library + SDK parts plus two custom behaviors (`thrust-lift`, the
 * one-button lift; `scroll-ramp`, the state-driven difficulty ramp).
 *
 * 0.2.0 made the screen flow expressible as DATA (scene `flow`, `tap-emit`,
 * declarative `persist`), so the old ~305-line GameShell screen-state machine and
 * its HTML menu overlays are GONE. This file keeps ONLY host concerns that have no
 * data primitive: the library audio, screen juice (flash/shake on crash), a pause
 * toggle (freezing the sim is a host-loop concern), and an Enter/Space bridge that
 * mirrors the on-screen flow buttons for keyboard players. No balance or game logic
 * lives here.
 *
 * 0.4.0 (E2): the per-frame HUD mirror that floored the float score into a display
 * key is GONE — the library `format-binding` system in each scene now derives
 * `scoreDisplay`/`bestDisplay` from `score`/`best` as DATA (no host rAF loop).
 */
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "./scenes/title.json";
import play from "./scenes/play.json";
import over from "./scenes/over.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { makeStorage } from "./host/storage.js";

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
// Audio level is data: $cfg.volume (default 0.6), so it's tunable like any balance value.
audio.setVolume(typeof (config as Record<string, number>).volume === "number" ? (config as Record<string, number>).volume : 0.6);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [title, play, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug), pauseKeys: ["Escape", "KeyP"], pauseScenes: ["play"] },
);

// --- screen juice (presentation only) ---------------------------------------
// Bind the crash event → shake/flash; it is the same `crash` the play scene's
// `flow.on` edge routes to the game-over scene.
const fx = new ScreenEffects();
fx.bindToEvents(game.world, {
  crash: (f) => {
    f.shake(16, 0.55, 34);
    f.flash("#b13e53", 0.4);
  },
});
// `attachScreenEffects` types the overlay structurally; a DOM element's
// CSSStyleDeclaration is runtime-compatible (the fx loop only assigns style props)
// but not to TS, so narrow it explicitly.
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

// Keyboard flow access (Enter/Space → start/retry) is DATA now — a `key-emit` behavior
// on each title/over flow button (E3); Space during PLAY stays pure thrust (no key-emit
// on the play scene). No host bridge.

// --- pause overlay + audio (the freeze + Esc/P key is the engine's now, E4) -----
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

// --- mobile touch: NONE needed (declarative, E1) ----------------------------
// Touch-to-fly is pure DATA now: the `input-actions` system in play.json binds the
// `thrust` action to a full-canvas `rect`, so HOLDING ANYWHERE on the canvas lifts
// (the classic flappy control) and `thrust-lift` reads it via `thrustAction`. The
// old DOM "HOLD TO FLY" button that synthesized a `Space` key event is GONE — touch
// reaches the mover through the same logical action the keyboard does, no host glue.
// (The window `pointerdown` listener above still unlocks audio on the first touch.)

// Observation hook for the Stage-4 playthrough harness (audit/harness/helicopter) —
// read-only; harmless in production.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
