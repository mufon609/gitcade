import type { Registry } from "@gitcade/sdk";
import { hudBar } from "./hud.js";
import { touchDpad, touchButton, tapEmit } from "./touch.js";

/**
 * UI half of Phase 2B. Most HUD/menu widgets are pure DATA (entity/scene templates
 * catalogued under kind `ui`) that lean on SDK-frozen sprite features — `text`
 * sprites with a live `bind` for score/timer/wave readouts, `shape` rects for menus.
 * Only three need runtime code: the health/progress BAR and the two TOUCH controls.
 *
 * Registered on a SEPARATE map (like FX) so the catalog's behavior/system-kind
 * coverage check stays exact — these are catalogued as kind `ui`.
 */
export const LIBRARY_UI_BEHAVIORS = {
  "hud-bar": hudBar,
  "touch-dpad": touchDpad,
  "touch-button": touchButton,
  "tap-emit": tapEmit,
} as const;

/** UI part ids that are runtime types (the code-backed widgets). */
export const LIBRARY_UI_RUNTIME_TYPES = ["hud-bar", "touch-dpad", "touch-button", "tap-emit"] as const;

export function registerLibraryUi(registry: Registry): void {
  for (const [type, fn] of Object.entries(LIBRARY_UI_BEHAVIORS)) registry.registerBehavior(type, fn);
}

export { hudBar } from "./hud.js";
export { touchDpad, touchButton, tapEmit, dpadVector, buttonPressed, type PointerLike, type Zone, type Rect } from "./touch.js";
