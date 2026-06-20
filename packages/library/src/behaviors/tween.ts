import type { BehaviorFn, Entity } from "@gitcade/sdk";
import { num, str } from "@gitcade/sdk";

/**
 * `tween` — animate one numeric entity property from a start value to a target over a
 * duration with an easing curve. The data path to the small
 * motions that read as "juice": a coin pop (`scale` with `out-back` overshoot), a bobbing
 * pickup (`y`, `pingpong`), a fade-in (`opacity`), a menu slide-in (`x`), a pulsing beacon
 * (`scale`, `loop`). Auto-starts when the behavior begins; pure per-tick math off `dt`
 * (no RNG/IO), so determinism + the frozen tick order hold.
 *
 * It drives the renderer-honored transform/visual slots — `x`/`y` (position), `scaleX`/
 * `scaleY`/`scale` (uniform), `rotation`, and `opacity` (clamped 0..1). Visual/positional
 * only; collision uses the base AABB, so a scale/rotation tween
 * is purely cosmetic. State is namespaced by `property` (`__tw_<property>_*`), so a tween
 * of `x` and a tween of `opacity` on the same entity don't collide — but two tweens of the
 * SAME property fight, which is nonsensical anyway.
 *
 * `from` defaults to the property's value when the tween first runs, so a tween "from where
 * it is now" needs no `from`. `loop` modes:
 *  - `none` (default): run once, then HOLD at `to`.
 *  - `loop`: restart from `from` each cycle.
 *  - `pingpong`: ride a triangle wave from→to→from→… (a pulse/bob).
 *
 * Params (`property`/`easing`/`loop` are structural; `from`/`to` are whitelisted; `duration`
 * /`delay` are balance → `$cfg`):
 *  - `property`: `x`|`y`|`scaleX`|`scaleY`|`scale`|`rotation`|`opacity` (default `opacity`)
 *  - `to`: target value (default 0)
 *  - `from`: start value (default = the property's current value when the tween starts)
 *  - `duration`: seconds for one from→to pass (default 1; clamped to ≥ a tiny epsilon)
 *  - `delay`: seconds to wait before starting (default 0)
 *  - `easing`: `linear`|`in-quad`|`out-quad`|`in-out-quad`|`out-back` (default `linear`)
 *  - `loop`: `none`|`loop`|`pingpong` (default `none`)
 */
export const tween: BehaviorFn = (entity, _world, params, dt) => {
  const property = str(params, "property", "opacity");
  const to = num(params, "to", 0);
  const fromParam = num(params, "from", NaN);
  const duration = Math.max(1e-6, num(params, "duration", 1));
  const delay = num(params, "delay", 0);
  const easing = str(params, "easing", "linear");
  const loop = str(params, "loop", "none");

  const elKey = `__tw_${property}_el`;
  const fromKey = `__tw_${property}_from`;

  // First run: capture the start value (explicit `from`, else the property's current value).
  if (entity.state[fromKey] === undefined) {
    entity.state[fromKey] = Number.isNaN(fromParam) ? getProp(entity, property) : fromParam;
    entity.state[elKey] = 0;
  }
  const from = entity.state[fromKey] as number;

  let el = ((entity.state[elKey] as number) ?? 0) + dt;
  entity.state[elKey] = el;

  // Honor the start delay (hold at `from` until it elapses).
  el -= delay;
  if (el <= 0) {
    setProp(entity, property, from);
    return;
  }

  // Progress 0..1 in the current cycle, per loop mode.
  let p: number;
  if (loop === "loop") {
    p = (el / duration) % 1;
  } else if (loop === "pingpong") {
    const phase = (el / duration) % 2;
    p = phase <= 1 ? phase : 2 - phase; // triangle wave 0→1→0
  } else {
    p = Math.min(el / duration, 1); // none: clamp + hold at the end
  }

  setProp(entity, property, from + (to - from) * applyEasing(easing, p));
};

function applyEasing(name: string, t: number): number {
  switch (name) {
    case "in-quad":
      return t * t;
    case "out-quad":
      return t * (2 - t);
    case "in-out-quad":
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case "out-back": {
      // A small overshoot past the target then settle — the springy "pop".
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const x = t - 1;
      return 1 + c3 * x * x * x + c1 * x * x;
    }
    case "linear":
    default:
      return t;
  }
}

function getProp(entity: Entity, property: string): number {
  switch (property) {
    case "x":
      return entity.x;
    case "y":
      return entity.y;
    case "scaleX":
    case "scale":
      return entity.scaleX;
    case "scaleY":
      return entity.scaleY;
    case "rotation":
      return entity.rotation;
    case "opacity":
      return entity.opacity;
    default:
      return 0;
  }
}

function setProp(entity: Entity, property: string, v: number): void {
  switch (property) {
    case "x":
      entity.x = v;
      break;
    case "y":
      entity.y = v;
      break;
    case "scaleX":
      entity.scaleX = v;
      break;
    case "scaleY":
      entity.scaleY = v;
      break;
    case "scale":
      entity.scaleX = v;
      entity.scaleY = v;
      break;
    case "rotation":
      entity.rotation = v;
      break;
    case "opacity":
      entity.opacity = Math.max(0, Math.min(1, v));
      break;
  }
}
