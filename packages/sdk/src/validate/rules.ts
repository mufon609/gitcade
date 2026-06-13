import type { Scene } from "../schema/scene.js";
import type { Config } from "../schema/config.js";
import { isWhitelistedNumericKey } from "../schema/whitelist.js";
import { isCfgRef, cfgRefPath, resolveConfigPath } from "../schema/config.js";

/** A single validation finding. */
export interface Issue {
  level: "error" | "warning";
  code: string;
  message: string;
  /** Dotted location, e.g. `main.entities[2].behaviors[0].params.speed`. */
  where?: string;
}

/**
 * Walk a params object, invoking callbacks for each numeric leaf and each `$cfg`
 * reference, tracking both the immediate KEY (for the whitelist check) and a
 * human-readable PATH (for error messages). Arrays inherit their parent key, so
 * `points: [1,2]` is checked under key `points`.
 */
export function walkParams(
  params: unknown,
  base: string,
  onNumber: (key: string, value: number, where: string) => void,
  onCfgRef: (ref: string, where: string) => void,
): void {
  const visit = (value: unknown, key: string, where: string): void => {
    if (typeof value === "number") {
      onNumber(key, value, where);
    } else if (typeof value === "string") {
      if (isCfgRef(value)) onCfgRef(value, where);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, key, `${where}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(v, k, `${where}.${k}`);
      }
    }
  };

  if (params && typeof params === "object" && !Array.isArray(params)) {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      visit(v, k, `${base}.${k}`);
    }
  }
}

/**
 * The mechanical no-magic-numbers rule + `$cfg` resolution check over all scenes.
 * A numeric literal in any behavior/system params block FAILS unless its key is
 * structurally whitelisted; every `$cfg.<path>` reference must resolve in
 * `config.json`.
 */
export function checkParams(scenes: Scene[], config: Config): Issue[] {
  const issues: Issue[] = [];

  const onNumber = (key: string, value: number, where: string): void => {
    if (!isWhitelistedNumericKey(key)) {
      issues.push({
        level: "error",
        code: "magic-number",
        message: `numeric literal ${value} under non-structural key "${key}" — move it to config.json and reference it as "$cfg.<key>"`,
        where,
      });
    }
  };
  const onCfgRef = (ref: string, where: string): void => {
    if (resolveConfigPath(config, cfgRefPath(ref)) === undefined) {
      issues.push({
        level: "error",
        code: "unresolved-cfg",
        message: `config reference "${ref}" does not resolve to a value in config.json`,
        where,
      });
    }
  };

  for (const scene of scenes) {
    scene.entities.forEach((e, ei) => {
      e.behaviors.forEach((b, bi) => {
        walkParams(b.params, `${scene.id}.entities[${ei}:${e.id}].behaviors[${bi}:${b.type}].params`, onNumber, onCfgRef);
      });
    });
    scene.systems.forEach((s, si) => {
      walkParams(s.params, `${scene.id}.systems[${si}:${s.type}].params`, onNumber, onCfgRef);
    });
  }

  return issues;
}

/** A `partId@version` reference discovered in the scenes. */
export interface PartRef {
  ref: string;
  partId: string;
  version: string;
  where: string;
}

/** Collect every `part` provenance reference (`"partId@1.2.0"`) across scenes. */
export function collectPartRefs(scenes: Scene[]): PartRef[] {
  const refs: PartRef[] = [];
  const add = (ref: string | undefined, where: string): void => {
    if (!ref) return;
    const at = ref.lastIndexOf("@");
    const partId = at > 0 ? ref.slice(0, at) : ref;
    const version = at > 0 ? ref.slice(at + 1) : "";
    refs.push({ ref, partId, version, where });
  };
  for (const scene of scenes) {
    scene.entities.forEach((e, ei) => {
      add(e.part, `${scene.id}.entities[${ei}:${e.id}].part`);
      e.behaviors.forEach((b, bi) => add(b.part, `${scene.id}.entities[${ei}:${e.id}].behaviors[${bi}].part`));
    });
    scene.systems.forEach((s, si) => add(s.part, `${scene.id}.systems[${si}].part`));
  }
  return refs;
}

/** The catalog shape the validator needs from `@gitcade/library` (Phase 2 owns it). */
export interface LibraryCatalog {
  version: string;
  parts: Array<{ id: string; version: string }>;
}

/**
 * Verify every `partId@version` reference resolves within the catalog of the
 * pinned `libraryVersion`. In Phase 1 no catalog exists yet; callers pass
 * `catalog = null` and any part references therefore fail loudly (you cannot pin
 * a part with no library), while part-free games (Pong) pass vacuously.
 */
export function checkPartRefs(
  refs: PartRef[],
  libraryVersion: string | undefined,
  catalog: LibraryCatalog | null,
): Issue[] {
  if (refs.length === 0) return [];
  const issues: Issue[] = [];

  if (!libraryVersion) {
    for (const r of refs) {
      issues.push({
        level: "error",
        code: "part-without-library",
        message: `part reference "${r.ref}" requires a pinned libraryVersion in game.json`,
        where: r.where,
      });
    }
    return issues;
  }
  if (!catalog) {
    for (const r of refs) {
      issues.push({
        level: "error",
        code: "catalog-unavailable",
        message: `cannot resolve "${r.ref}": @gitcade/library@${libraryVersion} catalog was not found (install the pinned library)`,
        where: r.where,
      });
    }
    return issues;
  }
  if (catalog.version !== libraryVersion) {
    issues.push({
      level: "error",
      code: "library-version-mismatch",
      message: `installed library catalog is ${catalog.version} but game.json pins ${libraryVersion}`,
    });
  }
  const index = new Set(catalog.parts.map((p) => `${p.id}@${p.version}`));
  for (const r of refs) {
    if (!index.has(`${r.partId}@${r.version}`)) {
      issues.push({
        level: "error",
        code: "part-not-in-catalog",
        message: `part "${r.ref}" does not exist in @gitcade/library@${libraryVersion}`,
        where: r.where,
      });
    }
  }
  return issues;
}
