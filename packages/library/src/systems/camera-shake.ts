import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";
import { systemState } from "../util.js";

/**
 * `camera-shake` — data-triggered screenshake / camera juice (INDIE-ROADMAP Tier-2). On a
 * named EVENT it starts a decaying shake, writing a transient random offset to the runtime
 * `world.camera.shakeX`/`shakeY` each tick; the renderer adds that offset to the camera,
 * so the view shakes whether or not the scene scrolls. The offset is kept SEPARATE
 * from `camera.x`/`y`, so it never corrupts a `camera-follow` base or the pointer→world
 * mapping. This is the engine replacement for the old host-side DOM canvas-translate shake.
 *
 * Trigger it as DATA: emit the event with an optional `{ magnitude, duration }` payload
 * (e.g. `world.events.emit("shake", { magnitude: 8, duration: 0.3 })` from an on-hit
 * behavior, a flow, a `trigger-zone`, etc.). Payload values override the param defaults, so
 * one shake system serves many intensities. A new shake whose magnitude is ≥ the active
 * one's refreshes it; a weaker one won't cut a stronger shake short.
 *
 * Deterministic: the per-tick offset is drawn from `world.rng`, so a seeded run (replay,
 * ghost, the headless validator) reproduces the exact shake. Pure camera write + event
 * read; the frozen tick order is untouched. Run it once per scene (it subscribes scene-
 * scoped on its first tick).
 *
 * Params (numbers are balance → `$cfg`; `event` is structural):
 *  - `event`: event name that triggers a shake (default `"shake"`)
 *  - `magnitude`: default shake amplitude in px when the payload omits one (default 0)
 *  - `duration`: default shake length in seconds when the payload omits one (default 0)
 *  - `falloff`: decay exponent of amplitude over the duration — 1 = linear, >1 = faster
 *    initial settle (default 1)
 */
interface ShakeState extends Record<string, unknown> {
  t: number;
  dur: number;
  mag: number;
  attached: boolean;
}

export const cameraShake: SystemFn = (world, params, dt) => {
  const cam = world.camera;
  if (!cam) return;
  const eventName = str(params, "event", "shake");
  const defaultMag = num(params, "magnitude", 0);
  const defaultDur = num(params, "duration", 0);
  const falloff = num(params, "falloff", 1);

  const st = systemState<ShakeState>(world, "__camShake", { t: 0, dur: 0, mag: 0, attached: false });

  // Subscribe ONCE per scene to the trigger event (scene-scoped → torn down on transition).
  if (!st.attached) {
    st.attached = true;
    world.events.onScene(eventName, (payload) => {
      const p = payload as { magnitude?: number; duration?: number } | null | undefined;
      const mag = p && typeof p.magnitude === "number" ? p.magnitude : defaultMag;
      const dur = p && typeof p.duration === "number" ? p.duration : defaultDur;
      if (mag <= 0 || dur <= 0) return;
      // Don't let a weaker shake weaken/cut an active stronger one; ≥ refreshes or overrides.
      if (st.t <= 0 || mag >= st.mag) {
        st.mag = mag;
        st.dur = dur;
        st.t = dur;
      }
    });
  }

  if (st.t > 0) {
    st.t = Math.max(0, st.t - dt);
    const k = st.dur > 0 ? Math.pow(st.t / st.dur, falloff) : 0; // decaying amplitude 1 → 0
    const amp = st.mag * k;
    cam.shakeX = (world.rng() * 2 - 1) * amp;
    cam.shakeY = (world.rng() * 2 - 1) * amp;
  } else {
    cam.shakeX = 0;
    cam.shakeY = 0;
  }
};
