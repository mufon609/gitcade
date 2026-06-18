/**
 * Tower Defense bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/{title,play,over}.json composing @gitcade/library + SDK parts and two
 * custom systems (`tower-build`, `creep-accounting`). 100% of the balance is in
 * config.json (no value is hardcoded in host glue).
 *
 * 0.2.0 ADOPTION — what used to be host TypeScript is now DATA:
 *   • G3 tilemap: the road is one data tilemap (drawn + queried via
 *     `world.isBuildable`); `tower-build` refuses the road. The rectangle `path`
 *     entities are GONE — towers on the road are impossible by construction.
 *   • G2 click-to-place: the host `canvas.addEventListener("pointerdown" → state.
 *     placeRequest)` is GONE; `tower-build` reads the SDK click EDGE directly.
 *   • G4/G5: grid-snap via `snapToGrid`; placement cost routed through the library
 *     `transaction` system (afford → deduct → emit).
 *   • G1 flow: title → play → over are DATA scenes (`flow.on` + `tap-emit`); the
 *     305-line GameShell is DELETED and the game runs the real `game.start()` loop
 *     (so the click edge clears every frame — the Idle Clicker lesson).
 *
 * What REMAINS host (no data primitive covers it):
 *   • the HTML upgrade bar (rich cost labels + affordability dimming the canvas
 *     renderer can't do) — it only SETS the data `upgradeRequest` flag;
 *   • a residual mirror for the two-value outcome summary (the single-value HUD
 *     readouts — Gold/Wave/Leaked/best/outcome title — are DATA now via the library
 *     `format-binding` system in each scene, E2);
 *   • a screen-FX juice bind + the audio gesture + a keyboard bridge to the flow.
 */
import { createGame } from "@gitcade/sdk";
import type { World } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "./scenes/title.json";
import play from "./scenes/play.json";
import over from "./scenes/over.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { makeStorage } from "./host/storage.js";

const cfg = config as Record<string, number>;

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
// Audio level is data: $cfg.volume (default 0.6), so it's tunable like any balance value.
audio.setVolume(typeof cfg.volume === "number" ? cfg.volume : 0.6);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [title, play, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug), pauseKeys: ["Escape", "KeyP"], pauseScenes: ["play"] },
);
const world = game.world;
const playing = () => game.scene.id === "play";

// --- upgrade bar → data request flag (HTML chrome; the economy is data) --------
// The bottom bar stays HTML host UI (rich cost labels + affordability dimming),
// but it only SETS the `upgradeRequest` flag the data `upgrade-tree` consumes — no
// economy logic lives here. (Prior audit suspected these weren't wired: the real
// cause was the GameShell's own loop never draining the click edge; on the real
// game.start() loop the flag is consumed every tick.)
const upgradeDefs = [
  { up: "range", label: "Range", cost: cfg.upgradeRangeCost, growth: cfg.upgradeRangeGrowth, max: cfg.upgradeRangeMax },
  { up: "firerate", label: "Fire rate", cost: cfg.upgradeFirerateCost, growth: cfg.upgradeFirerateGrowth, max: cfg.upgradeFirerateMax },
  { up: "bounty", label: "Bounty", cost: cfg.upgradeBountyCost, growth: cfg.upgradeBountyGrowth, max: cfg.upgradeBountyMax },
];
const upgradeButtons = new Map<string, HTMLButtonElement>();
document.querySelectorAll<HTMLButtonElement>("#tdbar button[data-up]").forEach((b) => {
  upgradeButtons.set(b.dataset.up!, b);
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (playing()) world.state.upgradeRequest = b.dataset.up!;
  });
});

const labelCache = new Map<string, string>();
function nextCost(cost: number, growth: number, owned: number): number {
  return Math.round(cost * Math.pow(growth > 0 ? growth : 1, owned));
}
function updateBar(w: World): void {
  const gold = (w.state.gold as number) ?? 0;
  const levels = (w.state.upgrades as Record<string, number>) ?? {};
  for (const def of upgradeDefs) {
    const btn = upgradeButtons.get(def.up);
    if (!btn) continue;
    const owned = levels[def.up] ?? 0;
    const maxed = def.max > 0 && owned >= def.max;
    const c = nextCost(def.cost, def.growth, owned);
    const lvl = owned > 0 ? ` ·L${owned}` : "";
    const html = `<b>${def.label} +${lvl}</b>${maxed ? "MAX" : `${c}g`}`;
    if (labelCache.get(def.up) !== html) {
      btn.innerHTML = html;
      labelCache.set(def.up, html);
    }
    const op = maxed || gold < c ? "0.5" : "1";
    if (btn.style.opacity !== op) btn.style.opacity = op;
  }
}

// --- HUD mirrors (presentation strings the canvas text sprites bind to) --------
function mirror(): void {
  const w = world;
  // The HUD strings (gold/wave/leak/bestWave/outcomeTitle/buildHint) are DATA now —
  // the library `format-binding` system in each scene templates them (E2). Only the
  // host-bound bits remain: the HTML upgrade bar, and the two-value outcome summary
  // (one format-binding writes one value; this line interpolates wave AND leaked).
  if (playing()) updateBar(w);
  if (game.scene.id === "over") {
    w.state.outcomeSummary = `Reached wave ${Math.max(1, (w.state.wave as number) ?? 0)} · leaked ${(w.state.leaked as number) ?? 0}`;
  }
  requestAnimationFrame(mirror);
}
requestAnimationFrame(mirror);

// Show/hide the HTML upgrade bar with the play scene (it is host chrome, not data).
function syncBarVisibility(): void {
  const bar = document.getElementById("tdbar");
  if (bar) bar.style.display = playing() ? "flex" : "none";
  requestAnimationFrame(syncBarVisibility);
}
requestAnimationFrame(syncBarVisibility);

// --- screen-FX juice (presentation only) ---------------------------------------
// Screen-level FX is reserved for SCREEN-WIDE, low-frequency events: a life lost to
// a leak (a brief red vignette) and game-over (a hard shake). The routine, high-
// frequency actions — placing a turret, a denied mis-tap — used to flash the WHOLE
// screen (the reported green flash); that feedback is now LOCAL, emitted at the cell
// by the data `sparkle`/`explosion` systems in play.json. A creep kill keeps a tiny
// 3px shake to punch the local death burst (the `explosion` system) without flashing.
const fx = new ScreenEffects();
fx.bindToEvents(world, {
  "creep-killed": (f) => f.shake(3, 0.1, 50),
  "creep-leaked": (f) => f.flash("#b13e53", 0.18),
  gameover: (f) => f.shake(12, 0.45, 36),
});
// `attachScreenEffects` types the overlay structurally; a DOM element's
// CSSStyleDeclaration is runtime-compatible (the fx loop only assigns style props)
// but not to TS, so narrow it explicitly (matches the other games).
const fxOverlay = document.getElementById("fx-overlay") as unknown as { style: Record<string, string> } | null;
attachScreenEffects(fx, canvas, fxOverlay);

// --- audio (needs a user gesture before the browser will play sound) -----------
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

// The desktop build-preview hover bridge is GONE (E9): the data `build-preview` system
// reads the SDK's button-less cursor channel (`world.input.cursor()`) directly, so the
// host `pointermove → world.state.buildHover` listener and its manual screen→world
// transform are no longer needed. The SDK already does that transform for every pointer.

// Observation hook for the Stage-4 playthrough harness — read-only; harmless in prod.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
