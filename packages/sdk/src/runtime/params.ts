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

/** Coerce a resolved param to a number with a default. */
export function num(params: ResolvedParams, key: string, fallback = 0): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

/** Coerce a resolved param to a string with a default. */
export function str(params: ResolvedParams, key: string, fallback = ""): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}

/** Coerce a resolved param to a boolean with a default. */
export function bool(params: ResolvedParams, key: string, fallback = false): boolean {
  const v = params[key];
  return typeof v === "boolean" ? v : fallback;
}

/** Read a resolved param as a string array (single strings are wrapped). */
export function strArray(params: ResolvedParams, key: string): string[] {
  const v = params[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}
