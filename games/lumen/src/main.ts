/**
 * Lumen bootstrap (host glue). The GAME is data — game.json + config.json + the scenes
 * (the `play-base` shell + the `level-1`/`level-2` levels), composing only @gitcade/library +
 * SDK parts. No balance or gameplay logic lives here.
 *
 * The three things data can't express are the ECHO ATTEMPT LOOP, the END-OF-LEVEL CHOICE, and the
 * LEVEL-SELECT launch:
 *
 *  - ECHO. Each attempt is RECORDED (the SDK run-recorder, `createGame({ seed, record:true })` →
 *    `getRecording()`), and the NEXT attempt of THAT LEVEL opens with an arcade ATTRACT loop of your
 *    last run of it — the "Echo" — replaying on repeat until you press a key, and that keypress starts
 *    live play (the library `attachReplayLoop`, driving a SECOND Game + the canvas rAF + skip input).
 *    The Echo replays the level you are ON (`currentLevel`), booting that level IN ISOLATION
 *    (createGame `entrySceneId`) with the recording's restored entry-state — so the level-1 Echo plays
 *    after a fresh start, and the level-2 Echo plays once you have reached level-2. A FIXED per-level
 *    seed means every attempt shares one seeded world, so the recorded Echo re-simulates byte-for-byte.
 *
 *  - CHOICE. Clearing a non-final Beacon doesn't auto-advance: it offers "↻ Replay this level" (re-enter
 *    the level you just cleared — its Echo, then live) or "→ Continue" (advance to the next level,
 *    carrying your stats, exactly as before). The final Beacon still wins; draining your lives still loses.
 *
 *  - LEVEL SELECT. The result + choice cards reach a DATA-authored level-select menu (`menu.json`, booted
 *    by `openMenu`): cards for each cleared level (won-gated + best score/time), a pick of which relaunches
 *    that level fresh — its Echo, then live. See `openMenu` for why the host wraps the menu's `@level` edges.
 *
 * Per-level recordings + progress are the library RUN-STORE's job now (`createRunStore`): it keeps each
 * level's LAST recording (the Echo source — a SINGLE recording spanning level-1 → level-2 would desync on
 * replay, since an input-only replay can't reproduce the host's `requestNextLevel()` between levels, so
 * each level records on its OWN key with NO scene change — the recorder is RE-ARMED on every level entry)
 * AND a won-set + best score/time INDEX that round-trips through `manifest.persist` for the menu to read.
 * The level the loop is on rides a persisted `currentLevel`, so a reload (or retry) resumes the right level.
 *
 * Everything else here is the same host-only glue breakout keeps: library audio (gesture-gated + mute),
 * screen juice (flash overlay + an in-engine camera-shake nudge), and the pause overlay (the SDK owns
 * the freeze + the Esc/P key; the host just reacts).
 */
import { createGame, type Game, type RunRecording } from "@gitcade/sdk";
import {
  createLibraryRegistry,
  LibraryAudioPlayer,
  ScreenEffects,
  attachScreenEffects,
  attachReplayLoop,
  createRunStore,
  restoreRecordingEntry,
} from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import playBase from "./scenes/play-base.json";
import level1 from "./scenes/level-1.json";
import level2 from "./scenes/level-2.json";
import menu from "./scenes/menu.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { makeStorage } from "./host/storage.js";
import { createCampaign } from "./campaign.js";

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
// Audio level is data: $cfg.volume, so it's tunable like any balance value.
audio.setVolume(typeof (config as Record<string, number>).volume === "number" ? (config as Record<string, number>).volume : 0.5);

const canvas = document.getElementById("game") as HTMLCanvasElement;
const storage = makeStorage(manifest.slug);

// The replayable run sources + a FIXED seed: every attempt shares one seeded world, so the
// recorded Echo re-simulates in the identical world and lines up with live play. `menu` is the
// DATA-authored level-select scene (booted on demand by openMenu, not part of the campaign sequence).
const raw = { manifest, config, scenes: [playBase, level1, level2, menu] };
const SEED = 0x10de; // "lode" — fixed, so the Echo always replays the same world

// --- campaign navigation (host policy) ---------------------------------------
// The ordered level sequence is data (manifest.levels); `campaign` is the PURE policy the loop reads off
// it (firstLevel / next / isFinal / label), factored into ./campaign.ts so it's unit-tested
// independently of this DOM bootstrap. A level never hard-wires its successor — the per-level Echo /
// choice flow stays scene-agnostic. Local aliases keep the call sites below terse.
const campaign = createCampaign((manifest.levels ?? []) as string[]);
const LEVELS = campaign.levels;
const firstLevel = campaign.first;
const nextLevelId = campaign.next;
const isFinalLevel = campaign.isFinal;
const levelLabel = campaign.label;

// --- run-store (between-runs durable data layer) -----------------------------
// The library run-store is the single authority for PER-LEVEL recordings + progress: it keeps each level's
// LAST recording (the next Echo source, under its own per-level key) and folds the won-set + best
// score/time into a progress INDEX. That index round-trips through `manifest.persist`
// {slot:"progress", keys:["runWon","runBest"]}: the menu scene's `persistence` system LOADS it into
// world.state, where `level-select` projects it and a gated `tap-emit` reads the won-set — so the menu's
// data is real, with no host mirror. Best TIME is the recording's deterministic tick count, never wall-clock.
const store = createRunStore({ storage });
// recordRuns are chained so sequential run-ends never race the index's read-modify-write; fire-and-forget,
// so a failed write costs only the next Echo / a stale best — never the live game (the result/retry path).
let recordChain: Promise<unknown> = Promise.resolve();
function recordRun(recording: RunRecording, score: number, won: boolean): void {
  recordChain = recordChain.then(() => store.recordRun({ recording, score, won })).catch(() => {});
}

// `currentLevel` — the level the loop is on (which Echo to show, where to boot live). PERSISTED so a
// reload or a retry resumes it; reset to the first level after a campaign win. The default-param of
// `attempt()` reads it, so updating it before an attempt re-points the whole loop.
const CURRENT_LEVEL_KEY = "currentLevel";
let currentLevel = firstLevel;
const setCurrentLevel = (id: string): void => {
  currentLevel = id;
  if (dev) dev.level = id;
  void storage.set(CURRENT_LEVEL_KEY, id).catch(() => {}); // fire-and-forget (a failed write just falls back to the first level on boot)
};
/** Resume the persisted level on boot — degrade to the first level on any read error / stale value. */
async function readCurrentLevel(): Promise<string> {
  try {
    const v = await storage.get(CURRENT_LEVEL_KEY);
    if (typeof v === "string" && LEVELS.includes(v)) return v;
  } catch {
    /* fall through to the first level */
  }
  return firstLevel;
}

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
// Between-levels CHOICE card (Replay vs Continue) — see the level-clear handler.
const choiceOverlay = document.getElementById("choice-overlay");
const choiceTitle = document.getElementById("choice-title");
const choiceStats = document.getElementById("choice-stats");
const replayBtn = document.getElementById("replay-btn");
const continueBtn = document.getElementById("continue-btn");
// "≡ Level select" affordances on the result + choice cards — the two between-runs screens the menu hub
// is reachable from (the live game is stopped at result and abandoned-on-open at choice, so the canvas is free).
const menuBtn = document.getElementById("menu-btn");
const choiceMenuBtn = document.getElementById("choice-menu-btn");
const pauseBtn = document.getElementById("pause-btn");
const muteBtn = document.getElementById("mute-btn");
// The HUD is DATA now — screen-space canvas entities (screen:true) the engine draws fixed
// under the follow-camera (motes/level/lives text bound to format-binding, hp a hud-bar
// reading the player's state). No host mirror: the game owns its HUD like any other scene data.
const show = (el: HTMLElement | null, on: boolean): void => {
  if (el) el.style.display = on ? "grid" : "none";
};

// --- dev-only debug seam -----------------------------------------------------
// Stripped from the production build via `import.meta.env.DEV` (absent from the shipped build-worker
// artifact). A headless-browser harness POLLS `phase`/`level` and drives the live `game` (e.g. teleport
// onto a Beacon to exercise the choice flow + the level-2 Echo end-to-end) over the chromium CDP shim.
interface LumenDev {
  /** The live, pausable game — `null` during the Echo attract loop / the menu. */
  game: Game | null;
  /** The level-select menu game while it is open, else `null`. A harness reads its projected per-level
   *  `world.state` (e.g. `level-1:sel` / `level-1:status`) and drives a card tap to launch a level. */
  menu: Game | null;
  /** The level the loop is on (the persisted `currentLevel`). */
  level: string;
  /** Coarse loop phase a harness can poll: `boot|echo|start|live|choice|result|menu`. */
  phase: string;
}
const dev: LumenDev | null = import.meta.env.DEV
  ? ((window as unknown as { __lumen: LumenDev }).__lumen = { game: null, menu: null, level: firstLevel, phase: "boot" })
  : null;
const setPhase = (phase: string): void => {
  if (dev) dev.phase = phase;
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
// Open an attempt of `sceneId` (defaults to the level the loop is on): attract-loop ITS Echo, then live.
async function attempt(sceneId: string = currentLevel): Promise<void> {
  liveGame = null;
  if (dev) dev.game = null;
  show(startOverlay, false);
  show(resultOverlay, false);
  show(pauseOverlay, false);
  show(choiceOverlay, false);

  // A storage READ that rejects must NOT brick the boot/retry (a black canvas) — degrade to
  // "no Echo this run" (the first-run path), exactly as if there were no prior recording.
  let prior: RunRecording | null = null;
  try {
    // The Echo replays THIS level's last run, read from the run-store (its per-level LAST recording).
    // Each level is keyed separately and is clean (it never spanned a transition), and the recording
    // carries the entry-state it was reached with — so booting it in isolation (entrySceneId: rec.sceneId)
    // and restoring that state replays it without desync.
    prior = await store.lastRecording(sceneId);
  } catch {
    prior = null;
  }
  if (prior) {
    setPhase("echo");
    // Attract-LOOP the Echo of the last run on a SECOND, input-less, seeded Game booted at THIS level: it
    // replays on repeat until the player presses a key, and THAT keypress starts live play. A fresh seeded
    // Game per cycle (makeReplayGame, attachInput:false) keeps every Echo byte-identical and stops the
    // watching player's keystrokes leaking into the re-simulation. createReplay restores the recording's
    // entry-state/RNG-phase, so a mid-campaign level (level-2) replays faithfully even booted in isolation.
    const rec = prior; // narrowed non-null; `makeReplayGame` (a closure) needs a const to see it
    attachReplayLoop(canvas, {
      makeReplayGame: () => createGame(raw, { canvas, registry, seed: rec.seed, entrySceneId: rec.sceneId, attachInput: false }),
      recording: rec,
      onStart: () => startLive(sceneId, rec),
      visuals: {
        prompt: "✦ ECHO OF YOUR LAST RUN — press any key to skip ✦",
        tint: "#4b3f8f",
        tintAlpha: 0.22,
        // The player's whole vocabulary, so "any key" really skips into live play.
        skipKeys: ["Space", "Enter", "Escape", "KeyG", "KeyP", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"],
      },
    });
  } else {
    // No Echo for this level yet (first-ever attempt, or a cleared write). A brief "begin" overlay, then live.
    setPhase("start");
    show(startOverlay, true);
    const begin = (): void => {
      window.removeEventListener("keydown", begin);
      startOverlay?.removeEventListener("pointerdown", begin);
      startLive(sceneId, null);
    };
    window.addEventListener("keydown", begin);
    startOverlay?.addEventListener("pointerdown", begin);
  }
}

// Start live play of `sceneId`. `prior` (this level's last recording, when there is one) seeds a
// mid-campaign re-entry from its carried state so the live run lines up with the Echo it followed.
function startLive(sceneId: string, prior: RunRecording | null): void {
  setCurrentLevel(sceneId);
  setPhase("live");
  show(startOverlay, false);
  show(resultOverlay, false);

  const live = createGame(raw, {
    canvas,
    registry,
    audio,
    storage,
    seed: SEED,
    record: true,
    entrySceneId: sceneId,
    pauseKeys: ["Escape", "KeyP"],
    pauseScenes: ["level-1", "level-2"],
  });
  // Re-enter a mid-campaign level from its recorded ENTRY-STATE (carriedHp / motes / lives + the RNG
  // phase), so a level-2 retry resumes from the carry the Echo replays from — not a from-scratch boot.
  // For the first level the captured entry is just { level: 1 } and the restore is a no-op, so applying
  // it whenever we have a prior recording is uniform and safe. The live recorder then captures this same
  // entry as the new run's frame 0, keeping every re-entry self-consistent.
  if (prior) restoreRecordingEntry(live, prior);
  liveGame = live;
  if (dev) dev.game = live;
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
    const endedIn = live.scene.id; // the level the run ENDED in — its recording is per-level (no transition)
    const recording = live.getRecording(); // capture before stop() tears the loop down
    live.stop();
    syncAudio();
    setPhase("result");
    // A win ends the campaign → the next attempt RESTARTS at the first level. A loss keeps `currentLevel`
    // as the level we ended in, so the retry re-enters THAT level (its Echo, then live).
    if (won) setCurrentLevel(firstLevel);
    if (resultTitle) resultTitle.textContent = won ? "THE BEACON IS LIT" : "THE VOID CLAIMS YOU";
    if (resultSub) resultSub.textContent = `◆ ${motes} motes gathered`;
    show(resultOverlay, true);
    // Arm the result actions after a beat so a movement key still held at death doesn't instant-retry.
    // Any key / tap → Echo again; L / the "≡ Level select" button → the menu hub.
    setTimeout(() => {
      const leave = (go: () => void): void => {
        window.removeEventListener("keydown", onKey);
        resultOverlay?.removeEventListener("pointerdown", onRetry);
        menuBtn?.removeEventListener("pointerdown", swallow);
        menuBtn?.removeEventListener("click", onMenu);
        go();
      };
      const onRetry = (): void => leave(() => void attempt()); // currentLevel (first level after a win, else where we died)
      const onMenu = (): void => leave(openMenu);
      const onKey = (e: KeyboardEvent): void => {
        if (e.code === "KeyL") {
          e.preventDefault();
          onMenu();
        } else onRetry();
      };
      const swallow = (e: Event): void => e.stopPropagation(); // a button tap must not ALSO retry the overlay
      window.addEventListener("keydown", onKey);
      resultOverlay?.addEventListener("pointerdown", onRetry);
      menuBtn?.addEventListener("pointerdown", swallow);
      menuBtn?.addEventListener("click", onMenu);
    }, retryArmDelayMs);
    // Fold this finished run into the run-store: updates THIS level's LAST recording (the next Echo) +
    // the won-set / best score+time. A win records the final level as cleared; a death records a loss
    // (best score can still rise; the won-set never shrinks). recording.sceneId IS `endedIn` (per-level).
    recordRun(recording, motes, won);
  };

  // Between-levels CHOICE. A Beacon emits "level-clear". For every level BUT the last, the host CARRIES
  // the player's remaining hp forward (entity hp → world.state.carriedHp, which the scene's flow.persist
  // hands to the next level, where the rebuilt player's health-and-death re-seeds hp from it via
  // `hpStateKey:"carriedHp"`), PERSISTS the leaving level's clean recording, ADVANCES + RE-ARMS the
  // recorder for the next level, then FREEZES and offers a choice: Replay the just-cleared level (its Echo,
  // then live) or Continue into the already-loaded next level. The LAST level skips the card — advancing
  // past the final Beacon emits "levels-complete" (the win edge), handled below.
  //
  // PER-LEVEL RECORDING — order matters. This handler runs MID-TICK (a behavior emitted "level-clear"), so
  // `requestNextLevel()` queued here DRAINS at the END of this very tick (→ the next level is loaded before
  // the next tick begins), and `resetRecording()` then aligns the recorder's frame 0 to that next level's
  // FIRST tick. We therefore advance + re-arm IMMEDIATELY (as before) and make the CHOICE over the already-
  // loaded next level: Continue resumes it; Replay discards it (live.stop()) and re-enters the cleared one.
  live.world.events.on("level-clear", () => {
    const p = live.world.query("player")[0];
    if (p) live.world.state.carriedHp = p.state.hp as number;
    const justCleared = live.scene.id; // still the cleared level (mid-tick, before the drain)
    if (isFinalLevel(justCleared)) {
      live.requestNextLevel(); // last level → emits "levels-complete" → finish(true) below
      return;
    }
    // Fold the CLEARED level's clean run into the run-store (its LAST recording → Replay's Echo is THIS very
    // run; the won-set gains this level; best score/time update) BEFORE advancing/re-arming the recorder.
    const hp = (live.world.state.carriedHp as number) ?? 0;
    const motes = (live.world.state.motes as number) ?? 0;
    const lives = (live.world.state.lives as number) ?? 0;
    recordRun(live.getRecording(), motes, true); // a non-final clear ⇒ this level is won (recording.sceneId === justCleared)
    const next = nextLevelId(justCleared)!; // non-final ⇒ present
    // Advance now (drains at the end of THIS tick) and re-arm so the next level records fresh from tick 0.
    live.requestNextLevel();
    live.resetRecording();
    live.pause();
    syncAudio();
    setPhase("choice");
    if (choiceTitle) choiceTitle.textContent = "BEACON LIT";
    if (choiceStats) choiceStats.textContent = `HP ${hp}    ◆ ${motes}    ✦ ${lives}`;
    if (continueBtn) continueBtn.textContent = `→ Continue to ${levelLabel(next)}`;
    show(choiceOverlay, true);
    // Arm BOTH choices after a beat so a movement key still held at the Beacon doesn't instant-pick. The
    // transition has already drained, so Continue simply RESUMES into the next level; Replay tears the
    // (advanced) live game down and re-enters the just-cleared level via a fresh attempt.
    setTimeout(() => {
      const cleanup = (): void => {
        window.removeEventListener("keydown", onKey);
        replayBtn?.removeEventListener("pointerdown", onReplay);
        continueBtn?.removeEventListener("pointerdown", onContinue);
        choiceMenuBtn?.removeEventListener("pointerdown", onMenu);
      };
      const onContinue = (): void => {
        cleanup();
        show(choiceOverlay, false);
        setCurrentLevel(next); // the loop is now on the next level (carry-over already in world.state)
        live.resume(); // unfreeze — the next level is already loaded; play begins
        syncAudio();
        setPhase("live");
      };
      const onReplay = (): void => {
        cleanup();
        show(choiceOverlay, false);
        live.stop(); // abandon the advanced next level…
        void attempt(justCleared); // …and re-enter the just-cleared level: its Echo (this run), then live
      };
      const onMenu = (): void => {
        cleanup();
        show(choiceOverlay, false);
        openMenu(); // openMenu stops the (paused) advanced game → frees the canvas → boots the level-select
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.code === "KeyR") {
          e.preventDefault();
          onReplay();
        } else if (e.code === "KeyL") {
          e.preventDefault();
          onMenu();
        } else if (e.code === "Enter" || e.code === "Space" || e.code === "ArrowRight" || e.code === "KeyD") {
          e.preventDefault();
          onContinue();
        }
      };
      window.addEventListener("keydown", onKey);
      replayBtn?.addEventListener("pointerdown", onReplay);
      continueBtn?.addEventListener("pointerdown", onContinue);
      choiceMenuBtn?.addEventListener("pointerdown", onMenu);
    }, retryArmDelayMs);
  });

  // Run outcomes: the FINAL Beacon ("levels-complete") wins; draining the last life ("gameover")
  // loses. "level-clear" alone is now just a stage boundary (handled above), no longer the win.
  live.world.events.on("levels-complete", () => finish(true));
  live.world.events.on("gameover", () => finish(false)); // the void / damage drained every life

  live.start();
}

// --- the level-select menu (a host-orchestrated phase) -----------------------
// Reachable from the result + choice cards (the "≡ Level select" button / L). The menu is a DATA scene
// (menu.json: per-level cards + the `level-select` projection + a won-gated `tap-emit` + `@level` flow
// edges); the HOST boots it as its OWN Game and turns a card pick into a fresh attempt — wrapping level
// entry in lumen's signature Echo, exactly as every other launch does. Booting with `levels: []` makes the
// menu's `@level:<id>` edges a NO-OP in this game (resolveLevelTarget returns null with no sequence), so
// they stay the portable, validator-checked data contract a non-wrapping host would follow while lumen's
// pick listeners do the launching. The menu's `persistence` system loads the run-store's progress index, so
// the cards' won-gating + best score/time are real data — no host mirror.
let menuGame: Game | null = null;
function openMenu(): void {
  if (menuGame) return; // already open
  // Free the canvas: stop whatever game owns it now — the stopped result game, or the PAUSED choice game
  // (abandoning its advanced next level, like Replay does). The menu renders on the canvas, so hide overlays.
  liveGame?.stop();
  liveGame = null;
  if (dev) dev.game = null;
  show(startOverlay, false);
  show(resultOverlay, false);
  show(pauseOverlay, false);
  show(choiceOverlay, false);
  setPhase("menu");

  const m = createGame(raw, { canvas, registry, storage, entrySceneId: "menu", levels: [], attachInput: true });
  menuGame = m;
  if (dev) dev.menu = m;

  const leave = (go: () => void): void => {
    window.removeEventListener("keydown", onEsc);
    m.stop();
    menuGame = null;
    if (dev) dev.menu = null;
    go();
  };
  // A pick → launch that level fresh (its Echo, then live), exactly like a retry. The gated tap-emit only
  // emits for CLEARED levels (level-select projects the per-level `:sel` flag it reads), so a pick is always
  // a won level. The `pick-<id>` event IS the menu's `@level:<id>` flow key — the host intercepts it to add
  // the Echo wrapper (the in-engine jump no-ops here, see the levels:[] note above).
  for (const id of LEVELS) {
    m.world.events.on(`pick-${id}`, () =>
      leave(() => {
        setCurrentLevel(id);
        void attempt(id);
      }),
    );
  }
  // Back (the "↩ BACK" card or Esc) → return to the level you were on: its Echo, then live.
  const back = (): void => leave(() => void attempt());
  m.world.events.on("menu-back", back);
  const onEsc = (e: KeyboardEvent): void => {
    if (e.code === "Escape") {
      e.preventDefault();
      back();
    }
  };
  window.addEventListener("keydown", onEsc);

  m.start();
}

renderMute();
// Resume the persisted level, then open its attempt (Echo, then live).
void (async () => {
  currentLevel = await readCurrentLevel();
  if (dev) dev.level = currentLevel;
  void attempt();
})();
