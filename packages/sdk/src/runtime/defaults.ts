import { Registry } from "./registry.js";
import { registerBuiltinBehaviors } from "./behaviors/index.js";
import { registerBuiltinSystems } from "./systems/index.js";

/**
 * A fresh {@link Registry} preloaded with every built-in behavior/system type.
 * Each game gets its own registry instance (no shared global state), then a
 * game's `custom-behaviors/` and the library register additional types
 * onto a clone of it.
 */
export function createDefaultRegistry(): Registry {
  const registry = new Registry();
  registerBuiltinBehaviors(registry);
  registerBuiltinSystems(registry);
  return registry;
}
