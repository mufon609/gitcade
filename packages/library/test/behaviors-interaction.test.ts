import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, collide, runBehavior } from "./helpers.js";
import { collectOnTouch } from "../src/behaviors/collect-on-touch.js";
import { triggerZone } from "../src/behaviors/trigger-zone.js";
import { portal } from "../src/behaviors/portal.js";

const DT = 1 / 60;

describe("collect-on-touch", () => {
  it("credits score and is consumed on pickup", () => {
    const world = makeWorld();
    const coin = makeEntity(world, { id: "coin", tags: ["coin"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    collide(coin, player);
    collectOnTouch(coin, world, { collectorTag: "player", value: 10, scoreKey: "score", kind: "coin" }, DT);
    expect(world.state.score).toBe(10);
    expect(coin.alive).toBe(false);
  });

  it("can persist (consume: false) for triggers/keys", () => {
    const world = makeWorld();
    const key = makeEntity(world, { id: "key", tags: ["key"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    collide(key, player);
    collectOnTouch(key, world, { collectorTag: "player", value: 1, grantKey: "keys", consume: false }, DT);
    expect(world.state.keys).toBe(1);
    expect(key.alive).toBe(true);
  });
});

describe("trigger-zone", () => {
  it("emits an enter event once and can kill the entrant (hazard)", () => {
    const world = makeWorld();
    const zone = makeEntity(world, { id: "z", tags: ["zone"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    let entered = 0;
    world.events.on("hazard", () => (entered += 1));
    collide(zone, player);
    runBehavior(triggerZone, zone, world, { tag: "player", enterEvent: "hazard", kill: true }, DT);
    expect(entered).toBe(1);
    expect(player.alive).toBe(false);
  });

  it("sets a world.state flag while occupied", () => {
    const world = makeWorld();
    const zone = makeEntity(world, { id: "z", tags: ["zone"] });
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    collide(zone, player);
    runBehavior(triggerZone, zone, world, { tag: "player", setStateKey: "inZone" }, DT);
    expect(world.state.inZone).toBe(true);
  });
});

describe("portal", () => {
  it("teleports a tagged entity to the destination point", () => {
    const world = makeWorld();
    const p = makeEntity(world, { id: "portal", x: 0, y: 0, w: 20, h: 20, tags: ["portal"] });
    const player = makeEntity(world, { id: "p", x: 5, y: 5, w: 16, h: 16, tags: ["player"] });
    collide(p, player);
    portal(p, world, { tag: "player", to: { x: 400, y: 300 }, cooldown: 0.5 }, DT);
    expect(player.cx).toBe(400);
    expect(player.cy).toBe(300);
  });
});
