import type { BehaviorFn, Registry, SystemFn, World } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `snake-body` — the one mechanic Snake needs that no @gitcade/library part
 * provides: a trailing body that follows the head's path cell-by-cell, grows when
 * food is eaten, and ends the run on a self- or wall-collision. It is written
 * param-driven (all balance via `$cfg`, all geometry structural). A path-history
 * follower / trailing body.
 *
 * It is a SYSTEM (not a per-entity behavior) because it owns several entities at
 * once — the body segments — and the head's grid stepping (`move-grid-step`) emits
 * no position it can hang a single behavior off of.
 *
 * Food placement is delegated to the library `place-on-free-cell` system: this system
 * only keeps the "exactly one food on the board" invariant, emitting `placeEvent`
 * whenever the board has no food (covers both the first food and every respawn after
 * an eat). The shared `snake-cell` tag on the head + segments is what
 * `place-on-free-cell` excludes, so food never lands on the snake.
 *
 * Params:
 *  - `headTag` / `segmentTag` / `foodTag`: entity tags (structural ids)
 *  - `placeEvent`: event emitted to request a food placement (default "place-food")
 *  - `tileSize`: cell size in px (structural; must match the head's move-grid-step)
 *  - `startLength`: initial body segment count (balance → `$cfg`)
 *  - `growBy`: segments added per food eaten (balance → `$cfg`)
 *  - `startDir`: `{ x, y }` initial heading (structural)
 *  - `gameOverEvent`: event emitted on death (default "gameover")
 *  - `segmentPrototype`: entity-definition cloned for each body segment (structural)
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
  imminentId: string | null; // the marker entity at the head's NEXT cell
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

  // Keep an invisible marker on the cell the head is about to step into, so
  // `place-on-free-cell` (passed excludeTags:["imminent"]) never drops food on the
  // single predicted cell — without it, the head can instantly re-eat into its next
  // step. The marker carries no collision/collect behavior and is NOT a `snake-cell`,
  // so it touches neither self-collision nor food pickup.
  const imminentTag = str(params, "imminentTag", "imminent");
  const dir = (head.state.__gridDir ?? { x: 1, y: 0 }) as { x: number; y: number };
  const nextX = Math.round(head.x / tile) * tile + dir.x * tile;
  const nextY = Math.round(head.y / tile) * tile + dir.y * tile;
  let marker = s.imminentId ? world.byId(s.imminentId) : null;
  if (!marker) {
    marker = world.spawn({
      id: `imminent.${headTag}`,
      sprite: { kind: "none" },
      size: { w: tile, h: tile },
      position: { x: nextX, y: nextY },
      tags: [imminentTag],
      layer: 0,
      behaviors: [],
    } as never);
    s.imminentId = marker.id;
  } else {
    marker.x = nextX;
    marker.y = nextY;
  }

  // One-time init: seed heading. The first food is requested by the "keep exactly
  // one food" check below (board starts empty), so init no longer places it.
  if (!s.init) {
    s.init = true;
    const dir = (params.startDir ?? { x: 1, y: 0 }) as { x: number; y: number };
    if (!head.state.__gridDir || isZero(head.state.__gridDir)) {
      head.state.__gridDir = { x: dir.x, y: dir.y };
    }
    s.cells = [{ x: head.x, y: head.y }];
    s.lastCell = { x: head.x, y: head.y };
    s.lastScore = (world.state[str(params, "scoreKey", "score")] as number) ?? 0;
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

  // Keep exactly one food on the board. Placement geometry is delegated to the
  // library `place-on-free-cell` system — we only request a drop when the board is
  // empty (the first food, and each respawn after an eat). The handler excludes every
  // live `snake-cell` (head + segments) by construction, so food never lands on the
  // snake.
  if (world.query(foodTag).length === 0) {
    world.events.emit(str(params, "placeEvent", "place-food"));
  }
};

/**
 * `snake-guard` — a head behavior placed AFTER `move-grid-step` in the head's
 * behaviors array, so it observes the head's freshly-stepped position in the SAME
 * tick the step happens. The `snake-body` SYSTEM runs *before* all behaviors
 * (frozen tick order: systems → behaviors), so its own wall/self check necessarily
 * acts on a one-step-stale head and only fires the tick AFTER the head has already
 * stepped off the field — which would show the head a step past death, off-screen.
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
  return { init: false, cells: [], target: startLength, lastCell: null, lastScore: 0, segIds: [], seq: 0, dead: false, imminentId: null };
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
