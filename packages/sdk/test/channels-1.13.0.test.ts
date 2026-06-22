import { describe, it, expect } from "vitest";
import {
  World,
  createDefaultRegistry,
  defineChannel,
  GAME_OVER,
  PAUSE_CHANGED,
  LEVELS_COMPLETE,
  PERSIST_RESTORED,
  SCORE,
  ENGINE_CHANNEL_NAMES,
  winCondition,
  type Scene,
} from "../src/index.js";
import { checkFlowEvents } from "../src/validate/rules.js";

/**
 * 1.13.0 — typed event channels (the additive {@link defineChannel} facade over the string-keyed
 * EventBus) + the `flow-event-never-emitted` validator advisory. These pin: (1) a channel forwards
 * to `world.events` verbatim and INTEROPERATES with raw string emit/on in both directions (the open
 * namespace is preserved); (2) the engine channels carry their canonical names; (3) the previously
 * 4-shape `gameover` now has ONE payload type, and the SDK `win-condition` emits it; (4) the flow
 * advisory FIRES on a typo'd/never-emitted flow key yet stays warning-only and lenient (engine names,
 * authored emit-param values, and caller-scanned literals all satisfy a key).
 */

function makeWorld(): World {
  return new World({ bounds: { width: 100, height: 100 }, config: {}, registry: createDefaultRegistry() });
}

describe("defineChannel — typed facade over the EventBus", () => {
  it("forwards emit→listener with the payload, and interoperates with RAW string emit/on both ways", () => {
    const world = makeWorld();
    const CH = defineChannel<{ n: number }>("test-ch");

    let typed: { n: number } | undefined;
    const off = CH.on(world, (p) => (typed = p));

    CH.emit(world, { n: 42 });
    expect(typed).toEqual({ n: 42 });

    // open namespace: a RAW emit on the same wire name reaches the typed listener…
    world.events.emit("test-ch", { n: 7 });
    expect(typed).toEqual({ n: 7 });

    // …and a typed emit reaches a RAW listener.
    let raw: unknown;
    world.events.on("test-ch", (d) => (raw = d));
    CH.emit(world, { n: 9 });
    expect(raw).toEqual({ n: 9 });
    expect(typed).toEqual({ n: 9 });

    // unsubscribe stops the typed listener.
    off();
    CH.emit(world, { n: 100 });
    expect(typed).toEqual({ n: 9 }); // unchanged after off()
  });

  it("onScene subscriptions are torn down by clearSceneListeners (scene-scoped)", () => {
    const world = makeWorld();
    const CH = defineChannel<void>("ping");
    let count = 0;
    CH.onScene(world, () => count++);

    CH.emit(world, undefined);
    expect(count).toBe(1);

    world.events.clearSceneListeners(); // what Game.loadScene runs on a transition
    CH.emit(world, undefined);
    expect(count).toBe(1); // not fired after scene teardown
  });

  it("engine channels carry their canonical wire names + ENGINE_CHANNEL_NAMES lists them", () => {
    expect(GAME_OVER.name).toBe("gameover");
    expect(PAUSE_CHANGED.name).toBe("pause-changed");
    expect(LEVELS_COMPLETE.name).toBe("levels-complete");
    expect(PERSIST_RESTORED.name).toBe("persist-restored");
    expect(SCORE.name).toBe("score");
    expect([...ENGINE_CHANNEL_NAMES].sort()).toEqual(
      ["gameover", "levels-complete", "pause-changed", "persist-restored", "score"].sort(),
    );
  });
});

describe("canonical gameover payload", () => {
  it("win-condition emits the canonical { outcome:'win', winner } shape", () => {
    const world = makeWorld();
    let payload: { outcome: string; winner?: string } | undefined;
    GAME_OVER.on(world, (p) => (payload = p));

    world.state.score = 10;
    // The system fires gameover when world.state.score reaches the threshold.
    winCondition(world, { conditions: [{ key: "score", gte: 10, winner: "p1" }] }, 1 / 60);

    expect(payload).toEqual({ outcome: "win", winner: "p1" });
  });
});

/** A minimal scene the loose `checkFlowEvents` walk accepts (cast past the full Scene shape). */
function scene(id: string, on: Record<string, string>, entities: unknown[] = []): Scene {
  return { id, size: { width: 1, height: 1 }, entities, systems: [], flow: { on } } as unknown as Scene;
}

describe("checkFlowEvents — flow-event-never-emitted advisory", () => {
  it("FIRES on a typo'd / never-emitted flow key (the silent dead-edge it exists to catch)", () => {
    const scenes = [scene("title", { gamover: "over" }), scene("over", {})];
    const issues = checkFlowEvents(scenes);
    expect(issues.some((i) => i.code === "flow-event-never-emitted" && i.where === "title.flow.on.gamover")).toBe(true);
  });

  it("is WARNING-only — never an error (an open, game-authored namespace must not be rejected)", () => {
    const issues = checkFlowEvents([scene("title", { gamover: "over" }), scene("over", {})]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.level === "warning")).toBe(true);
  });

  it("an ENGINE channel name (gameover) satisfies a flow key", () => {
    expect(checkFlowEvents([scene("a", { gameover: "b" }), scene("b", {})])).toHaveLength(0);
  });

  it("an authored emit-PARAM value (emitOnTap:'start-pressed') satisfies a flow key", () => {
    const title = scene("title", { "start-pressed": "play" }, [
      { id: "btn", behaviors: [{ type: "tap-emit", params: { emitOnTap: "start-pressed" } }] },
    ]);
    expect(checkFlowEvents([title, scene("play", {})])).toHaveLength(0);
  });

  it("a caller-scanned literal (extraEmitted, e.g. a game-src emit) satisfies a flow key", () => {
    expect(checkFlowEvents([scene("a", { "custom-signal": "b" }), scene("b", {})], ["custom-signal"])).toHaveLength(0);
  });
});
