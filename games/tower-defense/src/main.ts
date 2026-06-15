/**
 * Tower Defense bootstrap (host glue). The GAME is data — game.json + config.json +
 * src/scenes/{title,play,over}.json composing @gitcade/library + SDK parts and two
 * custom systems (`tower-build`, `creep-accounting`). 100% of the balance is in
 * config.json (the governance-flagship rule).
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
 *   • presentation HUD mirrors (legible "Gold N", "Wave n/10" readouts);
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
const canvas = document.getElementById("game") as HTMLCanvasElement;
const game = createGame(
  { manifest, config, scenes: [title, play, over] },
  { canvas, registry, audio, storage: makeStorage(manifest.slug) },
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
  const best = (w.state.bestWave as number) ?? 0;
  w.state.bestWaveHud = best > 0 ? `Best: wave ${best}` : "";
  if (playing()) {
    w.state.goldHud = `Gold ${Math.round((w.state.gold as number) ?? 0)}  (tower ${cfg.towerCost}g)`;
    w.state.waveHud = `Wave ${Math.max(1, (w.state.wave as number) ?? 0)}/${cfg.maxWaves}`;
    w.state.leakHud = `Leaked ${(w.state.leaked as number) ?? 0}/${cfg.maxLeak}`;
    if (typeof w.state.buildHint !== "string") w.state.buildHint = "Click open ground to build a turret";
    updateBar(w);
  }
  if (game.scene.id === "over") {
    const won = w.state.outcome === "win";
    w.state.outcomeTitle = won ? "The line held! 🛡️" : "Overrun";
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
const fx = new ScreenEffects();
fx.bindToEvents(world, {
  "creep-killed": (f) => f.shake(3, 0.1, 50),
  "creep-leaked": (f) => f.flash("#b13e53", 0.18),
  "build-denied": (f) => f.flash("#ef7d57", 0.14),
  "tower-placed": (f) => f.flash("#a7f070", 0.08),
  gameover: (f) => f.shake(12, 0.45, 36),
});
attachScreenEffects(fx, canvas, document.getElementById("fx-overlay"));

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

// --- keyboard bridge to the data-driven flow edges -----------------------------
// The title/over full-canvas `tap-emit` covers pointer/touch; this keeps
// Space/Enter starting/retrying for keyboard players. Scene-guarded so PLAY is
// untouched (no host pointer/placement glue — placement is the G2 click edge).
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.code !== "Enter") return;
  if (game.scene.id === "title") {
    e.preventDefault();
    world.events.emit("start-pressed");
  } else if (game.scene.id === "over") {
    e.preventDefault();
    world.events.emit("retry");
  }
});

// Observation hook for the Stage-4 playthrough harness — read-only; harmless in prod.
(window as unknown as { __game?: unknown }).__game = game;

game.start();
