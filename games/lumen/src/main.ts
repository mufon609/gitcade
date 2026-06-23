/**
 * Lumen bootstrap (host glue). The GAME is data — game.json + config.json + the scenes
 * (the `play-base` shell + the `level-1`/`level-2` levels), composing only @gitcade/library +
 * SDK parts. No balance or gameplay logic lives here.
 *
 * The one thing data can't express is the ECHO ATTEMPT LOOP: each attempt is RECORDED
 * (the SDK run-recorder, `createGame({ seed, record:true })` → `getRecording()`), and the
 * NEXT attempt opens with an arcade ATTRACT loop of your last run — the "Echo" — that
 * replays on repeat until you press a key, and that keypress starts live play (the library
 * `attachReplayLoop`, which drives a SECOND Game instance, the canvas rAF, and the skip
 * input). A FIXED per-level seed means every attempt shares one seeded world, so the
 * recorded Echo re-simulates byte-for-byte in the identical world and lines up.
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
  attachReplayLoop,
  parseRecording,
} from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import playBase from "./scenes/play-base.json";
import level1 from "./scenes/level-1.json";
import level2 from "./scenes/level-2.json";
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
const raw = { manifest, config, scenes: [playBase, level1, level2] };
const SEED = 0x10de; // "lode" — fixed, so the Echo always replays the same world
// PER-LEVEL recordings, keyed by scene id. A SINGLE recording spanning level-1 → level-2 desyncs on
// replay: an input-only replay can't reproduce the host's `requestNextLevel()` between levels, so it
// drifts at the boundary. So each level's run is recorded on its OWN key and contains NO scene change —
// the recorder is RE-ARMED on every level entry (see the level-clear handler). The attract-loop Echo
// replays the level the attempt STARTS in (the entry scene), which is the only Echo a restart-from-level-1
// campaign ever shows.
const ENTRY_SCENE = "level-1";
const runKey = (sceneId: string): string => `run:${sceneId}`;
const persistRun = (sceneId: string, recording: unknown): void => {
  // Fire-and-forget: a failed write costs only next run's Echo, never the live game (see finish()).
  void storage.set(runKey(sceneId), JSON.stringify(recording)).catch(() => {});
};
// Retry-arm delay (host timing) lifted to config.json so it's tunable like any balance value.
const retryArmDelayMs = ((config as Record<string, number>).retryArmDelay ?? 0.6) * 1000;

// --- DOM handles -------------------------------------------------------------
// `attachScreenEffects` types the overlay as `{ style: Record<string,string> }`; a DOM
// element's CSSStyleDeclaration is structurally compatible at runtime but not to TS.
const fxOverlay = document.getElementById("fx-overlay") as unknown as { style: Record<string, string> } | null;
const startOverlay = document.getElementById("start-overlay");
const resultOverlay = document.getElementById("result-overlay");
const resultTitle = document.getElementById("result-title");
const resultSub = document.getElementById("result-sub");
const pauseOverlay = document.getElementById("pause-overlay");
const interstitialOverlay = document.getElementById("interstitial-overlay");
const interstitialTitle = document.getElementById("interstitial-title");
const interstitialStats = document.getElementById("interstitial-stats");
const pauseBtn = document.getElementById("pause-btn");
const muteBtn = document.getElementById("mute-btn");
// The HUD is DATA now — screen-space canvas entities (screen:true) the engine draws fixed
// under the follow-camera (motes/level/lives text bound to format-binding, hp a hud-bar
// reading the player's state). No host mirror: the game owns its HUD like any other scene data.
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
  show(startOverlay, false);
  show(resultOverlay, false);
  show(pauseOverlay, false);
  show(interstitialOverlay, false);

  // A storage READ that rejects must NOT brick the boot/retry (a black canvas) — degrade to
  // "no Echo this run" (the first-run path), exactly as if there were no prior recording.
  let prior: ReturnType<typeof parseRecording> = null;
  try {
    // The Echo replays the level the attempt STARTS in (the entry scene). Each level is keyed separately,
    // and the entry-level recording is clean (it never spanned the transition), so the replay never desyncs.
    prior = parseRecording((await storage.get(runKey(ENTRY_SCENE))) ?? "");
  } catch {
    prior = null;
  }
  if (prior) {
    // Attract-LOOP the Echo of the last run on a SECOND, input-less, seeded Game: it replays on
    // repeat until the player presses a key, and THAT keypress starts live play. A fresh seeded Game
    // per cycle (makeReplayGame, attachInput:false) keeps every Echo byte-identical and stops the
    // watching player's keystrokes leaking into the re-simulation.
    const rec = prior; // narrowed non-null; `makeReplayGame` (a closure) needs a const to see it
    attachReplayLoop(canvas, {
      makeReplayGame: () => createGame(raw, { canvas, registry, seed: rec.seed, entrySceneId: "level-1", attachInput: false }),
      recording: rec,
      onStart: () => startLive(),
      visuals: {
        prompt: "✦ ECHO OF YOUR LAST RUN — press any key to skip ✦",
        tint: "#4b3f8f",
        tintAlpha: 0.22,
        // The player's whole vocabulary, so "any key" really skips into live play.
        skipKeys: ["Space", "Enter", "Escape", "KeyG", "KeyP", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
      },
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
    pauseScenes: ["level-1", "level-2"],
  });
  liveGame = live;
  // Dev-only debug seam (stripped from the production build via `import.meta.env.DEV`): exposes the
  // live Game so a headless-browser harness can drive end-to-end checks (e.g. teleport onto a Beacon
  // to exercise the between-levels interstitial). Absent from the shipped build-worker artifact.
  if (import.meta.env.DEV) (window as unknown as { __lumen?: Game }).__lumen = live;
  resumeAudio();

  // FLASH on outcomes (host overlay); SHAKE in-engine via the camera-shake system ("shake").
  // Every lethal cause — spikes, the void, a drained wraith — now routes through the player's
  // `health-and-death`, so "died" is the ONE canonical "player died" signal: the flash, the shake,
  // and the in-engine `explosion` (bound to "died" in play-base) all fire for ALL three the same way.
  fx.bindToEvents(live.world, {
    died: (f) => f.flash("#ff4fb0", 0.24),
    "level-clear": (f) => f.flash("#ffe0a8", 0.3), // a stage cleared (every Beacon)
    "levels-complete": (f) => f.flash("#ffe0a8", 0.4), // the FINAL beacon — the win
    gameover: (f) => f.flash("#ff4fb0", 0.4),
  });
  const shake = (magnitude: number, duration: number): void => {
    live.world.events.emit("shake", { magnitude, duration });
  };
  live.world.events.on("died", () => shake(9, 0.35));
  live.world.events.on("level-clear", () => shake(6, 0.5));
  live.world.events.on("levels-complete", () => shake(6, 0.5));
  live.world.events.on("gameover", () => shake(12, 0.5));

  // Pause overlay + audio re-gate. The SDK owns the freeze + the Esc/P key (pauseKeys);
  // it emits "pause-changed" and the host just REACTS.
  live.world.events.on("pause-changed", (e) => {
    show(pauseOverlay, (e as { paused: boolean }).paused);
    syncAudio();
  });

  // Persist the recording on BOTH outcomes, so even a failed run becomes the next Echo — but a
  // storage WRITE that rejects must cost ONLY next run's Echo, never the result/retry screen (and
  // never leave the game simulating headless behind a frozen overlay). So tear down + show the
  // result + arm retry FIRST and synchronously; THEN persist fire-and-forget with its own catch.
  let finished = false;
  const finish = (won: boolean): void => {
    if (finished) return;
    finished = true;
    const motes = (live.world.state.motes as number) ?? 0;
    const sceneId = live.scene.id; // the level the run ENDED in — its recording is per-level (no transition)
    const recording = live.getRecording(); // capture before stop() tears the loop down
    live.stop();
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
    }, retryArmDelayMs);
    // Persist under THIS level's key — a level-1 death updates the level-1 Echo; a level-2 death stores a
    // clean (re-armed) level-2 recording and leaves the level-1 Echo intact from when this run cleared it.
    persistRun(sceneId, recording);
  };
  // Between-levels interstitial. A Beacon emits "level-clear". For every level BUT the last, the host
  // CARRIES the player's remaining hp forward (entity hp → world.state.carriedHp, which the scene's
  // flow.persist hands to the next level, where the rebuilt player's health-and-death re-seeds hp from it
  // via `hpStateKey:"carriedHp"`), PERSISTS the leaving level's recording, ADVANCES, RE-ARMS the recorder
  // for the next level, then FREEZES and shows the carried-stats card. A continue press resumes into the
  // already-loaded next level. The LAST level skips the card — advancing past the final Beacon emits
  // "levels-complete" (no next level, no levelsComplete scene), which is the win edge bound below.
  //
  // PER-LEVEL RECORDING — order matters. This handler runs MID-TICK (a behavior emitted "level-clear"),
  // so `requestNextLevel()` queued here DRAINS at the END of this very tick (→ the next level is loaded
  // before the next tick begins), and `resetRecording()` then aligns the recorder's frame 0 to that next
  // level's FIRST tick. We therefore persist the leaving level's recording (clean — captured BEFORE the
  // drain) and read the carried stats FIRST, then advance + re-arm. (Re-arming after the transition is
  // why the card shows over the next level, not the cleared one — a non-issue behind the opaque card.)
  const levelsTotal = manifest.levels?.length ?? 1;
  live.world.events.on("level-clear", () => {
    const p = live.world.query("player")[0];
    if (p) live.world.state.carriedHp = p.state.hp as number;
    const here = (live.world.state.level as number) ?? 1;
    if (here >= levelsTotal) {
      live.requestNextLevel(); // last level → emits "levels-complete" → finish(true) below
      return;
    }
    // Capture the leaving level's CLEAN recording + the carried stats BEFORE advancing/re-arming.
    persistRun(live.scene.id, live.getRecording());
    const hp = (live.world.state.carriedHp as number) ?? 0;
    const motes = (live.world.state.motes as number) ?? 0;
    const lives = (live.world.state.lives as number) ?? 0;
    // Advance now (drains at the end of THIS tick) and re-arm so the next level records fresh from tick 0.
    live.requestNextLevel();
    live.resetRecording();
    live.pause();
    syncAudio();
    if (interstitialTitle) interstitialTitle.textContent = `LEVEL ${here + 1}`;
    if (interstitialStats) interstitialStats.textContent = `HP ${hp}    ◆ ${motes}    ✦ ${lives}`;
    show(interstitialOverlay, true);
    // Arm continue after a beat so a movement key still held at the Beacon doesn't instant-skip it. The
    // transition has already drained, so continue simply RESUMES into the next level.
    setTimeout(() => {
      const cont = (): void => {
        window.removeEventListener("keydown", cont);
        interstitialOverlay?.removeEventListener("pointerdown", cont);
        show(interstitialOverlay, false);
        live.resume(); // unfreeze — the next level is already loaded; play begins
        syncAudio();
      };
      window.addEventListener("keydown", cont);
      interstitialOverlay?.addEventListener("pointerdown", cont);
    }, retryArmDelayMs);
  });

  // Run outcomes: the FINAL Beacon ("levels-complete") wins; draining the last life ("gameover")
  // loses. "level-clear" alone is now just a stage boundary (handled above), no longer the win.
  live.world.events.on("levels-complete", () => finish(true));
  live.world.events.on("gameover", () => finish(false)); // the void / damage drained every life

  live.start();
}

renderMute();
void attempt();

