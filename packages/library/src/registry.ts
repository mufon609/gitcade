import { createDefaultRegistry, type Registry } from "@gitcade/sdk";
import { registerLibraryBehaviors } from "./behaviors/index.js";
import { registerLibrarySystems } from "./systems/index.js";
import { registerLibraryFx } from "./fx/index.js";
import { registerLibraryUi } from "./ui/index.js";

/**
 * Register every `@gitcade/library` behavior and system TYPE onto an existing
 * registry. This is the sanctioned extension path from the FROZEN SDK: it only
 * calls `registry.registerBehavior` / `registry.registerSystem`, never touches
 * the SDK schema, and never mutates the SDK's built-in registry in place. Returns
 * the same registry for chaining.
 *
 * @example
 * const registry = createDefaultRegistry().clone();
 * registerLibrary(registry);
 */
export function registerLibrary(registry: Registry): Registry {
  registerLibraryBehaviors(registry);
  registerLibrarySystems(registry);
  registerLibraryFx(registry);
  registerLibraryUi(registry);
  return registry;
}

/**
 * A fresh registry preloaded with the SDK built-ins PLUS the full component
 * library. This is what an ecosystem game (or a reuse-proof demo) constructs to
 * resolve `partId` types like `ai-chase` or `wave-spawner` at runtime, then
 * passes to `createGame({ ... }, { registry })`.
 */
export function createLibraryRegistry(): Registry {
  return registerLibrary(createDefaultRegistry());
}
