import type { Scene } from "./scene.js";
import { DEFAULT_SCENE_SIZE } from "./scene.js";
import type { EntityDef } from "./entity.js";
import type { SystemDef } from "./system.js";

/**
 * Scene inheritance. A scene with `extends: "<baseId>"` inherits the
 * base scene's shared stage and overlays its own content, so a multi-level game
 * authors the common shell (paddle, ball, the system stack, HUD) ONCE and each
 * level declares only what differs (its layout + a `$cfg` difficulty slice).
 *
 * The merge is ADDITIVE and id-keyed:
 *  - `entities`: base entities first (in base order), then the child's. A child
 *    entity whose `id` matches a base entity REPLACES it in place; new ids append.
 *  - `systems`: same rule keyed on the optional system `id`; an id-less child system
 *    always appends (so a level can add a system without disturbing the base stack).
 *  - `size`: the child's, unless the child left it at the schema default
 *    ({@link DEFAULT_SCENE_SIZE}) while the base set a different size — then the
 *    base's is inherited. (The 800x600 default is indistinguishable from "unset"
 *    after Zod parsing, so a child that genuinely wants the default while the base
 *    differs must set the base's default instead — documented edge.)
 *  - `world`/`tilemap`/`background`/`music`/`flow`: the child's when present, else the base's.
 *  - `id`/`extends`: always the child's own (the resolved scene keeps its identity).
 *
 * Chains (`A extends B extends C`) resolve bottom-up with a cycle guard. The result
 * carries no `extends`, so the runtime and renderer see fully-resolved scenes and
 * never need to know inheritance exists.
 */
export function resolveSceneInheritance(scenes: Scene[]): Scene[] {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const cache = new Map<string, Scene>();

  const resolve = (scene: Scene, chain: string[]): Scene => {
    if (!scene.extends) return scene;
    const cached = cache.get(scene.id);
    if (cached) return cached;
    if (chain.includes(scene.id)) {
      throw new Error(`scene inheritance cycle: ${[...chain, scene.id].join(" -> ")}`);
    }
    const baseDef = byId.get(scene.extends);
    if (!baseDef) {
      throw new Error(`scene "${scene.id}" extends unknown scene "${scene.extends}"`);
    }
    const base = resolve(baseDef, [...chain, scene.id]);
    const merged = mergeScene(base, scene);
    cache.set(scene.id, merged);
    return merged;
  };

  return scenes.map((s) => resolve(s, []));
}

/**
 * Overlay `child` onto its resolved `base` per the rules in
 * {@link resolveSceneInheritance}. Defensive about absent fields: a child authored
 * in `extends` form naturally omits `size`/`entities`/`systems` (and a hand-built
 * scene passed straight to `new Game` may skip Zod defaults), so a missing array is
 * treated as empty and a missing `size` inherits the base's.
 */
function mergeScene(base: Scene, child: Scene): Scene {
  return {
    ...base,
    ...child,
    // `extends` is fully resolved away; blank it so a resolved scene is never
    // re-resolved (and a downstream re-parse stays valid).
    extends: undefined,
    id: child.id,
    entities: mergeById(base.entities ?? [], child.entities ?? [], (e) => e.id),
    systems: mergeById(base.systems ?? [], child.systems ?? [], (s) => s.id),
    size: resolveSize(base.size, child.size),
    // World bounds: the child's if it set them, else the base's — so a level
    // shell can declare the scrollable world size once and each level inherits it.
    world: child.world ?? base.world,
    tilemap: child.tilemap ?? base.tilemap,
    background: child.background ?? base.background,
    music: child.music ?? base.music,
    flow: child.flow ?? base.flow,
  };
}

/**
 * The child's `size`, unless it is absent or left at the schema default
 * ({@link DEFAULT_SCENE_SIZE}) while the base set a different size — then the base's
 * is inherited. (The 800x600 default is indistinguishable from "unset" after Zod
 * parsing, so a child that genuinely wants the default while the base differs must
 * set the base's value instead — a documented edge.)
 */
function resolveSize(baseSize: Scene["size"] | undefined, childSize: Scene["size"] | undefined): Scene["size"] {
  if (!childSize) return baseSize as Scene["size"];
  if (!baseSize) return childSize;
  const childIsDefault =
    childSize.width === DEFAULT_SCENE_SIZE.width && childSize.height === DEFAULT_SCENE_SIZE.height;
  const baseDiffers =
    baseSize.width !== DEFAULT_SCENE_SIZE.width || baseSize.height !== DEFAULT_SCENE_SIZE.height;
  return childIsDefault && baseDiffers ? baseSize : childSize;
}

/**
 * Merge two arrays of defs keyed on an optional id: base items first (in order),
 * a child item with a matching id replaces the base item IN PLACE, and child items
 * with a new id (or no id) append in child order. Used for both entities and systems.
 */
function mergeById<T extends EntityDef | SystemDef>(
  base: T[],
  child: T[],
  keyOf: (item: T) => string | undefined,
): T[] {
  const result = [...base];
  const indexByKey = new Map<string, number>();
  base.forEach((item, i) => {
    const k = keyOf(item);
    if (k !== undefined) indexByKey.set(k, i);
  });
  for (const item of child) {
    const k = keyOf(item);
    const at = k !== undefined ? indexByKey.get(k) : undefined;
    if (at !== undefined) result[at] = item;
    else result.push(item);
  }
  return result;
}
