import { describe, it, expect } from "vitest";
import { Game, Input, EventBus, createDefaultRegistry, type Scene, type SystemFn } from "../src/index.js";

/**
 * Two additive SDK surfaces:
 *   • `world.events.onScene(evt, fn)` — a SCENE-SCOPED listener auto-removed on the
 *     next scene transition. Generalizes the per-part "attach once per World" WeakMap
 *     dedup; `Game.loadScene` clears them next to its flow-edge teardown.
 *   • `world.input.cursor()` — the button-less hover position in WORLD coords, the
 *     channel a desktop build-preview needs (replacing a host `pointermove` listener +
 *     manual screen→world transform). Both are inert until a game uses them; `on` and the
 *     existing pointer channels are byte-identical.
 */

// --- scene-scoped event listeners --------------------------------------------

describe("onScene / clearSceneListeners", () => {
  it("onScene fires like on, but clearSceneListeners removes ONLY the scene-scoped one", () => {
    const bus = new EventBus();
    let sceneHits = 0;
    let lifeHits = 0;
    bus.onScene("evt", () => sceneHits++);
    bus.on("evt", () => lifeHits++);
    bus.emit("evt");
    expect([sceneHits, lifeHits]).toEqual([1, 1]);

    bus.clearSceneListeners();
    bus.emit("evt");
    expect([sceneHits, lifeHits]).toEqual([1, 2]); // scene listener gone; the on() listener stays
  });

  it("clearSceneListeners leaves the event QUEUE untouched (that's clear()'s job)", () => {
    const bus = new EventBus();
    bus.emit("a", 1);
    bus.clearSceneListeners();
    expect(bus.drain().map((e) => e.type)).toEqual(["a"]); // queue intact
  });

  it("the onScene unsubscribe works manually and a later clearSceneListeners is a safe no-op", () => {
    const bus = new EventBus();
    let hits = 0;
    const off = bus.onScene("evt", () => hits++);
    off(); // manual early removal
    bus.emit("evt");
    expect(hits).toBe(0);
    expect(() => bus.clearSceneListeners()).not.toThrow(); // double-remove of an already-gone listener
  });
});

describe("a Play-again scene round-trip does not double-fire", () => {
  it("a system re-attaching its listener on scene re-entry fires it exactly once per event", () => {
    let fireCount = 0;
    // The canonical adoption shape: attach via onScene ONCE per scene entry, guarded by a
    // scene-scoped world.state flag (wiped on transition). No per-World WeakMap dedup.
    const counter: SystemFn = (world) => {
      const s = (world.state.__counter ??= { attached: false }) as { attached: boolean };
      if (!s.attached) {
        s.attached = true;
        world.events.onScene("ping", () => fireCount++);
      }
    };
    const registry = createDefaultRegistry();
    registry.registerSystem("counter", counter);

    const play = {
      id: "play",
      size: { width: 200, height: 200 },
      entities: [],
      systems: [{ type: "counter", params: {} }],
      flow: { on: { "to-menu": "menu" } },
    } as unknown as Scene;
    const menu = {
      id: "menu",
      size: { width: 200, height: 200 },
      entities: [],
      systems: [],
      flow: { on: { "to-play": "play" } },
    } as unknown as Scene;
    const game = new Game({ scenes: [play, menu], config: {}, registry, canvas: null });

    game.stepFrames(1); // counter attaches its listener in the first play visit
    game.world.events.emit("ping");
    expect(fireCount).toBe(1);

    // Play → menu → play. loadScene clears the scene-scoped listener leaving play, so the
    // second visit starts from a clean bus and re-attaches exactly one listener.
    game.world.events.emit("to-menu");
    game.stepFrames(1);
    expect(game.scene.id).toBe("menu");
    game.world.events.emit("to-play");
    game.stepFrames(1);
    expect(game.scene.id).toBe("play");
    game.stepFrames(1); // counter re-attaches in the second play visit (guard flag was wiped)

    game.world.events.emit("ping");
    // One fresh listener → +1. If clearSceneListeners were broken, the first visit's
    // listener would survive and this emit would fire BOTH (fireCount === 3).
    expect(fireCount).toBe(2);
  });
});

// --- button-less cursor channel ----------------------------------------------

/** Attach a fresh Input to fake pointer/key targets; optional rect ⇒ a screen→world scale. */
function makeCursorInput(rect?: { left: number; top: number; width: number; height: number }) {
  const keyL: Record<string, (e: any) => void> = {};
  const ptrL: Record<string, (e: any) => void> = {};
  const input = new Input();
  input.setWorldSize(800, 600);
  const pointerTarget: any = {
    addEventListener: (t: string, f: (e: any) => void) => (ptrL[t] = f),
    removeEventListener: () => {},
  };
  if (rect) pointerTarget.getBoundingClientRect = () => rect; // absent ⇒ Input maps 1:1
  input.attach({
    keyTarget: { addEventListener: (t: string, f: (e: any) => void) => (keyL[t] = f), removeEventListener: () => {} } as never,
    pointerTarget,
  });
  return {
    input,
    move: (x: number, y: number, id = 1) => ptrL.pointermove({ pointerId: id, clientX: x, clientY: y }),
    down: (x: number, y: number, id = 1) => ptrL.pointerdown({ pointerId: id, clientX: x, clientY: y }),
    up: (x: number, y: number, id = 1) => ptrL.pointerup({ pointerId: id, clientX: x, clientY: y }),
    leave: () => ptrL.pointerleave({}),
    blur: () => keyL.blur({}),
  };
}

describe("input.cursor()", () => {
  it("is null until the first pointer event, then tracks a bare (button-less) hover move", () => {
    const { input, move } = makeCursorInput();
    expect(input.cursor()).toBeNull();
    move(120, 80); // a hover with NO button down — the case the old held-pointer set ignored
    expect(input.cursor()).toEqual({ x: 120, y: 80 });
  });

  it("maps client coords into WORLD space (reuses the pointer transform)", () => {
    // Canvas displayed at half the world size ⇒ display (100,50) is world (200,100).
    const { input, move } = makeCursorInput({ left: 0, top: 0, width: 400, height: 300 });
    move(100, 50); // sx = 800/400 = 2, sy = 600/300 = 2
    expect(input.cursor()).toEqual({ x: 200, y: 100 });
  });

  it("a drag (button held) keeps the cursor fresh; pointerleave clears it", () => {
    const { input, down, move, up, leave } = makeCursorInput();
    down(10, 10);
    expect(input.cursor()).toEqual({ x: 10, y: 10 });
    move(40, 40); // dragging
    expect(input.cursor()).toEqual({ x: 40, y: 40 });
    up(40, 40);
    expect(input.cursor()).toEqual({ x: 40, y: 40 }); // release leaves the cursor at the last spot
    leave(); // cursor left the canvas (or a touch ended) → no hover
    expect(input.cursor()).toBeNull();
  });

  it("focus loss and detach both drop the cursor", () => {
    const { input, move, blur } = makeCursorInput();
    move(5, 5);
    expect(input.cursor()).not.toBeNull();
    blur();
    expect(input.cursor()).toBeNull();
    move(7, 7); // recovers after focus returns
    expect(input.cursor()).toEqual({ x: 7, y: 7 });
    input.detach();
    expect(input.cursor()).toBeNull();
  });
});
