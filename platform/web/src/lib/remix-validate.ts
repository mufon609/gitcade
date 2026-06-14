// The remix safety gate — a UI-side mirror of the worker's two hard rules so a
// remix that WOULD produce an invalid game is prevented BEFORE it is committed
// (the locked requirement), not rejected after a wasted build. Reuses the FROZEN
// SDK's browser-safe exports (SceneSchema + the numeric whitelist); it does NOT
// import @gitcade/sdk/validate (that subpath pulls in node:fs). The worker remains
// the real gate — this just stops obviously-invalid commits.
import { SceneSchema, isWhitelistedNumericKey } from "@gitcade/sdk";

export interface RemixIssue {
  code: "schema" | "magic-number" | "unresolved-cfg";
  message: string;
  where?: string;
}

/** Flatten config to dotted leaf paths (matches the SDK's `$cfg` resolution: nested
 *  OR flat-dotted keys both resolve). */
function flatten(tree: unknown, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
      else out.set(path, v);
    }
  }
  return out;
}

function resolvesInConfig(refPath: string, flat: Map<string, unknown>): boolean {
  // The SDK accepts both a flat-dotted key and a nested path; flatten covers both.
  return flat.has(refPath);
}

/** Walk a params object, invoking callbacks on numeric literals and $cfg refs. */
function walk(
  params: unknown,
  base: string,
  onNumber: (key: string, value: number, where: string) => void,
  onCfg: (ref: string, where: string) => void,
): void {
  const visit = (value: unknown, key: string, where: string): void => {
    if (typeof value === "number") onNumber(key, value, where);
    else if (typeof value === "string") {
      const m = value.match(/^\$cfg\.(.+)$/);
      if (m) onCfg(m[1], where);
    } else if (Array.isArray(value)) value.forEach((v, i) => visit(v, key, `${where}[${i}]`));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k, `${where}.${k}`);
  };
  if (params && typeof params === "object" && !Array.isArray(params))
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) visit(v, k, `${base}.${k}`);
}

/** Validate a remixed scene + config: schema-valid scene, no magic numbers in any
 *  behavior/system params, and every `$cfg` ref resolving in config. Returns the
 *  (possibly empty) list of blocking issues. */
export function validateRemix(scene: unknown, config: unknown): RemixIssue[] {
  const issues: RemixIssue[] = [];

  const parsed = SceneSchema.safeParse(scene);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ code: "schema", message: i.message, where: i.path.join(".") || "(scene)" });
    }
    // If the scene is structurally invalid, params walking is unreliable — stop here.
    return issues;
  }

  const flat = flatten(config);
  const s = parsed.data;
  const onNumber = (key: string, value: number, where: string) => {
    if (!isWhitelistedNumericKey(key)) {
      issues.push({
        code: "magic-number",
        message: `numeric literal ${value} under non-structural key "${key}" — must be a $cfg reference`,
        where,
      });
    }
  };
  const onCfg = (ref: string, where: string) => {
    if (!resolvesInConfig(ref, flat)) {
      issues.push({ code: "unresolved-cfg", message: `$cfg.${ref} does not resolve in config.json`, where });
    }
  };

  s.entities.forEach((e, ei) =>
    e.behaviors.forEach((b, bi) =>
      walk(b.params, `entities[${ei}:${e.id}].behaviors[${bi}:${b.type}].params`, onNumber, onCfg),
    ),
  );
  s.systems.forEach((sy, si) => walk(sy.params, `systems[${si}:${sy.type}].params`, onNumber, onCfg));

  return issues;
}

/** Extract every `$cfg.<path>` reference found in a params subtree (used to ensure
 *  a swapped-in behavior's tunables are backfilled into config before committing). */
export function collectCfgRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    const m = value.match(/^\$cfg\.(.+)$/);
    if (m) out.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => collectCfgRefs(v, out));
  else if (value && typeof value === "object")
    for (const v of Object.values(value as Record<string, unknown>)) collectCfgRefs(v, out);
  return out;
}
