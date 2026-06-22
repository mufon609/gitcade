/**
 * Lumen bootstrap (host glue). The GAME is data — game.json + config.json + two scenes
 * (the `play-base` shell + `level-1`), composing only @gitcade/library + SDK parts. No
 * balance or gameplay logic lives here.
 *
 * The one thing data can't express is the ECHO ATTEMPT LOOP: each attempt is RECORDED
 * (the SDK run-recorder, `createGame({ seed, record:true })` → `getRecording()`), and the
 * NEXT attempt opens with a skippable replay of your last run — the "Echo" — before live
 * play (the library `ReplayIntro`, which drives a SECOND Game instance, the canvas rAF,
 * and the skip input). A FIXED per-level seed means every attempt shares one seeded world,
 * so the recorded Echo re-simulates byte-for-byte in the identical world and lines up.
 *
 * Everything else here is the same host-only glue breakout keeps: library audio (gesture-
 * gated + mute), screen juice (flash overlay + an in-engine camera-shake nudge), and the
 * pause overlay (the SDK owns the freeze + the Esc/P key; the host just reacts).
 */
import { createGame, type Game } from "@gitcade/sdk";
import {
  createLibraryRegistry,
  LibraryAudioPlayer,
  ScreenEffects,
  attachScreenEffects,
  ReplayIntro,
  attachReplayIntro,
  parseRecording,
} from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import playBase from "./scenes/play-base.json";
import level1 from "./scenes/level-1.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { makeStorage } from "./host/storage.js";

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
// Audio level is data: $cfg.volume, so it's tunable like any balance value.
audio.setVolume(typeof (config as Record<string, number>).volume === "number" ? (config as Record<string, number>).volume : 0.5);

const canvas = document.getElementById("game") as HTMLCanvasElement;
const storage = makeStorage(manifest.slug);

// The replayable run sources + a FIXED seed: every attempt shares one seeded world, so the
// recorded Echo re-simulates in the identical world and lines up with live play.
const raw = { manifest, config, scenes: [playBase, level1] };
const SEED = 0x10de; // "lode" — fixed per level, so the Echo always replays the same world
const RUN_KEY = "run:level-1";

// --- DOM handles -------------------------------------------------------------
// `attachScreenEffects` types the overlay as `{ style: Record<string,string> }`; a DOM
// element's CSSStyleDeclaration is structurally compatible at runtime but not to TS.
const fxOverlay = document.getElementById("fx-overlay") as unknown as { style: Record<string, string> } | null;
const startOverlay = document.getElementById("start-overlay");
const resultOverlay = document.getElementById("result-overlay");
const resultTitle = document.getElementById("result-title");
const resultSub = document.getElementById("result-sub");
const pauseOverlay = document.getElementById("pause-overlay");
const pauseBtn = document.getElementById("pause-btn");
const muteBtn = document.getElementById("mute-btn");
// HUD is a screen-fixed DOM overlay (a scrolling level's world-space canvas can't host
// a fixed HUD): the host mirrors the display STRINGS `format-binding` derives as data
// (motesDisplay/hpDisplay/levelDisplay/livesDisplay) into these elements each frame.
const hud = document.getElementById("hud");
const hudMotes = document.getElementById("hud-motes");
const hudHp = document.getElementById("hud-hp");
const hudLevel = document.getElementById("hud-level");
const hudLives = document.getElementById("hud-lives");
const show = (el: HTMLElement | null, on: boolean): void => {
  if (el) el.style.display = on ? "grid" : "none";
};

// --- screen juice (presentation only) ----------------------------------------
// One global ScreenEffects driving the #fx-overlay (color FLASHES on the big moments).
// SHAKE is the in-engine `camera-shake` system (it rides the camera, so it shakes
// correctly while the world scrolls) — the host just EMITS "shake". bindToEvents is
// re-pointed at each new live world; the overlay loop attaches once.
const fx = new ScreenEffects();
attachScreenEffects(fx, canvas, fxOverlay);

// --- audio (needs a user gesture before the browser will play sound) ---------
let liveGame: Game | null = null; // the live, pausable game (null during the Echo)
let activeGame: Game | null = null; // whatever is on the canvas now (Echo replay OR live) — feeds the HUD
let musicStarted = false;
let userMuted = false;
function resumeAudio(): void {
  audio.resume();
  if (!musicStarted) {
    audio.startMusic("action");
    musicStarted = true;
  }
}
// Audio is OFF when muted, the live sim is paused, or the tab is hidden — one source of
// truth so those concerns can't fight over the gain. setMuted(true) stops the loop, so
// re-gating restarts it.
function syncAudio(): void {
  const off = userMuted || (liveGame?.isPaused() ?? false) || (typeof document !== "undefined" && document.hidden);
  audio.setMuted(off);
  if (!off && musicStarted) audio.startMusic("action");
}
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);
document.addEventListener("visibilitychange", syncAudio);

function renderMute(): void {
  if (muteBtn) muteBtn.textContent = userMuted ? "🔇" : "🔊";
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

// Pause button forwards to the CURRENT live game's SDK-owned toggle (no-op during the Echo).
if (pauseBtn) pauseBtn.onclick = () => liveGame?.togglePause();

// --- the Echo attempt loop ---------------------------------------------------
async function attempt(): Promise<void> {
  liveGame = null;
  activeGame = null;
  show(startOverlay, false);
  show(resultOverlay, false);
  show(pauseOverlay, false);

  const prior = parseRecording((await storage.get(RUN_KEY)) ?? "");
  if (prior) {
    // Play the Echo of the last run on a SECOND, input-less, seeded Game, THEN hand off to
    // live play (on natural completion OR a skip). attachInput:false so the watching
    // player's keystrokes don't leak into the re-simulation.
    const replayGame = createGame(raw, { canvas, registry, seed: prior.seed, entrySceneId: "level-1", attachInput: false });
    activeGame = replayGame; // the Echo feeds the HUD while it plays
    const intro = new ReplayIntro({ game: replayGame, recording: prior, onDone: () => startLive() });
    attachReplayIntro(intro, canvas, {
      prompt: "✦ ECHO OF YOUR LAST RUN — press any key to skip ✦",
      tint: "#4b3f8f",
      tintAlpha: 0.22,
      // The player's whole vocabulary, so "any key" really skips into live play.
      skipKeys: ["Space", "Enter", "Escape", "KeyG", "KeyP", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
    });
  } else {
    // First-ever attempt — no Echo yet. A brief "begin" overlay, then live play.
    show(startOverlay, true);
    const begin = (): void => {
      window.removeEventListener("keydown", begin);
      startOverlay?.removeEventListener("pointerdown", begin);
      startLive();
    };
    window.addEventListener("keydown", begin);
    startOverlay?.addEventListener("pointerdown", begin);
  }
}

function startLive(): void {
  show(startOverlay, false);
  show(resultOverlay, false);

  const live = createGame(raw, {
    canvas,
    registry,
    audio,
    storage,
    seed: SEED,
    record: true,
    entrySceneId: "level-1",
    pauseKeys: ["Escape", "KeyP"],
    pauseScenes: ["level-1"],
  });
  liveGame = live;
  activeGame = live;
  resumeAudio();

  // FLASH on outcomes (host overlay); SHAKE in-engine via the camera-shake system ("shake").
  fx.bindToEvents(live.world, {
    died: (f) => f.flash("#ff4fb0", 0.22),
    void: (f) => f.flash("#1b1442", 0.3),
    "level-clear": (f) => f.flash("#ffe0a8", 0.3),
    gameover: (f) => f.flash("#ff4fb0", 0.4),
  });
  const shake = (magnitude: number, duration: number): void => {
    live.world.events.emit("shake", { magnitude, duration });
  };
  live.world.events.on("died", () => shake(9, 0.35));
  live.world.events.on("void", () => shake(8, 0.3));
  live.world.events.on("level-clear", () => shake(6, 0.5));
  live.world.events.on("gameover", () => shake(12, 0.5));

  // Pause overlay + audio re-gate. The SDK owns the freeze + the Esc/P key (pauseKeys);
  // it emits "pause-changed" and the host just REACTS.
  live.world.events.on("pause-changed", (e) => {
    show(pauseOverlay, (e as { paused: boolean }).paused);
    syncAudio();
  });

  // Persist the recording on BOTH outcomes, so even a failed run becomes the next Echo.
  let finished = false;
  const finish = async (won: boolean): Promise<void> => {
    if (finished) return;
    finished = true;
    const motes = (live.world.state.motes as number) ?? 0;
    await storage.set(RUN_KEY, JSON.stringify(live.getRecording()));
    live.stop();
    activeGame = null;
    syncAudio();
    if (resultTitle) resultTitle.textContent = won ? "THE BEACON IS LIT" : "THE VOID CLAIMS YOU";
    if (resultSub) resultSub.textContent = `◆ ${motes} motes gathered`;
    show(resultOverlay, true);
    // Arm Retry after a beat so a movement key still held at death doesn't instant-retry.
    setTimeout(() => {
      const retry = (): void => {
        window.removeEventListener("keydown", retry);
        resultOverlay?.removeEventListener("pointerdown", retry);
        void attempt();
      };
      window.addEventListener("keydown", retry);
      resultOverlay?.addEventListener("pointerdown", retry);
    }, 600);
  };
  live.world.events.on("level-clear", () => void finish(true)); // reached the Beacon
  live.world.events.on("gameover", () => void finish(false)); // the void / damage drained every life

  live.start();
}

// HUD mirror: copy the active game's `format-binding` display strings into the screen-fixed
// DOM HUD each frame (its own rAF, independent of the SDK game loop). Hidden when nothing
// is on the canvas (the start / result overlays own the screen then).
function tickHud(): void {
  const s = activeGame?.world.state;
  if (hud) hud.style.display = s ? "flex" : "none";
  if (s) {
    if (hudMotes) hudMotes.textContent = typeof s.motesDisplay === "string" ? s.motesDisplay : "◆ 0";
    if (hudHp) hudHp.textContent = typeof s.hpDisplay === "string" ? s.hpDisplay : "♥ 0";
    if (hudLevel) hudLevel.textContent = typeof s.levelDisplay === "string" ? s.levelDisplay : "LEVEL 1";
    if (hudLives) hudLives.textContent = typeof s.livesDisplay === "string" ? s.livesDisplay : "✦ 0";
  }
  requestAnimationFrame(tickHud);
}
requestAnimationFrame(tickHud);

renderMute();
void attempt();

