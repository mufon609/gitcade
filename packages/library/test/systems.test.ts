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
import { inputActions } from "../src/systems/input-actions.js";
import { formatBinding } from "../src/systems/format-binding.js";
import { statModifier } from "../src/systems/stat-modifier.js";

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

  // --- E11: level-aware density ramp (the spawn-pressure half of difficulty) ---
  it("scales wave size by the level counter via densityPerLevel", () => {
    const world = makeWorld();
    world.state.level = 3; // factor = 1 + 0.5*(3-1) = 2
    const params = {
      interval: 0.01,
      waveSize: 2,
      waveSizeGrowth: 0,
      waveDelay: 0,
      maxWaves: 1,
      advanceOnClear: false,
      countTag: "enemy",
      densityPerLevel: 0.5,
      prototype: { id: "enemy", tags: ["enemy"], size: { w: 10, h: 10 }, position: { x: 0, y: 0 }, layer: 0, sprite: { kind: "none" }, behaviors: [] },
    };
    for (let i = 0; i < 50; i++) waveSpawner(world, params, DT);
    expect(world.query("enemy").length).toBe(4); // 2 base × factor 2
  });

  it("leaves wave size unchanged at level 1 / when density params are absent (additivity)", () => {
    const world = makeWorld();
    world.state.level = 1; // factor = 1
    const params = {
      interval: 0.01,
      waveSize: 2,
      waveSizeGrowth: 0,
      waveDelay: 0,
      maxWaves: 1,
      advanceOnClear: false,
      countTag: "enemy",
      densityPerLevel: 0.5, // present but inert at level 1
      prototype: { id: "enemy", tags: ["enemy"], size: { w: 10, h: 10 }, position: { x: 0, y: 0 }, layer: 0, sprite: { kind: "none" }, behaviors: [] },
    };
    for (let i = 0; i < 50; i++) waveSpawner(world, params, DT);
    expect(world.query("enemy").length).toBe(2);
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

  // --- E7 (1.1.0): entity-count, truthy flag, and all/any composition ---
  it("wins on a live entity-count condition (value defaults to 0 — 'field cleared')", () => {
    const world = makeWorld();
    makeEntity(world, { id: "c1", tags: ["creep"] }); // one creep alive → not yet
    winLoseConditions(world, { conditions: [{ tag: "creep", count: "eq", outcome: "win", winner: "player" }] }, DT);
    expect(world.state.gameOver).toBeUndefined();

    const cleared = makeWorld(); // none alive → 0 == 0 → win
    winLoseConditions(cleared, { conditions: [{ tag: "creep", count: "eq", outcome: "win", winner: "player" }] }, DT);
    expect(cleared.state.outcome).toBe("win");
  });

  it("supports a state truthy/falsy flag with no numeric literal", () => {
    const world = makeWorld();
    world.state.wavesComplete = false;
    winLoseConditions(world, { conditions: [{ key: "wavesComplete", truthy: true, outcome: "win" }] }, DT);
    expect(world.state.gameOver).toBeUndefined();
    world.state.wavesComplete = true;
    winLoseConditions(world, { conditions: [{ key: "wavesComplete", truthy: true, outcome: "win" }] }, DT);
    expect(world.state.outcome).toBe("win");
  });

  it("composes with all: tower-defense's real win (waves complete AND zero creeps)", () => {
    const world = makeWorld();
    const tdWin = {
      conditions: [
        { key: "leaked", cmp: "gte", value: 15, outcome: "lose", winner: "creeps" },
        { all: [{ key: "wavesComplete", truthy: true }, { tag: "creep", count: "eq" }], outcome: "win", winner: "player" },
      ],
    };

    // Waves complete but a creep still on the field → no win yet (the exact case the
    // hand-rolled creep-accounting predicate guarded; now it's data).
    world.state.wavesComplete = true;
    const lingering = makeEntity(world, { id: "c1", tags: ["creep"] });
    winLoseConditions(world, tdWin, DT);
    expect(world.state.gameOver).toBeUndefined();

    // Field clears → both sub-conditions hold → win.
    world.destroy(lingering);
    world.prune();
    winLoseConditions(world, tdWin, DT);
    expect(world.state.outcome).toBe("win");
    expect(world.state.winner).toBe("player");
  });

  it("evaluates conditions in order — a lose fires before a later win composite", () => {
    const world = makeWorld();
    world.state.leaked = 15;
    world.state.wavesComplete = true; // the win composite WOULD match (0 creeps) …
    winLoseConditions(
      world,
      {
        conditions: [
          { key: "leaked", cmp: "gte", value: 15, outcome: "lose", winner: "creeps" },
          { all: [{ key: "wavesComplete", truthy: true }, { tag: "creep", count: "eq" }], outcome: "win", winner: "player" },
        ],
      },
      DT,
    );
    expect(world.state.outcome).toBe("lose"); // … but the earlier lose wins the race
    expect(world.state.winner).toBe("creeps");
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

describe("input-actions (E1)", () => {
  it("installs keyboard + touch bindings that the input layer evaluates (no synth keys)", () => {
    const world = makeWorld();
    const keyL: Record<string, (e: any) => void> = {};
    const ptrL: Record<string, (e: any) => void> = {};
    world.input.setWorldSize(800, 600);
    world.input.attach({
      keyTarget: { addEventListener: (t: string, f: any) => (keyL[t] = f), removeEventListener: () => {} } as never,
      pointerTarget: { addEventListener: (t: string, f: any) => (ptrL[t] = f), removeEventListener: () => {} } as never,
    });
    // The scene's binding DATA: thrust = a key OR a hold-anywhere rect.
    inputActions(world, { bindings: { thrust: { keys: ["Space"], rect: { x: 0, y: 0, w: 800, h: 600 } } } }, DT);
    expect(world.input.action("thrust")).toBe(false);

    keyL.keydown({ code: "Space", cancelable: true, preventDefault() {} });
    expect(world.input.action("thrust")).toBe(true);
    keyL.keyup({ code: "Space" });
    expect(world.input.action("thrust")).toBe(false);

    // Touch path: a down pointer inside the rect activates the SAME action — the
    // capability that lets a game delete its synthesized-KeyboardEvent glue.
    ptrL.pointerdown({ pointerId: 1, clientX: 400, clientY: 300 });
    expect(world.input.action("thrust")).toBe(true);
  });

  it("is a no-op for absent/empty bindings", () => {
    const world = makeWorld();
    expect(() => inputActions(world, {}, DT)).not.toThrow();
    expect(world.input.action("anything")).toBe(false);
  });
});

describe("format-binding (E2)", () => {
  it("floors / compacts / templates / scales / maps / reads-entity into display keys", () => {
    const world = makeWorld();
    world.state.score = 99.7;
    world.state.coins = 1234;
    world.state.wave = 3;
    world.state.autoRate = 2;
    world.state.prestigeMult = 5;
    world.state.bestWave = 0;
    world.state.outcome = "win";
    makeEntity(world, { id: "player", state: { hp: 42.7 } });

    formatBinding(
      world,
      {
        bindings: [
          { from: "score", format: "floor", to: "scoreDisplay" },
          { from: "coins", format: "compact", to: "coinsDisplay" },
          { from: "wave", format: "round", template: "Wave {v}/{c}", constant: 10, to: "waveHud" },
          { from: "autoRate", mult: "prestigeMult", format: "compact", template: "{v}/sec", to: "rateDisplay" },
          { from: "hp", fromEntity: "player", format: "round", to: "hp" },
          { from: "outcome", map: { win: "YOU SURVIVED", lose: "OVERWHELMED" }, to: "outcomeText" },
          { from: "bestWave", emptyWhenZero: true, template: "Best: wave {v}", to: "bestWaveHud" },
          { constant: 80, to: "maxHp" },
        ],
      },
      DT,
    );

    expect(world.state.scoreDisplay).toBe("99"); // floor(99.7)
    expect(world.state.coinsDisplay).toBe("1.23K"); // compact(1234)
    expect(world.state.waveHud).toBe("Wave 3/10"); // template + config constant via {c}
    expect(world.state.rateDisplay).toBe("10/sec"); // 2 * prestigeMult(5) = 10
    expect(world.state.hp).toBe("43"); // round(42.7) read from the player ENTITY's state
    expect(world.state.outcomeText).toBe("YOU SURVIVED"); // value→label map
    expect(world.state.bestWaveHud).toBe(""); // hidden because bestWave is 0
    expect(world.state.maxHp).toBe("80"); // const-only output (a HUD bar's max)
  });

  it("uses the fallback when the source is absent", () => {
    const world = makeWorld();
    formatBinding(world, { bindings: [{ from: "clickPower", fallback: 1, format: "round", to: "powerDisplay" }] }, DT);
    expect(world.state.powerDisplay).toBe("1");
  });
});

describe("stat-modifier (E6)", () => {
  /** Attach a behavior carrying `params` to an entity (the runtime shape a system writes). */
  function withBehavior(e: ReturnType<typeof makeEntity>, type: string, params: Record<string, unknown>) {
    e.behaviors.push({ id: `${e.id}.${type}`, type, fn: () => {}, params, scratch: {} });
    return e;
  }

  it("stamps a world.state value onto a behavior param across ALL tagged entities (the restampTowers generalization)", () => {
    const world = makeWorld();
    world.state.towerRange = 200;
    world.state.towerCooldown = 0.5;
    const a = withBehavior(makeEntity(world, { id: "t1", tags: ["tower"] }), "ai-aim-and-fire", { range: 135, cooldown: 0.7 });
    const b = withBehavior(makeEntity(world, { id: "t2", tags: ["tower"] }), "ai-aim-and-fire", { range: 135, cooldown: 0.7 });

    statModifier(
      world,
      {
        modifiers: [
          { tag: "tower", behavior: "ai-aim-and-fire", param: "range", from: "towerRange" },
          { tag: "tower", behavior: "ai-aim-and-fire", param: "cooldown", from: "towerCooldown", min: 0.2 },
        ],
      },
      DT,
    );

    expect(a.behaviors[0].params.range).toBe(200);
    expect(b.behaviors[0].params.range).toBe(200); // EVERY tower, not just one
    expect(a.behaviors[0].params.cooldown).toBe(0.5);
  });

  it("clamps to [min,max] (the towerMinCooldown floor)", () => {
    const world = makeWorld();
    world.state.towerCooldown = 0.05; // below the floor
    const t = withBehavior(makeEntity(world, { id: "t1", tags: ["tower"] }), "ai-aim-and-fire", { cooldown: 0.7 });
    statModifier(world, { modifiers: [{ tag: "tower", behavior: "ai-aim-and-fire", param: "cooldown", from: "towerCooldown", min: 0.2 }] }, DT);
    expect(t.behaviors[0].params.cooldown).toBe(0.2);
  });

  it("self-heals: an entity spawned AFTER the first tick is stamped on the next tick", () => {
    const world = makeWorld();
    world.state.towerRange = 300;
    const params = { modifiers: [{ tag: "tower", behavior: "ai-aim-and-fire", param: "range", from: "towerRange" }] };
    statModifier(world, params, DT); // no towers yet — no-op
    const fresh = withBehavior(makeEntity(world, { id: "t1", tags: ["tower"] }), "ai-aim-and-fire", { range: 135 });
    statModifier(world, params, DT); // next tick picks it up — no per-spawn stamp needed
    expect(fresh.behaviors[0].params.range).toBe(300);
  });

  it("only the named behavior is touched; an unnamed behavior filter touches all", () => {
    const world = makeWorld();
    world.state.v = 9;
    const t = makeEntity(world, { id: "t1", tags: ["tower"] });
    withBehavior(t, "ai-aim-and-fire", { range: 1 });
    withBehavior(t, "velocity", { range: 1 }); // an unrelated behavior that happens to share the key
    statModifier(world, { modifiers: [{ tag: "tower", behavior: "ai-aim-and-fire", param: "range", from: "v" }] }, DT);
    expect(t.behaviors[0].params.range).toBe(9); // ai-aim-and-fire written
    expect(t.behaviors[1].params.range).toBe(1); // velocity left alone
  });

  it("applies the scale-by-state difficulty factor (base × (1+perLevel·(level-1)))", () => {
    const world = makeWorld();
    world.state.level = 3;
    const e = withBehavior(makeEntity(world, { id: "e1", tags: ["enemy"] }), "ai-aim-and-fire", { range: 0 });
    statModifier(world, { modifiers: [{ tag: "enemy", behavior: "ai-aim-and-fire", param: "range", base: 100, levelKey: "level", perLevel: 0.5 }] }, DT);
    expect(e.behaviors[0].params.range).toBe(200); // 100 * (1 + 0.5*(3-1))
  });

  it("applies a shared multiplier (the prestige-style multKey)", () => {
    const world = makeWorld();
    world.state.mult = 4;
    const e = withBehavior(makeEntity(world, { id: "e1", tags: ["src"] }), "auto-fire", { amount: 0 });
    statModifier(world, { modifiers: [{ tag: "src", behavior: "auto-fire", param: "amount", base: 10, multKey: "mult" }] }, DT);
    expect(e.behaviors[0].params.amount).toBe(40);
  });

  it("skips a modifier with no numeric source (writes no NaN)", () => {
    const world = makeWorld();
    const e = withBehavior(makeEntity(world, { id: "e1", tags: ["tower"] }), "ai-aim-and-fire", { range: 135 });
    statModifier(world, { modifiers: [{ tag: "tower", behavior: "ai-aim-and-fire", param: "range", from: "unseeded" }] }, DT);
    expect(e.behaviors[0].params.range).toBe(135); // untouched, not NaN
  });
});
