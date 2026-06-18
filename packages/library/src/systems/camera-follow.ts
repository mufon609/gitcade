import type { SystemFn } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * Move the render viewport (`world.camera`) to keep a tagged entity centered, with
 * optional easing and a centered deadzone, clamped so the viewport never shows
 * outside `world.bounds`. The runtime camera for scrolling levels — pair it with a
 * `scene.world` larger than `scene.size` (the SDK decouples sim bounds from the
 * viewport in 0.7.0). With no `scene.world`, `world.bounds` equals the viewport so
 * the clamp pins the camera at the origin and this is a no-op.
 *
 * It runs as a SYSTEM (before entity behaviors), so it reads the target's position
 * from the end of the previous tick — exactly one tick stale. Imperceptible with any
 * easing; with `smoothing:1` (hard snap) a fast target trails by at most one tick of
 * its own motion (sub-pixel at typical speeds).
 *
 * Params:
 *  - `targetTag`: tag of the entity to keep centered (first live match; default `"player"`)
 *  - `smoothing`: ease factor 0..1 per tick toward the target; 1 = hard snap (balance → `$cfg`)
 *  - `deadzone`: optional centered `{ w, h }` box (px) the target moves freely within
 *    before the camera pans (structural — `w`/`h` are whitelisted, so literals are fine)
 */
export const cameraFollow: SystemFn = (world, params) => {
  const cam = world.camera;
  if (!cam) return;
  const targetTag = str(params, "targetTag", "player");
  const target = world.query(targetTag)[0];
  if (!target) return;

  const smoothing = num(params, "smoothing", 1); // 1 = snap; <1 = ease toward
  const dz = params.deadzone as { w?: number; h?: number } | undefined;
  const dzW = dz && typeof dz.w === "number" ? dz.w : 0;
  const dzH = dz && typeof dz.h === "number" ? dz.h : 0;

  // Desired top-left so the target sits at viewport center, relaxed by the deadzone:
  // inside the centered dead box the camera holds; outside, it pans to put the target
  // back on the nearer dead-box edge.
  const cxView = cam.width / 2;
  const cyView = cam.height / 2;
  const relX = target.cx - cam.x; // target position WITHIN the current viewport
  const relY = target.cy - cam.y;
  let desiredX = cam.x;
  let desiredY = cam.y;
  if (relX < cxView - dzW / 2) desiredX = target.cx - (cxView - dzW / 2);
  else if (relX > cxView + dzW / 2) desiredX = target.cx - (cxView + dzW / 2);
  if (relY < cyView - dzH / 2) desiredY = target.cy - (cyView - dzH / 2);
  else if (relY > cyView + dzH / 2) desiredY = target.cy - (cyView + dzH / 2);

  // Ease toward the desired position (snap when smoothing ≥ 1). Frame-rate
  // independent because the host loop is a fixed timestep.
  const t = smoothing >= 1 ? 1 : Math.max(0, smoothing);
  cam.x += (desiredX - cam.x) * t;
  cam.y += (desiredY - cam.y) * t;

  // Clamp so the viewport stays inside the world. When the world is no larger than the
  // viewport on an axis, max is 0 → that axis stays pinned at the origin.
  const maxX = Math.max(0, world.bounds.width - cam.width);
  const maxY = Math.max(0, world.bounds.height - cam.height);
  cam.x = Math.min(Math.max(cam.x, 0), maxX);
  cam.y = Math.min(Math.max(cam.y, 0), maxY);
};
