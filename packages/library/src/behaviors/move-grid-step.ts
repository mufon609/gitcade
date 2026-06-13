import type { BehaviorFn } from "@gitcade/sdk";
import { num, strArray, bool } from "@gitcade/sdk";

interface Dir {
  x: number;
  y: number;
}

/**
 * Discrete grid-stepping movement. Moves the entity one `tileSize` cell at a time
 * on a fixed cadence. In `continuous` mode (the default — Snake) it keeps stepping
 * in the current heading and input only CHANGES heading, refusing 180° reversals;
 * with `continuous: false` (Sokoban-style) it steps once per fresh key press.
 * Writes position directly, so it does NOT need a `velocity` behavior.
 *
 * Emits a `"grid-step"` event on each step so other parts (e.g. a tail spawner)
 * can react. `tileSize` is structural grid geometry (whitelisted), but the step
 * cadence is feel/balance and therefore a `$cfg` value.
 *
 * Params:
 *  - `tileSize`: cell size in px (structural; default 16)
 *  - `stepInterval`: seconds between steps (balance → `$cfg`)
 *  - `up`/`down`/`left`/`right`: key-code arrays (defaults: arrows + WASD)
 *  - `continuous`: keep moving without input, Snake-style (default true)
 *  - `snap`: snap position to the tile grid on each step (default true)
 */
export const moveGridStep: BehaviorFn = (entity, world, params, dt) => {
  const tile = num(params, "tileSize", 16);
  const stepInterval = num(params, "stepInterval", 0.15);
  const continuous = bool(params, "continuous", true);
  const snap = bool(params, "snap", true);
  const up = orDefault(strArray(params, "up"), ["ArrowUp", "KeyW"]);
  const down = orDefault(strArray(params, "down"), ["ArrowDown", "KeyS"]);
  const left = orDefault(strArray(params, "left"), ["ArrowLeft", "KeyA"]);
  const right = orDefault(strArray(params, "right"), ["ArrowRight", "KeyD"]);

  const dir = (entity.state.__gridDir ??= { x: 0, y: 0 }) as Dir;

  // Read intent; reject reversals in continuous mode (can't fold the snake back).
  let want: Dir | null = null;
  if (world.input.anyDown(up)) want = { x: 0, y: -1 };
  else if (world.input.anyDown(down)) want = { x: 0, y: 1 };
  else if (world.input.anyDown(left)) want = { x: -1, y: 0 };
  else if (world.input.anyDown(right)) want = { x: 1, y: 0 };

  if (want) {
    const reverses = want.x === -dir.x && want.y === -dir.y && (dir.x !== 0 || dir.y !== 0);
    const moving = dir.x !== 0 || dir.y !== 0;
    if (!(continuous && reverses && moving)) {
      dir.x = want.x;
      dir.y = want.y;
    }
  }

  const timer = ((entity.state.__gridTimer as number) ?? 0) + dt;
  if (timer < stepInterval) {
    entity.state.__gridTimer = timer;
    return;
  }
  entity.state.__gridTimer = timer - stepInterval;

  const stepping = continuous ? dir.x !== 0 || dir.y !== 0 : !!want;
  if (!stepping) return;

  entity.x += dir.x * tile;
  entity.y += dir.y * tile;
  if (snap) {
    entity.x = Math.round(entity.x / tile) * tile;
    entity.y = Math.round(entity.y / tile) * tile;
  }
  world.events.emit("grid-step", { id: entity.id, x: entity.x, y: entity.y });
};

function orDefault(value: string[], fallback: string[]): string[] {
  return value.length ? value : fallback;
}
