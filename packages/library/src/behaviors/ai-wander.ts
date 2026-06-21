import type { BehaviorFn, World } from "@gitcade/sdk";
import { num } from "@gitcade/sdk";

/**
 * Aimless wandering: drift in a heading that re-randomizes every `changeInterval`
 * seconds, turning away from world edges so the entity stays in bounds. Uses
 * `world.rng` (the seedable RNG hook) so headless runs are deterministic. SETS
 * velocity; order a `velocity` behavior AFTER it.
 *
 * Params:
 *  - `speed`: wander speed in px/sec (balance → `$cfg`)
 *  - `changeInterval`: seconds between heading changes (balance → `$cfg`)
 *  - `edgePadding`: distance from a wall at which it turns inward (structural; default 16)
 */
export const aiWander: BehaviorFn = (entity, world, params, dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): heading vector + re-pick timer
  const speed = num(params, "speed", 0);
  const changeInterval = num(params, "changeInterval", 1);
  const edgePadding = num(params, "edgePadding", 16);

  let timer = ((s.wanderTimer as number) ?? changeInterval) + 0;
  // First tick: pick an initial heading.
  if (s.wanderDir === undefined) {
    pickHeading(s, world);
    s.wanderTimer = changeInterval;
  }

  timer = (s.wanderTimer as number) - dt;
  if (timer <= 0) {
    pickHeading(s, world);
    timer = changeInterval;
  }
  s.wanderTimer = timer;

  // Steer away from edges.
  const W = world.bounds.width;
  const H = world.bounds.height;
  const dir = s.wanderDir as { x: number; y: number };
  if (entity.x < edgePadding && dir.x < 0) dir.x = Math.abs(dir.x);
  else if (entity.x + entity.w > W - edgePadding && dir.x > 0) dir.x = -Math.abs(dir.x);
  if (entity.y < edgePadding && dir.y < 0) dir.y = Math.abs(dir.y);
  else if (entity.y + entity.h > H - edgePadding && dir.y > 0) dir.y = -Math.abs(dir.y);

  entity.vx = dir.x * speed;
  entity.vy = dir.y * speed;
};

function pickHeading(s: Record<string, unknown>, world: World): void {
  // `wanderDir` becomes velocity → feeds `snapshotWorld`; the angle→vector trig must be
  // cross-engine-deterministic, so go through `world.math` (not raw Math.cos/sin). `Math.PI` is
  // a spec-fixed constant (identical on every engine), so it stays.
  const angle = world.rng() * Math.PI * 2;
  s.wanderDir = { x: world.math.cos(angle), y: world.math.sin(angle) };
}
