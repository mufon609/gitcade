import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * The headless smoke test every game ships: boot from the JSON definitions and
 * run 60 simulated fixed frames with no canvas and no errors. This is what
 * `gitcade validate` runs (or defers to) as the publishability gate.
 */
describe("game scaffold smoke", () => {
  it("boots and runs 60 frames headless without throwing", () => {
    const game = createGame({ manifest, config, scenes: [main] }, { canvas: null });
    expect(() => game.stepFrames(60)).not.toThrow();
    expect(game.world.frame).toBe(60);
  });
});
