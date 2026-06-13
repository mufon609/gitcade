import { z } from "zod";

/**
 * A behavior/system parameter value as authored in JSON. Recursively one of:
 *  - a number   (allowed only under a whitelisted structural key; else use `$cfg`)
 *  - a string   (a literal like `"ArrowUp"`, or a `"$cfg.<path>"` reference)
 *  - a boolean
 *  - null
 *  - an array of param values
 *  - a nested object of param values
 *
 * The per-behavior-type meaning of each key is validated at registration time by
 * the type's own param schema; this base type just bounds the JSON shape so the
 * validator can mechanically walk params for the no-magic-numbers rule.
 */
export type ParamValue =
  | number
  | string
  | boolean
  | null
  | ParamValue[]
  | { [key: string]: ParamValue };

export const ParamValueSchema: z.ZodType<ParamValue> = z.lazy(() =>
  z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.null(),
    z.array(ParamValueSchema),
    z.record(z.string(), ParamValueSchema),
  ]),
);

/** A `params` block: a record of named parameters. Defaults to `{}`. */
export const ParamsSchema = z.record(z.string(), ParamValueSchema);
export type Params = z.infer<typeof ParamsSchema>;
