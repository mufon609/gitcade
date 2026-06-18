import { describe, it, expect } from "vitest";
import { createGame, Input } from "@gitcade/sdk";
import { createLibraryRegistry } from "@gitcade/library";
import { registerCustomBehaviors } from "../src/custom-behaviors/index.js";
import manifest from "../game.json";
import config from "../config.json";
import title from "../src/scenes/title.json";
import level1 from "../src/scenes/level-1.json";
import level2 from "../src/scenes/level-2.json";
import level3 from "../src/scenes/level-3.json";
import win from "../src/scenes/win.json";
import over from "../src/scenes/over.json";

/**
 * The headless smoke boot `gitcade validate` defers to. Boots the six-scene flow
 * (title → level-1 → level-2 → level-3 → win / over) on the full library + custom
 * registry with no canvas and exercises the data-driven transitions: a started run
 * launches the ball and breaks bricks; clearing a level advances to the next via the
 * `level-cleared` flow edge (carrying score/lives/level); clearing the last level
 * wins; draining lives routes to game-over — all without throwing.
 *
 * Breakout ships no custom behaviors, so registerCustomBehaviors is a no-op — but
 * calling it (like the other games + the scaffold) means a remix that vendors a
 * community part into a breakout fork installs the managed custom-behaviors registry,
 * and THIS smoke test then registers the vendored behavior instead of throwing
 * "unknown behavior type" during ecosystem validation.
 */
function boot() {
  const registry = createLibraryRegistry();
  registerCustomBehaviors(registry);
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

describe("breakout smoke (data flow + levels)", () => {
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

/**
 * The paddle uses the SDK `keyboard-axis` mover, which natively supports drag-to-move
 * touch. So a real ArrowRight keydown AND a touch/drag to the right both push the
 * paddle right.
 */
describe("breakout paddle input", () => {
  function bootLevel() {
    const registry = createLibraryRegistry();
    registerCustomBehaviors(registry);
    const input = new Input();
    input.setWorldSize(800, 600);
    const keyL: Record<string, (e: any) => void> = {};
    const ptrL: Record<string, (e: any) => void> = {};
    input.attach({
      keyTarget: { addEventListener: (t: string, f: any) => (keyL[t] = f), removeEventListener: () => {} } as never,
      pointerTarget: { addEventListener: (t: string, f: any) => (ptrL[t] = f), removeEventListener: () => {} } as never,
    });
    const game = createGame(
      { manifest, config, scenes: [title, level1, level2, level3, win, over] },
      { canvas: null, registry, input },
    );
    game.world.events.emit("start-pressed");
    game.stepFrames(2);
    expect(game.scene.id).toBe("level-1");
    return { game, keyL, ptrL };
  }

  it("a real ArrowRight keydown drives the paddle right", () => {
    const { game, keyL } = bootLevel();
    keyL.keydown({ code: "ArrowRight", cancelable: true, preventDefault() {} });
    game.stepFrames(1);
    expect(game.world.query("paddle")[0]!.vx).toBeGreaterThan(0);
  });

  it("a touch/drag to the right of the paddle moves it there (keyboard-axis native touch)", () => {
    const { game, ptrL } = bootLevel();
    ptrL.pointerdown({ pointerId: 1, clientX: 720, clientY: 560 }); // finger right of the paddle
    game.stepFrames(1);
    expect(game.world.query("paddle")[0]!.vx).toBeGreaterThan(0);
  });
});
