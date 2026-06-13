import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry, LibraryAudioPlayer } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import main from "../src/scenes/main.json";

/**
 * Phase 2B re-skin proof. Same four logic parts as the 2A arena demo (ai-chase +
 * contact-damage + wave-spawner + health-and-death) now wearing the presentational
 * half: generated sprites on the entities, the synthesized LibraryAudioPlayer, and
 * the fx 'explosion'/'sparkle' particle SYSTEMS wired to the death/collect events.
 * Asset rendering and music are browser-only (and no-op headless), so this asserts
 * the LOGIC + the fx integration deterministically.
 */
function boot(audio?: LibraryAudioPlayer) {
  return createGame(
    { manifest, config, scenes: [main] },
    { canvas: null, registry: createLibraryRegistry(), audio },
  );
}
const flush = () => Promise.resolve().then(() => Promise.resolve());

describe("arena re-skin proof", () => {
  it("boots and runs 120 frames headless with the synthesized audio player (no throw)", () => {
    const game = boot(new LibraryAudioPlayer());
    expect(() => game.stepFrames(120)).not.toThrow();
    expect(game.world.frame).toBe(120);
  });

  it("escalates through multiple waves of generated chaser mobs", () => {
    const game = boot();
    game.stepFrames(240);
    expect((game.world.state.wave as number) ?? 0).toBeGreaterThanOrEqual(2);
    expect(game.world.query("enemy").length).toBeGreaterThan(0);
  });

  it("emits explosion particles when a mob dies (fx system wired to enemy-died)", () => {
    const game = boot();
    // Step until the first kill, then confirm particles spawned that same window.
    let i = 0;
    while (((game.world.state.kills as number) ?? 0) < 1 && i < 600) {
      game.stepFrames(1);
      i++;
    }
    expect((game.world.state.kills as number) ?? 0).toBeGreaterThanOrEqual(1);
    const particles = game.world.query("particle").length;
    expect(particles).toBeGreaterThan(0);
  });

  it("clears the swarm via thorns and persists the high score through the storage bridge (win)", async () => {
    const game = boot();
    let i = 0;
    while (!game.world.state.gameOver && i < 12000) {
      game.stepFrames(1);
      i++;
    }
    expect(game.world.state.gameOver).toBe(true);
    expect(game.world.state.outcome).toBe("win");
    expect(game.world.state.kills as number).toBeGreaterThanOrEqual(18);
    expect(game.world.state.best as number).toBeGreaterThanOrEqual(18);
    await flush();
    expect(await game.world.storage.get<number>("reskin.best")).toBeGreaterThanOrEqual(18);
  });
});
