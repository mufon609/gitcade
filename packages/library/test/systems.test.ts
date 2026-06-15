import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity } from "./helpers.js";
import { score } from "../src/systems/score.js";
import { livesRespawn } from "../src/systems/lives-respawn.js";
import { timerCountdown } from "../src/systems/timer-countdown.js";
import { waveSpawner } from "../src/systems/wave-spawner.js";
import { levelProgression } from "../src/systems/level-progression.js";
import { winLoseConditions } from "../src/systems/win-lose-conditions.js";
import { simpleInventory } from "../src/systems/simple-inventory.js";
import { currency } from "../src/systems/currency.js";
import { upgradeTree } from "../src/systems/upgrade-tree.js";

const DT = 1 / 60;
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe("score", () => {
  it("tracks the running high score and persists it via the storage API", async () => {
    const world = makeWorld();
    const params = { scoreKey: "score", highKey: "highScore", storageKey: "hs" };
    world.state.score = 0;
    score(world, params, DT); // first tick kicks off the async load
    world.state.score = 120;
    score(world, params, DT);
    expect(world.state.highScore).toBe(120);
    await flush();
    expect(await world.storage.get("hs")).toBe(120);
  });

  it("loads a previously stored high score", async () => {
    const world = makeWorld();
    await world.storage.set("hs", 999);
    const params = { scoreKey: "score", highKey: "highScore", storageKey: "hs" };
    score(world, params, DT);
    await flush();
    expect(world.state.highScore).toBe(999);
  });
});

describe("timer-countdown", () => {
  it("counts down and ends the game as a loss at zero", () => {
    const world = makeWorld();
    const params = { duration: 0.1, timeKey: "timeLeft", onExpire: "lose" };
    timerCountdown(world, params, 0.05);
    expect(world.state.timeLeft).toBeCloseTo(0.05, 5);
    timerCountdown(world, params, 0.1);
    expect(world.state.timeLeft).toBe(0);
    expect(world.state.gameOver).toBe(true);
    expect(world.state.outcome).toBe("lose");
  });
});

describe("wave-spawner", () => {
  it("spawns escalating waves from a prototype and stops at maxWaves", () => {
    const world = makeWorld();
    const params = {
      interval: 0.1,
      waveSize: 3,
      waveSizeGrowth: 0,
      waveDelay: 0.2,
      maxWaves: 2,
      maxAlive: 0,
      countTag: "enemy",
      prototype: {
        id: "enemy",
        tags: ["enemy"],
        size: { w: 10, h: 10 },
        position: { x: 0, y: 0 },
        layer: 0,
        sprite: { kind: "none" },
        behaviors: [
          { type: "ai-chase", params: { targetTag: "player", speed: 0 } },
          { type: "velocity", params: {} },
          { type: "health-and-death", params: { hp: 1 } },
        ],
      },
    };
    let started = 0;
    world.events.on("wave-start", () => (started += 1));
    for (let i = 0; i < 200; i++) {
      waveSpawner(world, params, DT);
      world.prune();
    }
    expect(world.query("enemy").length).toBe(6); // 3 per wave × 2 waves
    expect(started).toBe(2);
    expect(world.state.wave).toBe(2);
  });

  // --- B-1: the spawn-point cursor is cumulative across waves, not per-wave ---
  it("cycles spawn points across waves with a persistent cursor at waveSize:1 (B-1)", () => {
    const world = makeWorld();
    const params = {
      interval: 0.01,
      waveSize: 1, // one spawn per wave — the pathological helicopter case
      waveSizeGrowth: 0,
      waveDelay: 0,
      maxWaves: 3,
      advanceOnClear: false, // advance by the (zero) delay, enemies persist for counting
      countTag: "enemy",
      spawnPoints: [{ x: 0, y: 10 }, { x: 0, y: 20 }, { x: 0, y: 30 }],
      prototype: { id: "enemy", tags: ["enemy"], size: { w: 10, h: 10 }, position: { x: 0, y: 0 }, layer: 0, sprite: { kind: "none" }, behaviors: [] },
    };
    for (let i = 0; i < 50; i++) waveSpawner(world, params, DT);
    const ys = world.query("enemy").map((e) => e.y).sort((a, b) => a - b);
    expect(world.state.wave).toBe(3);
    // Pre-fix this would be [10, 10, 10] (pinned to spawnPoints[0]); now all three.
    expect(ys).toEqual([10, 20, 30]);
    expect(new Set(ys).size).toBe(3); // multiple DISTINCT spawn-Y values across waves
  });

  // --- B-1 regression: round-robin WITHIN a wave is unchanged ---
  it("still distributes spawn points round-robin within a single large wave (B-1 regression)", () => {
    const world = makeWorld();
    const params = {
      interval: 0.01,
      waveSize: 4, // more spawns than points → wraps within the wave
      waveSizeGrowth: 0,
      waveDelay: 0,
      maxWaves: 1,
      advanceOnClear: false,
      countTag: "enemy",
      spawnPoints: [{ x: 0, y: 10 }, { x: 0, y: 20 }, { x: 0, y: 30 }],
      prototype: { id: "enemy", tags: ["enemy"], size: { w: 10, h: 10 }, position: { x: 0, y: 0 }, layer: 0, sprite: { kind: "none" }, behaviors: [] },
    };
    for (let i = 0; i < 50; i++) waveSpawner(world, params, DT);
    const ys = world.query("enemy").map((e) => e.y).sort((a, b) => a - b);
    expect(ys).toEqual([10, 10, 20, 30]); // cursor 0,1,2,0 → all three points used, first reused
  });
});

describe("lives-respawn", () => {
  it("spends a life and respawns the player after a delay", () => {
    const world = makeWorld();
    const params = {
      startLives: 2,
      watchTag: "player",
      respawnDelay: 0.1,
      respawnPosition: { x: 50, y: 50 },
      prototype: { id: "player", tags: ["player"], size: { w: 16, h: 16 }, position: { x: 0, y: 0 }, layer: 0, sprite: { kind: "none" }, behaviors: [] },
    };
    livesRespawn(world, params, DT); // no player present → spend a life
    expect(world.state.lives).toBe(1);
    for (let i = 0; i < 12; i++) {
      livesRespawn(world, params, DT);
      world.prune();
    }
    expect(world.query("player").length).toBe(1);
  });

  it("ends the game when the last life is lost", () => {
    const world = makeWorld();
    const params = {
      startLives: 1,
      watchTag: "player",
      prototype: { id: "player", tags: ["player"], sprite: { kind: "none" }, behaviors: [] },
    };
    livesRespawn(world, params, DT);
    expect(world.state.lives).toBe(0);
    expect(world.state.gameOver).toBe(true);
    expect(world.state.outcome).toBe("lose");
  });
});

describe("level-progression", () => {
  it("advances a level when the tracked tag is cleared", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "e", tags: ["enemy"] });
    const params = { levelKey: "level", mode: "clearTag", clearTag: "enemy" };
    levelProgression(world, params, DT); // an enemy exists → no advance
    expect(world.state.level).toBe(1);
    world.destroy(e);
    world.prune();
    levelProgression(world, params, DT); // cleared → advance
    expect(world.state.level).toBe(2);
  });
});

describe("win-lose-conditions", () => {
  it("ends the game on the first matching condition", () => {
    const world = makeWorld();
    world.state.kills = 5;
    winLoseConditions(world, { conditions: [{ key: "kills", cmp: "gte", value: 5, outcome: "win", winner: "player" }] }, DT);
    expect(world.state.gameOver).toBe(true);
    expect(world.state.outcome).toBe("win");
    expect(world.state.winner).toBe("player");
  });

  it("supports lose conditions with lte/eq", () => {
    const world = makeWorld();
    world.state.coreHp = 0;
    winLoseConditions(world, { conditions: [{ key: "coreHp", cmp: "lte", value: 0, outcome: "lose" }] }, DT);
    expect(world.state.outcome).toBe("lose");
  });
});

describe("simple-inventory", () => {
  it("clamps counts to capacity and emits a gain event", () => {
    const world = makeWorld();
    world.state.inventory = { gem: 5 };
    let gained = 0;
    world.events.on("item-gained", () => (gained += 1));
    simpleInventory(world, { inventoryKey: "inventory", capacity: 3 }, DT);
    expect((world.state.inventory as Record<string, number>).gem).toBe(3);
    expect(gained).toBe(1);
  });
});

describe("currency", () => {
  it("seeds the balance and accrues passive income up to the cap", () => {
    const world = makeWorld();
    const params = { currencyKey: "gold", startAmount: 100, passiveIncome: 60, maxAmount: 150 };
    currency(world, params, 1); // +60 → 160, clamped to 150
    expect(world.state.gold).toBe(150);
  });
});

describe("upgrade-tree", () => {
  it("fulfils an affordable purchase request and applies the effect", () => {
    const world = makeWorld();
    world.state.gold = 100;
    world.state.buy = "dmg";
    const params = {
      currencyKey: "gold",
      requestKey: "buy",
      levelsKey: "ups",
      upgrades: [{ id: "dmg", cost: 30, effectKey: "towerDamage", effectAmount: 5, maxLevel: 3 }],
    };
    upgradeTree(world, params, DT);
    expect(world.state.gold).toBe(70);
    expect((world.state.ups as Record<string, number>).dmg).toBe(1);
    expect(world.state.towerDamage).toBe(5);
  });

  it("denies a purchase the player cannot afford", () => {
    const world = makeWorld();
    world.state.gold = 10;
    world.state.buy = "dmg";
    let denied = "";
    world.events.on("upgrade-denied", (d) => (denied = (d as { reason: string }).reason));
    upgradeTree(world, { currencyKey: "gold", requestKey: "buy", upgrades: [{ id: "dmg", cost: 30 }] }, DT);
    expect(world.state.gold).toBe(10);
    expect(denied).toBe("insufficient-funds");
  });
});
