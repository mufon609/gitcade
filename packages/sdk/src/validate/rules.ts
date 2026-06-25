import type { Scene } from "../schema/scene.js";
import { isReservedFlowTarget, levelTargetId, resolveSceneInheritance } from "../schema/index.js";
import type { GameManifest } from "../schema/manifest.js";
import type { Config } from "../schema/config.js";
import { isWhitelistedNumericKey } from "../schema/whitelist.js";
import { isCfgRef, cfgRefPath, resolveConfigPath } from "../schema/config.js";
import { ENGINE_CHANNEL_NAMES } from "../runtime/channels.js";

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
 * reference, tracking the immediate KEY (for the whitelist check), a human-readable
 * PATH (for error messages), and whether the number is a DIRECT array element. The
 * `inArray` flag exists because the structural-key whitelist is meant for single
 * SCALARS: a bare numeric array (`offset: [50, 120, 9999]`) would otherwise inherit
 * its parent key and smuggle every element past the no-magic-numbers rule. A number
 * nested inside an OBJECT that happens to sit in an array (`path: [{x,y}]`) is judged
 * by its own key, so legitimate object-arrays (waypoints) are unaffected.
 */
export function walkParams(
  params: unknown,
  base: string,
  onNumber: (key: string, value: number, where: string, inArray: boolean) => void,
  onCfgRef: (ref: string, where: string) => void,
): void {
  const visit = (value: unknown, key: string, where: string, inArray: boolean): void => {
    if (typeof value === "number") {
      onNumber(key, value, where, inArray);
    } else if (typeof value === "string") {
      if (isCfgRef(value)) onCfgRef(value, where);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, key, `${where}[${i}]`, true));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(v, k, `${where}.${k}`, false);
      }
    }
  };

  if (params && typeof params === "object" && !Array.isArray(params)) {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      visit(v, k, `${base}.${k}`, false);
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

  const onNumber = (key: string, value: number, where: string, inArray: boolean): void => {
    // A bare numeric array element is never structural-whitelisted: a list of raw numbers
    // is the one shape that can smuggle balance past the key whitelist (every element would
    // otherwise inherit a whitelisted parent key). It must live in config.json.
    if (inArray) {
      issues.push({
        level: "error",
        code: "magic-number-array",
        message: `numeric literal ${value} inside an array under key "${key}" — an array of raw numbers smuggles balance past the structural-key whitelist; move the list to config.json and reference its values as "$cfg.<key>"`,
        where,
      });
      return;
    }
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
    // Entity overrides carry behavior params too (a level patching an inherited entity's behavior, or
    // pointing it at a different `$cfg` slice). They are merged into entities only at resolve time, so
    // scan them here at their authored `overrides[…]` location — otherwise a magic number or a dangling
    // `$cfg` smuggled through a patch would slip the gate.
    overridesOf(scene).forEach((ov, oi) => {
      overrideBehaviors(ov).forEach((b, bi) => {
        const type = typeof b.type === "string" ? b.type : "?";
        walkParams(b.params, `${scene.id}.overrides[${oi}:${ov.id}].behaviors[${bi}:${type}].params`, onNumber, onCfgRef);
      });
    });
  }

  return issues;
}

/** A scene's `overrides` as a safe array (the field is optional). */
function overridesOf(scene: Scene): Array<Record<string, unknown> & { id: string }> {
  return (scene.overrides ?? []) as Array<Record<string, unknown> & { id: string }>;
}

/**
 * The raw `behaviors` of an override patch. A patch is a passthrough partial (see
 * {@link EntityOverrideSchema}), so its `behaviors` arrive un-parsed: defend against a non-array and
 * surface each element loosely as `{ type?, params?, part? }` for the param/part scanners.
 */
function overrideBehaviors(ov: Record<string, unknown>): Array<{ type?: unknown; params?: unknown; part?: unknown }> {
  const b = ov.behaviors;
  return Array.isArray(b) ? (b as Array<{ type?: unknown; params?: unknown; part?: unknown }>) : [];
}

/**
 * Identifier UNIQUENESS — the holes the schema (which validates one file / one entity
 * at a time) structurally cannot see, and which corrupt the runtime SILENTLY:
 *  - two scene files declaring the same `id` collapse to one in the runtime's scene
 *    `Map` (last-write-wins), so a whole playable scene vanishes while every cross-ref
 *    to it still "resolves";
 *  - two entities sharing an `id` within a scene collapse in `World.byId` (last-write-
 *    wins), so parent links, tag targeting, and `byId` lookups silently resolve to one.
 * Both pass the schema and the 60-frame smoke boot, so they must be caught here. Entity
 * ids are checked on the AUTHORED scenes (a child scene legitimately RE-declares a base
 * entity's id via `extends` to override it — that is not a duplicate).
 */
export function checkUniqueIds(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];

  const sceneCounts = new Map<string, number>();
  for (const s of scenes) sceneCounts.set(s.id, (sceneCounts.get(s.id) ?? 0) + 1);
  for (const [id, n] of sceneCounts) {
    if (n > 1) {
      issues.push({
        level: "error",
        code: "duplicate-scene-id",
        message: `scene id "${id}" is declared by ${n} files in src/scenes/ — the runtime keeps only the last, silently dropping the others; scene ids must be unique`,
        where: `src/scenes (${id})`,
      });
    }
  }

  for (const scene of scenes) {
    const counts = new Map<string, number>();
    for (const e of scene.entities) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
    for (const [id, n] of counts) {
      if (n > 1) {
        issues.push({
          level: "error",
          code: "duplicate-entity-id",
          message: `entity id "${id}" appears ${n} times in scene "${scene.id}" — World.byId/parent/tag-target resolution collapses to a single one; entity ids must be unique within a scene`,
          where: `${scene.id}.entities (${id})`,
        });
      }
    }
  }

  return issues;
}

/**
 * Cross-scene REFERENCE integrity. The schema validates each scene file in
 * isolation, so a reference to a scene that does not exist — a typo'd
 * `flow.on` destination, an `extends` base, a `manifest.levels` entry, or the
 * `entryPoint` — would pass `gitcade validate` and only surface at runtime (a no-op
 * transition or a thrown "scene not found"). This rule resolves all four reference
 * kinds against the actual scene-id set so a broken link fails the publish gate.
 *
 * It also enforces the level-sequence invariants the reserved flow tokens depend on:
 * a `"@next"`/`"@first"` edge requires `manifest.levels`, and every id in `levels`
 * (plus `levelsComplete`) must name a real scene. Inheritance cycles (which the
 * runtime resolver throws on) are reported here as a clean error rather than a smoke
 * crash.
 */
export function checkSceneRefs(scenes: Scene[], manifest: GameManifest | null): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(scenes.map((s) => s.id));
  const hasLevels = Boolean(manifest?.levels && manifest.levels.length > 0);

  for (const scene of scenes) {
    if (scene.extends !== undefined && !ids.has(scene.extends)) {
      issues.push({
        level: "error",
        code: "extends-target-missing",
        message: `scene "${scene.id}" extends "${scene.extends}", which is not a scene in src/scenes/`,
        where: `${scene.id}.extends`,
      });
    }
    for (const [evt, target] of Object.entries(scene.flow?.on ?? {})) {
      if (isReservedFlowTarget(target)) {
        if (!hasLevels) {
          issues.push({
            level: "error",
            code: "flow-token-without-levels",
            message: `flow edge "${evt}" → "${target}" uses a reserved level token but game.json declares no \`levels\` sequence`,
            where: `${scene.id}.flow.on.${evt}`,
          });
        } else {
          // `@level:<id>` names a SPECIFIC level — it must be one of game.json's `levels`
          // (the runtime resolves it against that list; an unknown id is a no-op jump).
          // The companion to `level-scene-missing` (which checks the list entries name
          // real scenes): this checks an @level EDGE names a listed level. Skipped when
          // there is no `levels` sequence, since flow-token-without-levels already fired.
          const lid = levelTargetId(target);
          if (lid !== null && !manifest!.levels!.includes(lid)) {
            issues.push({
              level: "error",
              code: "level-target-missing",
              message: `flow edge "${evt}" → "${target}" jumps to level "${lid}", which is not in game.json \`levels\``,
              where: `${scene.id}.flow.on.${evt}`,
            });
          }
        }
        continue;
      }
      if (!ids.has(target)) {
        issues.push({
          level: "error",
          code: "flow-target-missing",
          message: `flow edge "${evt}" → "${target}" names a scene that does not exist in src/scenes/`,
          where: `${scene.id}.flow.on.${evt}`,
        });
      }
    }
  }

  if (manifest?.levels) {
    manifest.levels.forEach((id, i) => {
      if (!ids.has(id)) {
        issues.push({
          level: "error",
          code: "level-scene-missing",
          message: `game.json levels[${i}] = "${id}" is not a scene in src/scenes/`,
          where: `game.json:levels.${i}`,
        });
      }
    });
  }
  if (manifest?.levelsComplete && !ids.has(manifest.levelsComplete)) {
    issues.push({
      level: "error",
      code: "levels-complete-missing",
      message: `game.json levelsComplete = "${manifest.levelsComplete}" is not a scene in src/scenes/`,
      where: "game.json:levelsComplete",
    });
  }

  // entryPoint resolves to a scene id by basename (the same rule createGame uses);
  // a typo silently boots the wrong scene without this check.
  if (manifest) {
    const base = manifest.entryPoint
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.json$/i, "");
    if (!base || !ids.has(base)) {
      issues.push({
        level: "error",
        code: "entry-scene-missing",
        message: `entryPoint "${manifest.entryPoint}" does not resolve to a scene id (basename "${base ?? ""}" not found in src/scenes/)`,
        where: "game.json:entryPoint",
      });
    }
  }

  // Inheritance cycles: the runtime resolver throws; surface it as a clean error
  // here instead of a smoke crash. Unknown extends targets are already reported
  // above, so only re-report a genuine cycle. On success the RESOLVED scenes also
  // drive the entity-parent checks below (a child may parent to a base-scene entity).
  let resolved: Scene[] | null = null;
  try {
    resolved = resolveSceneInheritance(scenes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cycle/.test(msg)) {
      issues.push({ level: "error", code: "scene-inheritance-cycle", message: msg });
    } else if (/override for entity/.test(msg)) {
      // A patch deep-merged into a structurally-invalid entity (a typo'd key, a cross-kind sprite
      // merge, an out-of-range value). The resolver throws on re-parse; surface it cleanly here
      // instead of as a smoke crash, the same treatment as a cycle.
      issues.push({ level: "error", code: "scene-override-invalid", message: msg });
    }
  }

  // Entity PARENT refs (scene graph): every `entity.parent` must name an entity in the
  // SAME inheritance-resolved scene, and the parent graph must be acyclic. At runtime a dangling
  // parent silently orphans the child and a cycle is ignored (members treated as roots) — both
  // pass the 60-frame smoke boot, so catch them at the publish gate instead, like the flow/extends
  // ref checks above.
  for (const scene of resolved ?? []) {
    const entityIds = new Set(scene.entities.map((e) => e.id));
    const parentOf = new Map<string, string>();
    scene.entities.forEach((e, ei) => {
      if (e.parent === undefined) return;
      const where = `${scene.id}.entities[${ei}:${e.id}].parent`;
      if (!entityIds.has(e.parent)) {
        issues.push({
          level: "error",
          code: "parent-entity-missing",
          message: `entity "${e.id}" sets parent "${e.parent}", which is not an entity in scene "${scene.id}"`,
          where,
        });
        return;
      }
      if (e.parent === e.id) {
        issues.push({ level: "error", code: "parent-cycle", message: `entity "${e.id}" is its own parent`, where });
        return;
      }
      parentOf.set(e.id, e.parent);
    });
    // Acyclicity: follow each chain to a root; a revisited id is a cycle. Report each distinct
    // cycle once (mark every id on the walked path) rather than once per member.
    const cycleReported = new Set<string>();
    for (const start of parentOf.keys()) {
      if (cycleReported.has(start)) continue;
      const seen = new Set<string>();
      const path: string[] = [];
      let cur: string | undefined = start;
      while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        path.push(cur);
        cur = parentOf.get(cur);
      }
      if (cur !== undefined && seen.has(cur)) {
        issues.push({
          level: "error",
          code: "parent-cycle",
          message: `scene "${scene.id}" has an entity parent cycle through "${cur}"`,
          where: `${scene.id}.entities (${cur}).parent`,
        });
        for (const id of path) cycleReported.add(id);
      }
    }
  }

  // Override TARGETS: every `overrides[…]` patch must address an entity that exists in the resolved
  // scene (an inherited one, or one this scene declares). The resolver IGNORES a patch whose id matches
  // nothing — a runtime-robust no-op — so a typo'd target would otherwise silently do nothing and pass
  // the smoke boot. Match the authored patch ids against the RESOLVED entity set (overrides applied),
  // the same authored-vs-resolved split the parent checks use.
  if (resolved) {
    const resolvedById = new Map(resolved.map((s) => [s.id, s]));
    for (const scene of scenes) {
      const patches = scene.overrides;
      if (!patches || patches.length === 0) continue;
      const entityIds = new Set((resolvedById.get(scene.id)?.entities ?? []).map((e) => e.id));
      patches.forEach((ov, oi) => {
        if (!entityIds.has(ov.id)) {
          issues.push({
            level: "error",
            code: "override-target-missing",
            message: `override targets entity "${ov.id}", which is not an entity in scene "${scene.id}" (it inherits none with that id and declares none) — the patch would silently do nothing`,
            where: `${scene.id}.overrides[${oi}:${ov.id}]`,
          });
        }
      });
    }
  }

  return issues;
}

/**
 * Param keys whose VALUE is an event channel NAME — the keys a library/SDK/custom part reads an
 * event name out of (`str(params, "<key>")`): emit-side `emitOnTap`/`event`/`deathEvent`/`onDenied`/…
 * plus a few listen-side. Curated from the shipped parts (the same set the audit enumerated). Used to
 * collect a game's event VOCABULARY in {@link checkFlowEvents}. Deliberately broad (emit AND listen,
 * one namespace) so the warning-only advisory stays lenient and never over-rejects.
 */
const EVENT_NAME_PARAM_KEYS = new Set<string>([
  "emitOnTap",
  "emitOnKey",
  "emitOnHit",
  "pressEvent",
  "event",
  "deathEvent",
  "enterEvent",
  "exitEvent",
  "onOk",
  "onDenied",
  "trigger",
  "boughtEvent",
  "gameOverEvent",
  "killEvent",
  "leakEvent",
  "placeEvent",
  "tapEvent",
  "wavesCompleteEvent",
]);

/** Recursively collect every event-name param VALUE (a non-empty string under an {@link EVENT_NAME_PARAM_KEYS} key). */
function collectEventNames(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectEventNames(v, into);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "" && EVENT_NAME_PARAM_KEYS.has(k)) into.add(v);
      else collectEventNames(v, into);
    }
  }
}

/**
 * Flow-edge event reconciliation — the symmetric companion to {@link checkSceneRefs}'s
 * flow-target-missing, WARNING-only. A `scene.flow.on` KEY names the event whose emission triggers
 * the transition, but {@link EventBus.emit} silently no-ops with no listener and checkSceneRefs only
 * validates the VALUE/target — so a typo'd or never-emitted flow key (`"gamover"`) passes
 * schema + validate + the smoke boot and becomes a transition that can NEVER fire, with no
 * diagnostic. This flags any flow.on key absent from the game's event VOCABULARY.
 *
 * Vocabulary (lenient BY DESIGN — a non-failing advisory must never reject a legitimate game): the
 * engine channel names ({@link ENGINE_CHANNEL_NAMES}); every event-name PARAM VALUE authored across
 * the scenes (both emit and listen keys — one namespace — gathered from entity behaviors, systems,
 * override patches, and nested spawn prototypes); plus `extraEmitted`, the LITERAL emit names the
 * caller scanned from the game's OWN source. Vocabulary is collected GLOBALLY across all scenes (an
 * event emitted anywhere counts), which is the lenient choice — the goal is catching the dead/typo'd
 * key, not policing which scene emits what. WARNING-only: a flow key emitted from host glue (main.ts)
 * the static scan can't see must not fail a publish — the over-rejection trap an OPEN, game-authored
 * channel namespace forbids.
 */
export function checkFlowEvents(scenes: Scene[], extraEmitted: Iterable<string> = []): Issue[] {
  const vocab = new Set<string>(ENGINE_CHANNEL_NAMES);
  for (const n of extraEmitted) vocab.add(n);
  for (const scene of scenes) {
    scene.entities.forEach((e) => e.behaviors.forEach((b) => collectEventNames(b.params, vocab)));
    scene.systems.forEach((s) => collectEventNames(s.params, vocab));
    overridesOf(scene).forEach((ov) => collectEventNames(ov, vocab));
  }

  const issues: Issue[] = [];
  for (const scene of scenes) {
    for (const evt of Object.keys(scene.flow?.on ?? {})) {
      if (vocab.has(evt)) continue;
      issues.push({
        level: "warning",
        code: "flow-event-never-emitted",
        message: `flow edge keyed on "${evt}" names an event no part in this game emits (no emitter found in scene params, the game's own source, or the engine channels) — the transition can never fire. Check for a typo, or wire a part/button that emits "${evt}". (Advisory: host-JS emits in main.ts aren't statically visible, so this never affects publishability.)`,
        where: `${scene.id}.flow.on.${evt}`,
      });
    }
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
    // An override patch can introduce a part-pinned entity/behavior (`{ id, part, behaviors:[{part}] }`);
    // pin it to the catalog like any other, at its authored override location.
    overridesOf(scene).forEach((ov, oi) => {
      add(typeof ov.part === "string" ? ov.part : undefined, `${scene.id}.overrides[${oi}:${ov.id}].part`);
      overrideBehaviors(ov).forEach((b, bi) =>
        add(typeof b.part === "string" ? b.part : undefined, `${scene.id}.overrides[${oi}:${ov.id}].behaviors[${bi}].part`),
      );
    });
  }
  return refs;
}

/** The catalog shape the validator needs from `@gitcade/library`. */
export interface LibraryCatalog {
  version: string;
  parts: Array<{ id: string; version: string }>;
}

/**
 * Verify every `partId@version` reference resolves within the catalog of the
 * pinned `libraryVersion`. When no catalog is available, callers pass
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

/**
 * Corner inset (px) within which the mute (top-left) / pause (top-right) DOM buttons
 * sit in every game's index.html. Canvas HUD authored inside it gets covered by the
 * button — the HUD safe-area convention.
 */
const HUD_CORNER_INSET = 52;

/**
 * Known library/SDK behavior TYPE names that SET an entity's velocity (`vx`/`vy`)
 * each tick and rely on a later integrator to move it — the composition contract
 * documented in the library README ("movement parts SET velocity; order a
 * `velocity` behavior AFTER them"). A heuristic list of stable published part ids;
 * a custom/unknown type is never classified, so it can't trip a false positive.
 */
const VELOCITY_SETTERS = new Set<string>([
  "ai-chase",
  "ai-flee",
  "ai-wander",
  "ai-patrol",
  "move-4dir",
  "move-topdown-360",
  "auto-scroll",
  "follow-path",
  "keyboard-axis",
  "follow-entity-axis",
]);

/**
 * Behavior TYPE names that INTEGRATE velocity into position (`velocity`) or move an
 * entity's position DIRECTLY (`move-grid-step`/`move-platformer`) — any one of them
 * later in an entity's behavior array satisfies a {@link VELOCITY_SETTERS} mover.
 */
const VELOCITY_INTEGRATORS = new Set<string>(["velocity", "move-grid-step", "move-platformer"]);

/**
 * Non-failing presentation ADVISORIES. These are WARNING-level only — a game that
 * passes still passes (`ok` ignores warnings) — surfacing two recurring authoring
 * footguns:
 *  - **HUD under a corner button**: a `hud`-tagged entity tucked into a top corner
 *    where the mute/pause DOM buttons draw. Keep canvas HUD ≥~56px from the corners.
 *  - **Full-field rect at center coords**: a near-full-field rect (tap target / UI
 *    overlay) anchored at the field CENTER, so its top-left box overflows and only
 *    partly covers the field. Full-field rects anchor at {0,0}. The headless smoke
 *    boot taps dead center, so a broken AABB still boots green — which is exactly why
 *    this is an authoring advisory, not a runtime catch.
 *
 * Both are deliberately precise (corner zone / center signature) to avoid false
 * positives on legitimate edge-anchored decor tiles or origin-anchored backgrounds.
 */
export function checkAdvisories(scenes: Scene[]): Issue[] {
  const issues: Issue[] = [];
  for (const scene of scenes) {
    const W = scene.size?.width ?? 800;
    const H = scene.size?.height ?? 600;
    for (let i = 0; i < scene.entities.length; i++) {
      const e = scene.entities[i];
      const { x, y } = e.position;
      const { w, h } = e.size;
      const where = `${scene.id}.entities[${i}] (${e.id})`;

      if (e.tags.includes("hud") && y < HUD_CORNER_INSET && (x < HUD_CORNER_INSET || x > W - HUD_CORNER_INSET)) {
        const corner = x < HUD_CORNER_INSET ? "top-left mute" : "top-right pause";
        issues.push({
          level: "warning",
          code: "hud-corner-button",
          message: `HUD entity sits in the ${corner} button zone (~${HUD_CORNER_INSET}px corner inset); shift it clear (≥56px) so the DOM button doesn't cover it`,
          where,
        });
      }

      const nearFull = w >= 0.8 * W && h >= 0.8 * H;
      const nearCenter = Math.abs(x - W / 2) < 0.15 * W && Math.abs(y - H / 2) < 0.15 * H;
      if (nearFull && nearCenter && x > 0 && y > 0) {
        issues.push({
          level: "warning",
          code: "fullfield-rect-offset",
          message: `near-full-field entity (${w}x${h}) anchored at center coords (${x},${y}) overflows the ${W}x${H} field — full-field rects use top-left position {0,0} (the center-tap smoke boot can hide the resulting broken AABB)`,
          where,
        });
      }

      // Behavior-ordering advisories run on this authored entity's behavior array.
      issues.push(...checkBehaviorOrder(e.behaviors, where));
    }

    // The behavior-ordering footguns most often bite SPAWNED entities — creeps,
    // enemies, and bullets live as `prototype`/`projectile` objects inside a
    // system's or behavior's params (wave-spawner, lives-respawn, ai-aim-and-fire,
    // shoot), NOT as scene entities — so the same checks must reach into params.
    for (let si = 0; si < scene.systems.length; si++) {
      collectPrototypes(scene.systems[si].params, `${scene.id}.systems[${si}:${scene.systems[si].type}].params`).forEach(
        (p) => issues.push(...checkBehaviorOrder(p.behaviors, p.where)),
      );
    }
    scene.entities.forEach((e, ei) => {
      e.behaviors.forEach((b, bi) => {
        collectPrototypes(b.params, `${scene.id}.entities[${ei}:${e.id}].behaviors[${bi}:${b.type}].params`).forEach((p) =>
          issues.push(...checkBehaviorOrder(p.behaviors, p.where)),
        );
      });
    });
  }
  return issues;
}

/** A minimal behavior-def shape (authored entity or spawn prototype). */
interface BehaviorLike {
  type: string;
  params?: Record<string, unknown>;
}

/**
 * The two behavior-ORDERING advisories — "passes-validation-but-silently-broken"
 * footguns. Heuristic (keyed on stable published part names) and never classify a
 * custom/unknown type, so a bespoke mover can't trip a false positive. Runs on any
 * behavior array — an authored entity OR a spawn prototype.
 */
function checkBehaviorOrder(behaviors: BehaviorLike[], where: string): Issue[] {
  const issues: Issue[] = [];
  const types = behaviors.map((b) => b.type);

  // (1) mover-without-integrator: a known velocity-SETTING behavior with no
  //     integrator (`velocity`) / direct-position mover anywhere in the array — it
  //     sets vx/vy that nothing turns into motion, so it silently never moves. The
  //     60-frame smoke boot asserts no throw, not motion, so this slips through.
  const hasSetter = types.some((t) => VELOCITY_SETTERS.has(t));
  const hasIntegrator = types.some((t) => VELOCITY_INTEGRATORS.has(t));
  if (hasSetter && !hasIntegrator) {
    const setter = types.find((t) => VELOCITY_SETTERS.has(t));
    issues.push({
      level: "warning",
      code: "mover-without-integrator",
      message: `has a velocity-setting behavior ("${setter}") but no \`velocity\` integrator (or move-grid-step/move-platformer) after it — it sets vx/vy that nothing integrates, so it never moves. Add a \`velocity\` behavior later in this behaviors array`,
      where,
    });
  }

  // (2) scale-ramp-after-integrator: a `scale-by-state` that writes velocity
  //     (target vx/vy/velocity, default "velocity") ordered AFTER the `velocity`
  //     integrator — the integrator consumes the velocity first and the next tick's
  //     mover overwrites the scaled value, so the ramp is a visual-only no-op (the
  //     exact survival-arena bug: enemies "got faster" in the HUD but never moved
  //     faster). Move it BEFORE `velocity`.
  const firstVelocityIdx = types.indexOf("velocity");
  if (firstVelocityIdx >= 0) {
    for (let bi = firstVelocityIdx + 1; bi < behaviors.length; bi++) {
      const b = behaviors[bi];
      if (b.type !== "scale-by-state") continue;
      // Mode "once" legitimately runs AFTER the seeder (it sets the field a single
      // time, e.g. a per-level launch-speed bump) — the part's own docs prescribe
      // that order — so it is NOT the consumed-each-tick footgun this advisory flags.
      const mode = typeof b.params?.mode === "string" ? (b.params.mode as string) : "set";
      if (mode === "once") continue;
      const target = typeof b.params?.target === "string" ? (b.params.target as string) : "velocity";
      if (target === "velocity" || target === "vx" || target === "vy") {
        issues.push({
          level: "warning",
          code: "scale-ramp-after-integrator",
          message: `\`scale-by-state\` targeting "${target}" is ordered AFTER the \`velocity\` integrator — the integrator consumes the velocity first, so the ramp never affects motion (it only changes the post-tick vx/vy a test might read). Move this scale-by-state BEFORE the \`velocity\` behavior`,
          where: `${where}.behaviors[${bi}]`,
        });
      }
    }
  }

  return issues;
}

/** A spawn prototype discovered inside a params subtree: its behaviors + a location label. */
interface FoundPrototype {
  behaviors: BehaviorLike[];
  where: string;
}

/**
 * Recursively collect entity-like spawn prototypes — any object carrying a
 * `behaviors` array of `{type}` defs — from a params subtree. Finds nested
 * prototypes too (a spawner whose prototype itself spawns). The element guard
 * keeps an unrelated `behaviors`-named field from matching.
 */
function collectPrototypes(node: unknown, where: string, out: FoundPrototype[] = []): FoundPrototype[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectPrototypes(v, `${where}[${i}]`, out));
    return out;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (
      Array.isArray(o.behaviors) &&
      o.behaviors.length > 0 &&
      o.behaviors.every((b) => b && typeof b === "object" && typeof (b as { type?: unknown }).type === "string")
    ) {
      const id = typeof o.id === "string" ? o.id : "prototype";
      out.push({ behaviors: o.behaviors as BehaviorLike[], where: `${where} (${id})` });
    }
    for (const [k, v] of Object.entries(o)) collectPrototypes(v, `${where}.${k}`, out);
  }
  return out;
}
