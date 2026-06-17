/**
 * Survival Arena bootstrap (host glue). The GAME is data — game.json + config.json +
 * the three JSON scenes (title → play → over) wired by `flow.on` edges, composing
 * @gitcade/library + SDK parts ONLY. There are NO custom behaviors: the level-driven
 * enemy toughness/speed ramp (once `swarm-scale`, LIBRARY-GAPS #8) is now pure DATA via
 * two library `scale-by-state` instances in play.json. See custom-behaviors/index.ts.
 *
 * 0.2.0 made the screen flow expressible as DATA (scene `flow`, `tap-emit`,
 * declarative `persist`), so the old ~306-line GameShell screen-state machine and
 * its HTML menu overlays are GONE. This file keeps ONLY host concerns that have no
 * data primitive: the library audio, the FX SHOWCASE *screen-level* juice (the
 * per-kill burst is DATA — a local `explosion` at each dead enemy; the host owns only
 * the screen-shake/flash the frozen renderer can't do from a behavior: a small shake
 * when the PLAYER is hit, a bigger shake + red flash on death, a blue flash on
 * level-up), an Enter bridge mirroring the on-screen flow buttons for keyboard
 * players, a pause toggle (freezing the sim is a host-loop concern), and a few
 * presentation-only HUD mirrors (player hp → the bar's `hp`/`maxHp` keys, the float
 * survival timer → an integer `clock`, `best` → `bestDisplay`, and the win/lose
 * `outcome` → the game-over headline text). No balance or game logic lives here.
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
// Audio level is data: $cfg.volume (default 0.6), so it's governance-tunable like any balance value.
audio.setVolume(typeof cfg.volume === "number" ? cfg.volume : 0.6);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [title, play, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug) },
);

// --- HUD + outcome mirrors (presentation only) -------------------------------
// The hud-bar reads world.state.hp/maxHp, but the player's hp lives on the player
// entity; the timer is a float; the game-over headline depends on the win/lose
// outcome. Floor/mirror those into the keys the scenes bind to. No game logic —
// the parts (health-and-death, timer-countdown, win-lose-conditions, score) remain
// the source of truth.
function mirror(): void {
  const s = game.world.state;
  if (game.scene.id === "play") {
    s.maxHp = cfg.playerHp;
    const player = game.world.byId("player");
    if (player && typeof player.state.hp === "number") {
      s.hp = Math.max(0, Math.round(player.state.hp as number));
    }
    if (typeof s.timeLeft === "number") s.clock = Math.ceil(s.timeLeft as number);
  }
  if (typeof s.best === "number") s.bestDisplay = Math.floor(s.best as number);
  if (game.scene.id === "over") {
    const won = s.outcome === "win";
    s.outcomeText = won ? "YOU SURVIVED" : "OVERWHELMED";
    s.outcomeSub = won ? "You outlasted the swarm. 🏆" : "The swarm got you.";
  }
  requestAnimationFrame(mirror);
}
requestAnimationFrame(mirror);

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
  // `throttle` (library, 0.3.1) caps the shake to once per 220ms so a swarm pile-on
  // can't strobe — the shared helper that generalizes this game's audit fix.
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

// --- keyboard bridge to the data-driven flow edges ---------------------------
// On-screen buttons emit their flow event via the `tap-emit` data part; this only
// mirrors that for Enter/Space on the title/over screens so they stay
// keyboard-accessible. Scene-guarded, so Space/movement during PLAY is untouched.
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
  // pause()/resume() freeze the sim WITHOUT detaching input, so a held movement key
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

// Observation hook for the Stage-4 playthrough harness (audit/harness/survival-arena)
// — read-only; harmless in production.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
