/**
 * Snake bootstrap (host glue). The GAME is data — game.json + config.json + the
 * three JSON scenes (title → play → over) wired by `flow.on` edges, composing
 * @gitcade/library + SDK parts plus two custom parts (`snake-body`, `snake-guard`).
 *
 * 0.2.0 made the screen flow expressible as DATA (scene `flow`, `tap-emit`,
 * declarative `persist`), so the old ~305-line GameShell screen-state machine and
 * its HTML menu overlays are GONE. This file keeps ONLY host concerns that have no
 * data primitive: the library audio, screen juice (flash/shake), the mobile touch
 * d-pad (which drives the data-defined `move` ACTION via `input.setActionVector`,
 * NOT synthesized key events — the keyboard half is the `input-actions` system),
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
  { canvas, registry, audio, storage: makeStorage(manifest.slug), pauseKeys: ["Escape", "KeyP"], pauseScenes: ["play"] },
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

// Keyboard flow access (Enter/Space → start/retry) is DATA now — a `key-emit` behavior
// on each title/over flow button (E3), the keyboard companion to `tap-emit`. No host bridge.

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

// --- mobile touch d-pad (drives the data-defined `move` ACTION; no synth keys) ---
// Each button reports its direction as HELD; we fold the held set into a vector and
// push it through the SDK input layer (`setActionVector`), which `move-grid-step`
// reads via its `moveAction:"move"` param — the exact same channel the keyboard
// `input-actions` binding feeds. This replaces the old `dispatchEvent(KeyboardEvent)`
// bandaid: touch and keyboard now share one logical action instead of the game
// faking browser key events to reach a keyboard-only mover.
interface TouchControl {
  dir: "up" | "down" | "left" | "right";
  label: string;
  cell: string;
}
const TOUCH: TouchControl[] = [
  { dir: "up", label: "▲", cell: "1 / 2" },
  { dir: "left", label: "◀", cell: "2 / 1" },
  { dir: "right", label: "▶", cell: "2 / 3" },
  { dir: "down", label: "▼", cell: "3 / 2" },
];
const heldDirs = new Set<string>();
function pushMoveVector(): void {
  const x = (heldDirs.has("right") ? 1 : 0) - (heldDirs.has("left") ? 1 : 0);
  const y = (heldDirs.has("down") ? 1 : 0) - (heldDirs.has("up") ? 1 : 0);
  game.world.input.setActionVector("move", x, y);
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
      heldDirs.add(t.dir);
      pushMoveVector();
    };
    const up = (ev: Event): void => {
      ev.preventDefault();
      heldDirs.delete(t.dir);
      pushMoveVector();
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
