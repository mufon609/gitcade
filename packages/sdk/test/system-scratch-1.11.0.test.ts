import { describe, it, expect } from "vitest";
import { Game, createDefaultRegistry, type Scene, type SystemFn } from "../src/index.js";

/**
 * 1.11.0 — per-system scratch (the {@link SystemFn} 4th arg). A system now gets a private,
 * per-instance, per-tick-persistent store handed back by the host each tick — the symmetric analogue
 * of behavior scratch — replacing the module-level `WeakMap<World, …>` an event-driven system used
 * for its once-per-scene attach guard. The system instance (and its scratch) is rebuilt on every
 * scene load, so the clean pattern is: guard a scene-scoped `world.events.onScene` subscription on
 * `scratch`. These tests pin the host wiring AND that the migrated pattern is scene-correct: attach
 * exactly once, no cross-scene listener leak, clean re-attach (no double-fire) on re-entry.
 */
function makeScenes(): Scene[] {
  return [
    { id: "a", size: { width: 100, height: 100 }, entities: [], systems: [{ type: "test-emitter", params: {} }], flow: { on: { "go-b": "b" } } },
    { id: "b", size: { width: 100, height: 100 }, entities: [], systems: [], flow: { on: { "go-a": "a" } } },
  ] as unknown as Scene[];
}

describe("per-system scratch (SystemFn 4th arg)", () => {
  it("the host hands back the same scratch each tick → an attach-once guard persists across ticks", () => {
    let attachCount = 0;
    const registry = createDefaultRegistry();
    const sys: SystemFn = (_world, _params, _dt, scratch = {}) => {
      if (scratch.attached) return;
      scratch.attached = true;
      attachCount++;
    };
    registry.registerSystem("test-emitter", sys);
    const game = new Game({ scenes: makeScenes(), config: {}, canvas: null, registry });
    game.stepFrames(10);
    expect(attachCount).toBe(1); // attached once across 10 ticks — scratch persisted, not re-created
  });

  it("scratch is fresh per scene; the onScene listener is scene-scoped (no leak, no double-fire on re-entry)", () => {
    let attachCount = 0;
    let pingCount = 0;
    const registry = createDefaultRegistry();
    const sys: SystemFn = (world, _params, _dt, scratch = {}) => {
      if (scratch.attached) return;
      scratch.attached = true;
      attachCount++;
      world.events.onScene("ping", () => {
        pingCount++;
      });
    };
    registry.registerSystem("test-emitter", sys);
    const game = new Game({ scenes: makeScenes(), config: {}, canvas: null, registry });

    // Scene A: attaches exactly once; its listener fires.
    game.stepFrames(3);
    expect(attachCount).toBe(1);
    game.world.events.emit("ping");
    expect(pingCount).toBe(1);

    // A → B (B has no test-emitter). loadScene tears down A's scene-scoped listener.
    game.world.events.emit("go-b");
    game.stepFrames(1); // drains the queued scene change at tick end
    expect(game.scene.id).toBe("b");
    game.stepFrames(2);
    expect(attachCount).toBe(1); // B never attaches

    // THE LEAK FIX: A's listener is gone, so a ping in B fires nothing. The old module-level
    // `events.on` + World-keyed attach-once guard would have LEAKED A's listener into B here.
    game.world.events.emit("ping");
    expect(pingCount).toBe(1);

    // B → A (re-entry): the rebuilt instance gets a FRESH scratch → re-attaches exactly once →
    // exactly one fire (the World-keyed guard, by contrast, was sticky and never re-attached).
    game.world.events.emit("go-a");
    game.stepFrames(1); // drain → loadScene("a")
    expect(game.scene.id).toBe("a");
    game.stepFrames(1); // A's test-emitter runs in the new instance → re-attaches
    expect(attachCount).toBe(2);
    game.world.events.emit("ping");
    expect(pingCount).toBe(2);
  });
});
