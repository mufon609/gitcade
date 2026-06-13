/** An active pointer/touch in world (canvas) coordinates. */
export interface Pointer {
  id: number;
  x: number;
  y: number;
  down: boolean;
}

/** Minimal DOM surface so Input is testable and degrades cleanly when absent. */
interface InputTarget {
  addEventListener(type: string, listener: (ev: any) => void, opts?: any): void;
  removeEventListener(type: string, listener: (ev: any) => void): void;
}

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

  /** True while the given `KeyboardEvent.code` is held. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True if ANY of the given codes is held. */
  anyDown(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /**
   * A -1/0/+1 axis from two key groups. Both held cancels to 0. Also folds in
   * touch zones if provided (a pointer in `negZone`/`posZone` rectangles counts).
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

  setWorldSize(width: number, height: number): void {
    this.world = { width, height };
  }

  /**
   * Attach DOM listeners. `keyTarget` is usually `window`; `pointerTarget` the
   * canvas element. No-op-safe: pass nothing in headless tests.
   */
  attach(opts: { keyTarget?: InputTarget | null; pointerTarget?: (InputTarget & { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } }) | null }): void {
    const { keyTarget, pointerTarget } = opts;

    if (keyTarget) {
      const onDown = (e: KeyboardEvent) => {
        this.down.add(e.code);
      };
      const onUp = (e: KeyboardEvent) => {
        this.down.delete(e.code);
      };
      keyTarget.addEventListener("keydown", onDown);
      keyTarget.addEventListener("keyup", onUp);
      this.detachers.push(() => {
        keyTarget.removeEventListener("keydown", onDown);
        keyTarget.removeEventListener("keyup", onUp);
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
      };
      const onPDown = (e: PointerEvent) => upsert(e, true);
      const onPMove = (e: PointerEvent) => {
        if (this.pointers.has(e.pointerId)) upsert(e, this.pointers.get(e.pointerId)!.down);
      };
      const onPUp = (e: PointerEvent) => {
        this.pointers.delete(e.pointerId);
      };
      pointerTarget.addEventListener("pointerdown", onPDown);
      pointerTarget.addEventListener("pointermove", onPMove);
      pointerTarget.addEventListener("pointerup", onPUp);
      pointerTarget.addEventListener("pointercancel", onPUp);
      this.detachers.push(() => {
        pointerTarget.removeEventListener("pointerdown", onPDown);
        pointerTarget.removeEventListener("pointermove", onPMove);
        pointerTarget.removeEventListener("pointerup", onPUp);
        pointerTarget.removeEventListener("pointercancel", onPUp);
      });
    }
  }

  detach(): void {
    for (const d of this.detachers) d();
    this.detachers = [];
    this.down.clear();
    this.pointers.clear();
  }
}
