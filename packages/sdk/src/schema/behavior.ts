import { z } from "zod";
import { ParamsSchema } from "./params.js";

/**
 * A behavior INSTANCE attached to an entity, as authored in JSON.
 *
 * - `type` names a registered behavior (built-in, or a Phase 2 library part, or a
 *   project-local `custom-behaviors/` part). The runtime looks the type up in the
 *   behavior registry to find the {@link BehaviorFn} implementation.
 * - `params` carries the per-instance configuration. Numeric balance values MUST
 *   be `$cfg` references (enforced by the validator); structural numbers may be
 *   literals (see the whitelist).
 * - `id` is an optional stable instance id (auto-generated if omitted) used for
 *   runtime attach/detach.
 * - `part` optionally records catalog provenance (`"partId@1.2.0"`) so the
 *   validator can verify it resolves within the pinned `libraryVersion`.
 *
 * This `{ id, type, params }` shape is FROZEN at the end of Phase 1.
 */
export const BehaviorDefSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  params: ParamsSchema.default({}),
  part: z.string().optional(),
});

export type BehaviorDef = z.infer<typeof BehaviorDefSchema>;
