import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import type { Game, Entity } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import play from "../src/scenes/play.json";
import over from "../src/scenes/over.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

type Cfg = Record<string, number>;

/**
 * The headless smoke boot `gitcade validate` defers to. Tower Defense composes a
 * data-tilemap road (towers refused on it), click-to-place, grid-snap, the
 * `transaction` buy, and a data flow (title → play → over). This test exercises the
 * whole loop headlessly AND locks:
 *   - the headline fix: a tower CANNOT be built on a road/lane tile;
 *   - the invariant: the WIN is derived from the spawner config (maxWaves + the live
 *     creep count), never a hand-computed creep total;
 *   - a shared range/cooldown UPGRADE is the data `stat-modifier` system — it raises
 *     every live tower AND every later-placed tower;
 *   - the WIN itself is data — a `win-lose-conditions@1.1.0` composite
 *     `{ all: [ wavesComplete-flag, creep-count==0 ] }` — so reaching `outcome:"win"`
 *     can ONLY have gone through that composed condition.
 */

function totalCreepsFor(cfg: Cfg): number {
  let sum = 0;
  for (let w = 1; w <= cfg.maxWaves; w++) {
    sum += Math.max(0, Math.round(cfg.waveSize + cfg.waveSizeGrowth * (w - 1)));
  }
  return sum;
}

function boot(cfg: Cfg) {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  const game = createGame({ manifest, config: cfg, scenes: [title, play, over] }, { canvas: null, registry });
  // Enter the play scene from the data title flow.
  game.world.events.emit("start-pressed");
  game.stepFrames(2);
  return { game, w: game.world };
}

/** Drive the REAL click edge: push a release at (x,y), then step one tick so the
 * build system sees it (and a second tick so `transaction` confirms the buy). */
function clickBuild(game: Game, x: number, y: number): void {
  const released = game.world.input.justReleased() as { id: number; x: number; y: number }[];
  released.push({ id: 1, x, y });
  game.stepFrames(2);
}

// Off-road, buildable 40px cells flanking the L-path (none on a lane tile).
const TOWER_SPOTS = [
  { x: 20, y: 60 }, { x: 100, y: 60 }, { x: 180, y: 60 },
  { x: 100, y: 220 }, { x: 100, y: 300 },
  { x: 260, y: 260 }, { x: 340, y: 260 }, { x: 420, y: 260 }, { x: 500, y: 260 },
  { x: 460, y: 420 }, { x: 500, y: 420 },
  { x: 620, y: 420 }, { x: 700, y: 420 }, { x: 780, y: 420 },
];
const UPGRADES = ["firerate", "range", "bounty"];

/** The data flow ends a run by transitioning to the `over` scene (which wipes all but
 * the persisted keys). So "is the game over?" is `scene.id === "over"`, and the
 * outcome/summary are read from play.flow.persist's carried keys. */
function autoWin(cfg: Cfg, maxFrames = 60000) {
  const { game, w } = boot(cfg);
  let spot = 0;
  let upg = 0;
  let f = 0;
  while (game.scene.id === "play" && f < maxFrames) {
    const gold = (w.state.gold as number) ?? 0;
    if (spot < TOWER_SPOTS.length && gold >= cfg.towerCost) {
      const s = TOWER_SPOTS[spot++];
      clickBuild(game, s.x, s.y);
    } else if (gold >= cfg.upgradeFirerateCost) {
      w.state.upgradeRequest = UPGRADES[upg++ % UPGRADES.length];
      game.stepFrames(10);
    } else {
      game.stepFrames(10);
    }
    f += 10;
  }
  return { game, w, frames: f };
}

describe("tower-defense smoke", () => {
  it("enters play, places a turret on a CLICK, and runs without throwing", () => {
    const { game, w } = boot(config as Cfg);
    expect(game.scene.id).toBe("play");

    game.stepFrames(200);
    expect(w.query("creep").length).toBeGreaterThan(0);

    // A click on buildable ground → the click edge + the transaction spends gold.
    const goldBefore = w.state.gold as number;
    clickBuild(game, 100, 60);
    expect(w.query("tower").length).toBe(1);
    expect(w.state.gold).toBe(goldBefore - (config as Cfg).towerCost);

    expect(() => game.stepFrames(500)).not.toThrow();
  });

  it("REFUSES to build on the road (tilemap buildable:false)", () => {
    const { game, w } = boot(config as Cfg);
    game.stepFrames(60);
    const goldBefore = w.state.gold as number;
    // (120,140) is squarely on the first horizontal lane tile.
    expect(w.isBuildable(120, 140)).toBe(false);
    clickBuild(game, 120, 140);
    expect(w.query("tower").length).toBe(0); // nothing built
    expect(w.state.gold).toBe(goldBefore); // and NOT charged
    // A click on adjacent open ground DOES build.
    clickBuild(game, 100, 60);
    expect(w.query("tower").length).toBe(1);
    expect(w.state.gold).toBe(goldBefore - (config as Cfg).towerCost);
  });

  it("has NO standalone win total in config (the win is a composed condition)", () => {
    expect(config).not.toHaveProperty("totalCreeps");
    expect(config).toHaveProperty("maxWaves");
  });

  it("WINS the default config by clearing every wave the spawner actually makes", () => {
    const cfg = config as Cfg;
    const { game, w } = autoWin(cfg);
    expect(game.scene.id).toBe("over"); // the data flow ended the run
    expect(w.state.outcome).toBe("win"); // only the win-lose-conditions composite can set this
    expect(w.state.winner).toBe("player");
    expect(w.state.wave).toBe(cfg.maxWaves);
    expect(w.state.resolved).toBe(totalCreepsFor(cfg));
    expect(((w.state.leaked as number) ?? 0) < cfg.maxLeak).toBe(true);
  });

  it("footgun closed (REBALANCE UP): more/bigger waves win correctly — no premature win", () => {
    const cfg: Cfg = { ...(config as Cfg), maxWaves: 12, waveSize: 7 };
    const trueTotal = totalCreepsFor(cfg);
    expect(trueTotal).toBeGreaterThan(140);
    const { game, w } = autoWin(cfg, 90000);
    expect(game.scene.id).toBe("over");
    expect(w.state.outcome).toBe("win");
    expect(w.state.wave).toBe(cfg.maxWaves);
    expect(w.state.resolved).toBe(trueTotal);
  });

  it("footgun closed (REBALANCE DOWN): fewer/smaller waves win correctly — no softlock", () => {
    const cfg: Cfg = { ...(config as Cfg), maxWaves: 4, waveSize: 3 };
    const trueTotal = totalCreepsFor(cfg);
    expect(trueTotal).toBeLessThan(140);
    const { game, w } = autoWin(cfg, 30000);
    expect(game.scene.id).toBe("over");
    expect(w.state.outcome).toBe("win");
    expect(w.state.wave).toBe(cfg.maxWaves);
    expect(w.state.resolved).toBe(trueTotal);
  });

  it("LOSE still fires on a creep leak (no spurious win), default config", () => {
    // Build nothing → creeps leak → lose at maxLeak, then the flow goes to `over`.
    const cfg = config as Cfg;
    const { game, w } = boot(cfg);
    let f = 0;
    while (game.scene.id === "play" && f < 40000) {
      game.stepFrames(50);
      f += 50;
    }
    expect(game.scene.id).toBe("over");
    expect(w.state.outcome).toBe("lose");
    expect(w.state.winner).toBe("creeps");
    expect(w.state.leaked as number).toBeGreaterThanOrEqual(cfg.maxLeak);
  });

  // --- the shared range/cooldown upgrade is the data `stat-modifier` ---
  const aimRange = (t: Entity): number =>
    t.behaviors.find((b) => b.type === "ai-aim-and-fire")!.params.range as number;

  it("a range upgrade re-stamps EVERY live tower AND every later-placed one (data stat-modifier)", () => {
    const cfg = config as Cfg;
    const { game, w } = boot(cfg);
    w.state.gold = 1000; // fund the build + upgrade + second build outright

    // A tower placed before any upgrade starts at the $cfg base range.
    clickBuild(game, 100, 60);
    expect(w.query("tower").length).toBe(1);
    const first = w.query("tower")[0];
    expect(aimRange(first)).toBe(cfg.towerBaseRange);

    // Buy a range upgrade → world.state.towerRange climbs → the data stat-modifier
    // stamps it onto the ALREADY-PLACED tower.
    const before = w.state.towerRange as number;
    w.state.upgradeRequest = "range";
    game.stepFrames(2);
    const upgraded = w.state.towerRange as number;
    expect(upgraded).toBeGreaterThan(before);
    expect(aimRange(first)).toBe(upgraded);

    // A tower placed AFTER the upgrade inherits the current range too — the prototype's
    // $cfg base is corrected the same tick it spawns.
    clickBuild(game, 180, 60);
    expect(w.query("tower").length).toBe(2);
    for (const t of w.query("tower")) expect(aimRange(t)).toBe(upgraded);
  });

  // --- the win is the win-lose-conditions@1.1.0 composite ---
  it("the waves-complete EVENT is bridged to a flag, and the win waits for zero creeps (the composite)", () => {
    const cfg = config as Cfg;
    const { game, w } = boot(cfg);
    game.stepFrames(200); // past startDelay → creeps are on the field
    expect(w.query("creep").length).toBeGreaterThan(0);
    expect(w.state.wavesComplete).toBeFalsy();

    // creep-accounting bridges the spawner's one-shot event to a latched flag.
    w.events.emit("waves-complete", { waves: cfg.maxWaves });
    game.stepFrames(1);
    expect(w.state.wavesComplete).toBe(true);
    // The flag ALONE doesn't win: the composite's `{ tag:"creep", count:"eq" }`
    // (value defaults to 0) holds the line while creeps are still alive — the data
    // guard that keeps the win tied to the field being clear.
    expect(w.state.gameOver).toBeFalsy();
  });

  // --- scene-scoped listeners — "Play again" doesn't double-fire ---
  it("a play → over → play round-trip re-attaches creep-accounting cleanly (one kill = +1 resolved)", () => {
    const { game, w } = boot(config as Cfg);
    expect(game.scene.id).toBe("play");

    // First visit: one creep-killed event bumps `resolved` by exactly 1 (the listener,
    // registered via world.events.onScene, fires once). Measured as a DELTA around the
    // emit so live gameplay can't skew it.
    const r0 = (w.state.resolved as number) ?? 0;
    w.events.emit("creep-killed");
    expect(((w.state.resolved as number) ?? 0) - r0).toBe(1);

    // Round-trip play → over → play (the "Play again" path). loadScene clears the
    // scene-scoped listeners leaving play, so the second visit starts from a clean bus.
    w.requestScene("over");
    game.stepFrames(2);
    expect(game.scene.id).toBe("over");
    w.requestScene("play");
    game.stepFrames(2); // play re-enters; creep-accounting re-attaches via onScene
    expect(game.scene.id).toBe("play");

    // Second visit: ONE creep-killed must STILL bump `resolved` by exactly 1. If the
    // first visit's listener survived the scene change, this delta would be 2 — the
    // double-fire the scene-scoped listener lifecycle prevents.
    const r1 = (w.state.resolved as number) ?? 0;
    w.events.emit("creep-killed");
    expect(((w.state.resolved as number) ?? 0) - r1).toBe(1);
  });

  // --- the build preview reads world.input.cursor() ---
  it("build-preview tracks world.input.cursor() and parks on pointerleave", () => {
    const { game, w } = boot(config as Cfg);
    // The headless boot doesn't attach DOM input, so wire the SDK Input to a fake pointer
    // target (no getBoundingClientRect ⇒ client coords map 1:1 to world coords).
    const ptrL: Record<string, (e: { pointerId: number; clientX: number; clientY: number }) => void> = {};
    w.input.attach({
      pointerTarget: { addEventListener: (t: string, f: never) => (ptrL[t] = f), removeEventListener: () => {} } as never,
    });
    const cell = (): Entity => w.query("build-cell")[0];

    // No hover yet → cursor() is null → the preview cell sits parked off-screen.
    game.stepFrames(1);
    expect(w.input.cursor()).toBeNull();
    expect(cell().x).toBe(-9999);

    // Hover an open cell at world (100,60) → cursor() reports it → build-preview snaps the
    // cell highlight to that grid cell (x = cellCenter - tile/2 = 100 - 20 = 80).
    ptrL.pointermove({ pointerId: 1, clientX: 100, clientY: 60 });
    expect(w.input.cursor()).toEqual({ x: 100, y: 60 });
    game.stepFrames(1);
    expect(cell().x).toBe(80);
    expect(cell().y).toBe(40);

    // pointerleave clears the cursor → the preview parks again.
    ptrL.pointerleave({ pointerId: 1, clientX: 100, clientY: 60 });
    expect(w.input.cursor()).toBeNull();
    game.stepFrames(1);
    expect(cell().x).toBe(-9999);
  });
});
