import type { World } from "./world.js";
import type { Entity } from "./entity.js";
import type { Background } from "../schema/scene.js";
import type { ShapeSprite, SheetSprite, TextSprite } from "../schema/sprite.js";

/** A minimal 2D context surface (subset we use), so types don't require lib.dom everywhere. */
type Ctx = CanvasRenderingContext2D;

/**
 * The render-interpolation offset (1.8.0) from a body/camera's CURRENT (latest-tick) position on one
 * axis: `(prev − cur) · (1 − alpha)`, i.e. draw it lerped between the last two ticks (`prev` at
 * `alpha 0`, `cur` at `alpha 1`) — up to one frame behind the sim, the classic fixed-timestep
 * smoothing that kills judder when rAF doesn't divide the sim rate. Returns 0 (draw at `cur`, no
 * interpolation) when the per-tick delta exceeds `snap` — a TELEPORT (scene warp, screen-wrap,
 * respawn), which interpolation would otherwise streak across the screen. At `alpha 1` it is always 0,
 * so the renderer is byte-identical to the pre-interpolation path.
 */
function interpOffset(prev: number, cur: number, alpha: number, snap: number): number {
  const d = prev - cur;
  if (d > snap || d < -snap) return 0; // teleport, not motion — snap to the current position
  return d * (1 - alpha);
}

/**
 * Interpolate a ROTATION (radians) between its last two tick values along the SHORTEST arc (1.10.0,
 * the rotation half of render interpolation). A plain lerp is WRONG for an angle: `face-angle` writes
 * `atan2(...)`, which jumps +π→−π across its branch cut (a turret tracking a target crossing behind it,
 * a projectile turning), and a `tween` spin wraps 2π→0 each revolution — a linear lerp would unwind the
 * whole way around backward. Normalizing `prev − cur` into (−π, π] interpolates the short way, so the wrap
 * is seamless. At `alpha 1` this returns `cur` exactly, so the renderer is byte-identical to the
 * non-interpolated path. (No teleport-snap: the shortest arc is ≤ π, so even an instant re-orient streaks
 * at most a half-turn for a single frame — far milder than a position teleport streaking the whole screen.)
 */
function lerpAngle(prev: number, cur: number, alpha: number): number {
  const d = Math.atan2(Math.sin(prev - cur), Math.cos(prev - cur)); // (prev − cur) wrapped to (−π, π]
  return cur + d * (1 - alpha);
}

/**
 * Interpolate a per-axis SCALE between its last two tick values (1.10.0, the scale half of render
 * interpolation). SNAPS (draws at `cur`, no interpolation) when the sign flips or crosses zero
 * (`prev * cur <= 0`): `face-velocity` flips `scaleX` SIGN instantly (+mag ↔ −mag) to mirror a sprite,
 * and lerping across that passes through 0 — collapsing the sprite to a line for a frame. A same-sign
 * change (a `tween` pop/pulse) interpolates smoothly. At `alpha 1` this returns `cur`, byte-identical.
 */
function lerpScale(prev: number, cur: number, alpha: number): number {
  if (prev * cur <= 0) return cur; // sign flip / through-zero (a face-velocity mirror) — snap, don't collapse
  return cur + (prev - cur) * (1 - alpha);
}

/** Muted fallback fills for tilemap indices when no tileset image is available. */
const TILE_FALLBACK_COLORS = ["#2a2f3a", "#3a3030", "#30343a", "#2f3a30", "#3a3a2f", "#352f3a"];

/** Subtle per-cell gridline for the no-tileset tilemap fallback, so a map reads as
 *  structured cells rather than one flat slab (0.3.1, td-09). */
const TILE_GRID_COLOR = "rgba(255,255,255,0.06)";

/**
 * Canvas 2D renderer (the "sprite renderer" primitive: static shapes, images,
 * sheet-animation frames, and bound text). Entirely OPTIONAL: constructed with a
 * `null` context (headless/jsdom) it renders nothing, which is exactly how the
 * 60-frame smoke test runs. WebGL is never assumed (Locked Decision: no GPU).
 */
export class Renderer {
  private images = new Map<string, HTMLImageElement>();

  constructor(private readonly ctx: Ctx | null) {}

  get active(): boolean {
    return this.ctx !== null;
  }

  /**
   * Draw the world. `alpha` (1.8.0 render interpolation) is how far into the NEXT fixed tick the real
   * clock has advanced (`accumulator / fixedDt`, in [0,1)); the renderer draws each body and the camera
   * lerped between the last two ticks, so motion is smooth even when the rAF rate doesn't divide the 60 Hz
   * sim rate (the judder fix). The FULL render transform is interpolated (1.10.0): position
   * (`body.prevX/prevY` → `x/y`), rotation (`body.prevRotation` → `rotation`, shortest-arc), and per-axis
   * scale (`body.prevScaleX/Y` → `scaleX/Y`, flip-snapped) — so a spinning `face-angle` sprite or a scaling
   * `tween` is as smooth as a moving one. DEFAULT 1 ⇒ draw at the latest sim transform, byte-identical to
   * the pre-interpolation renderer — and since the SIMULATION never renders (headless `stepFrames`), the
   * validator/replays/tests are wholly unaffected. Render-only.
   */
  render(world: World, background?: Background, alpha = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // The VIEWPORT (camera) size — what the canvas shows. Falls back to world bounds
    // for a hand-built world without a camera. With no scrolling these are equal, so
    // a camera-less scene renders exactly as before (0.7.0).
    const cam = world.camera;
    const vw = cam ? cam.width : world.bounds.width;
    const vh = cam ? cam.height : world.bounds.height;
    // A per-tick position delta larger than a viewport dimension is a TELEPORT (scene warp, screen-wrap,
    // respawn), not motion — interpolating across it would streak the body over the screen for a frame,
    // so {@link interpOffset} snaps such a body to its current position instead. Real motion (even a fast
    // dash, tens of px/tick) is far below this, so the two never collide.
    const snap = Math.min(vw, vh);

    // Background is drawn in SCREEN space (no camera offset), so a solid/parallax
    // backdrop stays fixed behind the scrolling world.
    this.drawBackground(ctx, world, background, vw, vh);

    // Camera transform (0.7.0): pan the world under the viewport, including any transient shake OFFSET
    // (`shakeX`/`shakeY`, kept separate from the follow base). The follow BASE is interpolated between
    // ticks (1.8.0) so scrolling is smooth; shake (already a per-frame jitter) rides on top
    // un-interpolated. Skipped at the origin so a non-scrolling, non-shaking scene takes the exact
    // pre-0.7 path (no save/translate), and rounded to whole px so tiles/sprites stay crisp.
    const camX = cam ? cam.x + interpOffset(cam.prevX ?? cam.x, cam.x, alpha, snap) + (cam.shakeX ?? 0) : 0;
    const camY = cam ? cam.y + interpOffset(cam.prevY ?? cam.y, cam.y, alpha, snap) + (cam.shakeY ?? 0) : 0;
    const scrolled = cam != null && (camX !== 0 || camY !== 0);
    if (scrolled) {
      ctx.save();
      ctx.translate(-Math.round(camX), -Math.round(camY));
    }

    this.drawTilemap(ctx, world);

    const drawList = world.entities
      .filter((e) => e.alive && e.visible !== false && e.sprite.kind !== "none")
      .sort((a, b) => a.layer - b.layer || a.zIndex - b.zIndex);

    for (const e of drawList) {
      // Interpolate each body between its last two tick positions (render-only translate around the
      // entity's draw — no change to the draw* methods, which still read e.x/e.y). At alpha 1 the offset
      // is 0, so the draw is byte-identical to the non-interpolated path.
      const dx = interpOffset(e.body.prevX, e.x, alpha, snap);
      const dy = interpOffset(e.body.prevY, e.y, alpha, snap);
      if (dx !== 0 || dy !== 0) {
        ctx.save();
        ctx.translate(dx, dy);
        this.drawEntity(ctx, e, world, alpha);
        ctx.restore();
      } else {
        this.drawEntity(ctx, e, world, alpha);
      }
    }

    if (scrolled) ctx.restore();
  }

  /**
   * Draw the active scene's tilemap (0.2.0, OQ-3) UNDER the entities, so a scene's
   * road/lanes are one data tilemap — drawn AND queried (`world.isBuildable`) with
   * no entity/tilemap double-encoding. No-op when the scene has no tilemap, so a
   * 0.1.x scene renders exactly as before. When a `tileset` image is supplied each
   * non-empty index is blitted from the sheet; without one (or before it loads)
   * non-empty tiles fall back to a per-index fill — tinted by the cell's
   * `properties[idx].color` when authored (else a muted default) and outlined with a
   * subtle per-cell gridline, so a tileset-less map reads as structured terrain
   * rather than a flat slab (0.3.1, td-09 — additive; `color` rides the existing
   * `properties` catchall, no schema change).
   */
  private drawTilemap(ctx: Ctx, world: World): void {
    const t = world.tilemap;
    if (!t) return;
    const sheet = t.tileset ? this.loadImage(t.tileset) : null;
    const sheetReady = !!sheet && sheet.complete && sheet.naturalWidth > 0;
    const sheetCols = sheetReady ? Math.max(1, Math.floor(sheet!.naturalWidth / t.tileSize)) : 1;
    for (let row = 0; row < t.rows; row++) {
      for (let col = 0; col < t.cols; col++) {
        const idx = t.tiles[row * t.cols + col] ?? -1;
        if (idx < 0) continue; // empty cell
        const x = col * t.tileSize;
        const y = row * t.tileSize;
        if (sheetReady) {
          const sx = (idx % sheetCols) * t.tileSize;
          const sy = Math.floor(idx / sheetCols) * t.tileSize;
          ctx.drawImage(sheet!, sx, sy, t.tileSize, t.tileSize, x, y, t.tileSize, t.tileSize);
        } else {
          const props = t.properties?.[String(idx)];
          const tint = typeof props?.color === "string" ? props.color : TILE_FALLBACK_COLORS[idx % TILE_FALLBACK_COLORS.length];
          ctx.fillStyle = tint;
          ctx.fillRect(x, y, t.tileSize, t.tileSize);
          // Per-cell gridline (half-pixel offset for a crisp 1px line).
          ctx.strokeStyle = TILE_GRID_COLOR;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, t.tileSize - 1, t.tileSize - 1);
        }
      }
    }
  }

  /**
   * Draw the scene background: the solid `color` fill, then any declarative
   * `background.layers` as scrolling/parallax image planes (0.3.1, B). Each layer
   * is an image tiled to cover the viewport and drifted by `scrollX`/`scrollY`
   * px-per-second against `world.time` — so the same data renders identically at
   * any frame rate, and a fixed-camera scene just uses `scrollX:0`. The `layers`
   * descriptor has been in the FROZEN scene schema since 0.2.0 (parallax slot); the
   * 0.3.0 renderer only filled `color` and silently dropped layers — this honors
   * them with NO schema change (additive renderer, engine-root snake-05/breakout-05/
   * helicopter/survival-arena). For background depth, prefer this over a full-field
   * image entity: it stays declarative and needs no host scroll glue.
   */
  private drawBackground(ctx: Ctx, world: World, bg: Background | undefined, w: number, h: number): void {
    let color = "#0b0b12";
    let layers: ReadonlyArray<{ src: string; scrollX: number; scrollY: number }> | undefined;
    if (typeof bg === "string") color = bg;
    else if (bg && typeof bg === "object") {
      if (bg.color) color = bg.color;
      layers = bg.layers;
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    if (!layers) return;
    for (const layer of layers) this.drawParallaxLayer(ctx, layer, world.time, w, h);
  }

  /** Tile one parallax layer image across the viewport, drifted by scroll*time. */
  private drawParallaxLayer(
    ctx: Ctx,
    layer: { src: string; scrollX: number; scrollY: number },
    time: number,
    w: number,
    h: number,
  ): void {
    const img = this.loadImage(layer.src);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // Wrap the time-scaled offset into (-iw, 0] / (-ih, 0] so the first tile starts
    // just left/above the viewport and the loop fills to the right/bottom edge.
    let startX = (layer.scrollX * time) % iw;
    if (startX > 0) startX -= iw;
    let startY = (layer.scrollY * time) % ih;
    if (startY > 0) startY -= ih;
    for (let x = startX; x < w; x += iw) {
      for (let y = startY; y < h; y += ih) {
        ctx.drawImage(img, x, y, iw, ih);
      }
    }
  }

  private drawEntity(ctx: Ctx, e: Entity, world: World, alpha = 1): void {
    // Honor the entity transform (0.3.2). `rotation` (radians, clockwise) and
    // `scaleX`/`scaleY` are in the FROZEN entity schema (`rotation`/`scale`) and
    // populated on the runtime Entity since the schema froze, but the 0.3.x
    // renderer drew everything axis-aligned and unscaled — a declared-but-ignored
    // slot, exactly like `background.layers` before 0.3.1. We now apply it around
    // the entity's CENTER so a sprite spins/scales in place. Collision and
    // `entityAt` still use the un-rotated AABB (`collision.ts`, `world.ts`), so
    // this is PURELY visual — no contract/shape change. The transform is skipped
    // entirely at the identity (rotation 0, scale 1), so an entity that never sets
    // them renders byte-identically to before; only `ctx.translate/rotate/scale`
    // are used, which any real 2D context provides.
    //
    // Render interpolation (1.10.0): rotation and scale are drawn lerped between the last two ticks by
    // `alpha` — rotation along the shortest arc, scale flip-snapped (see {@link lerpAngle}/{@link lerpScale})
    // — the rotation/scale half of the position interpolation the render loop applies as a translate.
    // At `alpha 1` (the default + every headless/byte-identical caller) these collapse to the raw
    // `e.rotation`/`e.scaleX`/`e.scaleY`, so an un-interpolated draw is unchanged. The position pivot
    // `e.cx`/`e.cy` is the CURRENT center; the render loop's outer translate shifts it to the interpolated
    // position, so the whole transform interpolates together.
    const rot = alpha < 1 ? lerpAngle(e.body.prevRotation, e.rotation, alpha) : e.rotation;
    const sx = alpha < 1 ? lerpScale(e.body.prevScaleX, e.scaleX, alpha) : e.scaleX;
    const sy = alpha < 1 ? lerpScale(e.body.prevScaleY, e.scaleY, alpha) : e.scaleY;
    const transformed = rot !== 0 || sx !== 1 || sy !== 1;
    // Honor entity opacity (0.7.0): apply it as `globalAlpha`. Another declared-but-ignored
    // slot — `opacity`/`alpha` are whitelisted yet drawEntity never set globalAlpha, exactly
    // like rotation/scale before 0.3.2. Multiplied (so it composes with any ambient alpha)
    // and clamped to [0,1]; skipped at 1 so an opaque entity (the default) is byte-identical.
    // Lets a behavior fade / damage-flash / i-frame-flicker an entity.
    const faded = e.opacity < 1;
    if (transformed || faded) ctx.save();
    if (faded) ctx.globalAlpha = Math.max(0, Math.min(1, ctx.globalAlpha * e.opacity));
    if (transformed) {
      ctx.translate(e.cx, e.cy);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.translate(-e.cx, -e.cy);
    }
    switch (e.sprite.kind) {
      case "shape":
        this.drawShape(ctx, e, e.sprite);
        break;
      case "text":
        this.drawText(ctx, e, e.sprite, world);
        break;
      case "image":
        this.drawImage(ctx, e, e.sprite.src);
        break;
      case "sheet":
        this.drawSheet(ctx, e, e.sprite);
        break;
      default:
        break;
    }
    if (transformed || faded) ctx.restore();
  }

  private drawShape(ctx: Ctx, e: Entity, s: ShapeSprite): void {
    ctx.save();
    ctx.fillStyle = s.color;
    if (s.stroke) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.strokeWidth ?? 1;
    }
    switch (s.shape) {
      case "rect":
        ctx.fillRect(e.x, e.y, e.w, e.h);
        if (s.stroke) ctx.strokeRect(e.x, e.y, e.w, e.h);
        break;
      case "circle":
      case "ellipse": {
        ctx.beginPath();
        ctx.ellipse(e.cx, e.cy, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (s.stroke) ctx.stroke();
        break;
      }
      case "triangle": {
        ctx.beginPath();
        ctx.moveTo(e.cx, e.y);
        ctx.lineTo(e.x + e.w, e.y + e.h);
        ctx.lineTo(e.x, e.y + e.h);
        ctx.closePath();
        ctx.fill();
        if (s.stroke) ctx.stroke();
        break;
      }
      case "line":
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + e.w, e.y + e.h);
        ctx.strokeStyle = s.stroke ?? s.color;
        ctx.lineWidth = s.strokeWidth ?? 1;
        ctx.stroke();
        break;
    }
    ctx.restore();
  }

  private drawText(ctx: Ctx, e: Entity, s: TextSprite, world: World): void {
    const bound = s.bind != null ? world.state[s.bind] : undefined;
    const text = bound != null ? String(bound) : (s.text ?? "");
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.font = s.font;
    ctx.textAlign = s.align;
    ctx.textBaseline = "top";
    ctx.fillText(text, e.x, e.y);
    ctx.restore();
  }

  private drawImage(ctx: Ctx, e: Entity, src: string): void {
    const img = this.loadImage(src);
    if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, e.x, e.y, e.w, e.h);
  }

  private drawSheet(ctx: Ctx, e: Entity, s: SheetSprite): void {
    const img = this.loadImage(s.src);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const cols = Math.max(1, Math.floor(img.naturalWidth / s.frameWidth));
    const frame = e.anim.frame;
    const sx = (frame % cols) * s.frameWidth;
    const sy = Math.floor(frame / cols) * s.frameHeight;
    ctx.drawImage(img, sx, sy, s.frameWidth, s.frameHeight, e.x, e.y, e.w, e.h);
  }

  /** Lazily create an HTMLImageElement (browser only); returns null headless. */
  private loadImage(src: string): HTMLImageElement | null {
    if (typeof Image === "undefined") return null;
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      this.images.set(src, img);
    }
    return img;
  }
}
