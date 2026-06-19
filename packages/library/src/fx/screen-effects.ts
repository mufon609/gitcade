import type { World } from "@gitcade/sdk";

/** The per-frame visual offset/overlay the host applies to the canvas. */
export interface ScreenEffectFrame {
  /** Canvas translate in px. */
  dx: number;
  dy: number;
  /** Full-screen flash overlay color + alpha (0 = none). */
  flashColor: string;
  flashAlpha: number;
  /** Full-screen fade overlay color + alpha (1 = fully covered). */
  fadeColor: string;
  fadeAlpha: number;
}

/**
 * `screen-shake` / `screen-flash` / `screen-fade` — screen-level FX, implemented as
 * a small deterministic HOST-SIDE controller rather than a runtime system. Why
 * host-side: the FROZEN SDK renderer draws in absolute world coordinates with no
 * camera transform, so a camera shake or a full-screen overlay belongs to the page
 * that owns the canvas, not to a behavior that would have to corrupt entity
 * positions. The controller is pure and unit-testable (no DOM); {@link attachScreenEffects}
 * is the thin browser glue that applies each frame and is a no-op headless.
 *
 * Effects are additive: shake + flash + fade can run at once.
 */
export class ScreenEffects {
  // shake
  private shakeMag = 0;
  private shakeDur = 0;
  private shakeT = 0;
  private shakeFreq = 40;
  // flash
  private flashColorV = "#ffffff";
  private flashDur = 0;
  private flashT = 0;
  // fade
  private fadeColorV = "#000000";
  private fadeDur = 0;
  private fadeT = 0;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeActive = false;

  /** Shake the screen with `magnitude` px, decaying over `duration` s. */
  shake(magnitude = 8, duration = 0.3, frequency = 40): void {
    // Take the stronger of any in-progress shake so rapid hits don't weaken it.
    if (magnitude * 1 >= this.currentShakeMag()) {
      this.shakeMag = magnitude;
      this.shakeDur = duration;
      this.shakeT = 0;
      this.shakeFreq = frequency;
    }
  }

  /** Flash the screen `color`, fading out over `duration` s. */
  flash(color = "#f4f4f4", duration = 0.2): void {
    this.flashColorV = color;
    this.flashDur = duration;
    this.flashT = 0;
  }

  /** Fade the screen FROM clear TO `color` (cover) over `duration` s. */
  fadeOut(color = "#1a1c2c", duration = 0.5): void {
    this.fadeColorV = color;
    this.fadeFrom = 0;
    this.fadeTo = 1;
    this.fadeDur = duration;
    this.fadeT = 0;
    this.fadeActive = true;
  }

  /** Fade the screen FROM `color` (cover) TO clear over `duration` s. */
  fadeIn(color = "#1a1c2c", duration = 0.5): void {
    this.fadeColorV = color;
    this.fadeFrom = 1;
    this.fadeTo = 0;
    this.fadeDur = duration;
    this.fadeT = 0;
    this.fadeActive = true;
  }

  private currentShakeMag(): number {
    if (this.shakeT >= this.shakeDur) return 0;
    return this.shakeMag * (1 - this.shakeT / this.shakeDur);
  }

  /** Advance all effects by `dt` and return the frame to apply. Deterministic. */
  update(dt: number): ScreenEffectFrame {
    let dx = 0;
    let dy = 0;
    if (this.shakeT < this.shakeDur) {
      this.shakeT += dt;
      const mag = this.currentShakeMag();
      // Deterministic oscillation (no RNG) so tests are stable.
      dx = Math.sin(this.shakeT * this.shakeFreq) * mag;
      dy = Math.cos(this.shakeT * this.shakeFreq * 1.3) * mag;
    }

    let flashAlpha = 0;
    if (this.flashT < this.flashDur) {
      this.flashT += dt;
      flashAlpha = Math.max(0, 1 - this.flashT / this.flashDur);
    }

    let fadeAlpha = 0;
    if (this.fadeActive) {
      this.fadeT += dt;
      const k = this.fadeDur > 0 ? Math.min(1, this.fadeT / this.fadeDur) : 1;
      fadeAlpha = this.fadeFrom + (this.fadeTo - this.fadeFrom) * k;
      if (k >= 1) {
        this.fadeActive = false;
        fadeAlpha = this.fadeTo;
      }
    } else {
      fadeAlpha = this.fadeTo; // hold last fade level
    }

    return { dx, dy, flashColor: this.flashColorV, flashAlpha, fadeColor: this.fadeColorV, fadeAlpha };
  }

  /**
   * Subscribe effects to game events. `map` pairs an event name with a callback
   * that triggers effects, e.g. `{ "player-died": fx => fx.shake(12, 0.4) }`.
   */
  bindToEvents(world: World, map: Record<string, (fx: ScreenEffects, data: unknown) => void>): void {
    for (const [event, fn] of Object.entries(map)) {
      world.events.on(event, (data) => fn(this, data));
    }
  }
}

/**
 * Browser glue: drive a {@link ScreenEffects} each animation frame, translating the
 * canvas and drawing flash/fade overlays into an absolutely-positioned sibling. Pass
 * the canvas and (optionally) an overlay element. No-op when there is no DOM clock.
 * Returns a stop function.
 */
export function attachScreenEffects(
  fx: ScreenEffects,
  canvas: { style: { transform: string } },
  overlay?: { style: Record<string, string> } | null,
): () => void {
  if (typeof requestAnimationFrame !== "function") return () => {};
  let raf = 0;
  let last = typeof performance !== "undefined" ? performance.now() : 0;
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = fx.update(dt);
    const transform = `translate(${f.dx.toFixed(2)}px, ${f.dy.toFixed(2)}px)`;
    canvas.style.transform = transform;
    if (overlay) {
      // Flash takes visual priority over a resting fade level.
      overlay.style.background = f.flashAlpha > 0 ? f.flashColor : f.fadeColor;
      overlay.style.opacity = String(Math.max(f.flashAlpha, f.fadeAlpha));
      // Shake the overlay WITH the canvas, so a flash/fade stays locked to the
      // play-field instead of visibly sliding off it during a shake.
      overlay.style.transform = transform;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  };
}

/**
 * Wrap an event handler so it runs at most once per `ms`. The standard guard for a
 * SCREEN-level effect bound to a high-FREQUENCY event: without it, a swarm/pile-up
 * turns a per-hit `shake`/`flash` into a constant rumble or strobe — the same
 * over-juice the routine-action full-screen-flash anti-pattern is. The convention
 * (see CONVENTIONS.md): routine actions get a LOCAL particle burst, and the screen is
 * reserved for big rare beats; reach for this only when a screen effect on a
 * frequent-but-meaningful event (e.g. the player taking damage) genuinely earns its
 * place, then rate-limit it.
 *
 * Usage mirrors a normal `bindToEvents` handler:
 *   fx.bindToEvents(world, {
 *     damage: throttle(220, (f, data) => {
 *       if ((data as { target?: string } | null)?.target !== "player") return;
 *       f.shake(7, 0.2, 40);
 *     }),
 *   });
 *
 * Wall-clock throttle (FX is presentation, not sim — it need not be deterministic);
 * headless (no `performance`) it fires once then idles, matching the no-op renderer.
 */
export function throttle<A extends unknown[]>(ms: number, fn: (...args: A) => void): (...args: A) => void {
  let last = -Infinity;
  return (...args: A): void => {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (now - last < ms) return;
    last = now;
    fn(...args);
  };
}
