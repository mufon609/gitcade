import type { SystemFn, ActionBinding } from "@gitcade/sdk";

/**
 * `input-actions` — installs the scene's logical input-ACTION bindings into the
 * SDK input layer, so movers can read `world.input.action(name)` /
 * `actionVector(name)` and ONE action is satisfiable by keyboard OR an on-screen
 * rect/zone. This is the data part that lets a game DELETE its synthesized-
 * `KeyboardEvent` touch glue: bind an action to a key for desktop AND a zone/rect for
 * touch, then point the mover at the action name.
 *
 * It runs as a SYSTEM (systems run before behaviors in the frozen tick order), so the
 * bindings are always in place by the time a mover reads them — even on the first tick
 * after a scene load (`Game.loadScene` clears the scene-scoped bindings; this re-installs
 * them). Re-applying every tick is idempotent and needs no listener/restart-safety
 * bookkeeping. Idle headless (no pointers), so the smoke boot is unaffected.
 *
 * Params:
 *  - `bindings`: `Record<actionName, { keys?, rect?, axisKeys?, zone? }>`. All numeric
 *    leaves use the structural `x`/`y`/`w`/`h`/`radius` keys, so the binding is plain
 *    data that passes the validator with no `$cfg` indirection. An empty map is a no-op.
 */
export const inputActions: SystemFn = (world, params) => {
  const bindings = params.bindings;
  if (bindings && typeof bindings === "object" && !Array.isArray(bindings)) {
    world.input.defineActions(bindings as Record<string, ActionBinding>);
  }
};
