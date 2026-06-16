/**
 * Idle Clicker bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/{title,play}.json composing the library `currency` + `upgrade-tree`
 * (G5 economy) with four small custom economy systems (`click-to-earn`,
 * `auto-income`, `interval-bonus`, `prestige` — the idle loop the action library
 * doesn't cover; logged in LIBRARY-GAPS.md). 100% of the balance is in config.json.
 *
 * 0.2.0 ADOPTION — what used to be host TypeScript is now DATA:
 *   • G2 click-to-earn: the canvas `pointerdown` listener that incremented
 *     `world.state.clicks` is GONE. The `click-to-earn` system reads the SDK click
 *     EDGE (`input.justReleased()` + `entityAt`) on the coin directly.
 *   • G6 persistence: the host save/load/autosave (snapshot/setInterval/visibility/
 *     pagehide) is GONE. `manifest.persist` + the library `persistence` system
 *     round-trip coins/clickPower/autoRate/upgrades/prestigeMult/lastSeen through
 *     the SDK storage bridge.
 *   • G5 purchases & prestige: buying routes through `upgrade-tree`; prestige
 *     economics (bank + multiplier + reset) moved to the data `prestige` system.
 *     The GameShell screen-state machine is GONE — flow is `title → play` data.
 *
 * What REMAINS host (no data primitive covers it):
 *   • the HTML shop bar (rich cost labels + affordability dimming) — it only SETS
 *     the data request flags (`upgradeRequest` / `prestigeRequest`);
 *   • presentation HUD mirrors (formatted coins/rate/power readouts);
 *   • a tiny screen-FX juice bind (flash on click/bonus/denied);
 *   • the OFFLINE-CREDIT shim (OQ-4, out of 0.2.0 scope): a timestamp + a credit
 *     formula on top of G6's value persistence — see `applyOfflineCredit` below.
 */
import { createGame } from "@gitcade/sdk";
import type { World } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "./scenes/title.json";
import play from "./scenes/play.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { makeStorage } from "./host/storage.js";

const cfg = config as Record<string, number>;

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
// Audio level is data: $cfg.volume (default 0.6), so it's governance-tunable like any balance value.
audio.setVolume(typeof cfg.volume === "number" ? cfg.volume : 0.6);
const canvas = document.getElementById("game") as HTMLCanvasElement;
const storage = makeStorage(manifest.slug);
const game = createGame({ manifest, config, scenes: [title, play] }, { canvas, registry, audio, storage });
const world = game.world;
const playing = () => game.scene.id === "play";

// --- shop bar → data request flags (HTML chrome; the economy is data) ---------
// The bottom shop bar stays HTML host UI (rich cost labels + affordability dimming
// the canvas renderer can't do), but it only SETS the request flags the data
// `upgrade-tree` / `prestige` systems consume — no economy logic lives here.
document.querySelectorAll<HTMLButtonElement>("#idlebar button[data-up]").forEach((b) => {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (playing()) world.state.upgradeRequest = b.dataset.up!;
  });
});
const prestigeBtn = document.getElementById("prestige-btn");
if (prestigeBtn) {
  prestigeBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (playing()) world.state.prestigeRequest = true; // the data `prestige` system does the rest
  });
}

// IC-2: bind the shop-bar cost labels to config.json + the live growth-scaled cost
// (mirrors upgrade-tree's `Math.round(cost * growth^owned)`), so the "100% config-
// driven" claim holds for the UI and the price tracks purchases. Each label shows
// the owned level and dims when unaffordable / maxed.
const shopDefs = [
  { up: "click", label: "Stronger tap", cost: cfg.upgradeClickCost, growth: cfg.upgradeClickGrowth, max: cfg.upgradeClickMax },
  { up: "cursor", label: "Cursor", cost: cfg.upgradeCursorCost, growth: cfg.upgradeCursorGrowth, max: cfg.upgradeCursorMax },
  { up: "factory", label: "Factory", cost: cfg.upgradeFactoryCost, growth: cfg.upgradeFactoryGrowth, max: cfg.upgradeFactoryMax },
];
const shopButtons = new Map<string, HTMLButtonElement>();
document.querySelectorAll<HTMLButtonElement>("#idlebar button[data-up]").forEach((b) => shopButtons.set(b.dataset.up!, b));
const shopLabelCache = new Map<string, string>();

function nextCost(cost: number, growth: number, owned: number): number {
  return Math.round(cost * Math.pow(growth > 0 ? growth : 1, owned));
}
function updateShop(w: World): void {
  const coins = (w.state.coins as number) ?? 0;
  const levels = (w.state.upgrades as Record<string, number>) ?? {};
  for (const def of shopDefs) {
    const btn = shopButtons.get(def.up);
    if (!btn) continue;
    const owned = levels[def.up] ?? 0;
    const maxed = def.max > 0 && owned >= def.max;
    const cost = nextCost(def.cost, def.growth, owned);
    const lvl = owned > 0 ? ` ·L${owned}` : "";
    const html = `<b>${def.label}${lvl}</b>${maxed ? "MAX" : cost.toLocaleString()}`;
    if (shopLabelCache.get(def.up) !== html) {
      btn.innerHTML = html;
      shopLabelCache.set(def.up, html);
    }
    const op = maxed || coins < cost ? "0.55" : "1";
    if (btn.style.opacity !== op) btn.style.opacity = op;
  }
}

// --- OFFLINE-CREDIT shim (OQ-4 — OUT of 0.2.0 scope, deliberately tiny) --------
// Computing earnings-while-away needs a saved wall-clock timestamp + a game-specific
// credit formula — NOT a generic engine primitive, and crucially it needs `Date.now()`,
// which must stay OUT of the deterministic sim (so it's host-side, never a system). G6
// persistence handles the VALUE round-trip (incl. `lastSeen`); this shim does only the
// two things G6 can't:
//   1. on resume, credit `autoRate × elapsed × mult` (capped at `offlineCapSeconds`) once;
//   2. heartbeat `world.state.lastSeen = Date.now()` so the next save records "now" as the
//      away-point (started AFTER step 1 so it can't clobber the read).
//
// ORDERING: we must credit on TOP of the RESTORED `coins`, never a pre-restore (empty)
// state — `coins` is a claimed persist key, so `world.isPersistPending("coins")` is true
// while the restore is in flight (the same claim the seed systems defer on) and false once
// it lands. We wait for it to be false, then add the gain to the just-restored `coins`,
// reading the restored `autoRate`/`prestigeMult`/`lastSeen` straight from `world.state`.
//
// IC-OFFLINE (the robustness fix): the previous version waited until it had *sampled*
// `isPersistPending` true (a `sawRestoreClaim` flag) before crediting — to prove a restore
// actually happened. But this `mirror()` loop runs once per animation frame (and BEFORE the
// game's own loop, so it samples the flag before each tick), while the production bridge
// store on the parent is SYNCHRONOUS (the platform's parent-side key-value store): the
// restore's claim is placed and released entirely within the macrotask gap BETWEEN two
// frames, so the pending=true window is never observed and the credit was silently DROPPED
// in production. We now gate on two DURABLE signals instead of that transient one:
//   • GATE 1 — the play sim has actually ticked. This rAF loop can outrun the sim's first
//     tick, so we can't assume the persistence claim is placed yet. `bonusLeft` is written
//     by the `interval-bonus` system on EVERY play tick and is NOT a persisted key, so its
//     presence is a frame-timing-independent "≥1 play tick ran" signal. `persistence` is
//     ordered before `interval-bonus` in play.json, so bonusLeft set ⟹ the claim is placed.
//   • GATE 2 — the restore RESOLVED (`!isPersistPending("coins")`), so we read RESTORED values.
// Past both gates, a numeric `lastSeen` can only be a just-restored save (no system seeds it;
// the heartbeat writes it only AFTER `offlineApplied`); its absence means a first run with
// nothing to credit — either way we then own `lastSeen` (start the heartbeat).
let offlineApplied = false;

function tryApplyOfflineCredit(): void {
  if (offlineApplied || !playing()) return;
  if (typeof world.state.bonusLeft !== "number") return; // GATE 1: a play tick has run
  if (world.isPersistPending("coins")) return; // GATE 2: the restore has resolved

  const lastSeen = world.state.lastSeen;
  if (typeof lastSeen === "number") {
    const rate = (world.state.autoRate as number) ?? 0;
    const mult = (world.state.prestigeMult as number) ?? 1;
    if (rate > 0) {
      const elapsed = Math.min((Date.now() - lastSeen) / 1000, cfg.offlineCapSeconds);
      const gain = Math.floor(rate * elapsed * mult);
      if (gain > 0) {
        world.state.coins = ((world.state.coins as number) ?? 0) + gain;
        world.state.hint = `Welcome back! +${gain.toLocaleString()} coins while away`;
      }
    }
  }
  offlineApplied = true; // credited (or no save) — own `lastSeen` (heartbeat) from here on
}

// --- HUD mirrors + lastSeen heartbeat (presentation + the offline timestamp) ---
function mirror(): void {
  const w = world;
  if (playing()) {
    // Credit offline earnings once the persistence restore has landed (before the
    // heartbeat below overwrites the saved `lastSeen` we read from).
    tryApplyOfflineCredit();
    const mult = (w.state.prestigeMult as number) ?? 1;
    w.state.coinsDisplay = fmt(w.state.coins);
    w.state.rateDisplay = `${fmt(((w.state.autoRate as number) ?? 0) * mult)}/sec`;
    w.state.powerDisplay = `x${fmt(((w.state.clickPower as number) ?? cfg.baseClickPower) * mult)} / click`;
    w.state.prestigeDisplay = mult > 1 ? `prestige x${mult}` : "";
    w.state.bonusDisplay = `bonus in ${Math.max(0, Math.ceil((w.state.bonusLeft as number) ?? cfg.bonusPeriod))}s`;
    if (typeof w.state.hint !== "string") w.state.hint = "Tap the coin to earn!";
    // Heartbeat the away-timestamp (only after the offline read, so it can't clobber it).
    if (offlineApplied) w.state.lastSeen = Date.now();
    updateShop(w);
  }
  requestAnimationFrame(mirror);
}
requestAnimationFrame(mirror);

// --- screen-FX juice (presentation only) --------------------------------------
// SCREEN effects are reserved for the big, infrequent moment. Prestige — a deliberate
// run-resetting reset-for-a-multiplier — gets the flash + shake; it's rare and major,
// so it's proportionate (the same bar snake/tower-defense use: screen FX = big moments).
// The high-frequency actions are now LOCAL instead of full-screen flashes (IC-FX,
// the audit headline): clicking the coin (the single most frequent action) and the
// periodic bonus burst particles via the `sparkle` FX systems in play.json, at the
// tap point / coin — a per-click screen flash read as a strobe.
const fx = new ScreenEffects();
fx.bindToEvents(world, {
  prestige: (f) => {
    f.flash("#ef7d57", 0.3);
    f.shake(8, 0.3, 36);
  },
});
// IC-3: a rejected buy gets a cue instead of silently no-op'ing — but LOCAL to the
// button that was denied (the event carries its id), not a full-screen flash for a
// minor mis-tap. The shop buttons are HTML, so the cue lives in the DOM next to them.
world.events.on("upgrade-denied", (data) => {
  const id = (data as { id?: string } | null)?.id;
  const btn = id ? shopButtons.get(id) : undefined;
  if (btn) {
    btn.classList.remove("denied"); // restart the animation if it's already mid-flash
    void btn.offsetWidth; // force reflow so re-adding the class re-triggers the keyframes
    btn.classList.add("denied");
  }
  audio.play("hit");
});
// `attachScreenEffects` types the overlay structurally; a DOM element's
// CSSStyleDeclaration is runtime-compatible (the fx loop only assigns style props)
// but not to TS, so narrow it explicitly (matches the other games).
const fxOverlay = document.getElementById("fx-overlay") as unknown as { style: Record<string, string> } | null;
attachScreenEffects(fx, canvas, fxOverlay);

// --- audio (needs a user gesture before the browser will play sound) ----------
let musicStarted = false;
function resumeAudio(): void {
  audio.resume();
  if (!musicStarted) {
    audio.startMusic("menu");
    musicStarted = true;
  }
}
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);

// --- mute (centralized audio gate) -------------------------------------------
// Audio is OFF when the player muted or the tab is hidden (idle-clicker has no pause).
// One source of truth so the mute button and tab-hide can't fight over the gain.
let userMuted = false;
const muteBtn = document.getElementById("mute-btn");
function renderMute(): void {
  if (muteBtn) muteBtn.textContent = userMuted ? "🔇" : "🔊";
}
function syncAudio(): void {
  const off = userMuted || game.isPaused() || document.hidden;
  audio.setMuted(off);
  if (!off && musicStarted) audio.startMusic("menu");
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
// Mute while the tab is backgrounded (the music loop shouldn't play to an empty room).
document.addEventListener("visibilitychange", syncAudio);

// --- keyboard bridge to the data-driven title flow edge -----------------------
// The title's full-canvas `tap-emit` covers pointer/touch; this keeps Space/Enter
// starting the game for keyboard players. Scene-guarded so PLAY is untouched.
window.addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && game.scene.id === "title") {
    e.preventDefault();
    world.events.emit("start-pressed");
  }
});

// Observation hook for the Stage-4 playthrough harness — read-only; harmless in prod.
(window as unknown as { __game?: unknown }).__game = game;

game.start();

function fmt(v: unknown): string {
  return (typeof v === "number" ? Math.floor(v) : 0).toLocaleString();
}
