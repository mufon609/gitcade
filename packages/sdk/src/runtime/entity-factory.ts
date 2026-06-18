import type { EntityDef } from "../schema/entity.js";
import type { Config } from "../schema/config.js";
import { Entity, type BehaviorInstance } from "./entity.js";
import type { Registry } from "./registry.js";
import { resolveParams } from "./params.js";

/**
 * Build a live {@link Entity} from its JSON definition, resolving every behavior's
 * `$cfg` params and binding it to its registered implementation. Used both at
 * scene load and at runtime by `world.spawn`. Kept dependency-free of `World` so
 * the runtime modules form an acyclic graph.
 *
 * Throws if a behavior `type` is not registered — the validator catches this
 * statically, so at runtime it indicates a missing library/custom registration.
 */
export function buildEntity(def: EntityDef, registry: Registry, config: Config): Entity {
  const entity = new Entity({
    id: def.id,
    x: def.position.x,
    y: def.position.y,
    w: def.size.w,
    h: def.size.h,
    layer: def.layer,
    zIndex: def.zIndex,
    rotation: def.rotation,
    scale: def.scale,
    opacity: def.opacity,
    visible: def.visible,
    tags: def.tags,
    sprite: def.sprite,
    state: def.state ? { ...def.state } : {},
  });

  let i = 0;
  for (const b of def.behaviors) {
    const reg = registry.getBehavior(b.type);
    if (!reg) {
      throw new Error(`unknown behavior type "${b.type}" on entity "${def.id}"`);
    }
    const instance: BehaviorInstance = {
      id: b.id ?? `${def.id}:${b.type}:${i++}`,
      type: b.type,
      fn: reg.fn,
      params: resolveParams(b.params, config),
    };
    entity.addBehavior(instance);
  }

  return entity;
}
