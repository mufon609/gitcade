/**
 * Snake bootstrap (host glue). The GAME is data — game.json + config.json + the
 * three JSON scenes (title → play → over) wired by `flow.on` edges, composing
 * @gitcade/library + SDK parts plus two custom parts (`snake-body`, `snake-guard`).
 *
 * 0.2.0 made the screen flow expressible as DATA (scene `flow`, `tap-emit`,
 * declarative `persist`), so the old ~305-line GameShell screen-state machine and
 * its HTML menu overlays are GONE. This file keeps ONLY host concerns that have no
 * data primitive: the library audio, screen juice (flash/shake), the mobile touch
 * d-pad (which synthesizes the arrow keys the `move-grid-step` part already reads),
 * a pause toggle (freezing the sim is a host-loop concern), and an Enter/Space
 * bridge that mirrors the on-screen flow buttons for keyboard players. No balance
 * or game logic lives here.
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
  { canvas, registry, audio, storage: makeStorage(manifest.slug) },
);

// --- screen juice (presentation only) ---------------------------------------
// SCREEN effects are reserved for big, infrequent moments. Death is one: the same
// `snake-dead` the play scene's `flow.on` edge routes to game-over gets a shake +
// red flash — proportionate to losing the run. Eating a coin is the single most
// frequent action, so it does NOT get a full-screen flash (that read as a strobe);
// its feedback is LOCAL — the `sparkle` FX system in play.json bursts particles at
// the eaten cell, plus the existing `collect` sound. (0.3.0 audit, snake-01.)
const fx = new ScreenEffects();
fx.bindToEvents(game.world, {
  "snake-dead": (f) => {
    f.shake(12, 0.45, 36);
    f.flash("#b13e53", 0.3);
  },
});
// `attachScreenEffects` types the overlay as `{ style: Record<string,string> }`;
// a DOM element's CSSStyleDeclaration is structurally compatible at runtime (the fx
// loop only assigns style props) but not to TS, so narrow it explicitly.
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
// mirrors that for Enter/Space so the title/over screens stay keyboard-accessible.
// It emits the SAME events — it does not implement any screen state itself.
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
  // pause()/resume() freeze the sim WITHOUT detaching input, so a held direction key
  // survives the pause (stop()/start() would clear it). Mute music while paused.
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

// --- mobile touch d-pad (synthesizes the arrow keys move-grid-step reads) ----
interface TouchControl {
  code: string;
  label: string;
  cell: string;
}
const TOUCH: TouchControl[] = [
  { code: "ArrowUp", label: "▲", cell: "1 / 2" },
  { code: "ArrowLeft", label: "◀", cell: "2 / 1" },
  { code: "ArrowRight", label: "▶", cell: "2 / 3" },
  { code: "ArrowDown", label: "▼", cell: "3 / 2" },
];
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
  for (const t of TOUCH) {
    const b = document.createElement("button");
    b.className = "tbtn";
    b.textContent = t.label;
    b.style.gridArea = t.cell;
    const down = (ev: Event): void => {
      ev.preventDefault();
      resumeAudio();
      synthKey("keydown", t.code);
    };
    const up = (ev: Event): void => {
      ev.preventDefault();
      synthKey("keyup", t.code);
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    pad.appendChild(b);
  }
}

// Observation hook for the Stage-4 playthrough harness (audit/harness/snake) —
// read-only; harmless in production.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
