import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, collide, runBehavior } from "./helpers.js";
import { contactDamage } from "../src/behaviors/contact-damage.js";
import { healthAndDeath } from "../src/behaviors/health-and-death.js";
import { shoot } from "../src/behaviors/shoot.js";
import { meleeSwing } from "../src/behaviors/melee-swing.js";

const DT = 1 / 60;

describe("contact-damage", () => {
  it("reduces an overlapping target's hp", () => {
    const world = makeWorld();
    const enemy = makeEntity(world, { id: "e", tags: ["enemy"] });
    const player = makeEntity(world, { id: "p", tags: ["player"], state: { hp: 10 } });
    collide(enemy, player);
    runBehavior(contactDamage, enemy, world, { targetTag: "player", damage: 3 }, DT);
    expect(player.state.hp).toBe(7);
  });

  it("respects per-target cooldown", () => {
    const world = makeWorld();
    const enemy = makeEntity(world, { id: "e", tags: ["enemy"] });
    const player = makeEntity(world, { id: "p", tags: ["player"], state: { hp: 10 } });
    collide(enemy, player);
    runBehavior(contactDamage, enemy, world, { targetTag: "player", damage: 3, cooldown: 1 }, DT);
    runBehavior(contactDamage, enemy, world, { targetTag: "player", damage: 3, cooldown: 1 }, DT); // same tick, blocked
    expect(player.state.hp).toBe(7);
  });

  it("skips victims whose hp is not yet a number (no NaN)", () => {
    const world = makeWorld();
    const enemy = makeEntity(world, { id: "e", tags: ["enemy"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] }); // hp unset
    collide(enemy, player);
    runBehavior(contactDamage, enemy, world, { targetTag: "player", damage: 3 }, DT);
    expect(player.state.hp).toBeUndefined();
  });

  it("self-destructs after a hit when configured (bullets)", () => {
    const world = makeWorld();
    const bullet = makeEntity(world, { id: "b", tags: ["bullet"] });
    const enemy = makeEntity(world, { id: "e", tags: ["enemy"], state: { hp: 1 } });
    collide(bullet, enemy);
    runBehavior(contactDamage, bullet, world, { targetTag: "enemy", damage: 1, selfDestruct: true }, DT);
    expect(bullet.alive).toBe(false);
  });
});

describe("health-and-death", () => {
  it("seeds hp from the param on first tick", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "e" });
    runBehavior(healthAndDeath, e, world, { hp: 5 }, DT);
    expect(e.state.hp).toBe(5);
    expect(e.alive).toBe(true);
  });

  it("dies, tallies, and destroys when hp hits zero", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "e", state: { hp: 0 } });
    runBehavior(healthAndDeath, e, world, { hp: 5, tallyKey: "kills" }, DT);
    expect(e.alive).toBe(false);
    expect(world.state.kills).toBe(1);
  });

  it("expires after its lifespan (generalized TTL for bullets/hitboxes)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "bullet", state: { hp: 1 } });
    runBehavior(healthAndDeath, e, world, { lifespan: 0.1 }, 0.05);
    expect(e.alive).toBe(true);
    runBehavior(healthAndDeath, e, world, { lifespan: 0.1 }, 0.06); // age ≥ lifespan
    expect(e.alive).toBe(false);
  });
});

describe("shoot", () => {
  it("spawns a projectile on a fresh fire and respects cooldown", () => {
    const world = makeWorld();
    const shooter = makeEntity(world, { id: "ship", x: 100, y: 100, w: 16, h: 16, tags: ["player"] });
    (world.input as unknown as { anyDown: () => boolean }).anyDown = () => true;
    const params = {
      projectileSpeed: 400,
      cooldown: 0.5,
      direction: { x: 0, y: -1 },
      projectile: { id: "bullet", tags: ["bullet"], size: { w: 4, h: 8 }, sprite: { kind: "none" }, behaviors: [] },
    };
    runBehavior(shoot, shooter, world, params, DT);
    expect(world.query("bullet").length).toBe(1);
    expect(world.query("bullet")[0]!.vy).toBe(-400);
    runBehavior(shoot, shooter, world, params, DT); // within cooldown → no second bullet
    expect(world.query("bullet").length).toBe(1);
  });
});

describe("melee-swing", () => {
  it("spawns a transient hitbox in front of the wielder", () => {
    const world = makeWorld();
    const hero = makeEntity(world, { id: "hero", x: 100, y: 100, w: 16, h: 16 });
    hero.vx = 50; // facing right
    (world.input as unknown as { anyDown: () => boolean }).anyDown = () => true;
    const params = {
      cooldown: 0.3,
      reach: { x: 24, y: 0 },
      hitbox: { id: "swing", tags: ["melee"], size: { w: 20, h: 20 }, sprite: { kind: "none" }, behaviors: [] },
    };
    runBehavior(meleeSwing, hero, world, params, DT);
    const swing = world.query("melee")[0];
    expect(swing).toBeDefined();
    expect(swing!.cx).toBeGreaterThan(hero.cx); // placed to the right
  });
});
