import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity } from "./helpers.js";
import { aiChase } from "../src/behaviors/ai-chase.js";
import { aiFlee } from "../src/behaviors/ai-flee.js";
import { aiPatrol } from "../src/behaviors/ai-patrol.js";
import { aiWander } from "../src/behaviors/ai-wander.js";
import { aiAimAndFire } from "../src/behaviors/ai-aim-and-fire.js";

const DT = 1 / 60;

describe("ai-chase", () => {
  it("aims velocity toward the nearest target", () => {
    const world = makeWorld();
    const enemy = makeEntity(world, { id: "e", x: 0, y: 0, w: 10, h: 10 });
    makeEntity(world, { id: "p", x: 100, y: 0, w: 10, h: 10, tags: ["player"] });
    aiChase(enemy, world, { targetTag: "player", speed: 60 }, DT);
    expect(enemy.vx).toBeCloseTo(60, 5);
    expect(enemy.vy).toBeCloseTo(0, 5);
  });

  it("locks pursuit to the Y axis (space-invaders descent)", () => {
    const world = makeWorld();
    const invader = makeEntity(world, { id: "i", x: 0, y: 0, w: 10, h: 10 });
    makeEntity(world, { id: "p", x: 200, y: 300, w: 10, h: 10, tags: ["player"] });
    aiChase(invader, world, { targetTag: "player", speed: 40, lockAxis: "y" }, DT);
    expect(invader.vx).toBe(0);
    expect(invader.vy).toBe(40); // straight down toward the player below
  });

  it("holds still within stopDistance", () => {
    const world = makeWorld();
    const enemy = makeEntity(world, { id: "e", x: 0, y: 0, w: 10, h: 10 });
    makeEntity(world, { id: "core", x: 12, y: 0, w: 10, h: 10, tags: ["core"] });
    aiChase(enemy, world, { targetTag: "core", speed: 60, stopDistance: 100 }, DT);
    expect(enemy.vx).toBe(0);
    expect(enemy.vy).toBe(0);
  });
});

describe("ai-flee", () => {
  it("moves directly away from the threat", () => {
    const world = makeWorld();
    const prey = makeEntity(world, { id: "prey", x: 100, y: 0, w: 10, h: 10 });
    makeEntity(world, { id: "p", x: 0, y: 0, w: 10, h: 10, tags: ["player"] });
    aiFlee(prey, world, { threatTag: "player", speed: 50 }, DT);
    expect(prey.vx).toBeGreaterThan(0); // fleeing to the right, away from the player at the left
  });

  it("only flees within panicDistance", () => {
    const world = makeWorld();
    const prey = makeEntity(world, { id: "prey", x: 500, y: 0, w: 10, h: 10 });
    makeEntity(world, { id: "p", x: 0, y: 0, w: 10, h: 10, tags: ["player"] });
    aiFlee(prey, world, { threatTag: "player", speed: 50, panicDistance: 100 }, DT);
    expect(prey.vx).toBe(0); // threat is far → calm
  });
});

describe("ai-patrol", () => {
  it("advances to the next waypoint on arrival and dwells", () => {
    const world = makeWorld();
    const guard = makeEntity(world, { id: "g", x: 95, y: 0, w: 10, h: 10 });
    const params = { points: [{ x: 100, y: 5 }, { x: 300, y: 5 }], speed: 40, waitTime: 0.5, arriveRadius: 8 };
    aiPatrol(guard, world, params, DT); // at first waypoint → advance + start waiting
    expect(guard.state.__patrolIdx).toBe(1);
    expect((guard.state.__patrolWait as number)).toBeGreaterThan(0);
    expect(guard.vx).toBe(0);
  });
});

describe("ai-wander", () => {
  it("picks a unit heading and moves at the wander speed", () => {
    const world = makeWorld({ seed: 42 });
    const critter = makeEntity(world, { id: "c", x: 400, y: 300, w: 10, h: 10 });
    aiWander(critter, world, { speed: 30, changeInterval: 1 }, DT);
    expect(Math.hypot(critter.vx, critter.vy)).toBeCloseTo(30, 4);
  });
});

describe("ai-aim-and-fire", () => {
  it("fires at a target in range on cooldown", () => {
    const world = makeWorld();
    const turret = makeEntity(world, { id: "t", x: 100, y: 100, w: 16, h: 16 });
    makeEntity(world, { id: "p", x: 100, y: 200, w: 16, h: 16, tags: ["player"] });
    const params = {
      targetTag: "player",
      range: 300,
      cooldown: 1,
      projectileSpeed: 200,
      projectile: { id: "eb", tags: ["enemy-bullet"], size: { w: 6, h: 6 }, sprite: { kind: "none" }, behaviors: [] },
    };
    aiAimAndFire(turret, world, params, DT);
    const bullets = world.query("enemy-bullet");
    expect(bullets.length).toBe(1);
    expect(bullets[0]!.vy).toBeGreaterThan(0); // toward the player below
  });

  it("does not fire when the target is out of range", () => {
    const world = makeWorld();
    const turret = makeEntity(world, { id: "t", x: 0, y: 0, w: 16, h: 16 });
    makeEntity(world, { id: "p", x: 700, y: 500, w: 16, h: 16, tags: ["player"] });
    aiAimAndFire(turret, world, { targetTag: "player", range: 50, cooldown: 1, projectileSpeed: 200, projectile: { id: "eb", tags: ["enemy-bullet"], sprite: { kind: "none" }, behaviors: [] } }, DT);
    expect(world.query("enemy-bullet").length).toBe(0);
  });
});
