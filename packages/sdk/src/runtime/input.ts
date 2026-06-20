/** An active pointer/touch in world (canvas) coordinates. */
export interface Pointer {
  id: number;
  x: number;
  y: number;
  down: boolean;
}

/**
 * A one-frame pointer EDGE in world coordinates: a pointer that went down
 * (`justPressed`) or up (`justReleased`) during the frame just simulated. Distinct
 * from the held {@link Pointer} set — a Tap exists for exactly one fixed tick.
 */
export interface Tap {
  id: number;
  x: number;
  y: number;
}

/**
 * A declarative binding for one logical ACTION (the input action layer).
 * A logical action ("thrust", "move") is satisfiable by ANY of its sources, so a
 * mover reads `world.input.action(name)` / `actionVector(name)` and never cares
 * whether the player used a key, an on-screen button, or a virtual d-pad. This is
 * what lets touch feed a keyboard-authored mover WITHOUT the game synthesizing
 * fake `KeyboardEvent`s (the bandaid this layer retires). All coordinates are in
 * WORLD space (the same space {@link Pointer} reports), so a binding is plain data:
 * its numeric leaves use the structural `x`/`y`/`w`/`h`/`radius` keys, so it passes
 * the validator's no-magic-number gate with no `$cfg` indirection.
 */
export interface ActionBinding {
  /** BUTTON source: active while ANY of these `KeyboardEvent.code` values is held. */
  keys?: string[];
  /** BUTTON source: active while a DOWN pointer is inside this world-space rect (an on-screen / hold-anywhere zone). */
  rect?: { x: number; y: number; w: number; h: number };
  /** DIRECTIONAL source: key groups → a unit vector ({-1,0,1} per axis); opposed keys cancel. */
  axisKeys?: { up?: string[]; down?: string[]; left?: string[]; right?: string[] };
  /** DIRECTIONAL source: an analog d-pad — the first DOWN pointer inside the circular zone yields a vector from its center. */
  zone?: { x: number; y: number; radius: number };
}

/** A host-pushed override for one action (e.g. a DOM button reporting "held"). Sticky until changed. */
interface ActionOverride {
  active: boolean;
  vec: { x: number; y: number };
}

/** Minimal DOM surface so Input is testable and degrades cleanly when absent. */
interface InputTarget {
  addEventListener(type: string, listener: (ev: any) => void, opts?: any): void;
  removeEventListener(type: string, listener: (ev: any) => void): void;
}

/**
 * `KeyboardEvent.code` values whose browser default is to SCROLL the page
 * (or, for Space, scroll AND activate a focused control). When the key target
 * is `window` these otherwise fire the page's native scroll while you play —
 * Space-to-flap games (helicopter) become unplayable. We `preventDefault()`
 * exactly these, and only when no modifier is held, so OS/browser shortcuts
 * (Ctrl+R, Cmd+L, Alt+Tab) and Tab focus traversal are untouched.
 */
const SCROLL_KEYS = new Set<string>([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/**
 * Unified keyboard + touch/pointer input. In headless/jsdom contexts (no DOM
 * target) it simply reports nothing down and no pointers, so simulation runs
 * idle — exactly what the 60-frame smoke test needs.
 *
 * Keyboard uses `KeyboardEvent.code` values (`"ArrowUp"`, `"KeyW"`, `"Space"`).
 */
export class Input {
  private down = new Set<string>();
  private pointers = new Map<number, Pointer>();
  private detachers: Array<() => void> = [];
  /** Bounds used to clamp/scale pointer coordinates into world space. */
  private world = { width: 0, height: 0 };

  // Button-less hover CURSOR. The held-pointer set above tracks pressed
  // pointers (for the click edge); this is the LAST pointer position whether or not a
  // button is down — the channel a desktop hover affordance (TD's build preview) needs.
  // Driven by bare `pointermove` (desktop hover has no button) plus pointerdown/up, in the
  // SAME world space as every other pointer channel. null until the first pointer event and
  // cleared on pointerleave / focus loss / detach, so a cursor that left the canvas reports
  // "no position" — matching a host `pointerleave → delete world.state.buildHover`
  // bridge this retires. Touch has no hover (a tap ends in pointerleave), so it stays null
  // there, and headless never sees a pointer event, so it stays null in tests/validate.
  private lastCursor: { x: number; y: number } | null = null;

  // One-frame pointer edge buffers. Real pointer events arrive asynchronously
  // BETWEEN fixed ticks; they are captured here and exposed for exactly the next
  // tick, then cleared by endFrame() at tick end — so a behavior/system sees a
  // deterministic, reproducible click edge (the same model the harness drives with
  // { click, holdFrames }). These never change the held-pointer contract above.
  private pressedThisFrame: Tap[] = [];
  private releasedThisFrame: Tap[] = [];

  // Logical-action layer. `actionBindings` are declarative (installed
  // from scene DATA by the library `input-actions` system each tick); `actionOverrides`
  // are host-pushed (a DOM button calling setAction). Both are SCENE-SCOPED — cleared
  // by `resetActions()` on every scene change (called from Game.loadScene) — and
  // evaluated LIVE against the held key/pointer state, so there is no per-frame edge
  // bookkeeping. Empty for any game that never defines an action, so this whole layer
  // is inert (byte-identical behavior) unless a game opts in.
  private actionBindings = new Map<string, ActionBinding>();
  private actionOverrides = new Map<string, ActionOverride>();

  /** True while the given `KeyboardEvent.code` is held. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True if ANY of the given codes is held. */
  anyDown(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /**
   * A -1/0/+1 axis from two key groups (keyboard only). Both held cancels to 0.
   * (Touch control is done by synthesizing key events into this set — see the games'
   * `#touch` pads — not by passing pointer zones here.)
   */
  axis(negCodes: string[], posCodes: string[]): number {
    let v = 0;
    if (this.anyDown(negCodes)) v -= 1;
    if (this.anyDown(posCodes)) v += 1;
    return v;
  }

  /** Active pointers (touches / mouse-down), in world coordinates. */
  activePointers(): Pointer[] {
    return [...this.pointers.values()].filter((p) => p.down);
  }

  /** Pointers that went DOWN during the frame just simulated. Cleared each tick by endFrame(). */
  justPressed(): Tap[] {
    return this.pressedThisFrame;
  }

  /** Pointers that went UP during the frame just simulated (the click EDGE). Cleared each tick. */
  justReleased(): Tap[] {
    return this.releasedThisFrame;
  }

  /** The completed click edges this frame — alias of {@link justReleased}. */
  taps(): Tap[] {
    return this.releasedThisFrame;
  }

  /** Convenience: true if any pointer went down this frame. */
  clicked(): boolean {
    return this.pressedThisFrame.length > 0;
  }

  /**
   * The last known pointer position in WORLD coordinates, button held or NOT — the
   * button-less hover channel. Desktop mouse-move drives it (a bare
   * `pointermove` with no button is exactly this), so a hover affordance can track the
   * cursor without the game hand-rolling its own `pointermove` listener + screen→world
   * transform. Returns `null` until the first pointer event and after the cursor leaves
   * the canvas (`pointerleave`), focus is lost, or input is detached — so touch (a tap
   * ends in pointerleave) and headless both report `null`, and a consumer simply gets no
   * hover there (the prior behavior). Additive: nothing else reads it.
   */
  cursor(): { x: number; y: number } | null {
    return this.lastCursor;
  }

  /**
   * Host-only: clear the per-frame edge buffers. Called by {@link Game.update} at
   * tick end (next to `events.clear()`), so an edge lives exactly one fixed tick.
   */
  endFrame(): void {
    this.pressedThisFrame.length = 0;
    this.releasedThisFrame.length = 0;
  }

  // --- Headless input scripting ------------------------------------------------
  // Drive input deterministically with no DOM — the sanctioned entrypoint for headless
  // tests and the determinism-conformance harness, replacing the fragile monkeypatching of
  // isDown/axis/etc. Both mutate the same held-set / edge buffers the DOM listeners do, so a
  // scripted key reads identically to a real one (isDown/anyDown/axis/action/actionVector) and
  // a scripted tap drives the same one-frame edge (justPressed/justReleased/taps/clicked).

  /** Hold (`down=true`) or release (`down=false`) a key by its `KeyboardEvent.code`. */
  setKey(code: string, down: boolean): void {
    if (down) this.down.add(code);
    else this.down.delete(code);
  }

  /**
   * Inject a one-frame pointer TAP (a press+release edge) at world point `(x, y)` — it lives
   * exactly the next tick, then {@link endFrame} clears it, like a real click edge. Drives the
   * tap-reading paths (`taps`/`justReleased`/`justPressed`/`clicked`); it does not add a HELD
   * pointer (so hold-zone actions are unaffected — intentional for a discrete tap).
   */
  tap(x: number, y: number): void {
    this.pressedThisFrame.push({ id: -1, x, y });
    this.releasedThisFrame.push({ id: -1, x, y });
  }

  // --- Logical-action layer ----------------------------------------------------

  /**
   * Install/merge declarative action bindings. Idempotent — the library
   * `input-actions` system calls this every tick with the scene's binding DATA, so
   * a binding is always present by the time the behavior phase runs (systems run
   * before behaviors). Re-defining a name replaces its binding.
   */
  defineActions(defs: Record<string, ActionBinding>): void {
    for (const [name, b] of Object.entries(defs)) this.actionBindings.set(name, b);
  }

  /**
   * Host override: hold or release a logical action externally — e.g. a DOM touch
   * button's `pointerdown`/`pointerup` calling `setAction("thrust", true/false)`
   * instead of synthesizing a fake key event. Sticky until changed; cleared on
   * focus loss, scene change, and detach. The sanctioned replacement for the
   * synthesized-`KeyboardEvent` pattern when a game keeps DOM controls.
   */
  setAction(name: string, active: boolean): void {
    const o = this.actionOverrides.get(name) ?? { active: false, vec: { x: 0, y: 0 } };
    o.active = active;
    this.actionOverrides.set(name, o);
  }

  /** Host override: drive a directional action's analog vector (e.g. a DOM joystick). Sticky. */
  setActionVector(name: string, x: number, y: number): void {
    const o = this.actionOverrides.get(name) ?? { active: false, vec: { x: 0, y: 0 } };
    o.vec = { x, y };
    this.actionOverrides.set(name, o);
  }

  /** Clear any host override on `name` (the binding, if any, still applies). */
  clearAction(name: string): void {
    this.actionOverrides.delete(name);
  }

  /** Drop ALL action bindings and overrides. Scene-scoped: called by `Game.loadScene`. */
  resetActions(): void {
    this.actionBindings.clear();
    this.actionOverrides.clear();
  }

  /**
   * Is logical action `name` active this tick? True if a host override holds it, a
   * bound key is held, a bound rect/zone has a down pointer, or a bound directional
   * source is deflected. Unknown/undefined action ⇒ `false` (so the layer is inert
   * for games that don't use it).
   */
  action(name: string): boolean {
    const o = this.actionOverrides.get(name);
    if (o && (o.active || o.vec.x !== 0 || o.vec.y !== 0)) return true;
    const b = this.actionBindings.get(name);
    if (!b) return false;
    if (b.keys && this.anyDown(b.keys)) return true;
    if (b.rect && this.pointerInRect(b.rect)) return true;
    const v = this.bindingVector(b);
    return v.x !== 0 || v.y !== 0;
  }

  /**
   * The directional vector for action `name`: the keyboard axis (digital, ±1) OR
   * the analog d-pad zone OR a host override. A non-zero host override wins; else
   * the keyboard axis wins when any directional key is held; else the zone. Unknown
   * action / no directional source ⇒ `{x:0,y:0}`.
   */
  actionVector(name: string): { x: number; y: number } {
    const o = this.actionOverrides.get(name);
    if (o && (o.vec.x !== 0 || o.vec.y !== 0)) return { x: o.vec.x, y: o.vec.y };
    const b = this.actionBindings.get(name);
    if (!b) return { x: 0, y: 0 };
    return this.bindingVector(b);
  }

  /** True if any DOWN pointer falls inside the world-space rect. */
  private pointerInRect(r: { x: number; y: number; w: number; h: number }): boolean {
    for (const p of this.pointers.values()) {
      if (p.down && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return true;
    }
    return false;
  }

  /** Combine a binding's directional sources into a vector (keyboard axis first, then analog zone). */
  private bindingVector(b: ActionBinding): { x: number; y: number } {
    const ax = b.axisKeys;
    if (ax) {
      let x = 0;
      let y = 0;
      if (ax.left && this.anyDown(ax.left)) x -= 1;
      if (ax.right && this.anyDown(ax.right)) x += 1;
      if (ax.up && this.anyDown(ax.up)) y -= 1;
      if (ax.down && this.anyDown(ax.down)) y += 1;
      if (x !== 0 || y !== 0) return { x, y };
    }
    const z = b.zone;
    if (z) {
      for (const p of this.pointers.values()) {
        if (!p.down) continue;
        const dx = p.x - z.x;
        const dy = p.y - z.y;
        const dist = Math.hypot(dx, dy);
        if (dist > z.radius * 1.6) continue; // pointer is elsewhere on screen
        const DEADZONE = 0.25; // structural, source-level — not a balance value
        if (dist < z.radius * DEADZONE) return { x: 0, y: 0 };
        const n = Math.max(dist, 0.0001);
        const mag = Math.min(1, dist / z.radius);
        return { x: (dx / n) * mag, y: (dy / n) * mag };
      }
    }
    return { x: 0, y: 0 };
  }

  setWorldSize(width: number, height: number): void {
    this.world = { width, height };
  }

  /**
   * Attach DOM listeners. `keyTarget` is usually `window`; `pointerTarget` the
   * canvas element. No-op-safe: pass nothing in headless tests.
   */
  attach(opts: { keyTarget?: InputTarget | null; pointerTarget?: (InputTarget & { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number }; setPointerCapture?: (pointerId: number) => void }) | null }): void {
    const { keyTarget, pointerTarget } = opts;

    if (keyTarget) {
      const onDown = (e: KeyboardEvent) => {
        this.down.add(e.code);
        // Suppress the browser's native scroll for game-control keys so the page
        // doesn't scroll out from under the player. Guarded on `cancelable` and on
        // the absence of modifiers so browser/OS shortcuts still pass through.
        if (e.cancelable && !e.ctrlKey && !e.metaKey && !e.altKey && SCROLL_KEYS.has(e.code)) {
          e.preventDefault();
        }
      };
      const onUp = (e: KeyboardEvent) => {
        this.down.delete(e.code);
      };
      // Focus left the game (Alt-Tab, click outside the iframe, OS notification,
      // tab switch). The browser delivers the keydown but the matching keyup is
      // lost, so a held control would stick "down" forever (helicopter rising,
      // snake mis-steering). Drop all held keys/pointers when focus is lost.
      const onBlur = () => {
        this.down.clear();
        this.pointers.clear();
        // A held touch-button override (setAction) must release on focus loss too,
        // just like a held key — otherwise the action sticks "on" forever.
        this.actionOverrides.clear();
        // The cursor is no longer over the game — drop the hover position.
        this.lastCursor = null;
      };
      keyTarget.addEventListener("keydown", onDown);
      keyTarget.addEventListener("keyup", onUp);
      keyTarget.addEventListener("blur", onBlur);
      this.detachers.push(() => {
        keyTarget.removeEventListener("keydown", onDown);
        keyTarget.removeEventListener("keyup", onUp);
        keyTarget.removeEventListener("blur", onBlur);
      });
    }

    if (pointerTarget) {
      const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
        const rect = pointerTarget.getBoundingClientRect?.();
        if (!rect) return { x: clientX, y: clientY };
        const sx = rect.width > 0 ? this.world.width / rect.width : 1;
        const sy = rect.height > 0 ? this.world.height / rect.height : 1;
        return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
      };
      const upsert = (e: PointerEvent, down: boolean) => {
        const { x, y } = toWorld(e.clientX, e.clientY);
        this.pointers.set(e.pointerId, { id: e.pointerId, x, y, down });
        // The held pointer's position is also the live cursor position — so a drag
        // keeps the hover cursor fresh, not just a button-less mouse-move.
        this.lastCursor = { x, y };
      };
      const onPDown = (e: PointerEvent) => {
        upsert(e, true);
        // Capture the pointer so its move/up events keep coming to the canvas even
        // after the pointer is dragged OFF it. Without this, a drag that releases
        // outside the canvas fires `pointerup` on some other element, so the held
        // pointer is never deleted — leaving e.g. survival-arena's pointer-follow
        // walking toward the last point forever. Guarded: jsdom/test fakes and old
        // engines may lack the method; capture is a best-effort enhancement.
        try {
          pointerTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* setPointerCapture can throw if the pointer is already gone — ignore */
        }
        // Record the press EDGE (held-set upsert above is unchanged).
        const p = this.pointers.get(e.pointerId);
        if (p) this.pressedThisFrame.push({ id: p.id, x: p.x, y: p.y });
      };
      const onPMove = (e: PointerEvent) => {
        if (this.pointers.has(e.pointerId)) {
          upsert(e, this.pointers.get(e.pointerId)!.down); // tracked (held) pointer — also refreshes lastCursor
        } else {
          // A button-less hover move: no held pointer to update, but the cursor
          // position still advances for world.input.cursor().
          this.lastCursor = toWorld(e.clientX, e.clientY);
        }
      };
      const onPUp = (e: PointerEvent) => {
        // Record the release EDGE BEFORE deleting from the held map (the :delete
        // below is the unchanged held-set contract — we only add the edge record).
        const p = this.pointers.get(e.pointerId) ?? { id: e.pointerId, ...toWorld(e.clientX, e.clientY) };
        this.releasedThisFrame.push({ id: p.id, x: p.x, y: p.y });
        this.pointers.delete(e.pointerId);
      };
      // The cursor left the canvas — drop the hover position so a hover-driven affordance
      // (build preview) hides, matching a host `pointerleave → delete buildHover`
      // bridge. Boundary events are suppressed while a pointer is captured, so a drag
      // OFF the canvas keeps lastCursor live; this fires on a true leave or after a touch
      // releases capture (pointerup → leave), so touch reports null after its tap.
      const onPLeave = () => {
        this.lastCursor = null;
      };
      pointerTarget.addEventListener("pointerdown", onPDown);
      pointerTarget.addEventListener("pointermove", onPMove);
      pointerTarget.addEventListener("pointerup", onPUp);
      pointerTarget.addEventListener("pointercancel", onPUp);
      pointerTarget.addEventListener("pointerleave", onPLeave);
      this.detachers.push(() => {
        pointerTarget.removeEventListener("pointerdown", onPDown);
        pointerTarget.removeEventListener("pointermove", onPMove);
        pointerTarget.removeEventListener("pointerup", onPUp);
        pointerTarget.removeEventListener("pointercancel", onPUp);
        pointerTarget.removeEventListener("pointerleave", onPLeave);
      });
    }
  }

  detach(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.down.clear();
    this.pointers.clear();
    this.pressedThisFrame.length = 0;
    this.releasedThisFrame.length = 0;
    this.lastCursor = null; // no listeners ⇒ no live cursor
    this.resetActions();
  }
}
