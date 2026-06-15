import type { BehaviorFn, Registry, SystemFn, World } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `snake-body` — the one mechanic Snake needs that no @gitcade/library part
 * provides: a trailing body that follows the head's path cell-by-cell, grows when
 * food is eaten, ends the run on a self- or wall-collision, and keeps exactly one
 * food pickup on a free cell. It is written param-driven (all balance via `$cfg`,
 * all geometry structural) and is logged in games/LIBRARY-GAPS.md as a
 * generalization candidate ("path-history follower / trailing body" +
 * "respawn-pickup-on-free-cell").
 *
 * It is a SYSTEM (not a per-entity behavior) because it owns several entities at
 * once — the body segments and the food — and the head's grid stepping
 * (`move-grid-step`) emits no position it can hang a single behavior off of.
 *
 * Params:
 *  - `headTag` / `segmentTag` / `foodTag`: entity tags (structural ids)
 *  - `tileSize`: cell size in px (structural; must match the head's move-grid-step)
 *  - `startLength`: initial body segment count (balance → `$cfg`)
 *  - `growBy`: segments added per food eaten (balance → `$cfg`)
 *  - `startDir`: `{ x, y }` initial heading (structural)
 *  - `eatEvent`: event emitted by the food's collect-on-touch (default "collect")
 *  - `gameOverEvent`: event emitted on death (default "gameover")
 *  - `segmentPrototype`: entity-definition cloned for each body segment (structural)
 *  - `foodPrototype`: entity-definition cloned when respawning food (structural)
 */
interface SnakeScratch {
  init: boolean;
  cells: Array<{ x: number; y: number }>; // head-first pixel positions (tile-snapped)
  target: number; // desired total body length
  lastCell: { x: number; y: number } | null;
  lastScore: number; // for poll-based growth (no event listener — restart-safe)
  segIds: string[];
  seq: number;
  dead: boolean;
}

export const snakeBody: SystemFn = (world, params, _dt) => {
  const headTag = str(params, "headTag", "head");
  const segmentTag = str(params, "segmentTag", "snake-body");
  const foodTag = str(params, "foodTag", "food");
  const tile = num(params, "tileSize", 20);
  const growBy = num(params, "growBy", 1);
  const gameOverEvent = str(params, "gameOverEvent", "gameover");
  const stateKey = str(params, "stateKey", "__snake");

  const s = (world.state[stateKey] ??= freshScratch(num(params, "startLength", 3))) as SnakeScratch;
  if (s.dead) return;

  const head = world.query(headTag)[0];
  if (!head) return;

  // One-time init: seed heading + the first food.
  if (!s.init) {
    s.init = true;
    const dir = (params.startDir ?? { x: 1, y: 0 }) as { x: number; y: number };
    if (!head.state.__gridDir || isZero(head.state.__gridDir)) {
      head.state.__gridDir = { x: dir.x, y: dir.y };
    }
    s.cells = [{ x: head.x, y: head.y }];
    s.lastCell = { x: head.x, y: head.y };
    s.lastScore = (world.state[str(params, "scoreKey", "score")] as number) ?? 0;
    spawnFood(world, params, foodTag, tile, s);
  }

  // Poll-based growth: each food eaten raises the score by `foodValue`; grow one
  // segment per food. Polling (not an event listener) keeps this restart-safe —
  // loadScene clears world.state but not the event bus, so a re-attached listener
  // would double-count.
  const scoreKey = str(params, "scoreKey", "score");
  const foodValue = num(params, "foodValue", 1);
  const score = (world.state[scoreKey] as number) ?? 0;
  if (foodValue > 0 && score > s.lastScore) {
    s.target += growBy * Math.round((score - s.lastScore) / foodValue);
    s.lastScore = score;
  }

  // Detect a fresh head cell (the head moved this/last tick).
  const hx = Math.round(head.x / tile) * tile;
  const hy = Math.round(head.y / tile) * tile;
  if (!s.lastCell || hx !== s.lastCell.x || hy !== s.lastCell.y) {
    s.lastCell = { x: hx, y: hy };

    // Wall collision (head left the play field).
    if (hx < 0 || hy < 0 || hx + head.w > world.bounds.width || hy + head.h > world.bounds.height) {
      return die(world, s, gameOverEvent);
    }
    // Self collision (new head cell lands on an existing body cell).
    for (let i = 1; i < s.cells.length && i < s.target; i++) {
      if (s.cells[i]!.x === hx && s.cells[i]!.y === hy) {
        return die(world, s, gameOverEvent);
      }
    }

    s.cells.unshift({ x: hx, y: hy });
    if (s.cells.length > s.target + 1) s.cells.length = s.target + 1;
    syncSegments(world, params, segmentTag, s);
  }

  // Keep exactly one food on the board.
  if (world.query(foodTag).length === 0) spawnFood(world, params, foodTag, tile, s);
};

/**
 * `snake-guard` — a head behavior placed AFTER `move-grid-step` in the head's
 * behaviors array, so it observes the head's freshly-stepped position in the SAME
 * tick the step happens. The `snake-body` SYSTEM runs *before* all behaviors
 * (frozen tick order: systems → behaviors), so its own wall/self check necessarily
 * acts on a one-step-stale head and only fires the tick AFTER the head has already
 * stepped off the field — the S3 "death one step late / head off-screen" defect.
 *
 * This guard ends the run the instant a step carries the head into a wall or its
 * own body and clamps the head back to its last committed (on-screen) cell, so the
 * head never visibly leaves the field. It reads the same `world.state[stateKey]`
 * body cells the system maintains. It deliberately does NOT replace `snake-body`'s
 * own death check: because the guard sets `s.dead` first, the system simply stops,
 * but the system remains the backstop for any path that reaches a fatal cell
 * without this behavior (e.g. a scene that omits it).
 *
 * Note this reads the POST-step (and post-turn) position, so a player who turns
 * away from a wall on the same step is NOT falsely killed — a hazard any
 * predict-before-the-step approach in the system would hit, since the turn is
 * applied inside `move-grid-step`, which runs after the system.
 *
 * Params: `stateKey` (must match snake-body), `tileSize` (structural),
 *  `gameOverEvent` (event emitted on death).
 */
export const snakeGuard: BehaviorFn = (head, world, params, _dt) => {
  const stateKey = str(params, "stateKey", "__snake");
  const s = world.state[stateKey] as SnakeScratch | undefined;
  if (!s || !s.init || s.dead) return;

  const tile = num(params, "tileSize", 20);
  const gameOverEvent = str(params, "gameOverEvent", "gameover");

  const qx = Math.round(head.x / tile) * tile;
  const qy = Math.round(head.y / tile) * tile;

  // Wall: the step carried the head off the play field.
  const wall =
    qx < 0 || qy < 0 || qx + head.w > world.bounds.width || qy + head.h > world.bounds.height;

  // Self: the new head cell overlaps a body cell that will NOT vacate this step.
  // The tail (index `s.target`) vacates as the body advances, so it is excluded —
  // exactly the bound `snake-body`'s own self-check uses.
  let self = false;
  for (let i = 1; i < s.cells.length && i < s.target; i++) {
    if (s.cells[i]!.x === qx && s.cells[i]!.y === qy) {
      self = true;
      break;
    }
  }

  if (wall || self) {
    const last = s.cells[0]; // last committed (on-screen) head cell
    if (last) {
      head.x = last.x;
      head.y = last.y;
    }
    die(world, s, gameOverEvent);
  }
};

function freshScratch(startLength: number): SnakeScratch {
  return { init: false, cells: [], target: startLength, lastCell: null, lastScore: 0, segIds: [], seq: 0, dead: false };
}

function isZero(d: unknown): boolean {
  const v = d as { x?: number; y?: number };
  return !v || ((v.x ?? 0) === 0 && (v.y ?? 0) === 0);
}

function die(world: World, s: SnakeScratch, event: string): void {
  s.dead = true;
  world.state.gameOver = true;
  world.state.outcome = "lose";
  world.audio.play("explode");
  world.events.emit(event, { outcome: "lose", by: "snake-collision" });
}

/** Reconcile body-segment entities to the trailing cells (cells[1..]). */
function syncSegments(world: World, params: Record<string, unknown>, segmentTag: string, s: SnakeScratch): void {
  const bodyCells = s.cells.slice(1); // cells[0] is the head's own cell
  // Grow.
  while (s.segIds.length < bodyCells.length) {
    const proto = clone(params.segmentPrototype) as Record<string, unknown>;
    const id = `seg.${s.seq++}`;
    proto.id = id;
    proto.position = { x: 0, y: 0 };
    proto.tags = uniqueTags(proto.tags, segmentTag);
    const e = world.spawn(proto as never);
    e.x = -100;
    e.y = -100;
    s.segIds.push(id);
  }
  // Shrink.
  while (s.segIds.length > bodyCells.length) {
    const id = s.segIds.pop()!;
    const e = world.byId(id);
    if (e) world.destroy(e);
  }
  // Reposition.
  for (let i = 0; i < bodyCells.length; i++) {
    const e = world.byId(s.segIds[i]!);
    if (e) {
      e.x = bodyCells[i]!.x;
      e.y = bodyCells[i]!.y;
    }
  }
}

/** Spawn one food pickup on a random cell not currently occupied by the snake. */
function spawnFood(
  world: World,
  params: Record<string, unknown>,
  foodTag: string,
  tile: number,
  s: SnakeScratch,
): void {
  const cols = Math.floor(world.bounds.width / tile);
  const rows = Math.floor(world.bounds.height / tile);
  const occupied = new Set(s.cells.map((c) => `${c.x},${c.y}`));

  // S2: also exclude the cell the head is about to enter THIS step. `move-grid-step`
  // (the head's behavior) runs AFTER this system in the frozen tick order
  // (systems → behaviors), so the head entity is up to one cell ahead of
  // `s.cells[0]`. Food dropped on that imminent cell would be eaten next tick for an
  // unearned point plus a one-frame flicker.
  const head = world.query(str(params, "headTag", "head"))[0];
  if (head) {
    const dir = (head.state.__gridDir ?? { x: 0, y: 0 }) as { x: number; y: number };
    const hx = Math.round(head.x / tile) * tile;
    const hy = Math.round(head.y / tile) * tile;
    occupied.add(`${hx + (dir.x ?? 0) * tile},${hy + (dir.y ?? 0) * tile}`);
  }

  let x = 0;
  let y = 0;
  let placed = false;
  for (let tries = 0; tries < 64; tries++) {
    x = Math.floor(world.rng() * cols) * tile;
    y = Math.floor(world.rng() * rows) * tile;
    if (!occupied.has(`${x},${y}`)) {
      placed = true;
      break;
    }
  }
  // S4: random retries exhausted (near-full board) — scan deterministically for the
  // first free cell rather than risk placing food on the snake. Unreachable at normal
  // length (40×30 = 1200 cells), but makes the fallback correct instead of "give up".
  if (!placed) {
    for (let gy = 0; gy < rows && !placed; gy++) {
      for (let gx = 0; gx < cols && !placed; gx++) {
        const cx = gx * tile;
        const cy = gy * tile;
        if (!occupied.has(`${cx},${cy}`)) {
          x = cx;
          y = cy;
          placed = true;
        }
      }
    }
  }
  // If `placed` is still false the board is genuinely full (a win far beyond normal
  // play); fall through with the last random pick.

  const proto = clone(params.foodPrototype) as Record<string, unknown>;
  proto.id = `food.${s.seq++}`;
  proto.position = { x, y };
  proto.tags = uniqueTags(proto.tags, foodTag);
  world.spawn(proto as never);
}

function uniqueTags(existing: unknown, required: string): string[] {
  const set = new Set<string>(Array.isArray(existing) ? (existing as string[]) : []);
  set.add(required);
  return [...set];
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Register this game's custom parts onto its registry. */
export function registerCustomBehaviors(registry: Registry): void {
  registry.registerSystem("snake-body", snakeBody);
  registry.registerBehavior("snake-guard", snakeGuard);
}
