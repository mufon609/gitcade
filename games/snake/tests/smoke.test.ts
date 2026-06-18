import { describe, it, expect } from "vitest";
import { createGame, Input } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import play from "../src/scenes/play.json";
import over from "../src/scenes/over.json";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";

/**
 * The headless smoke boot `gitcade validate` defers to (Snake uses custom parts +
 * library parts the default registry can't supply). Boots the 0.2.0 three-scene
 * flow on the full library + custom registry and exercises the data-driven
 * transitions with no canvas — title → play → over → play — asserting the snake
 * food appears, a death routes to the game-over scene, score hands off, and a
 * retry returns to play, all without throwing.
 */
function boot() {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
  return createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry });
}

describe("snake smoke (0.2.0 data flow)", () => {
  it("boots the entry (title) scene and runs frames without throwing", () => {
    const game = boot();
    expect(game.scene.id).toBe("title");
    expect(() => game.stepFrames(30)).not.toThrow();
  });

  it("title → play transitions on the start-pressed flow edge and spawns food", () => {
    const game = boot();
    game.world.events.emit("start-pressed"); // what the title's tap-emit button emits
    game.stepFrames(2); // queued scene change drains after the tick, then play inits
    expect(game.scene.id).toBe("play");
    expect(game.world.query("food").length).toBe(1);
    expect(game.world.query("head").length).toBe(1);
  });

  it("a wall death routes play → over and hands off the score", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    game.world.state.score = 30; // stand in for three coins eaten
    // Drive straight right into the wall until the snake dies and flow routes over.
    const head = game.world.query("head")[0]!;
    (head.state.__gridDir as { x: number; y: number }) = { x: 1, y: 0 };
    game.stepFrames(300);
    expect(game.scene.id).toBe("over");
    expect(game.world.state.score).toBe(30); // carried by play.flow.persist
  });

  it("retry routes over → play and resets the run", () => {
    const game = boot();
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    game.world.state.score = 30;
    const head = game.world.query("head")[0]!;
    (head.state.__gridDir as { x: number; y: number }) = { x: 1, y: 0 };
    game.stepFrames(300);
    expect(game.scene.id).toBe("over");
    game.world.events.emit("retry");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    expect(game.world.query("food").length).toBe(1);
  });
});

/**
 * E1 (0.4.0) — the real play.json wiring end-to-end: the `input-actions` system
 * installs the `move` action and `move-grid-step{moveAction:"move"}` steers by it,
 * so BOTH a real keyboard event AND the touch d-pad's `setActionVector` turn the
 * head — proving the synthesized-`KeyboardEvent` bandaid is fully retired.
 */
describe("snake input action layer (E1)", () => {
  function bootPlay() {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const input = new Input();
    const keyL: Record<string, (e: any) => void> = {};
    input.attach({ keyTarget: { addEventListener: (t: string, f: any) => (keyL[t] = f), removeEventListener: () => {} } as never });
    const game = createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry, input });
    game.world.events.emit("start-pressed");
    game.stepFrames(2); // → play, with the input-actions binding installed
    expect(game.scene.id).toBe("play");
    return { game, key: (code: string) => keyL.keydown({ code, cancelable: true, preventDefault() {} }) };
  }

  it("a real ArrowUp keydown turns the head UP through the move action (no synth key)", () => {
    const { game, key } = bootPlay();
    const head = game.world.query("head")[0]!;
    const y0 = head.y;
    key("ArrowUp"); // a genuine DOM keydown into the SDK Input, read via the binding
    game.stepFrames(20); // ~3 grid steps
    expect(head.y).toBeLessThan(y0); // steered up — the action layer carried the key to the mover
  });

  it("the touch d-pad's setActionVector steers the head the same way", () => {
    const { game } = bootPlay();
    const head = game.world.query("head")[0]!;
    const y0 = head.y;
    game.world.input.setActionVector("move", 0, -1); // exactly what main.ts's d-pad pushes
    game.stepFrames(20);
    expect(head.y).toBeLessThan(y0);
  });
});

/**
 * E3 (key-emit) + E4 (engine pause) — the keyboard flow bridge and the host pause
 * state machine are gone: a real Enter on the title fires the flow as DATA, and the
 * engine owns the pause (guarded by `pauseScenes`, emitting `pause-changed`).
 */
describe("snake flow + pause (E3 key-emit / E4 pause)", () => {
  it("a real Enter on the title fires start-pressed via key-emit → play (no host bridge)", () => {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const input = new Input();
    const keyL: Record<string, (e: any) => void> = {};
    input.attach({ keyTarget: { addEventListener: (t: string, f: any) => (keyL[t] = f), removeEventListener: () => {} } as never });
    const game = createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry, input });
    expect(game.scene.id).toBe("title");
    game.stepFrames(1); // key-emit adopts the (key-up) baseline, no emit
    keyL.keydown({ code: "Enter", cancelable: true, preventDefault() {} });
    game.stepFrames(2); // fresh press → start-pressed → flow.on → play
    expect(game.scene.id).toBe("play");
  });

  it("togglePause is engine-owned: guarded off the title, works on play, emits pause-changed (E4)", () => {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    // Mirror main.ts's createGame opts: pause only on the play scene.
    const game = createGame({ manifest, config, scenes: [title, play, over] }, { canvas: null, registry, pauseScenes: ["play"] });
    expect(game.isPaused()).toBe(false);
    game.togglePause(); // on "title" — not a pause scene → no-op
    expect(game.isPaused()).toBe(false);

    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("play");
    let evt: unknown;
    game.world.events.on("pause-changed", (d) => (evt = d));
    game.togglePause(); // play → pauses
    expect(game.isPaused()).toBe(true);
    expect(evt).toEqual({ paused: true });
  });
});
