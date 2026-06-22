import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, collide, runBehavior } from "./helpers.js";
import { hudBar } from "../src/ui/hud.js";
import { triggerZone } from "../src/behaviors/trigger-zone.js";
import { livesRespawn } from "../src/systems/lives-respawn.js";

/**
 * 1.1.0 — three additive, default-off params that close real integration gaps:
 *  - `hud-bar.valueEntity`: source a bar's value from a tracked entity's own state
 *    (the entity→HUD bridge `format-binding` couldn't give, since it stringifies) so a
 *    data-driven HEALTH BAR off `health-and-death`'s `entity.state.hp` is possible.
 *  - `trigger-zone.setRespawnKey` + `lives-respawn.respawnStateKey`: a checkpoint writes
 *    its own position, and respawn honors it over the static point.
 *
 * Every param is unset by default, so existing games stay byte-identical (proven by the
 * conformance golden); these cases exercise only the new opt-in paths.
 */
const DT = 1 / 60;

describe("hud-bar valueEntity (1.1.0)", () => {
  const SPRITE = { kind: "shape" as const, shape: "rect" as const, color: "#a7f070" };

  it("sources the value from a tracked entity's own state[valueKey], by id", () => {
    const world = makeWorld();
    world.state.maxHp = 10;
    makeEntity(world, { id: "player", tags: ["player"], state: { hp: 5 } });
    const bar = makeEntity(world, { id: "hpbar", w: 120, h: 12, sprite: SPRITE });
    hudBar(bar, world, { valueKey: "hp", valueEntity: "player", maxKey: "maxHp", width: 120 }, DT);
    expect(bar.w).toBe(60); // 5/10 of the 120px full width
  });

  it("resolves valueEntity as a TAG when no id matches (world.query fallback)", () => {
    const world = makeWorld();
    world.state.maxHp = 10;
    makeEntity(world, { id: "p1", tags: ["hero"], state: { hp: 2 } });
    const bar = makeEntity(world, { id: "hpbar", w: 100, h: 12, sprite: SPRITE });
    hudBar(bar, world, { valueKey: "hp", valueEntity: "hero", maxKey: "maxHp", width: 100 }, DT);
    expect(bar.w).toBe(20); // 2/10 of 100px
  });

  it("redirects the source entirely — an absent entity reads 0, NOT world.state", () => {
    const world = makeWorld();
    world.state.maxHp = 10;
    world.state.hp = 9; // present on world.state, but valueEntity must ignore it
    const bar = makeEntity(world, { id: "hpbar", w: 100, h: 12, sprite: SPRITE });
    hudBar(bar, world, { valueKey: "hp", valueEntity: "ghost", maxKey: "maxHp", width: 100 }, DT);
    expect(bar.w).toBe(0); // ghost not found → value 0 (bar empties), world.state.hp untouched
  });

  it("without valueEntity, still reads world.state[valueKey] (byte-compatible default)", () => {
    const world = makeWorld();
    world.state.hp = 7;
    world.state.maxHp = 10;
    const bar = makeEntity(world, { id: "hpbar", w: 100, h: 12, sprite: SPRITE });
    hudBar(bar, world, { valueKey: "hp", maxKey: "maxHp", width: 100 }, DT);
    expect(bar.w).toBe(70);
  });
});

describe("trigger-zone setRespawnKey (1.1.0)", () => {
  it("writes the zone's own {x,y} to world.state on entry", () => {
    const world = makeWorld();
    const zone = makeEntity(world, { id: "cp1", x: 200, y: 120, tags: ["zone"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    collide(zone, player);
    runBehavior(triggerZone, zone, world, { tag: "player", enterEvent: "checkpoint", setRespawnKey: "respawnPoint" }, DT);
    expect(world.state.respawnPoint).toEqual({ x: 200, y: 120 });
  });

  it("records the point even for a once-checkpoint (set before going inert)", () => {
    const world = makeWorld();
    const zone = makeEntity(world, { id: "cp1", x: 64, y: 480, tags: ["zone"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    collide(zone, player);
    runBehavior(triggerZone, zone, world, { tag: "player", setRespawnKey: "rp", once: true }, DT);
    expect(world.state.rp).toEqual({ x: 64, y: 480 });
  });

  it("leaves world.state untouched without setRespawnKey (default-off)", () => {
    const world = makeWorld();
    const zone = makeEntity(world, { id: "cp1", x: 200, y: 120, tags: ["zone"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    collide(zone, player);
    runBehavior(triggerZone, zone, world, { tag: "player" }, DT);
    expect(world.state.respawnPoint).toBeUndefined();
  });
});

describe("lives-respawn respawnStateKey (1.1.0)", () => {
  const proto = {
    id: "player",
    tags: ["player"],
    size: { w: 16, h: 16 },
    position: { x: 0, y: 0 },
    layer: 0,
    sprite: { kind: "none" },
    behaviors: [],
  };

  /** Drive a death → countdown → respawn cycle and return the respawned player. */
  function respawn(world: ReturnType<typeof makeWorld>, params: Record<string, unknown>) {
    livesRespawn(world, params, DT); // no player present → spend a life, await respawn
    for (let i = 0; i < 12; i++) {
      livesRespawn(world, params, DT);
      world.prune();
    }
    return world.query("player")[0];
  }

  it("respawns at the live state-key point when present (overrides respawnPosition)", () => {
    const world = makeWorld();
    world.state.cp = { x: 300, y: 200 };
    const e = respawn(world, {
      startLives: 2, watchTag: "player", respawnDelay: 0.05,
      respawnPosition: { x: 50, y: 50 }, respawnStateKey: "cp", prototype: proto,
    });
    expect(e).toBeDefined();
    expect({ x: e.x, y: e.y }).toEqual({ x: 300, y: 200 });
  });

  it("falls back to respawnPosition when the state-key point is absent or malformed", () => {
    const world = makeWorld();
    world.state.cp = "not-a-point"; // malformed → asVec2 null → static fallback
    const e = respawn(world, {
      startLives: 2, watchTag: "player", respawnDelay: 0.05,
      respawnPosition: { x: 50, y: 50 }, respawnStateKey: "cp", prototype: proto,
    });
    expect({ x: e.x, y: e.y }).toEqual({ x: 50, y: 50 });
  });
});

describe("checkpoint flow (trigger-zone → lives-respawn, 1.1.0)", () => {
  it("a checkpoint's setRespawnKey feeds lives-respawn's respawnStateKey end-to-end", () => {
    const world = makeWorld();
    // 1. Player crosses a once-checkpoint at (300, 200) → it records the respawn point.
    const zone = makeEntity(world, { id: "cp", x: 300, y: 200, tags: ["zone"] });
    const player = makeEntity(world, { id: "player", tags: ["player"] });
    collide(zone, player);
    runBehavior(triggerZone, zone, world, { tag: "player", setRespawnKey: "respawnPoint", once: true }, DT);
    expect(world.state.respawnPoint).toEqual({ x: 300, y: 200 });

    // 2. Player dies → lives-respawn brings it back at the checkpoint, not the static start.
    world.destroy(player);
    world.prune();
    const params = {
      startLives: 2, watchTag: "player", respawnDelay: 0.05,
      respawnPosition: { x: 50, y: 50 }, respawnStateKey: "respawnPoint",
      prototype: { id: "player", tags: ["player"], size: { w: 16, h: 16 }, position: { x: 0, y: 0 }, layer: 0, sprite: { kind: "none" }, behaviors: [] },
    };
    livesRespawn(world, params, DT);
    for (let i = 0; i < 12; i++) {
      livesRespawn(world, params, DT);
      world.prune();
    }
    const respawned = world.query("player")[0];
    expect(respawned).toBeDefined();
    expect({ x: respawned.x, y: respawned.y }).toEqual({ x: 300, y: 200 });
  });
});
