/**
 * Helicopter bootstrap (host glue). The GAME is data — game.json + config.json +
 * the three JSON scenes (title → play → over) wired by `flow.on` edges, composing
 * @gitcade/library + SDK parts plus two custom behaviors (`thrust-lift`, the
 * one-button lift; `scroll-ramp`, the state-driven difficulty ramp).
 *
 * 0.2.0 made the screen flow expressible as DATA (scene `flow`, `tap-emit`,
 * declarative `persist`), so the old ~305-line GameShell screen-state machine and
 * its HTML menu overlays are GONE. This file keeps ONLY host concerns that have no
 * data primitive: the library audio, screen juice (flash/shake on crash), the
 * mobile touch button (which synthesizes the Space key the `thrust-lift` part
 * already reads), a pause toggle (freezing the sim is a host-loop concern), an
 * Enter/Space bridge that mirrors the on-screen flow buttons for keyboard players,
 * and a presentation-only HUD mirror that floors the continuous (float) survival
 * score into an integer display key (the renderer's text `bind` has no formatter,
 * and no library part floors a value). No balance or game logic lives here.
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
// Audio level is data: $cfg.volume (default 0.6), so it's governance-tunable like any balance value.
audio.setVolume(typeof (config as Record<string, number>).volume === "number" ? (config as Record<string, number>).volume : 0.6);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [title, play, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug) },
);

// --- HUD mirror (presentation only) -----------------------------------------
// The survival score is a continuous float (currency passiveIncome); the text
// `bind` renders raw, so floor it into integer display keys the scenes bind to.
// No game logic — `score`/`best` (floats) remain the source of truth that the
// currency / score / level-progression systems read.
function mirrorScore(): void {
  const s = game.world.state;
  if (typeof s.score === "number") s.scoreDisplay = Math.floor(s.score as number);
  if (typeof s.best === "number") s.bestDisplay = Math.floor(s.best as number);
  requestAnimationFrame(mirrorScore);
}
requestAnimationFrame(mirrorScore);

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

// --- keyboard bridge to the data-driven flow edges ---------------------------
// On-screen buttons emit their flow event via the `tap-emit` data part; this only
// mirrors that for Enter/Space on the title/over screens so they stay
// keyboard-accessible. It is scene-guarded, so Space during PLAY is pure thrust
// (the bridge never fires there) — it emits the SAME flow events, no screen state.
window.addEventListener("keydown", (e) => {
  if (e.code !== "Enter" && e.code !== "Space") return;
  if (game.scene.id === "title") {
    e.preventDefault();
    game.world.events.emit("start-pressed");
  } else if (game.scene.id === "over") {
    e.preventDefault();
    game.world.events.emit("retry");
  }
});

// --- pause (a host-loop concern: no data primitive freezes the world) --------
let paused = false;
const pauseOverlay = document.getElementById("pause-overlay");
function setPaused(next: boolean): void {
  if (game.scene.id !== "play" && !paused) return; // only pause during play
  paused = next;
  if (pauseOverlay) pauseOverlay.style.display = paused ? "grid" : "none";
  // pause()/resume() freeze the sim WITHOUT detaching input, so a held thrust key
  // survives the pause (stop()/start() would clear it). syncAudio() mutes while paused.
  if (paused) game.pause();
  else game.resume();
  syncAudio();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" || e.code === "KeyP") {
    e.preventDefault();
    setPaused(!paused);
  }
});
const pauseBtn = document.getElementById("pause-btn");
if (pauseBtn) pauseBtn.onclick = () => setPaused(!paused);

// The SDK auto-pauses the sim on tab-hide; re-gate audio so the music loop doesn't play
// to an empty room (and comes back on return, unless muted/paused).
document.addEventListener("visibilitychange", syncAudio);

// --- mobile touch button (synthesizes the Space key thrust-lift reads) -------
const held = new Set<string>();
function synthKey(type: "keydown" | "keyup", code: string): void {
  if (type === "keydown") {
    if (held.has(code)) return;
    held.add(code);
  } else {
    held.delete(code);
  }
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}
const pad = document.getElementById("touch");
if (pad) {
  const b = document.createElement("button");
  b.className = "tbtn";
  b.textContent = "HOLD TO FLY";
  b.style.gridArea = "1 / 1 / 4 / 4";
  b.style.background = "rgba(65,166,246,.45)";
  const down = (ev: Event): void => {
    ev.preventDefault();
    resumeAudio();
    synthKey("keydown", "Space");
  };
  const up = (ev: Event): void => {
    ev.preventDefault();
    synthKey("keyup", "Space");
  };
  b.addEventListener("pointerdown", down);
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("pointerleave", up);
  pad.appendChild(b);
}

// Observation hook for the Stage-4 playthrough harness (audit/harness/helicopter) —
// read-only; harmless in production.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
