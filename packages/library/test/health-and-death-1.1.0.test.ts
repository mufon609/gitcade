import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, runBehavior } from "./helpers.js";
import { healthAndDeath } from "../src/behaviors/health-and-death.js";

/**
 * 1.1.0 — one additive, default-off param: `hpStateKey`. When it names a NUMBER on
 * `world.state`, hp seeds FROM it instead of the static `hp` param — the seam a level
 * transition uses to carry the player's remaining hp into the next stage (the stashing
 * key rides `scene.flow.persist`). Unset key / non-number ⇒ the static `hp` path, so
 * existing games stay byte-identical (proven by the conformance golden); these cases
 * exercise only the new opt-in path.
 */
const DT = 1 / 60;

describe("health-and-death hpStateKey (1.1.0)", () => {
  it("seeds hp from world.state[hpStateKey] when it is a number (overrides the static hp)", () => {
    const world = makeWorld();
    world.state.carriedHp = 2; // a partial-hp carry from a prior level
    const e = makeEntity(world, { id: "player" });
    runBehavior(healthAndDeath, e, world, { hp: 5, hpStateKey: "carriedHp" }, DT);
    expect(e.state.hp).toBe(2); // the carried value, NOT the static 5
    expect(e.alive).toBe(true);
  });

  it("falls back to the static hp when the carry key is unset (default-off, byte-compatible)", () => {
    const world = makeWorld(); // no carriedHp on world.state
    const e = makeEntity(world, { id: "player" });
    runBehavior(healthAndDeath, e, world, { hp: 5, hpStateKey: "carriedHp" }, DT);
    expect(e.state.hp).toBe(5);
  });

  it("falls back to the static hp when the carry key holds a non-number", () => {
    const world = makeWorld();
    world.state.carriedHp = "full"; // malformed → ignored
    const e = makeEntity(world, { id: "player" });
    runBehavior(healthAndDeath, e, world, { hp: 3, hpStateKey: "carriedHp" }, DT);
    expect(e.state.hp).toBe(3);
  });

  it("without hpStateKey, still seeds from the static hp (the 1.0.0 path is unchanged)", () => {
    const world = makeWorld();
    world.state.carriedHp = 99; // present, but no hpStateKey param → must be ignored
    const e = makeEntity(world, { id: "player" });
    runBehavior(healthAndDeath, e, world, { hp: 4 }, DT);
    expect(e.state.hp).toBe(4);
  });

  it("carries a 0-hp value through (a number is a number) — seeds 0 and dies on that tick", () => {
    const world = makeWorld();
    world.state.carriedHp = 0; // 0 is a valid carried number, not a fallback trigger
    const e = makeEntity(world, { id: "player", tags: ["player"] });
    runBehavior(healthAndDeath, e, world, { hp: 5, hpStateKey: "carriedHp", deathEvent: "died" }, DT);
    expect(e.state.hp).toBe(0);
    expect(e.alive).toBe(false); // seeded to 0 → the existing death path fires
  });

  it("seeds only ONCE — a later carriedHp change does not overwrite live hp", () => {
    const world = makeWorld();
    world.state.carriedHp = 3;
    const e = makeEntity(world, { id: "player" });
    runBehavior(healthAndDeath, e, world, { hp: 5, hpStateKey: "carriedHp" }, DT);
    expect(e.state.hp).toBe(3);
    e.state.hp = 2; // took a hit
    world.state.carriedHp = 3; // a stale carry value lingering on world.state
    runBehavior(healthAndDeath, e, world, { hp: 5, hpStateKey: "carriedHp" }, DT);
    expect(e.state.hp).toBe(2); // hp is already a number → not re-seeded
  });
});
