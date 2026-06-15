import { describe, it, expect } from "vitest";
import { createGame } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import level1 from "../src/scenes/level-1.json";
import level2 from "../src/scenes/level-2.json";
import level3 from "../src/scenes/level-3.json";
import win from "../src/scenes/win.json";
import over from "../src/scenes/over.json";

/**
 * The headless smoke boot `gitcade validate` defers to. Boots the 0.2.0 six-scene
 * flow (title → level-1 → level-2 → level-3 → win / over) on the full library
 * registry with no canvas and exercises the data-driven transitions: a started run
 * launches the ball and breaks bricks; clearing a level advances to the next via
 * the `level-cleared` flow edge (carrying score/lives/level); clearing the last
 * level wins; draining lives routes to game-over — all without throwing.
 */
function boot() {
  const registry = createLibraryRegistry();
  return createGame(
    { manifest, config, scenes: [title, level1, level2, level3, win, over] },
    { canvas: null, registry },
  );
}

function start(game: ReturnType<typeof boot>) {
  game.world.events.emit("start-pressed");
  game.stepFrames(2); // queued scene change drains after the tick, then level-1 inits
}

/** Destroy every brick and let level-progression + the flow edge react. */
function clearLevel(game: ReturnType<typeof boot>) {
  for (const b of game.world.query("breakable")) game.world.destroy(b);
  game.stepFrames(3);
}

describe("breakout smoke (0.2.0 data flow + levels)", () => {
  it("boots the entry (title) scene", () => {
    const game = boot();
    expect(game.scene.id).toBe("title");
    expect(() => game.stepFrames(30)).not.toThrow();
  });

  it("title → level-1 on start-pressed, with the ball + a full brick wall", () => {
    const game = boot();
    start(game);
    expect(game.scene.id).toBe("level-1");
    expect(game.world.query("ball").length).toBe(1);
    expect(game.world.query("breakable").length).toBe(40);
    expect(game.world.state.lives).toBe(config.startLives);
  });

  it("the ball launches and breaks at least one brick within 4s", () => {
    const game = boot();
    start(game);
    const startBricks = game.world.query("breakable").length;
    game.stepFrames(240);
    expect(game.world.query("breakable").length).toBeLessThan(startBricks);
  });

  it("clearing level-1 advances to level-2 and carries the score", () => {
    const game = boot();
    start(game);
    game.world.state.score = 500;
    clearLevel(game);
    expect(game.scene.id).toBe("level-2");
    expect(game.world.state.score).toBe(500); // carried by flow.persist
    expect(game.world.query("breakable").length).toBe(30); // level-2 layout
  });

  it("clearing every level wins (level-3 → win)", () => {
    const game = boot();
    start(game);
    clearLevel(game); // → level-2
    expect(game.scene.id).toBe("level-2");
    clearLevel(game); // → level-3
    expect(game.scene.id).toBe("level-3");
    clearLevel(game); // → win
    expect(game.scene.id).toBe("win");
  });

  it("draining lives decrements then routes level-1 → over", () => {
    const game = boot();
    start(game);
    expect(game.world.state.lives).toBe(3);
    // Drop the ball into the killzone band repeatedly until lives run out. (y=600
    // is inside the killzone AABB at y=598; y past it would miss the collision.)
    let guard = 0;
    while (game.scene.id === "level-1" && guard++ < 6000) {
      const ball = game.world.query("ball")[0];
      if (ball) ball.y = 600;
      game.stepFrames(1);
    }
    expect(game.scene.id).toBe("over"); // gameover flow edge fired at 0 lives
  });
});
