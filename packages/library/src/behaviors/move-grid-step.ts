import type { BehaviorFn } from "@gitcade/sdk";
import { num, str, strArray, bool } from "@gitcade/sdk";

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
 *  - `moveAction`: optional logical-action name. When set, intent is read from
 *    `world.input.actionVector(moveAction)` (keyboard axis OR a touch d-pad zone,
 *    unified by the `input-actions` system) and the DOMINANT axis becomes the next
 *    heading — so a touch player steers without the game synthesizing arrow keys.
 *    Unset ⇒ the `up`/`down`/`left`/`right` key path.
 */
export const moveGridStep: BehaviorFn = (entity, world, params, dt, scratch) => {
  const s = scratch!; // per-instance scratch (host-provided): last-stepped heading + step timer
  const tile = num(params, "tileSize", 16);
  const stepInterval = num(params, "stepInterval", 0.15);
  const continuous = bool(params, "continuous", true);
  const snap = bool(params, "snap", true);
  const up = orDefault(strArray(params, "up"), ["ArrowUp", "KeyW"]);
  const down = orDefault(strArray(params, "down"), ["ArrowDown", "KeyS"]);
  const left = orDefault(strArray(params, "left"), ["ArrowLeft", "KeyA"]);
  const right = orDefault(strArray(params, "right"), ["ArrowRight", "KeyD"]);

  const dir = (entity.state.__gridDir ??= { x: 0, y: 0 }) as Dir;
  // The reversal guard must compare against the LAST COMMITTED step direction, not
  // the live `dir`. `dir` is mutated the instant a non-reversing turn is accepted,
  // so two perpendicular taps inside one step window each pass the guard against the
  // other's intermediate value and sum to a self-reversing step (the snake folds
  // into its neck). `s.gridStep` is the heading actually stepped last; it only
  // changes when a step fires, so only the committed heading counts.
  const stepped = (s.gridStep ??= { x: dir.x, y: dir.y }) as Dir;

  // Read intent; reject reversals in continuous mode (can't fold the snake back).
  // With `moveAction` intent comes from the logical-action VECTOR — keyboard axis OR
  // a touch d-pad zone, unified — and the dominant axis is the heading; an axis tie
  // resolves to vertical, preserving the key path's up/down>left/right precedence.
  // Without it, the first-match key reading.
  const moveAction = str(params, "moveAction", "");
  let want: Dir | null = null;
  if (moveAction) {
    const v = world.input.actionVector(moveAction);
    const TURN_DEADZONE = 0.3; // structural: ignore tiny analog drift, not balance
    if (Math.abs(v.x) > Math.abs(v.y)) {
      if (Math.abs(v.x) > TURN_DEADZONE) want = { x: Math.sign(v.x), y: 0 };
    } else if (Math.abs(v.y) > TURN_DEADZONE) {
      want = { x: 0, y: Math.sign(v.y) };
    }
  } else if (world.input.anyDown(up)) want = { x: 0, y: -1 };
  else if (world.input.anyDown(down)) want = { x: 0, y: 1 };
  else if (world.input.anyDown(left)) want = { x: -1, y: 0 };
  else if (world.input.anyDown(right)) want = { x: 1, y: 0 };

  if (want) {
    const reverses = want.x === -stepped.x && want.y === -stepped.y && (stepped.x !== 0 || stepped.y !== 0);
    if (!(continuous && reverses)) {
      dir.x = want.x;
      dir.y = want.y;
    }
  }

  const timer = ((s.gridTimer as number) ?? 0) + dt;
  if (timer < stepInterval) {
    s.gridTimer = timer;
    return;
  }
  s.gridTimer = timer - stepInterval;

  const stepping = continuous ? dir.x !== 0 || dir.y !== 0 : !!want;
  if (!stepping) return;

  // Record the heading we actually step in — this is what the next window's
  // reversal guard compares against.
  stepped.x = dir.x;
  stepped.y = dir.y;

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
