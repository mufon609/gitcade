import { describe, it, expect } from "vitest";
import { makeWorld, makeEntity } from "./helpers.js";
import { dpadVector, buttonPressed } from "../src/ui/index.js";

describe("ui/hud-bar", () => {
  it("scales the entity width to value / max, anchored at full width", () => {
    const world = makeWorld();
    world.state.hp = 5;
    world.state.maxHp = 10;
    const bar = makeEntity(world, { id: "hpbar", w: 120, h: 12, sprite: { kind: "shape", shape: "rect", color: "#a7f070" } });
    const hudBar = world.registry.getBehavior("hud-bar")!.fn;
    hudBar(bar, world, { valueKey: "hp", maxKey: "maxHp", width: 120 }, 1 / 60);
    expect(bar.w).toBe(60);
    world.state.hp = 0;
    hudBar(bar, world, { valueKey: "hp", maxKey: "maxHp", width: 120 }, 1 / 60);
    expect(bar.w).toBe(0);
    world.state.hp = 10;
    hudBar(bar, world, { valueKey: "hp", maxKey: "maxHp", width: 120 }, 1 / 60);
    expect(bar.w).toBe(120);
  });
});

describe("ui/touch helpers", () => {
  it("dpadVector returns a normalized direction for a pointer inside the zone", () => {
    const zone = { x: 90, y: 510, r: 60 };
    const right = dpadVector([{ x: 140, y: 510, down: true }], zone);
    expect(right.x).toBeGreaterThan(0.5);
    expect(Math.abs(right.y)).toBeLessThan(0.2);
    const idle = dpadVector([{ x: 92, y: 511, down: true }], zone); // inside deadzone
    expect(idle).toEqual({ x: 0, y: 0 });
    const elsewhere = dpadVector([{ x: 700, y: 100, down: true }], zone);
    expect(elsewhere).toEqual({ x: 0, y: 0 });
    const up = dpadVector([{ x: 90, y: 460, down: true }], zone);
    expect(up.y).toBeLessThan(-0.5);
  });

  it("buttonPressed detects a down pointer inside the rect", () => {
    const rect = { x: 640, y: 470, w: 110, h: 110 };
    expect(buttonPressed([{ x: 690, y: 520, down: true }], rect)).toBe(true);
    expect(buttonPressed([{ x: 690, y: 520, down: false }], rect)).toBe(false);
    expect(buttonPressed([{ x: 100, y: 100, down: true }], rect)).toBe(false);
  });
});

describe("ui/touch behaviors (no pointers headless → idle, no throw)", () => {
  it("touch-dpad zeroes velocity and touch-button clears its flag with no input", () => {
    const world = makeWorld();
    const player = makeEntity(world, { id: "p", tags: ["player"] });
    player.vx = 99;
    const dpad = world.registry.getBehavior("touch-dpad")!.fn;
    dpad(player, world, { speed: 200, zone: { x: 90, y: 510, radius: 60 } }, 1 / 60);
    expect(player.vx).toBe(0);
    expect(player.vy).toBe(0);

    const ctrl = makeEntity(world, { id: "ctrl" });
    const btn = world.registry.getBehavior("touch-button")!.fn;
    btn(ctrl, world, { actionKey: "fire", rect: { x: 640, y: 470, w: 110, h: 110 } }, 1 / 60);
    expect(world.state.fire).toBe(false);
  });
});
