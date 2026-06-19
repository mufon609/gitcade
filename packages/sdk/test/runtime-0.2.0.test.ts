import { describe, it, expect } from "vitest";
import { Game, World, Entity, Input, createDefaultRegistry, type Scene, type Config } from "../src/index.js";

function makeWorld(config: Config = {}): World {
  return new World({ bounds: { width: 800, height: 600 }, config, registry: createDefaultRegistry() });
}

// ---------------------------------------------------------------------------
// pointer click edge + entity pick
// ---------------------------------------------------------------------------
describe("Input click edge buffers", () => {
  it("records a press/release edge and clears it on endFrame (one-tick window)", () => {
    const input = new Input();
    input.setWorldSize(300, 240);
    // Drive a real attach against a fake pointer target (no getBoundingClientRect ⇒ 1:1).
    const listeners: Record<string, (e: any) => void> = {};
    const target = {
      addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] = fn),
      removeEventListener: () => {},
    };
    input.attach({ pointerTarget: target as never });

    listeners.pointerdown({ pointerId: 1, clientX: 150, clientY: 120 });
    expect(input.justPressed()).toEqual([{ id: 1, x: 150, y: 120 }]);
    expect(input.clicked()).toBe(true);

    listeners.pointerup({ pointerId: 1, clientX: 150, clientY: 120 });
    expect(input.justReleased()).toEqual([{ id: 1, x: 150, y: 120 }]);

    // endFrame clears both buffers — the edge lives exactly one tick.
    input.endFrame();
    expect(input.justPressed()).toEqual([]);
    expect(input.justReleased()).toEqual([]);
    expect(input.clicked()).toBe(false);
  });

  it("does not affect the held-pointer contract (still deleted on up)", () => {
    const input = new Input();
    const listeners: Record<string, (e: any) => void> = {};
    input.attach({
      pointerTarget: {
        addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] = fn),
        removeEventListener: () => {},
      } as never,
    });
    listeners.pointerdown({ pointerId: 1, clientX: 10, clientY: 10 });
    expect(input.activePointers()).toHaveLength(1);
    listeners.pointerup({ pointerId: 1, clientX: 10, clientY: 10 });
    expect(input.activePointers()).toHaveLength(0);
  });

  it("captures the pointer on down so a drag releasing off-canvas still delivers up", () => {
    const input = new Input();
    const listeners: Record<string, (e: any) => void> = {};
    const captured: number[] = [];
    input.attach({
      pointerTarget: {
        addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] = fn),
        removeEventListener: () => {},
        setPointerCapture: (id: number) => captured.push(id),
      } as never,
    });
    listeners.pointerdown({ pointerId: 7, clientX: 10, clientY: 10 });
    // Capture requested → the canvas keeps receiving this pointer's events even
    // off-element, so the eventual pointerup clears the held pointer (no stuck drag).
    expect(captured).toEqual([7]);
    listeners.pointerup({ pointerId: 7, clientX: 9999, clientY: 9999 }); // released far off-canvas
    expect(input.activePointers()).toHaveLength(0);
  });
});

describe("keydown preventDefault — page-scroll suppression", () => {
  function attachKeys(): { listeners: Record<string, (e: any) => void>; input: Input } {
    const input = new Input();
    const listeners: Record<string, (e: any) => void> = {};
    input.attach({
      keyTarget: {
        addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] = fn),
        removeEventListener: () => {},
      } as never,
    });
    return { listeners, input };
  }

  function fakeKey(code: string, extra: Partial<Record<string, unknown>> = {}) {
    let prevented = false;
    return {
      code,
      cancelable: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...extra,
      preventDefault: () => {
        prevented = true;
      },
      get prevented() {
        return prevented;
      },
    };
  }

  it("prevents the browser default for scroll-causing game keys, and still tracks them as down", () => {
    const { listeners, input } = attachKeys();
    for (const code of ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]) {
      const ev = fakeKey(code);
      listeners.keydown(ev);
      expect(ev.prevented, `${code} should preventDefault`).toBe(true);
      expect(input.isDown(code)).toBe(true);
    }
  });

  it("leaves non-scroll keys (and their default action) alone, but still tracks them", () => {
    const { listeners, input } = attachKeys();
    const ev = fakeKey("KeyW");
    listeners.keydown(ev);
    expect(ev.prevented).toBe(false);
    expect(input.isDown("KeyW")).toBe(true);
  });

  it("never swallows modified key combos (browser/OS shortcuts pass through)", () => {
    const { listeners } = attachKeys();
    for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
      const ev = fakeKey("Space", { [mod]: true });
      listeners.keydown(ev);
      expect(ev.prevented, `Space+${mod} must not be prevented`).toBe(false);
    }
  });

  it("respects non-cancelable events", () => {
    const { listeners } = attachKeys();
    const ev = fakeKey("Space", { cancelable: false });
    listeners.keydown(ev);
    expect(ev.prevented).toBe(false);
  });

  it("clears all held keys on blur (no stuck keys when focus leaves the game)", () => {
    const { listeners, input } = attachKeys();
    listeners.keydown(fakeKey("Space"));
    listeners.keydown(fakeKey("ArrowLeft"));
    expect(input.isDown("Space")).toBe(true);
    expect(input.isDown("ArrowLeft")).toBe(true);
    // Focus leaves (Alt-Tab / click outside the iframe): the matching keyups never
    // arrive, so the blur handler must drop the held set or the keys stick forever.
    listeners.blur({});
    expect(input.isDown("Space")).toBe(false);
    expect(input.isDown("ArrowLeft")).toBe(false);
  });
});

describe("World.entityAt / pick", () => {
  it("returns the topmost entity (by layer then zIndex) under a point, honoring a tag filter", () => {
    const world = makeWorld();
    const lo = new Entity({ id: "lo", x: 100, y: 100, w: 50, h: 50, layer: 0, tags: ["pickable"], sprite: { kind: "none" } });
    const hi = new Entity({ id: "hi", x: 120, y: 120, w: 50, h: 50, layer: 5, tags: ["pickable"], sprite: { kind: "none" } });
    const other = new Entity({ id: "ot", x: 120, y: 120, w: 50, h: 50, layer: 9, tags: ["ui"], sprite: { kind: "none" } });
    world.add(lo);
    world.add(hi);
    world.add(other);
    // Overlap region (130,130): topmost overall is "ot" (layer 9)...
    expect(world.entityAt(130, 130)?.id).toBe("ot");
    // ...but with a tag filter only "pickable" qualify → "hi" (layer 5 > 0).
    expect(world.entityAt(130, 130, "pickable")?.id).toBe("hi");
    expect(world.pick(130, 130, "pickable")?.id).toBe("hi");
    // Outside any box.
    expect(world.entityAt(0, 0)).toBeUndefined();
    // Dead entities are skipped.
    hi.alive = false;
    expect(world.entityAt(130, 130, "pickable")?.id).toBe("lo");
  });
});

// ---------------------------------------------------------------------------
// runtime tilemap query
// ---------------------------------------------------------------------------
describe("tilemap query", () => {
  const tileScene: Scene = {
    id: "main",
    size: { width: 200, height: 150 },
    tilemap: {
      tileSize: 50,
      cols: 4,
      rows: 3,
      tiles: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
      properties: { "0": { buildable: true }, "1": { lane: true, walkable: true, buildable: false } },
    },
    entities: [],
    systems: [],
  } as unknown as Scene;

  it("stores the tilemap on the world and answers tileAt/isBuildable/cellRect", () => {
    const game = new Game({ scenes: [tileScene], config: {}, canvas: null });
    const w = game.world;
    expect(w.tilemap).toBeDefined();
    expect(w.tileAt(75, 75)).toBe(1); // middle row = road
    expect(w.isBuildable(75, 75)).toBe(false); // road not buildable (fixes towers-on-road)
    expect(w.isBuildable(25, 25)).toBe(true); // top row buildable
    expect(w.tileAt(-1, 0)).toBe(-1); // out of bounds
    expect(w.isBuildable(-1, 0)).toBe(false);
    expect(w.cellRect(1, 1)).toEqual({ x: 50, y: 50, w: 50, h: 50 });
  });

  it("is permissive with no tilemap (additivity)", () => {
    const w = makeWorld();
    expect(w.tilemap).toBeUndefined();
    expect(w.tileAt(10, 10)).toBe(-1);
    expect(w.isBuildable(10, 10)).toBe(true); // undecorated scenes stay permissive
  });
});

// ---------------------------------------------------------------------------
// economy assist on World
// ---------------------------------------------------------------------------
describe("world.canAfford / spend", () => {
  it("checks and deducts a numeric balance, no-op when unaffordable", () => {
    const w = makeWorld();
    w.state.gold = 50;
    expect(w.canAfford("gold", 30)).toBe(true);
    expect(w.spend("gold", 30)).toBe(true);
    expect(w.state.gold).toBe(20);
    expect(w.spend("gold", 999)).toBe(false);
    expect(w.state.gold).toBe(20); // unchanged
    expect(w.canAfford("gold", 999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// data-driven scene flow + state hand-off
// ---------------------------------------------------------------------------
describe("scene flow + persist hand-off", () => {
  const flowScenes: Scene[] = [
    {
      id: "one",
      size: { width: 300, height: 200 },
      entities: [],
      systems: [],
      flow: { on: { "go-two": "two" }, persist: ["gold"] },
    },
    { id: "two", size: { width: 300, height: 200 }, entities: [], systems: [] },
  ] as unknown as Scene[];

  it("requestScene is queued and drained AFTER the tick, preserving persist + keep keys", () => {
    const game = new Game({ scenes: flowScenes, config: {}, canvas: null });
    game.world.state.gold = 100;
    game.world.state.dropme = 7;
    game.world.requestScene("two", { keep: ["dropme"] });
    expect(game.scene.id).toBe("one"); // not switched mid-call (queued)
    game.update(1 / 60); // drains at tick end
    expect(game.scene.id).toBe("two");
    expect(game.world.state.gold).toBe(100); // flow.persist
    expect(game.world.state.dropme).toBe(7); // per-hop keep
  });

  it("a flow.on event edge transitions with no host JS", () => {
    const game = new Game({ scenes: flowScenes, config: {}, canvas: null });
    game.world.state.gold = 42;
    game.world.events.emit("go-two");
    game.update(1 / 60);
    expect(game.scene.id).toBe("two");
    expect(game.world.state.gold).toBe(42);
  });

  it("re-entering a scene does not accumulate duplicate flow listeners", () => {
    const scenes: Scene[] = [
      { id: "a", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { next: "b" }, persist: [] } },
      { id: "b", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { next: "a" }, persist: [] } },
    ] as unknown as Scene[];
    const game = new Game({ scenes, config: {}, canvas: null });
    // a→b→a→b, three transitions; the bus must not fan one emit into many requests.
    game.world.events.emit("next");
    game.update(1 / 60);
    expect(game.scene.id).toBe("b");
    game.world.events.emit("next");
    game.update(1 / 60);
    expect(game.scene.id).toBe("a");
    game.world.events.emit("next");
    game.update(1 / 60);
    expect(game.scene.id).toBe("b"); // still deterministic — no double-fire skipping a scene
  });
});

// ---------------------------------------------------------------------------
// Additivity — a 0.1.x scene (no flow) keeps the full-wipe loadScene behavior
// ---------------------------------------------------------------------------
describe("Additivity — loadScene full-wipe unchanged without flow", () => {
  it("wipes all world.state on a host loadScene when the leaving scene declares no persist", () => {
    const scenes: Scene[] = [
      { id: "one", size: { width: 100, height: 100 }, entities: [], systems: [] },
      { id: "two", size: { width: 100, height: 100 }, entities: [], systems: [] },
    ] as unknown as Scene[];
    const game = new Game({ scenes, config: {}, canvas: null });
    game.world.state.score = 99;
    game.loadScene("two"); // host call, no keepExtra
    expect(game.scene.id).toBe("two");
    expect("score" in game.world.state).toBe(false); // byte-identical 0.1.x full wipe
  });
});
