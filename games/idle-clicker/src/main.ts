/**
 * Idle Clicker bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/main.json composing the library `currency` + `upgrade-tree` with three
 * custom economy systems. 100% of the balance is in config.json. This file wires
 * input/UI and — the headline feature — OFFLINE PROGRESS through the SDK storage
 * bridge (`world.storage`), never raw browser storage:
 *   - on resume it loads the save and credits coins earned while away (capped),
 *   - it autosaves on an interval and when the tab is hidden/closed.
 */
import { createGame } from "@gitcade/sdk";
import type { World } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "./scenes/main.json";
import { registerCustomBehaviors } from "./custom-behaviors/index.js";
import { GameShell } from "./host/shell.js";
import { makeStorage } from "./host/storage.js";

const cfg = config as Record<string, number>;
const SAVE_KEY = "idleSave";

interface Save {
  coins: number;
  clickPower: number;
  autoRate: number;
  upgrades: Record<string, number>;
  prestigeMult: number;
  lastSeen: number;
}

const registry = createLibraryRegistry();
registerCustomBehaviors(registry);

const audio = new LibraryAudioPlayer();
const canvas = document.getElementById("game") as HTMLCanvasElement;
const menu = document.getElementById("menu") as HTMLElement;
const storage = makeStorage(manifest.slug);
const game = createGame({ manifest, config, scenes: [main] }, { canvas, registry, audio, storage });
const world = game.world;
const playing = () => menu.style.display === "none";

let saved: Save | null = null;
let prestigeMult = 1;

// Load the persisted save up front (async; ready by the time Play is tapped).
void (async () => {
  try {
    const s = await storage.get<Save>(SAVE_KEY);
    if (s && typeof s === "object") {
      saved = s;
      prestigeMult = s.prestigeMult ?? 1;
    }
  } catch {
    /* no save yet */
  }
})();

function snapshot(): Save {
  return {
    coins: (world.state.coins as number) ?? 0,
    clickPower: (world.state.clickPower as number) ?? cfg.baseClickPower,
    autoRate: (world.state.autoRate as number) ?? 0,
    upgrades: (world.state.upgrades as Record<string, number>) ?? {},
    prestigeMult,
    lastSeen: Date.now(),
  };
}
function save(): void {
  saved = snapshot();
  void storage.set(SAVE_KEY, saved);
}
// Autosave through the SDK storage bridge — never raw browser storage.
setInterval(() => {
  if (playing()) save();
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing()) save();
});
window.addEventListener("pagehide", () => {
  if (playing()) save();
});

// Tap anywhere on the coin field to earn; light it up.
canvas.addEventListener("pointerdown", () => {
  if (!playing()) return;
  world.state.clicks = ((world.state.clicks as number) ?? 0) + 1;
  audio.play("collect");
  world.events.emit("click", {});
});

// Shop bar → upgrade-tree requests; prestige resets for a permanent multiplier.
document.querySelectorAll<HTMLButtonElement>("#idlebar button[data-up]").forEach((b) => {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (playing()) world.state.upgradeRequest = b.dataset.up!;
  });
});

// IC-2: bind the shop-bar cost labels to config.json + the live growth-scaled cost
// (mirrors upgrade-tree's `Math.round(cost * growth^owned)`), so the "100% config-
// driven" claim holds for the UI and the price tracks purchases instead of a stale
// literal. Each label also shows the owned level and dims when unaffordable / maxed.
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
const prestigeBtn = document.getElementById("prestige-btn");
if (prestigeBtn) {
  prestigeBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!playing()) return;
    world.state.lastBank = Math.floor((world.state.coins as number) ?? 0);
    prestigeMult = Math.round((prestigeMult + cfg.prestigeBonus) * 100) / 100;
    // IC-1: clickPower stays the raw base; prestige is now applied to ALL income
    // via the `prestigeMult` state key the economy systems read each tick.
    saved = { coins: 0, clickPower: cfg.baseClickPower, autoRate: cfg.baseAutoRate, upgrades: {}, prestigeMult, lastSeen: Date.now() };
    void storage.set(SAVE_KEY, saved);
    world.events.emit("prestige", {});
  });
}

new GameShell({
  game,
  audio,
  music: "menu",
  title: "IDLE CLICKER",
  tagline: "Tap. Automate. Profit — even while away.",
  howto: [
    "Tap the coin (or anywhere) to earn",
    "Buy cursors and factories to earn while idle — and while away",
    "Prestige to reset for a permanent multiplier",
  ],
  gameOverEvent: "prestige",
  outcomeText: (w) => `Banked ${num(w.state.lastBank)} coins  •  Prestige multiplier now x${prestigeMult}`,
  screenFx: {
    click: (fx) => fx.flash("#ffcd75", 0.06),
    bonus: (fx) => fx.flash("#a7f070", 0.18),
    // IC-3: a "can't afford" (or otherwise rejected) buy now gets a cue instead
    // of silently no-op'ing — a brief red flash + a soft negative thunk.
    "upgrade-denied": (fx) => {
      fx.flash("#ef7d57", 0.12);
      audio.play("hit");
    },
  },
  onEnterPlay: (w) => {
    w.state.clicks = 0;
    // IC-1: the prestige multiplier is now a first-class income multiplier the
    // economy systems read every tick (click-to-earn / auto-income / interval-bonus).
    w.state.prestigeMult = prestigeMult;
    if (saved) {
      w.state.coins = saved.coins ?? 0;
      w.state.clickPower = saved.clickPower ?? cfg.baseClickPower;
      w.state.autoRate = saved.autoRate ?? cfg.baseAutoRate;
      w.state.upgrades = saved.upgrades ?? {};
      const elapsed = Math.min((Date.now() - (saved.lastSeen ?? Date.now())) / 1000, cfg.offlineCapSeconds);
      // Offline credit also benefits from prestige, mirroring live auto-income.
      const gain = Math.floor((saved.autoRate ?? 0) * elapsed * prestigeMult);
      if (gain > 0) {
        w.state.coins = (w.state.coins as number) + gain;
        w.state.hint = `Welcome back! +${gain.toLocaleString()} coins while away`;
      } else {
        w.state.hint = "Tap the coin to earn!";
      }
    } else {
      w.state.coins = cfg.startCoins;
      w.state.clickPower = cfg.baseClickPower;
      w.state.autoRate = cfg.baseAutoRate;
      w.state.upgrades = {};
      w.state.hint = "Tap the coin to earn!";
    }
  },
  beforeFrame: (w) => {
    // HUD shows the EFFECTIVE per-click / per-second income (prestige-scaled), so
    // the prestige multiplier is visible in the readouts that drive it (IC-1).
    const mult = (w.state.prestigeMult as number) ?? 1;
    w.state.coinsDisplay = fmt(w.state.coins);
    w.state.rateDisplay = `${fmt(((w.state.autoRate as number) ?? 0) * mult)}/sec`;
    w.state.powerDisplay = `x${fmt(((w.state.clickPower as number) ?? cfg.baseClickPower) * mult)} / click`;
    w.state.bonusDisplay = `bonus in ${Math.max(0, Math.ceil((w.state.bonusLeft as number) ?? cfg.bonusPeriod))}s`;
    updateShop(w);
  },
});

function fmt(v: unknown): string {
  return (typeof v === "number" ? Math.floor(v) : 0).toLocaleString();
}
function num(v: unknown): number {
  return typeof v === "number" ? Math.round(v) : 0;
}
