import type { Registry } from "@gitcade/sdk";

import { move4dir } from "./move-4dir.js";
import { movePlatformer } from "./move-platformer.js";
import { moveTopdown360 } from "./move-topdown-360.js";
import { moveGridStep } from "./move-grid-step.js";
import { autoScroll } from "./auto-scroll.js";
import { followPath } from "./follow-path.js";
import { shoot } from "./shoot.js";
import { meleeSwing } from "./melee-swing.js";
import { contactDamage } from "./contact-damage.js";
import { healthAndDeath } from "./health-and-death.js";
import { aiChase } from "./ai-chase.js";
import { aiFlee } from "./ai-flee.js";
import { aiPatrol } from "./ai-patrol.js";
import { aiWander } from "./ai-wander.js";
import { aiAimAndFire } from "./ai-aim-and-fire.js";
import { collectOnTouch } from "./collect-on-touch.js";
import { triggerZone } from "./trigger-zone.js";
import { portal } from "./portal.js";
import { scaleByState } from "./scale-by-state.js";

/**
 * Every library behavior, keyed by the exact `type` string a scene/entity uses to
 * reference it. The id ↔ implementation mapping lives in one place so the catalog
 * (`parts/`), the registration call, and the runtime can never disagree.
 */
export const LIBRARY_BEHAVIORS = {
  "move-4dir": move4dir,
  "move-platformer": movePlatformer,
  "move-topdown-360": moveTopdown360,
  "move-grid-step": moveGridStep,
  "auto-scroll": autoScroll,
  "follow-path": followPath,
  shoot: shoot,
  "melee-swing": meleeSwing,
  "contact-damage": contactDamage,
  "health-and-death": healthAndDeath,
  "ai-chase": aiChase,
  "ai-flee": aiFlee,
  "ai-patrol": aiPatrol,
  "ai-wander": aiWander,
  "ai-aim-and-fire": aiAimAndFire,
  "collect-on-touch": collectOnTouch,
  "trigger-zone": triggerZone,
  portal: portal,
  "scale-by-state": scaleByState,
} as const;

/** The library behavior type ids (for tests / introspection). */
export const LIBRARY_BEHAVIOR_TYPES = Object.keys(LIBRARY_BEHAVIORS);

/** Register every library behavior TYPE onto a registry (never mutates the schema). */
export function registerLibraryBehaviors(registry: Registry): void {
  for (const [type, fn] of Object.entries(LIBRARY_BEHAVIORS)) {
    registry.registerBehavior(type, fn);
  }
}

export {
  move4dir,
  movePlatformer,
  moveTopdown360,
  moveGridStep,
  autoScroll,
  followPath,
  shoot,
  meleeSwing,
  contactDamage,
  healthAndDeath,
  aiChase,
  aiFlee,
  aiPatrol,
  aiWander,
  aiAimAndFire,
  collectOnTouch,
  triggerZone,
  portal,
  scaleByState,
};
