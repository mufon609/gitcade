// THE REMIX ENGINE — turn point-and-click edits on a game you own (or a
// fork-on-demand) into a single readable commit that still PASSES `gitcade validate`.
// Three edit kinds, all derived from the catalog so nothing new is invented:
//   a. swap an entity's sprite for another catalog entity's sprite (structural)
//   b. swap a movement behavior for a category+tags-COMPATIBLE one (catalog default
//      params; missing $cfg tunables are backfilled into config so it resolves)
//   c. edit config.json tunables (sliders) — numbers stay numbers, always valid
//
// The pure model/apply functions live here (unit-tested); the API routes wire them
// to repo I/O + commitFiles. User-published parts used by a swap are VENDORED into
// the fork under src/vendored-parts/ (locked Library-distribution decision — no
// private registry); catalog (library) parts keep their `partId@version` provenance.
import { prisma } from "./prisma";
import { behaviorCompatible, type CatalogPart } from "./catalog";
import { collectCfgRefs } from "./remix-validate";

// ─────────────────────────── catalog accessors ───────────────────────────

export interface RemixSpriteOption {
  partId: string;
  version: string;
  license: string;
  source: "catalog" | "user";
  /** The SDK sprite descriptor to drop onto an entity. */
  sprite: Record<string, unknown>;
}

export interface RemixMovementOption {
  partId: string;
  version: string;
  license: string;
  source: "catalog" | "user";
  tags: string[];
  /** Catalog default params (balance via $cfg) applied on swap. */
  params: Record<string, unknown>;
  /** Vendored source for user parts (dropped into src/vendored-parts/ on swap). */
  sourceCode?: string | null;
}

export interface CatalogIndex {
  /** entityPartId → sprite option */
  sprites: RemixSpriteOption[];
  /** movement behavior parts (catalog + user) */
  movement: Array<CatalogPart & { source: "catalog" | "user"; version: string; sourceCode?: string | null }>;
  /** behaviorPartId → CatalogPart (for compatibility + provenance) */
  behaviorById: Map<string, CatalogPart & { source: "catalog" | "user"; version: string; sourceCode?: string | null }>;
}

/** Pull the remix-relevant parts from the Part mirror: entity sprites + movement
 *  behaviors (catalog and user-published). */
export async function getRemixCatalog(): Promise<CatalogIndex> {
  const rows = await prisma.part.findMany({
    where: { OR: [{ kind: "entity" }, { kind: "behavior", category: "movement" }] },
  });

  const sprites: RemixSpriteOption[] = [];
  const movement: CatalogIndex["movement"] = [];
  const behaviorById: CatalogIndex["behaviorById"] = new Map();

  for (const r of rows) {
    if (r.kind === "entity") {
      const def = (r.definition as { params?: { sprite?: Record<string, unknown> } } | null) ?? null;
      const sprite = def?.params?.sprite;
      if (sprite && typeof sprite.src === "string") {
        sprites.push({
          partId: r.partId,
          version: r.version,
          license: r.license,
          source: r.source as "catalog" | "user",
          sprite,
        });
      }
    } else {
      const def = (r.definition as { type?: string; params?: Record<string, unknown> } | null) ?? null;
      const cp: CatalogPart & { source: "catalog" | "user"; version: string; sourceCode?: string | null } = {
        id: r.partId,
        kind: "behavior",
        version: r.version,
        category: r.category,
        tags: r.tags,
        description: r.description,
        license: r.license,
        definition: { type: r.partId, params: def?.params ?? {} },
        source: r.source as "catalog" | "user",
        sourceCode: r.sourceCode,
      };
      movement.push(cp);
      behaviorById.set(r.partId, cp);
    }
  }
  sprites.sort((a, b) => a.partId.localeCompare(b.partId));
  movement.sort((a, b) => a.id.localeCompare(b.id));
  return { sprites, movement, behaviorById };
}

// ─────────────────────────── the editable model ───────────────────────────

export interface EditableEntity {
  id: string;
  /** Current sprite descriptor (image|sheet with a src). */
  sprite: Record<string, unknown>;
}

export interface MovementSlot {
  /** Stable slot key: `${entityId}#${behaviorIndex}`. */
  key: string;
  entityId: string;
  behaviorIndex: number;
  currentType: string;
  /** Movement options compatible with the current behavior (catalog-derived). */
  options: Array<{ partId: string; version: string; license: string; source: "catalog" | "user"; tags: string[] }>;
}

export interface ConfigLeaf {
  path: string;
  value: number | string | boolean;
  kind: "number" | "string" | "boolean";
  /** Slider bounds for numeric leaves (sane range around the current value). */
  min?: number;
  max?: number;
  step?: number;
}

export interface RemixModel {
  entities: EditableEntity[];
  movementSlots: MovementSlot[];
  configLeaves: ConfigLeaf[];
  spriteOptions: RemixSpriteOption[];
  scenePath: string;
  configPath: string;
  sceneId: string;
}

function sliderRange(v: number): { min: number; max: number; step: number } {
  if (!isFinite(v)) return { min: 0, max: 1, step: 0.01 };
  const isInt = Number.isInteger(v);
  const mag = Math.abs(v);
  const max = mag === 0 ? (isInt ? 10 : 1) : Math.max(mag * 3, mag + (isInt ? 10 : 1));
  const min = v < 0 ? Math.min(v * 3, -max) : 0;
  const step = isInt ? 1 : Math.max(0.001, Number((mag / 100 || 0.01).toPrecision(1)));
  return { min: Number(min.toFixed(4)), max: Number(max.toFixed(4)), step };
}

/** Flatten config to dotted-path leaves preserving value types. */
export function flattenConfigLeaves(tree: unknown, prefix = "", out: ConfigLeaf[] = []): ConfigLeaf[] {
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flattenConfigLeaves(v, path, out);
      else if (typeof v === "number") out.push({ path, value: v, kind: "number", ...sliderRange(v) });
      else if (typeof v === "string") out.push({ path, value: v, kind: "string" });
      else if (typeof v === "boolean") out.push({ path, value: v, kind: "boolean" });
    }
  }
  return out;
}

/** Build the point-and-click remix model from a loaded scene + config + catalog. */
export function buildRemixModel(
  scene: Record<string, unknown>,
  config: unknown,
  scenePath: string,
  configPath: string,
  catalog: CatalogIndex,
): RemixModel {
  const entities = (Array.isArray(scene.entities) ? scene.entities : []) as Array<Record<string, unknown>>;

  const editable: EditableEntity[] = [];
  const slots: MovementSlot[] = [];

  for (const e of entities) {
    const id = String(e.id ?? "");
    const sprite = e.sprite as Record<string, unknown> | undefined;
    if (sprite && (sprite.kind === "image" || sprite.kind === "sheet") && typeof sprite.src === "string") {
      editable.push({ id, sprite });
    }
    const behaviors = (Array.isArray(e.behaviors) ? e.behaviors : []) as Array<Record<string, unknown>>;
    behaviors.forEach((b, bi) => {
      const type = String(b.type ?? "");
      const current = catalog.behaviorById.get(type);
      if (current && current.category === "movement") {
        const options = catalog.movement
          .filter((m) => behaviorCompatible(current, m))
          .map((m) => ({
            partId: m.id,
            version: m.version,
            license: m.license,
            source: m.source,
            tags: m.tags,
          }));
        slots.push({ key: `${id}#${bi}`, entityId: id, behaviorIndex: bi, currentType: type, options });
      }
    });
  }

  return {
    entities: editable,
    movementSlots: slots,
    configLeaves: flattenConfigLeaves(config),
    spriteOptions: catalog.sprites,
    scenePath,
    configPath,
    sceneId: String(scene.id ?? "main"),
  };
}

// ─────────────────────────── applying edits ───────────────────────────

export interface RemixEdits {
  /** entityId → target sprite partId. */
  spriteSwaps?: Record<string, string>;
  /** slotKey (`entityId#behaviorIndex`) → target movement partId. */
  movementSwaps?: Record<string, string>;
  /** dotted config path → new value. */
  configEdits?: Record<string, number | string | boolean>;
}

export interface VendoredFile {
  path: string;
  content: string;
}

export interface RemixApplyResult {
  scene: Record<string, unknown>;
  config: Record<string, unknown>;
  vendored: VendoredFile[];
  /** Human-readable one-liners describing every change (the commit body). */
  summary: string[];
  /** $cfg keys backfilled into config by a movement swap. */
  addedConfigKeys: string[];
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  // Match the SDK: a flat-dotted key OR a nested path both resolve. We write the
  // FLAT key when it already exists flat, else nest. Seed configs are flat.
  if (Object.prototype.hasOwnProperty.call(obj, path)) {
    obj[path] = value;
    return;
  }
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function hasPath(config: Record<string, unknown>, path: string): boolean {
  if (Object.prototype.hasOwnProperty.call(config, path)) return true;
  const parts = path.split(".");
  let cur: unknown = config;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return false;
  }
  return true;
}

function defaultForKey(key: string): number {
  const k = key.toLowerCase();
  if (/(interval|cooldown|time|delay|duration)/.test(k)) return 0.8;
  if (/(speed|vel)/.test(k)) return 70;
  if (/(range|radius|dist)/.test(k)) return 120;
  if (/(gravity)/.test(k)) return 900;
  if (/(jump)/.test(k)) return 320;
  if (/(damage|dmg|value|gain|amount|cost)/.test(k)) return 5;
  if (/(hp|health|lives|count|max)/.test(k)) return 5;
  return 40;
}

/** Apply remix edits to a scene + config (pure). Returns the new files + a summary
 *  + any vendored part files. Does NOT validate — callers run validateRemix. */
export function applyRemix(
  sceneIn: Record<string, unknown>,
  configIn: unknown,
  edits: RemixEdits,
  catalog: CatalogIndex,
): RemixApplyResult {
  const scene = JSON.parse(JSON.stringify(sceneIn)) as Record<string, unknown>;
  const config = JSON.parse(JSON.stringify(configIn ?? {})) as Record<string, unknown>;
  const summary: string[] = [];
  const vendored: VendoredFile[] = [];
  const addedConfigKeys: string[] = [];

  const spriteByPart = new Map(catalog.sprites.map((s) => [s.partId, s]));
  const entities = (Array.isArray(scene.entities) ? scene.entities : []) as Array<Record<string, unknown>>;

  // (a) sprite swaps
  for (const [entityId, targetPart] of Object.entries(edits.spriteSwaps ?? {})) {
    const target = spriteByPart.get(targetPart);
    const entity = entities.find((e) => String(e.id) === entityId);
    if (!target || !entity) continue;
    const oldSrc = (entity.sprite as Record<string, unknown> | undefined)?.src;
    entity.sprite = JSON.parse(JSON.stringify(target.sprite));
    summary.push(`sprite(${entityId}): ${shortAsset(oldSrc)} → ${targetPart}`);
  }

  // (b) movement swaps
  for (const [slotKey, targetPart] of Object.entries(edits.movementSwaps ?? {})) {
    const [entityId, biStr] = slotKey.split("#");
    const bi = Number(biStr);
    const entity = entities.find((e) => String(e.id) === entityId);
    const target = catalog.behaviorById.get(targetPart);
    if (!entity || !target || !Array.isArray(entity.behaviors) || !entity.behaviors[bi]) continue;
    const behaviors = entity.behaviors as Array<Record<string, unknown>>;
    const prevType = String(behaviors[bi].type);
    const params = JSON.parse(JSON.stringify(target.definition.params ?? {}));
    const swapped: Record<string, unknown> = { type: target.id, params };
    if (target.source === "catalog") {
      // Keep catalog provenance so the "made from" panel + validator resolve it.
      swapped.part = `${target.id}@${target.version}`;
    } else if (target.sourceCode) {
      // User part: vendor the source so the fork carries the implementation (no
      // private registry — locked decision). It is REGISTERED at runtime by the
      // managed src/custom-behaviors/index.ts the commit step writes (see
      // remix-service#vendoredWiringFiles) — without that, the build's headless/smoke
      // check throws "unknown behavior type". Always `.ts`: uploaded sources may use
      // TS-only syntax (type imports/annotations) a `.js` file can't bundle, and TS is
      // a JS superset so plain-JS sources compile as `.ts` too.
      vendored.push({ path: `src/vendored-parts/${target.id}.ts`, content: target.sourceCode });
      summary.push(`vendored user part src/vendored-parts/${target.id}.ts`);
    } else {
      // A user part with no stored source can't be wired into the fork — skip the
      // swap rather than commit a scene that references an unregistered type.
      continue;
    }
    behaviors[bi] = swapped;

    // Backfill every $cfg tunable the swapped-in behavior needs.
    for (const ref of collectCfgRefs(params)) {
      if (!hasPath(config, ref)) {
        setPath(config, ref, defaultForKey(ref));
        addedConfigKeys.push(ref);
      }
    }
    summary.push(`movement(${entityId}): ${prevType} → ${target.id}`);
  }

  // (c) config tunable edits
  for (const [path, value] of Object.entries(edits.configEdits ?? {})) {
    setPath(config, path, value);
    summary.push(`config ${path} → ${typeof value === "string" ? JSON.stringify(value) : value}`);
  }

  return { scene, config, vendored, summary, addedConfigKeys };
}

function shortAsset(src: unknown): string {
  if (typeof src !== "string") return "(sprite)";
  return src.split("/").pop() ?? src;
}
