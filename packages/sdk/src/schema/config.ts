import { z } from "zod";

/**
 * A single tunable value. Almost always a number (speeds, costs, health), but
 * strings (e.g. a default difficulty label) and booleans (feature flags) are
 * permitted so that "all tunables live in config" stays literally true.
 */
export const ConfigLeafSchema = z.union([z.number(), z.string(), z.boolean()]);
export type ConfigLeaf = z.infer<typeof ConfigLeafSchema>;

/**
 * A config node is either a leaf value or a nested group of values. `config.json`
 * is therefore a (possibly nested) key/value store of ALL tunable balance values.
 *
 * Both flat and grouped styles are supported and resolve identically:
 *   `{ "towerCost.arrow": 50 }`            → `$cfg.towerCost.arrow`
 *   `{ "towerCost": { "arrow": 50 } }`     → `$cfg.towerCost.arrow`
 * Grouping is encouraged for the slider UIs in Phases 6/7 (Remix + Governance),
 * which want to render related tunables together.
 */
export type ConfigNode = ConfigLeaf | { [key: string]: ConfigNode };
export const ConfigNodeSchema: z.ZodType<ConfigNode> = z.lazy(() =>
  z.union([ConfigLeafSchema, z.record(z.string(), ConfigNodeSchema)]),
);

/** The root `config.json` shape: a record of tunable keys. */
export const ConfigSchema = z.record(z.string(), ConfigNodeSchema);
export type Config = z.infer<typeof ConfigSchema>;

/** The reference prefix used inside behavior/system params: `"$cfg.playerSpeed"`. */
export const CFG_PREFIX = "$cfg.";

/** True if `value` is a `$cfg.<path>` reference string. */
export function isCfgRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CFG_PREFIX);
}

/** Extract the dotted path from a `$cfg.<path>` reference (`"$cfg.a.b"` → `"a.b"`). */
export function cfgRefPath(ref: string): string {
  return ref.slice(CFG_PREFIX.length);
}

/**
 * Resolve a dotted config path against a config object.
 *
 * Resolution order, so flat and nested styles both work:
 *  1. exact own-property match on the literal key (`config["towerCost.arrow"]`)
 *  2. otherwise walk dot segments (`config.towerCost.arrow`)
 *
 * Returns `undefined` if the path does not resolve to a leaf value.
 */
export function resolveConfigPath(config: Config, path: string): ConfigLeaf | undefined {
  // 1. literal flat key
  if (Object.prototype.hasOwnProperty.call(config, path)) {
    const v = (config as Record<string, ConfigNode>)[path];
    if (isLeaf(v)) return v;
  }
  // 2. dotted walk
  const segments = path.split(".");
  let cursor: ConfigNode | undefined = config as unknown as ConfigNode;
  for (const seg of segments) {
    if (cursor && typeof cursor === "object" && !Array.isArray(cursor) && seg in cursor) {
      cursor = (cursor as Record<string, ConfigNode>)[seg];
    } else {
      return undefined;
    }
  }
  return isLeaf(cursor) ? cursor : undefined;
}

function isLeaf(v: ConfigNode | undefined): v is ConfigLeaf {
  return typeof v === "number" || typeof v === "string" || typeof v === "boolean";
}
