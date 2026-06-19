import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity, runBehavior } from "./helpers.js";
import { faceAngle } from "../src/behaviors/face-angle.js";
import { aiAimAndFire } from "../src/behaviors/ai-aim-and-fire.js";
import { followPath } from "../src/behaviors/follow-path.js";
import { formatCompact, cappedOfflineGain } from "../src/util.js";

const DT = 1 / 60;

describe("face-angle", () => {
  it("velocity mode points rotation along travel", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.vx = 0;
    e.vy = 10; // straight down → +y → atan2(+,0) = +PI/2
    faceAngle(e, world, { mode: "velocity" }, DT);
    expect(e.rotation).toBeCloseTo(Math.PI / 2, 6);
  });

  it("velocity mode holds rotation below minSpeed (no snap to 0 at rest)", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "p" });
    e.rotation = 1.234;
    e.vx = 0;
    e.vy = 0;
    faceAngle(e, world, { mode: "velocity", minSpeed: 1 }, DT);
    expect(e.rotation).toBe(1.234);
  });

  it("target mode faces the nearest tagged entity", () => {
    const world = makeWorld();
    const turret = makeEntity(world, { id: "t", x: 100, y: 100, w: 0, h: 0 }); // center (100,100)
    makeEntity(world, { id: "foe", x: 200, y: 100, w: 0, h: 0, tags: ["enemy"] }); // due right
    faceAngle(turret, world, { mode: "target", targetTag: "enemy" }, DT);
    expect(turret.rotation).toBeCloseTo(0, 6); // facing +x
  });

  it("tilt mode banks by a velocity axis, clamped", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "heli" });
    e.vy = -400; // rising fast
    faceAngle(e, world, { mode: "tilt", axis: "vy", tiltPerVel: 0.002, maxTilt: 0.5 }, DT);
    expect(e.rotation).toBeCloseTo(-0.5, 6); // -400*0.002 = -0.8, clamped to -0.5
  });
});

describe("ai-aim-and-fire priority targeting", () => {
  it("priorityKey picks the most-advanced target, overriding nearest", () => {
    const world = makeWorld();
    const tower = makeEntity(world, { id: "tower", x: 400, y: 100, w: 0, h: 0 });
    // Nearest creep is to the LEFT but barely advanced; the MOST-advanced creep is
    // farther, to the RIGHT — so the chosen target is unambiguous from the aim sign.
    makeEntity(world, { id: "near", x: 360, y: 100, w: 0, h: 0, tags: ["creep"], state: { __pathProgress: 5 } });
    makeEntity(world, { id: "far", x: 560, y: 100, w: 0, h: 0, tags: ["creep"], state: { __pathProgress: 90 } });
    const proto = { id: "shot", sprite: { kind: "none" }, size: { w: 4, h: 4 }, behaviors: [], tags: ["shot"] };
    runBehavior(aiAimAndFire, 
      tower,
      world,
      { targetTag: "creep", range: 1000, cooldown: 0, projectileSpeed: 100, projectile: proto, priorityKey: "__pathProgress" },
      DT,
    );
    const shot = world.query("shot")[0];
    expect(shot, "a projectile was fired").toBeDefined();
    expect(shot.vx).toBeGreaterThan(0); // aimed at "far" (right), not the nearer "near" (left)
  });

  it("default (no priorityKey) still targets nearest", () => {
    const world = makeWorld();
    const tower = makeEntity(world, { id: "tower", x: 400, y: 100, w: 0, h: 0 });
    makeEntity(world, { id: "left", x: 300, y: 100, w: 0, h: 0, tags: ["creep"], state: {} });
    const proto = { id: "shot", sprite: { kind: "none" }, size: { w: 4, h: 4 }, behaviors: [], tags: ["shot"] };
    runBehavior(aiAimAndFire, tower, world, { targetTag: "creep", range: 1000, cooldown: 0, projectileSpeed: 100, projectile: proto }, DT);
    const shot = world.query("shot")[0];
    expect(shot.vx).toBeLessThan(0); // nearest (only) creep is to the left → bullet goes -x
  });
});

describe("follow-path __pathProgress", () => {
  it("accumulates a monotonic distance metric while moving", () => {
    const world = makeWorld();
    const e = makeEntity(world, { id: "creep", x: 0, y: 300, w: 0, h: 0 });
    const params = { points: [{ x: 800, y: 300 }], speed: 100, arriveRadius: 6 };
    runBehavior(followPath, e, world, params, DT);
    const p1 = e.state.__pathProgress as number;
    runBehavior(followPath, e, world, params, DT);
    const p2 = e.state.__pathProgress as number;
    expect(p1).toBeCloseTo(100 * DT, 6);
    expect(p2).toBeGreaterThan(p1);
  });
});

describe("formatCompact", () => {
  it("compacts big numbers and keeps small ones plain", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1234)).toBe("1.23K");
    expect(formatCompact(4_500_000)).toBe("4.5M");
    expect(formatCompact(7_890_000_000)).toBe("7.89B");
    expect(formatCompact(5_000_000)).toBe("5M"); // trailing zeros trimmed
    expect(formatCompact(-2500)).toBe("-2.5K");
  });
});

describe("cappedOfflineGain", () => {
  it("credits rate*elapsed, clamped to the cap, floored", () => {
    const now = 1_000_000;
    expect(cappedOfflineGain(2, now - 10_000, now, 3600)).toBe(20); // 10s * 2/s
    expect(cappedOfflineGain(2, now - 10_000_000, now, 3600)).toBe(7200); // capped at 3600s * 2/s
    expect(cappedOfflineGain(2, now, now, 3600)).toBe(0); // no gap
    expect(cappedOfflineGain(2, now + 5000, now, 3600)).toBe(0); // backwards gap
    expect(cappedOfflineGain(0, now - 10_000, now, 3600)).toBe(0); // zero rate
  });
});
