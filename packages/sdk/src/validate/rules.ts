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

/**
 * Corner inset (px) within which the mute (top-left) / pause (top-right) DOM buttons
 * sit in every game's index.html. Canvas HUD authored inside it gets covered by the
 * button — the HUD safe-area convention (0.3.1, helicopter-05 / survival-arena-06).
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
 * Non-failing presentation ADVISORIES (0.3.1). These are WARNING-level only — a game
 * that passed before still passes (`ok` ignores warnings) — surfacing two recurring
 * authoring footguns the 0.3.0 game audit hit across several games:
 *  - **HUD under a corner button** (helicopter-05 / survival-arena-06): a `hud`-tagged
 *    entity tucked into a top corner where the mute/pause DOM buttons draw. Keep canvas
 *    HUD ≥~56px from the corners.
 *  - **Full-field rect at center coords** (idle-clicker IC-10): a near-full-field rect
 *    (tap target / UI overlay) anchored at the field CENTER, so its top-left box
 *    overflows and only partly covers the field. Full-field rects anchor at {0,0}. The
 *    headless smoke boot taps dead center, so a broken AABB still boots green — which is
 *    exactly why this is an authoring advisory, not a runtime catch.
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
 * The two behavior-ORDERING advisories (0.3.2) — "passes-validation-but-silently-
 * broken" footguns the 0.3.x game audit surfaced. Heuristic (keyed on stable
 * published part names) and never classify a custom/unknown type, so a bespoke
 * mover can't trip a false positive. Runs on any behavior array — an authored
 * entity OR a spawn prototype.
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
