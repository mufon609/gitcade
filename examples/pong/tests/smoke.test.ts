import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Pong's headless smoke test: boot from JSON, run 60 fixed frames with no canvas,
 * assert it neither throws nor corrupts state. This is the publish gate the
 * validator runs (or defers to).
 */
describe("pong smoke", () => {
  it("boots and runs 60 frames headless without throwing", () => {
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null });
    expect(() => game.stepFrames(60)).not.toThrow();
    expect(game.world.frame).toBe(60);
  });

  it("keeps the ball on the field over a long run (scoring resets it)", () => {
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null });
    game.stepFrames(2000);
    const ball = game.world.byId("ball");
    expect(ball).toBeDefined();
    // After any number of points, the ball is always re-served inside the field.
    expect(ball!.x).toBeGreaterThan(-100);
    expect(ball!.x).toBeLessThan(900);
  });

  it("accumulates a score for at least one side within a long run", () => {
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null });
    game.stepFrames(3000);
    const left = (game.world.state.scoreLeft as number) ?? 0;
    const right = (game.world.state.scoreRight as number) ?? 0;
    expect(left + right).toBeGreaterThan(0);
  });
});
