import { describe, it, expect } from "vitest";
import { Game, type Scene } from "@gitcade/sdk";
import { createLibraryRegistry } from "../src/registry.js";
import { randomFreeCell, snapToGrid } from "../src/util.js";
import { transaction, persistence, currency } from "../src/systems/index.js";
import { tapEmit } from "../src/ui/index.js";
import { scaleByState } from "../src/behaviors/index.js";
import { makeWorld, makeEntity } from "./helpers.js";

// ---------------------------------------------------------------------------
// transaction system (afford → deduct → emit)
// ---------------------------------------------------------------------------
describe("transaction system", () => {
  it("deducts and emits purchased on an affordable request; denies otherwise", () => {
    const world = makeWorld();
    world.state.gold = 50;
    const events: Array<{ type: string; data: any }> = [];
    world.events.on("purchased", (d) => events.push({ type: "purchased", data: d }));
    world.events.on("purchase-denied", (d) => events.push({ type: "purchase-denied", data: d }));
    const params = { currencyKey: "gold", requestKey: "purchaseRequest", onOk: "purchased", onDenied: "purchase-denied" };

    world.state.purchaseRequest = { id: "thing", cost: 30 };
    transaction(world, params, 1 / 60);
    expect(world.state.gold).toBe(20);
    expect(world.state.purchaseRequest).toBe(""); // consumed
    expect(events.at(-1)).toEqual({ type: "purchased", data: { id: "thing", cost: 30 } });

    world.state.purchaseRequest = { id: "big", cost: 999 };
    transaction(world, params, 1 / 60);
    expect(world.state.gold).toBe(20); // unchanged
    expect(events.at(-1)).toEqual({ type: "purchase-denied", data: { id: "big", cost: 999, reason: "insufficient-funds" } });
  });

  it("resolves a bare-id request against a costs map", () => {
    const world = makeWorld();
    world.state.coins = 100;
    let ok = false;
    world.events.on("bought", () => (ok = true));
    world.state.buy = "sword";
    transaction(world, { currencyKey: "coins", requestKey: "buy", onOk: "bought", onDenied: "no", costs: { sword: 40 } }, 1 / 60);
    expect(world.state.coins).toBe(60);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #4 — snapToGrid / randomFreeCell are re-exported from the PACKAGE INDEX
//   (not just src/util.js), so games no longer inline the grid-snap formula.
// ---------------------------------------------------------------------------
describe("public grid helpers re-exported from @gitcade/library (#4)", () => {
  it("snapToGrid and randomFreeCell are reachable from the package index", async () => {
    const lib = await import("../src/index.js");
    expect(typeof lib.snapToGrid).toBe("function");
    expect(typeof lib.randomFreeCell).toBe("function");
    expect(lib.snapToGrid(75, 75, 50)).toEqual({ x: 75, y: 75 });
  });
});

// ---------------------------------------------------------------------------
// free-cell placement helpers (deterministic via world.rng)
// ---------------------------------------------------------------------------
describe("randomFreeCell / snapToGrid", () => {
  it("snaps a point to its cell center", () => {
    expect(snapToGrid(75, 75, 50)).toEqual({ x: 75, y: 75 });
    expect(snapToGrid(10, 10, 50)).toEqual({ x: 25, y: 25 });
  });

  it("never returns an occupied cell and is deterministic for a fixed seed", () => {
    const world = makeWorld({ bounds: { width: 100, height: 100 }, seed: 7 });
    // Occupy the cell whose center is (10,10) with a tagged entity.
    makeEntity(world, { id: "occ", x: 4, y: 4, w: 12, h: 12, tags: ["body"] }); // center 10,10
    const a = randomFreeCell(world, { tileSize: 20, occupiedTag: "body" });
    expect(a).not.toBeNull();
    expect(a).not.toEqual({ x: 10, y: 10 }); // excluded — occupied

    // Same seed ⇒ same sequence (deterministic replay).
    const world2 = makeWorld({ bounds: { width: 100, height: 100 }, seed: 7 });
    makeEntity(world2, { id: "occ", x: 4, y: 4, w: 12, h: 12, tags: ["body"] });
    const b = randomFreeCell(world2, { tileSize: 20, occupiedTag: "body" });
    expect(b).toEqual(a);
  });

  it("excludes cells of extra excludeTags entities and explicit excludeCells (#2)", () => {
    // 4x4 grid @ ts20 on a 80x80 world = 16 cells; occupy almost all, leave one free,
    // then exclude that one via a marker tag → null (proves the marker blocked it).
    const world = makeWorld({ bounds: { width: 80, height: 80 }, seed: 3 });
    let free: { x: number; y: number } | null = null;
    // Fill 15 of 16 cells with "body"; track the single free cell center.
    const centers: Array<[number, number]> = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) centers.push([c * 20 + 10, r * 20 + 10]);
    const freeCenter = centers[5]!; // arbitrary free cell
    for (const [cx, cy] of centers) {
      if (cx === freeCenter[0] && cy === freeCenter[1]) continue;
      makeEntity(world, { id: `b${cx}-${cy}`, x: cx - 6, y: cy - 6, w: 12, h: 12, tags: ["body"] });
    }
    free = randomFreeCell(world, { tileSize: 20, occupiedTag: "body" });
    expect(free).toEqual({ x: freeCenter[0], y: freeCenter[1] }); // the one open cell

    // Now mark the free cell with a "marker"-tagged entity and exclude it.
    makeEntity(world, { id: "marker", x: freeCenter[0] - 4, y: freeCenter[1] - 4, w: 8, h: 8, tags: ["marker"] });
    expect(randomFreeCell(world, { tileSize: 20, occupiedTag: "body", excludeTags: ["marker"] })).toBeNull();
    // Same via explicit excludeCells.
    expect(
      randomFreeCell(world, { tileSize: 20, occupiedTag: "body", excludeCells: [{ x: freeCenter[0], y: freeCenter[1] }] }),
    ).toBeNull();
  });

  it("returns null when every cell is occupied", () => {
    const world = makeWorld({ bounds: { width: 40, height: 40 }, seed: 1 }); // 2x2 grid @ ts20
    for (const [i, c] of [[10, 10], [30, 10], [10, 30], [30, 30]].entries()) {
      makeEntity(world, { id: `o${i}`, x: c[0] - 6, y: c[1] - 6, w: 12, h: 12, tags: ["body"] });
    }
    expect(randomFreeCell(world, { tileSize: 20, occupiedTag: "body" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wave-spawner placement:"free-cell" scatters across distinct cells
// ---------------------------------------------------------------------------
describe("wave-spawner placement:free-cell", () => {
  it("scatters spawns across distinct, non-overlapping cells", () => {
    const proto = {
      id: "e",
      sprite: { kind: "shape", shape: "rect", color: "#bb9af7" },
      size: { w: 12, h: 12 },
      position: { x: 100, y: 75 },
      behaviors: [],
      tags: ["spawned"],
    };
    const scene: Scene = {
      id: "main",
      size: { width: 200, height: 150 },
      entities: [],
      systems: [
        {
          type: "wave-spawner",
          params: {
            prototype: proto,
            interval: 0.1,
            waveSize: 5,
            waveDelay: 0.1,
            maxWaves: 0,
            advanceOnClear: false,
            countTag: "spawned",
            placement: "free-cell",
            tileSize: 20,
            occupiedTag: "spawned",
          },
        },
      ],
    } as unknown as Scene;
    const game = new Game({ scenes: [scene], config: {}, canvas: null, registry: createLibraryRegistry(), rng: mulberry(99) });
    game.stepFrames(90);
    const centers = game.world.query("spawned").map((e) => `${e.cx},${e.cy}`);
    expect(centers.length).toBeGreaterThan(3);
    expect(new Set(centers).size).toBe(centers.length); // all distinct cells
    // All in bounds.
    for (const e of game.world.query("spawned")) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x + e.w).toBeLessThanOrEqual(200);
      expect(e.y + e.h).toBeLessThanOrEqual(150);
    }
  });
});

// ---------------------------------------------------------------------------
// persistence round-trip through the storage bridge
// ---------------------------------------------------------------------------
describe("persistence system", () => {
  it("saves declared keys on change and restores them on a fresh world (live value wins)", async () => {
    const scene: Scene = {
      id: "main",
      size: { width: 100, height: 100 },
      entities: [],
      systems: [{ type: "persistence", params: {} }],
    } as unknown as Scene;
    const persist = { keys: ["best"], slot: "save", everySeconds: 0 };

    // Run 1 — set the persisted key, let the system flush it to storage.
    const g1 = new Game({ scenes: [scene], config: {}, canvas: null, persist, registry: createLibraryRegistry() });
    g1.world.state.best = 4242;
    g1.world.state.scratch = 7; // not declared → never persisted
    g1.stepFrames(3);
    // The save is fire-and-forget; flush the microtask queue.
    await Promise.resolve();
    expect(await g1.world.storage.get("save")).toEqual({ best: 4242 });

    // Run 2 — a NEW game sharing the same storage adapter restores "best".
    const g2 = new Game({ scenes: [scene], config: {}, canvas: null, persist, storage: g1.world.storage, registry: createLibraryRegistry() });
    expect(g2.world.state.best).toBeUndefined();
    g2.stepFrames(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(g2.world.state.best).toBe(4242); // restored
    expect("scratch" in g2.world.state).toBe(false); // never persisted
  });
});

// ---------------------------------------------------------------------------
// a persisted, system-SEEDED key restores authoritatively
//   even when `currency` would seed it synchronously on the SAME scene.
//   `persistence` claims the key, `currency` defers its seed while the load
//   is in flight, the restore wins. No title-scene workaround needed.
// ---------------------------------------------------------------------------
describe("persistence vs currency seeding race", () => {
  // Flush the .then→.catch→.finally microtask chain the load promise schedules.
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  // persistence is ORDERED FIRST so it claims the key before currency runs.
  const raceScene: Scene = {
    id: "play",
    size: { width: 100, height: 100 },
    entities: [],
    systems: [
      { type: "persistence", params: {} },
      { type: "currency", params: { currencyKey: "coins", startAmount: 0 } },
    ],
  } as unknown as Scene;
  const persist = { keys: ["coins"], slot: "save", everySeconds: 0 };

  it("a saved balance survives a reboot of the SAME (seeding) scene", async () => {
    // Run 1 — earn coins, let persistence flush.
    const g1 = new Game({ scenes: [raceScene], config: {}, canvas: null, persist, registry: createLibraryRegistry() });
    g1.stepFrames(1);
    await flush();
    g1.world.state.coins = 12345; // simulate gameplay earnings
    g1.stepFrames(1);
    await Promise.resolve();
    expect(await g1.world.storage.get("save")).toEqual({ coins: 12345 });

    // Run 2 — fresh world, SAME scene (currency present), SAME storage.
    const g2 = new Game({ scenes: [raceScene], config: {}, canvas: null, persist, storage: g1.world.storage, registry: createLibraryRegistry() });
    // Tick 1: persistence claims `coins`; currency sees it pending and DEFERS its
    // seed (no `coins: 0` clobber).
    g2.stepFrames(1);
    expect(g2.world.isPersistPending("coins")).toBe(true); // claimed, load not yet resolved
    expect("coins" in g2.world.state).toBe(false); // seed deferred — NOT 0
    // Load resolves → restore writes the saved balance, claim releases.
    await flush();
    expect(g2.world.state.coins).toBe(12345); // restored, authoritative
    expect(g2.world.isPersistPending("coins")).toBe(false);
    // Subsequent ticks: currency no longer seeds (key present), value stands.
    g2.stepFrames(2);
    expect(g2.world.state.coins).toBe(12345);
  });

  it("with NO saved value, the seed still fires after the load resolves (additivity)", async () => {
    const g = new Game({ scenes: [raceScene], config: {}, canvas: null, persist, registry: createLibraryRegistry() });
    g.stepFrames(1);
    expect("coins" in g.world.state).toBe(false); // deferred while claimed
    await flush(); // empty load resolves, claim releases
    g.stepFrames(1);
    expect(g.world.state.coins).toBe(0); // currency now seeds startAmount normally
  });

  it("currency alone (no persistence claiming) seeds on tick 1", () => {
    const w = makeWorld();
    currency(w, { currencyKey: "gold", startAmount: 50 }, 1 / 60);
    expect(w.state.gold).toBe(50); // no claim ⇒ immediate seed (additive no-op of the check)
  });
});

// ---------------------------------------------------------------------------
// Idle Clicker offline-credit ordering: a HOST-SIDE writer that
// adds earnings-while-away must defer on the SAME persist claim the seed systems
// use, so it lands AFTER the async restore — never racing a fixed timer that the
// restore can overwrite (a naive `setTimeout(credit, 60)` silently lost coins
// whenever the bridge round-trip took longer than 60ms).
// ---------------------------------------------------------------------------
describe("offline-credit ordering vs the persistence restore", () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const scene: Scene = {
    id: "play",
    size: { width: 100, height: 100 },
    entities: [],
    systems: [
      { type: "persistence", params: {} },
      { type: "currency", params: { currencyKey: "coins", startAmount: 0 } },
    ],
  } as unknown as Scene;
  const persist = { keys: ["coins", "autoRate", "lastSeen"], slot: "save", everySeconds: 0 };

  const NOW = 1_000_000_000_000;
  const SAVED_COINS = 500;
  const RATE = 10;
  const CAP = 7200;
  const lastSeen = NOW - 3_600_000; // 1h ago
  const gain = Math.floor(RATE * Math.min((NOW - lastSeen) / 1000, CAP)); // 10 * 3600 = 36000

  // Seed a storage that already holds a save with autoRate + an away timestamp.
  async function savedStorage() {
    const seed = new Game({ scenes: [scene], config: {}, canvas: null, persist, registry: createLibraryRegistry() });
    seed.stepFrames(1);
    await flush();
    seed.world.state.coins = SAVED_COINS;
    seed.world.state.autoRate = RATE;
    seed.world.state.lastSeen = lastSeen;
    seed.stepFrames(1);
    await Promise.resolve();
    return seed.world.storage;
  }

  // The exact host poll from idle-clicker main.ts (tryApplyOfflineCredit).
  function makePoll(world: import("@gitcade/sdk").World) {
    let applied = false, sawClaim = false;
    return () => {
      if (applied) return;
      if (world.isPersistPending("coins")) { sawClaim = true; return; }
      if (!sawClaim) return;
      applied = true;
      const rate = (world.state.autoRate as number) ?? 0;
      const ls = world.state.lastSeen;
      if (typeof ls === "number" && rate > 0) {
        const g = Math.floor(rate * Math.min((NOW - ls) / 1000, CAP));
        if (g > 0) world.state.coins = ((world.state.coins as number) ?? 0) + g;
      }
    };
  }

  it("credits on TOP of the restored balance, even when the restore lands late", async () => {
    const storage = await savedStorage();
    const g = new Game({ scenes: [scene], config: {}, canvas: null, persist, storage, registry: createLibraryRegistry() });
    const poll = makePoll(g.world);

    // Frame 1: persistence claims `coins`; the poll sees it pending and DEFERS.
    g.stepFrames(1);
    poll();
    expect(g.world.isPersistPending("coins")).toBe(true);
    expect("coins" in g.world.state).toBe(false); // not credited pre-restore

    // The restore lands (late).
    await flush();
    expect(g.world.state.coins).toBe(SAVED_COINS); // authoritative restore
    expect(g.world.isPersistPending("coins")).toBe(false);

    // Next frame: poll now applies the away-gain ON TOP of the restored balance.
    g.stepFrames(1);
    poll();
    expect(g.world.state.coins).toBe(SAVED_COINS + gain); // 500 + 36000, nothing lost
  });

  it("CONTRAST: applying BEFORE the restore loses the credit", async () => {
    const storage = await savedStorage();
    const g = new Game({ scenes: [scene], config: {}, canvas: null, persist, storage, registry: createLibraryRegistry() });
    // Simulate a naive setTimeout firing early — credit while the restore is still pending.
    g.stepFrames(1);
    g.world.state.coins = ((g.world.state.coins as number) ?? 0) + gain;
    // The async restore then lands and overwrites `coins` — the gain is gone.
    await flush();
    expect(g.world.state.coins).toBe(SAVED_COINS); // clobbered: gain silently lost
  });
});

// ---------------------------------------------------------------------------
// #8 — scale-by-state: ramp a live field by a world.state level counter.
//   Generalizes Helicopter `scroll-ramp` (set velocity) and Survival Arena
//   `swarm-scale` (multiply velocity + one-time hp bump).
// ---------------------------------------------------------------------------
describe("scale-by-state behavior (#8)", () => {
  it("'set' velocity ramps scroll speed from baseX/baseY by the level (Helicopter scroll-ramp)", () => {
    const world = makeWorld();
    world.state.level = 3;
    const e = makeEntity(world, { id: "scroller", x: 0, y: 0, w: 10, h: 10 });
    const params = { levelKey: "level", perLevel: 0.5, target: "velocity", mode: "set", baseX: -100, baseY: 0 };
    scaleByState(e, world, params as any, 1 / 60);
    // factor = 1 + 0.5*(3-1) = 2 ⇒ vx = -100 * 2
    expect(e.vx).toBe(-200);
    expect(e.vy).toBe(0);
    // 'set' forces base*factor each tick — it does NOT compound.
    scaleByState(e, world, params as any, 1 / 60);
    expect(e.vx).toBe(-200);
  });

  it("'multiply' rescales the live velocity another behavior set this frame (Survival speed)", () => {
    const world = makeWorld();
    world.state.level = 4; // factor = 1 + 0.25*3 = 1.75
    const e = makeEntity(world, { id: "enemy", x: 0, y: 0, w: 10, h: 10 });
    e.vx = 100; e.vy = 0; // imagine ai-chase set this just before
    scaleByState(e, world, { levelKey: "level", perLevel: 0.25, target: "velocity", mode: "multiply" } as any, 1 / 60);
    expect(e.vx).toBeCloseTo(175);
    // Level 1 ⇒ factor 1 ⇒ no-op.
    const world1 = makeWorld();
    world1.state.level = 1;
    const e1 = makeEntity(world1, { id: "e1", x: 0, y: 0, w: 10, h: 10 });
    e1.vx = 80;
    scaleByState(e1, world1, { perLevel: 0.25, target: "velocity", mode: "multiply" } as any, 1 / 60);
    expect(e1.vx).toBe(80);
  });

  it("'once' bumps a seeded state value exactly once (Survival hp)", () => {
    const world = makeWorld();
    world.state.level = 5; // factor = 1 + 0.2*4 = 1.8
    const e = makeEntity(world, { id: "enemy", x: 0, y: 0, w: 10, h: 10 });
    e.state.hp = 80; // health-and-death seeded it first
    const params = { levelKey: "level", perLevel: 0.2, target: "state:hp", mode: "once", base: 80 };
    scaleByState(e, world, params as any, 1 / 60);
    expect(e.state.hp).toBeCloseTo(144); // 80 * 1.8
    // Running again does NOT bump again (one-time guard).
    e.state.hp = 50; // simulate damage
    scaleByState(e, world, params as any, 1 / 60);
    expect(e.state.hp).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// tap-emit — clicking the entity emits its flow event
// ---------------------------------------------------------------------------
describe("tap-emit behavior", () => {
  it("emits emitOnTap when the click edge lands on this entity", () => {
    const world = makeWorld({ bounds: { width: 300, height: 200 } });
    const btn = makeEntity(world, { id: "start", x: 100, y: 80, w: 80, h: 40, tags: ["ui"] });
    let fired = 0;
    world.events.on("start-pressed", () => (fired += 1));

    // No tap → nothing.
    tapEmit(btn, world, { emitOnTap: "start-pressed" }, 1 / 60);
    expect(fired).toBe(0);

    // Inject a release edge on the button via a real attach.
    const listeners: Record<string, (e: any) => void> = {};
    world.input.attach({
      pointerTarget: {
        addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] = fn),
        removeEventListener: () => {},
      } as never,
    });
    listeners.pointerdown({ pointerId: 1, clientX: 140, clientY: 100 });
    listeners.pointerup({ pointerId: 1, clientX: 140, clientY: 100 });
    tapEmit(btn, world, { emitOnTap: "start-pressed" }, 1 / 60);
    expect(fired).toBe(1);
  });
});

/** Local mulberry32 (the helper's is not exported by name to tests that need a seed). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
