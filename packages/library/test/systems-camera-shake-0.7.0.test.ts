import { describe, it, expect } from "vitest";
import { makeWorld } from "./helpers.js";
import { cameraShake } from "../src/systems/camera-shake.js";

const DT = 1 / 60;

/**
 * 0.7.0 — camera-shake (INDIE-ROADMAP Tier-2 juice): a data-triggered, decaying screenshake
 * written to world.camera.shakeX/shakeY (the renderer adds it). Deterministic off world.rng.
 */
describe("camera-shake — data-triggered screenshake", () => {
  it("subscribes, shakes on the event, and decays to zero", () => {
    const world = makeWorld({ seed: 1 });
    const params = { event: "shake" };
    cameraShake(world, params, DT); // tick 1: subscribe; nothing yet
    expect(world.camera.shakeX).toBe(0);

    world.events.emit("shake", { magnitude: 10, duration: 0.2 });
    cameraShake(world, params, DT); // tick 2: shaking
    expect(Math.abs(world.camera.shakeX!) + Math.abs(world.camera.shakeY!)).toBeGreaterThan(0);
    expect(Math.abs(world.camera.shakeX!)).toBeLessThanOrEqual(10);

    for (let i = 0; i < 20; i++) cameraShake(world, params, DT); // > 0.2s → fully decayed
    expect(world.camera.shakeX).toBe(0);
    expect(world.camera.shakeY).toBe(0);
  });

  it("a stronger shake overrides; a weaker one does not cut it short", () => {
    const world = makeWorld({ seed: 2 });
    const params = { event: "shake" };
    cameraShake(world, params, DT); // subscribe

    world.events.emit("shake", { magnitude: 20, duration: 0.5 });
    cameraShake(world, params, DT);
    expect((world.state.__camShake as { mag: number }).mag).toBe(20);

    world.events.emit("shake", { magnitude: 3, duration: 0.1 }); // weaker — ignored
    cameraShake(world, params, DT);
    expect((world.state.__camShake as { mag: number }).mag).toBe(20);

    world.events.emit("shake", { magnitude: 30, duration: 0.4 }); // stronger — overrides
    cameraShake(world, params, DT);
    expect((world.state.__camShake as { mag: number }).mag).toBe(30);
  });

  it("uses param defaults when the payload omits magnitude/duration", () => {
    const world = makeWorld({ seed: 3 });
    const params = { event: "boom", magnitude: 8, duration: 0.25 };
    cameraShake(world, params, DT); // subscribe
    world.events.emit("boom"); // no payload → fall back to the param defaults
    cameraShake(world, params, DT);
    expect(Math.abs(world.camera.shakeX!) + Math.abs(world.camera.shakeY!)).toBeGreaterThan(0);
  });

  it("is deterministic — the same seed reproduces identical offsets", () => {
    function run(): number[] {
      const w = makeWorld({ seed: 7 });
      const params = { event: "shake" };
      cameraShake(w, params, DT);
      w.events.emit("shake", { magnitude: 10, duration: 0.3 });
      const xs: number[] = [];
      for (let i = 0; i < 5; i++) {
        cameraShake(w, params, DT);
        xs.push(w.camera.shakeX!);
      }
      return xs;
    }
    expect(run()).toEqual(run());
  });
});
