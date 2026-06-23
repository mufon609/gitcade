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
    screen: def.screen,
    tags: def.tags,
    sprite: def.sprite,
    state: def.state ? { ...def.state } : {},
    // Scene-graph link: `parent` + `local` seed the runtime parenting fields; the
    // hierarchy phase derives this entity's world transform from the parent each tick.
    parentId: def.parent,
    local: def.local,
  });

  // Resolve the authored `collider` onto the body — defaults are already applied by the
  // schema, so this just mirrors it into the runtime component the resolution phase reads. Absent
  // ⇒ left undefined, so `World.resolveBodies` skips this entity (byte-identical arcade scene).
  if (def.collider) {
    entity.body.collider = {
      role: def.collider.role,
      oneWay: def.collider.oneWay,
      carriable: def.collider.carriable,
      pushable: def.collider.pushable,
      mass: def.collider.mass,
      inset: { x: def.collider.inset.x, y: def.collider.inset.y },
      // Mirror stepHeight ONLY when set (>0): an absent key keeps the runtime collider — and so the
      // snapshot + the committed determinism golden — byte-identical for every body that doesn't opt in.
      ...(def.collider.stepHeight > 0 ? { stepHeight: def.collider.stepHeight } : {}),
    };
  }

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
      scratch: {},
    };
    entity.addBehavior(instance);
  }

  return entity;
}
