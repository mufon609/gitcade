import { describe, it, expect } from "vitest";
import type { Tilemap } from "@gitcade/sdk";
import { makeWorld, makeEntity, runBehavior } from "./helpers.js";
import { cameraFollow } from "../src/systems/camera-follow.js";
import { tilemapCollide } from "../src/behaviors/tilemap-collide.js";
import { movePlatformer } from "../src/behaviors/move-platformer.js";

const DT = 1 / 60;

/**
 * 0.7.0 — the platformer enablers (INDIE-ROADMAP Tier-0):
 *  - camera-follow (0.1): pan the viewport to track a target, clamped to the world.
 *  - tilemap-collide (0.2): resolve an AABB against solid tiles + contact flags.
 *  - move-platformer (1.1.0): honor the tilemap-collide `contacts.onGround` flag.
 */

describe("camera-follow", () => {
  /** A world whose simulation area (3200x600) is wider than its 800x600 viewport. */
  function scrollWorld() {
    const world = makeWorld({ bounds: { width: 3200, height: 600 } });
    world.camera = { x: 0, y: 0, width: 800, height: 600 }; // viewport (a Game sets this from scene.size)
    return world;
  }

  it("centers the viewport on the target (snap)", () => {
    const world = scrollWorld();
    makeEntity(world, { id: "p", x: 1600, y: 300, w: 16, h: 16, tags: ["player"] });
    cameraFollow(world, { targetTag: "player", smoothing: 1 }, DT);
    // Target center (1608, 308) → cam top-left so it sits at viewport center (400,300).
    expect(world.camera.x).toBeCloseTo(1608 - 400, 3);
    // World is only viewport-tall, so Y clamps to the origin.
    expect(world.camera.y).toBe(0);
  });

  it("clamps at the left and right edges so the viewport never leaves the world", () => {
    const left = scrollWorld();
    makeEntity(left, { id: "p", x: 0, y: 300, w: 16, h: 16, tags: ["player"] });
    cameraFollow(left, { targetTag: "player", smoothing: 1 }, DT);
    expect(left.camera.x).toBe(0); // can't pan past the left edge

    const right = scrollWorld();
    makeEntity(right, { id: "p", x: 3184, y: 300, w: 16, h: 16, tags: ["player"] });
    cameraFollow(right, { targetTag: "player", smoothing: 1 }, DT);
    expect(right.camera.x).toBe(3200 - 800); // pinned to the right edge (maxX)
  });

  it("eases toward the target when smoothing < 1", () => {
    const world = scrollWorld();
    makeEntity(world, { id: "p", x: 1600, y: 300, w: 16, h: 16, tags: ["player"] });
    cameraFollow(world, { targetTag: "player", smoothing: 0.5 }, DT);
    // Half the distance from 0 toward the snap target (1208) this tick.
    expect(world.camera.x).toBeCloseTo(1208 * 0.5, 3);
  });

  it("holds still while the target is inside the deadzone", () => {
    const world = scrollWorld();
    world.camera.x = 1000; // viewport spans world x 1000..1800; center at 1400
    makeEntity(world, { id: "p", x: 1392, y: 300, w: 16, h: 16, tags: ["player"] }); // center 1400 — dead center
    cameraFollow(world, { targetTag: "player", smoothing: 1, deadzone: { w: 200, h: 120 } }, DT);
    expect(world.camera.x).toBe(1000); // unmoved
  });

  it("no target ⇒ no-op (no throw, camera unchanged)", () => {
    const world = scrollWorld();
    world.camera.x = 500;
    expect(() => cameraFollow(world, { targetTag: "player", smoothing: 1 }, DT)).not.toThrow();
    expect(world.camera.x).toBe(500);
  });
});

describe("tilemap-collide", () => {
  /** A 10x10 grid of 32px tiles with a solid border (row 0 ceiling, row 9 floor, cols 0 & 9 walls). */
  function boxTilemap(): Tilemap {
    const cols = 10;
    const rows = 10;
    const tiles: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const border = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
        tiles.push(border ? 1 : -1);
      }
    }
    return { tileSize: 32, cols, rows, tiles, properties: { "1": { solid: true } } };
  }

  it("lands on a solid floor and flags contacts.onGround", () => {
    const world = makeWorld();
    world.tilemap = boxTilemap();
    const e = makeEntity(world, { id: "p", x: 100, y: 290, w: 16, h: 16 }); // y+h=306 penetrates floor row 9 (288..320)
    e.vy = 100;
    tilemapCollide(e, world, { solidProp: "solid" }, DT);
    expect(e.y).toBe(9 * 32 - 16); // bottom flush with the floor top (288)
    expect(e.vy).toBe(0);
    expect(e.body.contacts.onGround).toBe(true);
  });

  it("stops at a wall when moving right and flags contacts.onWallR", () => {
    const world = makeWorld();
    world.tilemap = boxTilemap();
    const e = makeEntity(world, { id: "p", x: 280, y: 100, w: 16, h: 16 }); // x+w=296 penetrates wall col 9 (288..320)
    e.vx = 60;
    tilemapCollide(e, world, { solidProp: "solid" }, DT);
    expect(e.x).toBe(9 * 32 - 16); // pushed left of the wall (272)
    expect(e.vx).toBe(0);
    expect(e.body.contacts.onWallR).toBe(true);
  });

  it("stops at a ceiling when moving up and flags contacts.onCeiling", () => {
    const world = makeWorld();
    world.tilemap = boxTilemap();
    const e = makeEntity(world, { id: "p", x: 100, y: 10, w: 16, h: 16 }); // penetrates ceiling row 0 (0..32)
    e.vy = -60;
    tilemapCollide(e, world, { solidProp: "solid" }, DT);
    expect(e.y).toBe(32); // pushed below the ceiling
    expect(e.vy).toBe(0);
    expect(e.body.contacts.onCeiling).toBe(true);
  });

  it("passes through a non-solid tile and clears the flags", () => {
    const world = makeWorld();
    world.tilemap = boxTilemap();
    const e = makeEntity(world, { id: "p", x: 150, y: 150, w: 16, h: 16 }); // interior (all -1 / non-solid)
    e.vy = 100;
    tilemapCollide(e, world, { solidProp: "solid" }, DT);
    expect(e.y).toBe(150); // unmoved
    expect(e.body.contacts.onGround).toBe(false);
  });

  it("no tilemap ⇒ flags false, no throw", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p", x: 0, y: 0, w: 16, h: 16 });
    e.body.contacts.onGround = true; // pre-seed; the no-tilemap path must reset it
    expect(() => tilemapCollide(e, world, {}, DT)).not.toThrow();
    expect(e.body.contacts.onGround).toBe(false);
  });
});

describe("move-platformer — tilemap grounding hook (1.1.0)", () => {
  it("jumps when a resolver marked contacts.onGround, even off the world floor", () => {
    const world = makeWorld({ bounds: { width: 800, height: 600 } });
    const e = makeEntity(world, { id: "p", x: 100, y: 100, w: 16, h: 16 }); // mid-air vs world floor
    e.body.contacts.onGround = true; // a resolver marked us grounded last tick
    (world.input as unknown as { axis: () => number; anyDown: () => boolean }).axis = () => 0;
    (world.input as unknown as { anyDown: () => boolean }).anyDown = () => true; // jump held
    runBehavior(movePlatformer, e, world, { moveSpeed: 0, gravity: 1000, jumpSpeed: 400, jump: ["Space"] }, DT);
    expect(e.vy).toBeLessThan(0); // launched upward off the tile floor
  });

  it("does NOT jump in mid-air when nothing marked it grounded", () => {
    const world = makeWorld({ bounds: { width: 800, height: 600 } });
    const e = makeEntity(world, { id: "p", x: 100, y: 100, w: 16, h: 16 }); // no contacts.onGround, not on world floor
    (world.input as unknown as { axis: () => number; anyDown: () => boolean }).axis = () => 0;
    (world.input as unknown as { anyDown: () => boolean }).anyDown = () => true;
    runBehavior(movePlatformer, e, world, { moveSpeed: 0, gravity: 1000, jumpSpeed: 400, jump: ["Space"] }, DT);
    expect(e.vy).toBeGreaterThan(0); // only gravity — no jump
  });
});
