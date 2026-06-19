import type { BehaviorFn, SystemFn, ParamSpec } from "./types.js";

/** A registered behavior type: its implementation and optional param spec. */
export interface BehaviorRegistration {
  type: string;
  fn: BehaviorFn;
  spec?: ParamSpec;
}
export interface SystemRegistration {
  type: string;
  fn: SystemFn;
  spec?: ParamSpec;
}

/**
 * The behavior/system registry. The SDK ships built-in types here; the
 * `@gitcade/library` and a game's local `custom-behaviors/` register additional
 * TYPES (never new schema shapes) via {@link registerBehavior}/{@link registerSystem}.
 * This registration API is the FROZEN extension point.
 *
 * A `Registry` instance is created per game so registrations are isolated and
 * deterministic (no global mutable state leaking across games/tests).
 */
export class Registry {
  private behaviors = new Map<string, BehaviorRegistration>();
  private systems = new Map<string, SystemRegistration>();

  registerBehavior(type: string, fn: BehaviorFn, spec?: ParamSpec): this {
    this.behaviors.set(type, { type, fn, spec });
    return this;
  }
  registerSystem(type: string, fn: SystemFn, spec?: ParamSpec): this {
    this.systems.set(type, { type, fn, spec });
    return this;
  }

  getBehavior(type: string): BehaviorRegistration | undefined {
    return this.behaviors.get(type);
  }
  getSystem(type: string): SystemRegistration | undefined {
    return this.systems.get(type);
  }

  hasBehavior(type: string): boolean {
    return this.behaviors.has(type);
  }
  hasSystem(type: string): boolean {
    return this.systems.has(type);
  }

  behaviorTypes(): string[] {
    return [...this.behaviors.keys()];
  }
  systemTypes(): string[] {
    return [...this.systems.keys()];
  }

  /** Shallow copy so a game can extend the built-ins without mutating them. */
  clone(): Registry {
    const r = new Registry();
    for (const b of this.behaviors.values()) r.registerBehavior(b.type, b.fn, b.spec);
    for (const s of this.systems.values()) r.registerSystem(s.type, s.fn, s.spec);
    return r;
  }
}
