import type { Scene } from "./scene.js";
import { DEFAULT_SCENE_SIZE } from "./scene.js";
import type { EntityDef, EntityOverride } from "./entity.js";
import { EntityDefSchema } from "./entity.js";
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
 * After the shell merge, the scene's `overrides` apply FIELD-LEVEL patches onto the resolved entity
 * set (see {@link applyEntityOverrides}) — the granular companion to the wholesale id-merge above:
 * where the `entities` merge replaces an inherited entity whole, an override nudges a single field of
 * it (`{ id, position: { x: 100 } }` keeps the base `y`). Both `extends` and `overrides` are resolved
 * away — the result carries neither, so the runtime and renderer see fully-resolved scenes and never
 * need to know inheritance exists.
 *
 * Chains (`A extends B extends C`) resolve bottom-up with a cycle guard; each level's overrides apply
 * to the entities it inherited (a base's overrides are already baked into the base before a child
 * extends it).
 */
export function resolveSceneInheritance(scenes: Scene[]): Scene[] {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const cache = new Map<string, Scene>();

  const resolve = (scene: Scene, chain: string[]): Scene => {
    const cached = cache.get(scene.id);
    if (cached) return cached;

    // 1. Inheritance shell merge (a root scene is its own base).
    let merged = scene;
    if (scene.extends) {
      if (chain.includes(scene.id)) {
        throw new Error(`scene inheritance cycle: ${[...chain, scene.id].join(" -> ")}`);
      }
      const baseDef = byId.get(scene.extends);
      if (!baseDef) {
        throw new Error(`scene "${scene.id}" extends unknown scene "${scene.extends}"`);
      }
      const base = resolve(baseDef, [...chain, scene.id]);
      merged = mergeScene(base, scene);
    }

    // 2. Field-level entity overrides (no-op + same reference when the scene declares none, so a
    //    scene without overrides — every scene authored before this feature — resolves byte-identically).
    const final = applyEntityOverrides(merged, scene.id, scene.overrides);
    cache.set(scene.id, final);
    return final;
  };

  return scenes.map((s) => resolve(s, []));
}

/**
 * Apply a scene's `overrides` — field-level entity patches — onto its resolved entity set, addressing
 * each by `id`. Every patch DEEP-MERGES onto the entity with that id (nested objects recurse, so
 * `{ position: { x: 100 } }` keeps the base `y`; arrays and primitives replace; absent keys inherit),
 * and the merged entity is then re-parsed through the strict {@link EntityDefSchema}. The re-parse is
 * the safety net that lets the patch be a loose passthrough partial (see {@link EntityOverrideSchema}):
 * it rejects an unknown key (a typo), an invalid sprite-union merge, or an out-of-range value — turning
 * a broken patch into a clear resolve-time error instead of a corrupted frame.
 *
 * A patch whose id matches no resolved entity is IGNORED here (a runtime-robust no-op, mirroring how a
 * dangling `parent` silently orphans rather than crashes); the validator reports it as
 * `override-target-missing` so it never ships silently. Patches apply in author order, so two patches
 * to the same id accumulate. The result carries `overrides: undefined` — resolved away like `extends`.
 */
function applyEntityOverrides(
  scene: Scene,
  sceneId: string,
  overrides: EntityOverride[] | undefined,
): Scene {
  if (!overrides || overrides.length === 0) return scene;

  const indexById = new Map<string, number>();
  scene.entities.forEach((e, i) => indexById.set(e.id, i));

  const entities = scene.entities.slice();
  for (const patch of overrides) {
    const at = indexById.get(patch.id);
    if (at === undefined) continue; // dead patch — the validator flags it as override-target-missing
    const mergedEntity = deepMerge(entities[at], patch);
    const parsed = EntityDefSchema.safeParse(mergedEntity);
    if (!parsed.success) {
      const detail = parsed.error.errors
        .map((e) => `${e.path.join(".") || "<root>"}: ${e.message}`)
        .join("; ");
      throw new Error(`scene "${sceneId}": override for entity "${patch.id}" produced an invalid entity: ${detail}`);
    }
    entities[at] = parsed.data;
  }

  return { ...scene, entities, overrides: undefined };
}

/** True for a mergeable plain object: a non-null, non-array object (so nested shapes recurse but arrays replace). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `patch` onto `base`, returning a NEW value (never mutating either). Two plain objects
 * recurse key-by-key; anything else (a primitive, an array, or an object-replacing-a-primitive) is
 * taken from `patch`. This is the override semantics: nested entity shapes (`position`, `size`,
 * `sprite`, `state`, `collider`) merge per-leaf, while arrays (`behaviors`, `tags`) replace wholesale —
 * a patch that touches `behaviors` re-lists it, keeping the tick order it declares explicit.
 */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
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
    // `extends`/`overrides` are authoring-time constructs resolved away here: blank them so a resolved
    // scene is never re-resolved or re-patched (and a downstream re-parse stays valid). The child's own
    // `overrides` are still applied AFTER this merge — `applyEntityOverrides` reads them from the
    // original child scene, not from this stripped result.
    extends: undefined,
    overrides: undefined,
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
