import { z } from "zod";
import { ParamsSchema } from "./params.js";

/**
 * A system INSTANCE for a scene, as authored in JSON. Systems operate on the
 * whole world each tick (collision detection, HUD, win/lose checks, spawners),
 * whereas behaviors are attached to a single entity.
 *
 * Same `{ id, type, params }` shape as a behavior; `type` names a registered
 * system implementation ({@link SystemFn}). FROZEN at the end of Phase 1.
 */
export const SystemDefSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  params: ParamsSchema.default({}),
  part: z.string().optional(),
});

export type SystemDef = z.infer<typeof SystemDefSchema>;
