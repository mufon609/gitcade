/**
 * Idle Clicker bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/{title,play}.json composing the library `currency` + `upgrade-tree`
 * economy with four small custom economy systems (`click-to-earn`, `auto-income`,
 * `interval-bonus`, `prestige` — the idle loop the action library doesn't cover).
 * 100% of the balance is in config.json. Flow is
 * `title → play`, also data.
 *
 * What lives host-side (no data primitive covers it):
 *   • the HTML shop bar (rich cost labels + affordability dimming) — it only SETS
 *     the data request flags (`upgradeRequest` / `prestigeRequest`);
 *   • a residual host mirror for the prestige-threshold label + conditional hint
 *     (the numeric coins/rate/power/bonus readouts are DATA — `format-binding`);
 *   • a tiny screen-FX juice bind (flash on click/bonus/denied);
 *   • the offline-credit shim: a timestamp + a credit formula on top of the value
 *     persistence — see `armOfflineCredit` below.
 */
import { createGame, powInt } from "@gitcade/sdk";
import type { World } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer, ScreenEffects, attachScreenEffects, formatCompact, cappedOfflineGain } from "@gitcade/library";
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
// Audio level is data: $cfg.volume (default 0.6), so it's tunable like any balance value.
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

// Bind the shop-bar cost labels to config.json + the live growth-scaled cost
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
  // Cross-engine-deterministic integer power (owned is a level count) — the standing rule for
  // systems-layer curves; keeps a host-computed cost identical on every engine.
  return Math.round(cost * powInt(growth > 0 ? growth : 1, owned));
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

// --- offline-credit shim (deliberately tiny) ----------------------------------
// Earnings-while-away needs a saved wall-clock timestamp + a credit formula, and crucially
// `Date.now()` — which must stay OUT of the deterministic sim, so this is host-side, never a
// system. Persistence round-trips the values (incl. `lastSeen`); this shim credits
// `autoRate × elapsed × mult` (capped at `offlineCapSeconds`) once on resume, then heartbeats
// `world.state.lastSeen = Date.now()` for the next save.
//
// Credit on TOP of the RESTORED `coins`: await `world.whenRestored(["coins"])` rather than
// poll `isPersistPending`, because the production bridge store is synchronous — the pending
// claim is placed and released inside the rAF macrotask gap, so a poll would miss it. Armed
// once the play scene is live, after `loadScene`'s scene-scoped reset.
let offlineApplied = false;
let offlineArmed = false;

function armOfflineCredit(): void {
  if (offlineArmed || !playing()) return;
  offlineArmed = true;
  void world.whenRestored(["coins"]).then(() => {
    if (offlineApplied || !playing()) {
      offlineApplied = true;
      return;
    }
    const lastSeen = world.state.lastSeen;
    if (typeof lastSeen === "number") {
      const rate = (world.state.autoRate as number) ?? 0;
      const mult = (world.state.prestigeMult as number) ?? 1;
      if (rate > 0) {
        // The capped-accrual formula is the library `cappedOfflineGain` —
        // floor(rate*mult × min(elapsed, cap)). `Date.now()` stays here in host glue
        // (it must never enter the deterministic sim), which is why this is a util.
        const gain = cappedOfflineGain(rate * mult, lastSeen, Date.now(), cfg.offlineCapSeconds);
        if (gain > 0) {
          world.state.coins = ((world.state.coins as number) ?? 0) + gain;
          world.state.hint = `Welcome back! +${formatCompact(gain)} coins while away`;
        }
      }
    }
    offlineApplied = true; // credited (or no save) — own `lastSeen` (heartbeat) from here on
  });
}

// --- HUD mirrors + lastSeen heartbeat (presentation + the offline timestamp) ---
function mirror(): void {
  const w = world;
  if (playing()) {
    // Arm the offline-earnings credit once play is live; it fires when the persistence
    // restore lands (before the heartbeat below overwrites the saved `lastSeen`).
    armOfflineCredit();
    // The numeric HUD strings (coins/rate/power/bonus) are DATA — the library
    // `format-binding` system in play.json compacts/templates them. Only the
    // genuinely host-side bits remain below: the prestige-multiplier threshold label,
    // the conditional hint default (which the offline credit message overrides), the
    // offline `lastSeen` heartbeat, and the HTML shop bar.
    const mult = (w.state.prestigeMult as number) ?? 1;
    w.state.prestigeDisplay = mult > 1 ? `prestige x${mult}` : "";
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
// High-frequency actions stay LOCAL instead of full-screen flashes (a per-click screen
// flash reads as a strobe): clicking the coin (the single most frequent action) and the
// periodic bonus burst particles via the `sparkle` FX systems in play.json, at the tap
// point / coin.
const fx = new ScreenEffects();
fx.bindToEvents(world, {
  prestige: (f) => {
    f.flash("#ef7d57", 0.3);
    f.shake(8, 0.3, 36);
  },
});
// A rejected buy gets a cue instead of silently no-op'ing — but LOCAL to the
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

// Keyboard flow access (Enter/Space → start) is DATA — a `key-emit` behavior on the
// title flow button, the keyboard companion to `tap-emit`. No host bridge.

game.start();
