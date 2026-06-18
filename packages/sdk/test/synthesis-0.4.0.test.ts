import { describe, it, expect } from "vitest";
import { Game, Input, type Scene } from "../src/index.js";

function makeScene(id: string): Scene {
  return { id, size: { width: 200, height: 200 }, entities: [], systems: [] } as unknown as Scene;
}

/**
 * E1 (0.4.0) — the logical input ACTION layer. A mover reads `action(name)` /
 * `actionVector(name)`; the binding decides whether keyboard, an on-screen rect,
 * or a virtual d-pad zone satisfies it — so touch feeds a keyboard-authored mover
 * WITHOUT the game synthesizing fake `KeyboardEvent`s (the bandaid this retires).
 */

/** Attach a fresh Input to fake key + pointer targets (no getBoundingClientRect ⇒ world coords are 1:1). */
function makeInput() {
  const keyL: Record<string, (e: any) => void> = {};
  const ptrL: Record<string, (e: any) => void> = {};
  const input = new Input();
  input.setWorldSize(800, 600);
  input.attach({
    keyTarget: { addEventListener: (t: string, f: (e: any) => void) => (keyL[t] = f), removeEventListener: () => {} } as never,
    pointerTarget: { addEventListener: (t: string, f: (e: any) => void) => (ptrL[t] = f), removeEventListener: () => {} } as never,
  });
  return {
    input,
    keydown: (code: string) => keyL.keydown({ code, cancelable: true, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} }),
    keyup: (code: string) => keyL.keyup({ code }),
    pdown: (id: number, x: number, y: number) => ptrL.pointerdown({ pointerId: id, clientX: x, clientY: y }),
    pup: (id: number, x: number, y: number) => ptrL.pointerup({ pointerId: id, clientX: x, clientY: y }),
    blur: () => keyL.blur(),
  };
}

describe("E1 input action layer (0.4.0)", () => {
  it("keyboard axisKeys → unit actionVector; opposed keys cancel", () => {
    const { input, keydown, keyup } = makeInput();
    input.defineActions({
      move: { axisKeys: { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] } },
    });
    expect(input.actionVector("move")).toEqual({ x: 0, y: 0 });
    expect(input.action("move")).toBe(false);

    keydown("ArrowRight");
    expect(input.actionVector("move")).toEqual({ x: 1, y: 0 });
    expect(input.action("move")).toBe(true);

    keydown("ArrowUp");
    expect(input.actionVector("move")).toEqual({ x: 1, y: -1 });

    keydown("ArrowLeft"); // left + right opposed → x cancels to 0
    expect(input.actionVector("move")).toEqual({ x: 0, y: -1 });

    keyup("ArrowUp");
    keyup("ArrowLeft");
    keyup("ArrowRight");
    expect(input.action("move")).toBe(false);
  });

  it("keys → action() button source", () => {
    const { input, keydown, keyup } = makeInput();
    input.defineActions({ thrust: { keys: ["Space", "ArrowUp"] } });
    expect(input.action("thrust")).toBe(false);
    keydown("Space");
    expect(input.action("thrust")).toBe(true);
    keyup("Space");
    expect(input.action("thrust")).toBe(false);
  });

  it("rect → action() while a DOWN pointer is inside (hold-anywhere zone)", () => {
    const { input, pdown, pup } = makeInput();
    input.defineActions({ thrust: { rect: { x: 0, y: 0, w: 800, h: 600 } }, btn: { rect: { x: 0, y: 0, w: 100, h: 100 } } });
    expect(input.action("thrust")).toBe(false);

    pdown(1, 400, 300); // anywhere on the field
    expect(input.action("thrust")).toBe(true);
    expect(input.action("btn")).toBe(false); // (400,300) is outside the small rect
    pup(1, 400, 300);
    expect(input.action("thrust")).toBe(false);

    pdown(2, 50, 50); // inside the small rect
    expect(input.action("btn")).toBe(true);
    pup(2, 50, 50);
  });

  it("zone → analog actionVector from center, with a deadzone at center", () => {
    const { input, pdown, pup } = makeInput();
    input.defineActions({ move: { zone: { x: 100, y: 500, radius: 60 } } });

    pdown(1, 100, 440); // 60px straight above center → full up vector
    const v = input.actionVector("move");
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(-1);
    expect(input.action("move")).toBe(true);
    pup(1, 100, 440);

    pdown(2, 100, 500); // dead center → inside deadzone → no deflection
    expect(input.actionVector("move")).toEqual({ x: 0, y: 0 });
    expect(input.action("move")).toBe(false);
    pup(2, 100, 500);
  });

  it("host overrides: setAction / setActionVector / clearAction", () => {
    const { input } = makeInput();
    input.setAction("fire", true);
    expect(input.action("fire")).toBe(true);
    input.setAction("fire", false);
    expect(input.action("fire")).toBe(false);

    input.setActionVector("move", 0.5, -0.5);
    expect(input.actionVector("move")).toEqual({ x: 0.5, y: -0.5 });
    expect(input.action("move")).toBe(true);
    input.clearAction("move");
    expect(input.actionVector("move")).toEqual({ x: 0, y: 0 });
  });

  it("a host override wins over the binding, and a held override releases on focus loss", () => {
    const { input, blur } = makeInput();
    input.defineActions({ thrust: { keys: ["Space"] } });
    input.setAction("thrust", true); // a DOM button reporting "held", no key down
    expect(input.action("thrust")).toBe(true);
    blur();
    expect(input.action("thrust")).toBe(false); // override cleared like a held key
  });

  it("resetActions() clears bindings AND overrides (scene-scoped)", () => {
    const { input, keydown } = makeInput();
    input.defineActions({ thrust: { keys: ["Space"] } });
    input.setAction("jump", true);
    keydown("Space");
    expect(input.action("thrust")).toBe(true);

    input.resetActions();
    expect(input.action("thrust")).toBe(false); // binding gone (Space is still held, but unbound)
    expect(input.action("jump")).toBe(false); // override gone
  });

  it("is inert for a game that defines no actions (backward compatible)", () => {
    const { input, keydown } = makeInput();
    keydown("Space");
    expect(input.action("anything")).toBe(false);
    expect(input.actionVector("anything")).toEqual({ x: 0, y: 0 });
  });
});

/**
 * E4 (0.4.0) — the data-ish pause primitive: `togglePause()` flips the sim freeze and
 * emits `pause-changed` so the host reacts (overlay/audio) without owning the logic; a
 * `pauseScenes` guard blocks pausing menus but never strands a pause. (The `pauseKeys`
 * rAF-loop handler that calls togglePause is browser-only and not exercised headless.)
 */
describe("E4 pause primitive (0.4.0)", () => {
  it("togglePause flips the freeze and emits pause-changed with the new state", () => {
    const game = new Game({ scenes: [makeScene("play")], config: {}, canvas: null });
    const events: boolean[] = [];
    game.world.events.on("pause-changed", (d) => events.push((d as { paused: boolean }).paused));
    expect(game.isPaused()).toBe(false);
    game.togglePause();
    expect(game.isPaused()).toBe(true);
    game.togglePause();
    expect(game.isPaused()).toBe(false);
    expect(events).toEqual([true, false]); // one event per toggle, carrying the new state
  });

  it("pauseScenes blocks pausing a disallowed scene; toggling works on an allowed one", () => {
    const game = new Game({
      scenes: [makeScene("title"), makeScene("play")],
      config: {},
      entrySceneId: "title",
      pauseScenes: ["play"],
      canvas: null,
    });
    const events: boolean[] = [];
    game.world.events.on("pause-changed", (d) => events.push((d as { paused: boolean }).paused));

    game.togglePause(); // on "title" — not a pause scene → no-op, no event
    expect(game.isPaused()).toBe(false);
    expect(events).toEqual([]);

    game.world.requestScene("play");
    game.stepFrames(1); // drain the transition
    expect(game.scene.id).toBe("play");

    game.togglePause(); // allowed scene → pauses
    expect(game.isPaused()).toBe(true);
    game.togglePause(); // unpauses
    expect(game.isPaused()).toBe(false);
    expect(events).toEqual([true, false]);
  });
});
