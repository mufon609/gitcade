/**
 * Breakout bootstrap (host glue). The GAME is data — game.json + config.json + the
 * six JSON scenes (title → level-1 → level-2 → level-3 → win / over) wired by
 * `flow.on` edges, composing only @gitcade/library + SDK parts (no custom code).
 *
 * 0.2.0 made the screen flow AND the level progression expressible as DATA (scene
 * `flow`, `tap-emit`, declarative `persist`), so the old ~305-line GameShell
 * screen-state machine and its HTML menu overlays are GONE. The level-to-level
 * advance is a `flow.on` edge per level scene (`level-cleared → level-2`, etc.),
 * driven by the library `level-progression` system — not host code.
 *
 * This file keeps ONLY host concerns that have no data primitive: the library
 * audio, screen juice (flash/shake), the mobile touch pad (which synthesizes the
 * arrow keys the `move-4dir` paddle already reads), a pause toggle (freezing the
 * sim is a host-loop concern), and an Enter/Space bridge that mirrors the
 * on-screen flow buttons for keyboard players. No balance or game logic lives here.
 */
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "./scenes/title.json";
import level1 from "./scenes/level-1.json";
import level2 from "./scenes/level-2.json";
import level3 from "./scenes/level-3.json";
import win from "./scenes/win.json";
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
  { manifest, config, scenes: [title, level1, level2, level3, win, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug) },
);

// --- screen juice (presentation only) ---------------------------------------
// Bind only BIG, INFREQUENT moments → flash/shake. Routine feedback (breaking a
// brick — the single most frequent action) is now LOCAL: an `explosion` particle
// burst at the broken brick, declared as scene data (see each level's FX system),
// not a screen effect. Reserving the screen for rare events keeps the per-hit feel
// punchy without a constant whole-screen jiggle. These remaining bindings fire on
// the scene events the library parts emit: ball-lost (trigger-zone), level-cleared
// (level-progression), gameover (lives-respawn).
const fx = new ScreenEffects();
fx.bindToEvents(game.world, {
  "ball-lost": (f) => {
    f.shake(10, 0.35, 34);
    f.flash("#b13e53", 0.25);
  },
  "level-cleared": (f) => f.flash("#a7f070", 0.18),
  gameover: (f) => f.shake(12, 0.45, 36),
});
// `attachScreenEffects` types the overlay as `{ style: Record<string,string> }`; a
// DOM element's CSSStyleDeclaration is structurally compatible at runtime but not
// to TS, so narrow it explicitly.
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
// mirrors that for Enter/Space so the title/win/over screens stay keyboard-
// accessible. It emits the SAME events — it implements no screen state itself.
const isPlay = (id: string): boolean => id.startsWith("level-");
window.addEventListener("keydown", (e) => {
  if (e.code !== "Enter" && e.code !== "Space") return;
  if (game.scene.id === "title") {
    e.preventDefault();
    game.world.events.emit("start-pressed");
  } else if (game.scene.id === "win" || game.scene.id === "over") {
    e.preventDefault();
    game.world.events.emit("retry");
  }
});

// --- pause (a host-loop concern: no data primitive freezes the world) --------
let paused = false;
const pauseOverlay = document.getElementById("pause-overlay");
function setPaused(next: boolean): void {
  if (!isPlay(game.scene.id) && !paused) return; // only pause during a level
  paused = next;
  if (pauseOverlay) pauseOverlay.style.display = paused ? "grid" : "none";
  // pause()/resume() freeze the sim WITHOUT detaching input, so a held paddle key
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

// --- mobile touch pad (synthesizes the arrow keys move-4dir reads) -----------
interface TouchControl {
  code: string;
  label: string;
  cell: string;
}
const TOUCH: TouchControl[] = [
  { code: "ArrowLeft", label: "◀", cell: "2 / 1" },
  { code: "ArrowRight", label: "▶", cell: "2 / 3" },
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

// Observation hook for the Stage-4 playthrough harness (audit/harness/breakout) —
// read-only; harmless in production.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
