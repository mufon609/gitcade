import { type Config, isCfgRef, cfgRefPath, resolveConfigPath } from "../schema/config.js";
import type { Params } from "../schema/params.js";
import type { ResolvedParams } from "./types.js";

/**
 * Deep-resolve a params block against `config.json`: every `"$cfg.<path>"` string
 * becomes its config value; everything else passes through. Done ONCE at scene
 * load so tick-time behavior code reads plain numbers.
 *
 * Throws if a `$cfg` reference does not resolve — the validator catches this
 * statically first, so at runtime an unresolved ref means a programming error.
 */
export function resolveParams(params: Params, config: Config): ResolvedParams {
  return deepResolve(params, config) as ResolvedParams;
}

function deepResolve(value: unknown, config: Config): unknown {
  if (isCfgRef(value)) {
    const resolved = resolveConfigPath(config, cfgRefPath(value));
    if (resolved === undefined) {
      throw new Error(`unresolved config reference: ${value}`);
    }
    return resolved;
  }
  if (Array.isArray(value)) return value.map((v) => deepResolve(v, config));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepResolve(v, config);
    }
    return out;
  }
  return value;
}

/**
 * The scalar param readers (`num`/`str`/`bool`) and {@link strArray} pull a value out of a
 * `$cfg`-resolved params block as the type the consuming part expects. They split apart two
 * cases that used to collapse into the same silent fallback:
 *
 *  - **absent** — the key is missing, or authored as `null` ("explicitly unset"). Returns the
 *    caller's default. This is the legitimate optional-param path; it is byte-identical to before,
 *    so every game that simply omits an optional param is unaffected.
 *  - **present but the WRONG type** — e.g. a string or boolean read by `num`. THROWS. This is
 *    always an authoring mistake, almost always a `"$cfg.<path>"` reference pointing at a
 *    config.json value of the wrong primitive type (config leaves are `number | string | boolean`).
 *    Silently coercing it to the default — a numeric param reading `0`, a flag reading `false` —
 *    hides a broken game behind one that boots, so it is surfaced loudly instead.
 *
 * Because behaviors run inside the validator's headless smoke boot (and a custom-part game's own
 * `npm test`), the throw is caught at the publish gate: a once-silent mismatch becomes a build
 * error rather than a 0 that ships. `$cfg` refs are already resolved to their primitive by
 * {@link resolveParams} before any of these run, so the originating path is no longer visible —
 * hence the generic "$cfg" hint in the message rather than the exact key.
 */
function readScalar(
  params: ResolvedParams,
  key: string,
  type: "number" | "string" | "boolean",
): number | string | boolean | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined; // absent → the caller's fallback
  if (typeof v !== type) {
    throw new Error(
      `param "${key}" must be a ${type}, but got ${formatValue(v)} — likely a "$cfg.<path>" ` +
        `reference resolving to a config.json value of the wrong type (a $cfg leaf is ` +
        `number | string | boolean and must match how the param is read)`,
    );
  }
  // Runtime-verified above; a dynamic `typeof v !== type` cannot narrow `unknown` for the compiler.
  return v as number | string | boolean;
}

/** Render a rejected param value for an error message: its runtime type + JSON form. */
function formatValue(v: unknown): string {
  const type = Array.isArray(v) ? "array" : typeof v;
  return `${type} (${JSON.stringify(v)})`;
}

/** Read a resolved param as a number; absent → `fallback`, present-but-not-a-number → throws. */
export function num(params: ResolvedParams, key: string, fallback = 0): number {
  return (readScalar(params, key, "number") as number | undefined) ?? fallback;
}

/** Read a resolved param as a string; absent → `fallback`, present-but-not-a-string → throws. */
export function str(params: ResolvedParams, key: string, fallback = ""): string {
  return (readScalar(params, key, "string") as string | undefined) ?? fallback;
}

/** Read a resolved param as a boolean; absent → `fallback`, present-but-not-a-boolean → throws. */
export function bool(params: ResolvedParams, key: string, fallback = false): boolean {
  return (readScalar(params, key, "boolean") as boolean | undefined) ?? fallback;
}

/**
 * Read a resolved param as a string array: absent → `[]`, a single string → wrapped (`["x"]`), an
 * array → returned once every element is confirmed a string. A present non-array/non-string value,
 * or an array holding a non-string element (e.g. a `$cfg` ref that resolved to a number), THROWS —
 * the array counterpart of the scalar guard above, rather than silently dropping the offender.
 */
export function strArray(params: ResolvedParams, key: string): string[] {
  const v = params[key];
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) {
    for (const el of v) {
      if (typeof el !== "string") {
        throw new Error(
          `param "${key}" must be an array of strings, but an element is ${formatValue(el)} — ` +
            `likely a "$cfg.<path>" reference resolving to a non-string config.json value`,
        );
      }
    }
    return v as string[];
  }
  throw new Error(`param "${key}" must be a string or an array of strings, but got ${formatValue(v)}`);
}

/**
 * The per-instance COOLDOWN gate: "ready at most once per `seconds`". This is the single
 * most hand-rolled pattern across the library (the fire/swing/spawn/contact-damage/portal
 * `if (now < last + rate) return; last = now` dance), so it lives once here, correctly.
 *
 * Pass a behavior's `scratch` (its per-instance store — see {@link BehaviorFn}), a `key`
 * namespacing this cooldown within that scratch, the current `world.time`, and the interval.
 * Returns `true` and ARMS the cooldown when ready; `false` while still cooling. A pure function
 * of the stored stamp + `now`, so it is replay-deterministic; the first call (no stamp yet) is
 * always ready. Reads the time you pass — keep it on `world.time` (never the wall clock).
 *
 *   if (cooldown(scratch, "fire", world.time, fireRate)) spawnBullet();
 */
export function cooldown(scratch: Record<string, unknown>, key: string, now: number, seconds: number): boolean {
  const stamp = `__cd_${key}`;
  const last = scratch[stamp];
  const lastT = typeof last === "number" ? last : -Infinity;
  if (now < lastT + seconds) return false;
  scratch[stamp] = now;
  return true;
}
