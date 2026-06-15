import { describe, it, expect } from "vitest";
import { Game, type Scene } from "@gitcade/sdk";
import { createLibraryRegistry } from "../src/registry.js";
import { randomFreeCell, snapToGrid } from "../src/util.js";
import { transaction, persistence } from "../src/systems/index.js";
import { tapEmit } from "../src/ui/index.js";
import { makeWorld, makeEntity } from "./helpers.js";

// ---------------------------------------------------------------------------
// G5 — transaction system (afford → deduct → emit)
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
// G4 — free-cell placement helpers (deterministic via world.rng)
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

  it("returns null when every cell is occupied", () => {
    const world = makeWorld({ bounds: { width: 40, height: 40 }, seed: 1 }); // 2x2 grid @ ts20
    for (const [i, c] of [[10, 10], [30, 10], [10, 30], [30, 30]].entries()) {
      makeEntity(world, { id: `o${i}`, x: c[0] - 6, y: c[1] - 6, w: 12, h: 12, tags: ["body"] });
    }
    expect(randomFreeCell(world, { tileSize: 20, occupiedTag: "body" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// G4 — wave-spawner placement:"free-cell" scatters across distinct cells
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
// G6 — persistence round-trip through the storage bridge
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
// tap-emit — clicking the entity emits its flow event (G1 companion, OQ-7)
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
