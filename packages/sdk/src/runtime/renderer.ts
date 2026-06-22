import type { World } from "./world.js";
import type { Entity } from "./entity.js";
import type { Background } from "../schema/scene.js";
import type { ShapeSprite, SheetSprite, TextSprite } from "../schema/sprite.js";

/** A minimal 2D context surface (subset we use), so types don't require lib.dom everywhere. */
type Ctx = CanvasRenderingContext2D;

/** Viewport CULL RECT in WORLD coords (left/top/right/bottom) — the window tiles & entities draw into. */
type CullRect = { l: number; t: number; r: number; b: number };

/**
 * The render-interpolation offset from a body/camera's CURRENT (latest-tick) position on one
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
 * Interpolate a ROTATION (radians) between its last two tick values along the SHORTEST arc (the
 * rotation half of render interpolation). A plain lerp is WRONG for an angle: `face-angle` writes
 * `atan2(...)`, which jumps +π→−π across its branch cut (a turret tracking a target crossing behind it,
 * a projectile turning), and a `tween` spin wraps 2π→0 each revolution — a linear lerp would unwind the
 * whole way around backward. Normalizing `prev − cur` into (−π, π] interpolates the short way, so the wrap
 * is seamless. At `alpha 1` this returns `cur` exactly, so the renderer is byte-identical to the
 * non-interpolated path. (No teleport-snap: the shortest arc is ≤ π, so even an instant re-orient streaks
 * at most a half-turn for a single frame — far milder than a position teleport streaking the whole screen.)
 */
function lerpAngle(prev: number, cur: number, alpha: number): number {
  // Raw Math.* is fine here (NOT the world.math seam): this is RENDER interpolation — the result
  // is drawn, never written back to the world or `snapshotWorld`, so a cross-engine last-ULP
  // difference is purely cosmetic and the simulation stays byte-identical.
  const d = Math.atan2(Math.sin(prev - cur), Math.cos(prev - cur)); // (prev − cur) wrapped to (−π, π]
  return cur + d * (1 - alpha);
}

/**
 * Interpolate a per-axis SCALE between its last two tick values (the scale half of render
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
 *  structured cells rather than one flat slab. */
const TILE_GRID_COLOR = "rgba(255,255,255,0.06)";

/**
 * Viewport-cull safety margin in px (viewport culling). The cull rect is the viewport grown by
 * this on every side. `camX`/`camY` already fold in the camera's render interpolation AND shake (they
 * ARE the translate basis), and every entity is tested at its INTERPOLATED center with a transform-aware
 * radius — so this margin exists ONLY to absorb the ≤0.5px slop from the `Math.round(camX/camY)` at the
 * translate. A couple px is plenty and it never scales with content. Erring large is harmless: culling
 * is a strict SUPERSET of what's visible, so a wider margin only redraws a few off-canvas cells/sprites
 * pixel-identically — it can never DROP a visible one.
 */
const CULL_MARGIN = 2;

/** Clamp `n` to the inclusive range [lo, hi] (the tile-window bounds). */
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

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
   * Draw the world. `alpha` (render interpolation) is how far into the NEXT fixed tick the real
   * clock has advanced (`accumulator / fixedDt`, in [0,1)); the renderer draws each body and the camera
   * lerped between the last two ticks, so motion is smooth even when the rAF rate doesn't divide the 60 Hz
   * sim rate (the judder fix). The FULL render transform is interpolated: position
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
    // a camera-less scene renders exactly as before.
    const cam = world.camera;
    const vw = cam ? cam.width : world.bounds.width;
    const vh = cam ? cam.height : world.bounds.height;
    // A per-tick position delta larger than a viewport dimension is a TELEPORT (scene warp, screen-wrap,
    // respawn), not motion — interpolating across it would streak the body over the screen for a frame,
    // so {@link interpOffset} snaps such a body to its current position instead. Real motion (even a fast
    // dash, tens of px/tick) is far below this, so the two never collide.
    const snap = Math.min(vw, vh);

    // The interpolated CAMERA BASIS (the world translate origin): the follow base lerped between the last
    // two ticks (smooth scrolling when rAF ≠ the sim rate) PLUS any transient shake OFFSET (`shakeX`/`shakeY`,
    // kept separate from the follow base; the follow base interpolates, shake — already a per-frame jitter —
    // rides on top un-interpolated). Computed up here, BEFORE the background, because a parallax layer may
    // COUPLE to it (track the camera by its depth factor); the SAME camX/camY is reused as the world
    // translate + cull basis below, so the background and the world scroll against one camera. Render-only:
    // it is read from deterministic sim state, never written back, so headless play stays byte-identical.
    const camX = cam ? cam.x + interpOffset(cam.prevX ?? cam.x, cam.x, alpha, snap) + (cam.shakeX ?? 0) : 0;
    const camY = cam ? cam.y + interpOffset(cam.prevY ?? cam.y, cam.y, alpha, snap) + (cam.shakeY ?? 0) : 0;

    // Background is drawn in SCREEN space (no camera translate), so a solid/static backdrop stays fixed,
    // but each parallax layer MAY couple to the camera by its `parallaxX`/`parallaxY` factor (camX/camY
    // passed through) so it tracks the view. A layer with factor 0 (the default) ignores the camera and
    // stays a pure time-drift backdrop — byte-identical to before this change.
    this.drawBackground(ctx, world, background, vw, vh, camX, camY);

    // Camera transform: pan the world under the viewport. Skipped at the origin so a non-scrolling,
    // non-shaking scene takes the no-save/translate path, and rounded to whole px so tiles/sprites stay crisp.
    const scrolled = cam != null && (camX !== 0 || camY !== 0);
    if (scrolled) {
      ctx.save();
      ctx.translate(-Math.round(camX), -Math.round(camY));
    }

    // Viewport CULL RECT: the world-space window the canvas actually shows. camX/camY already
    // include the camera's interpolation + shake (the exact translate basis), grown by CULL_MARGIN for
    // the Math.round slop. drawTilemap iterates only the cells inside it; an entity outside it is skipped
    // by {@link inView}. With no camera / no scroll the viewport spans the whole world, so the rect covers
    // every cell and entity — nothing is culled and the draw calls are byte-identical to the pre-cull path.
    const cull: CullRect = { l: camX - CULL_MARGIN, t: camY - CULL_MARGIN, r: camX + vw + CULL_MARGIN, b: camY + vh + CULL_MARGIN };

    this.drawTilemap(ctx, world, cull);

    // Partition the drawn entities in ONE pass: WORLD entities (camera-panned + viewport-culled +
    // render-interpolated — the existing path, unchanged) and SCREEN-space HUD entities (`screen:true`,
    // drawn after the camera restore so they stay FIXED on the canvas while the world scrolls).
    // `screenList` is left null unless a screen entity actually exists, so a game with none never
    // allocates it or runs the second pass: the no-HUD FAST PATH emits exactly the draw calls it did
    // before this layer (same filter predicate, same source order ⇒ same stable-sorted draw order).
    const drawList: Entity[] = [];
    let screenList: Entity[] | null = null;
    for (const e of world.entities) {
      if (!e.alive || e.visible === false || e.sprite.kind === "none") continue;
      if (e.screen) (screenList ??= []).push(e);
      else if (this.inView(e, alpha, snap, cull)) drawList.push(e);
    }
    drawList.sort((a, b) => a.layer - b.layer || a.zIndex - b.zIndex);

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

    // SCREEN-space HUD pass — taken ONLY when a `screen:true` entity exists. Drawn AFTER the camera
    // restore (no camera translate ⇒ fixed on the canvas), in canvas coordinates (no world-rect cull:
    // `position` is screen space, so the cull rect is meaningless — these are a few HUD entities, all
    // drawn), and at the CURRENT transform (alpha 1 — static HUD has no movers, so render interpolation
    // is moot). Sorted by `layer` then `zIndex` like the world list; a screen entity is never in
    // `drawList`, so it draws exactly once.
    if (screenList) {
      screenList.sort((a, b) => a.layer - b.layer || a.zIndex - b.zIndex);
      for (const e of screenList) this.drawEntity(ctx, e, world, 1);
    }
  }

  /**
   * Is entity `e` inside the viewport CULL RECT (viewport culling) — i.e. should it be drawn?
   * Skips an entity whose conservative drawn AABB is FULLY outside the rect — a SUPERSET test: it only
   * ever drops draw calls for geometry off-screen, never one with a visible pixel.
   *
   * Tested at the entity's INTERPOLATED center (the same {@link interpOffset} the render loop translates
   * by — so a body mid-lerp toward the edge isn't culled early), with a half-extent equal to the
   * rotation-INVARIANT circumscribed radius of its SCALED, stroked box: the radius bounds the box at
   * EVERY angle, so the interpolated rotation is never needed; per-axis scale is bounded by max(|cur|,|prev|)
   * (the scale lerp / flip-snap never exceeds that); and a stroked shape's outline is folded in (full
   * strokeWidth — conservative against the half-width straddle + a corner miter). camX/camY (hence the rect)
   * already carry the camera's own interpolation + shake, so those need no allowance here.
   *
   * TEXT is EXEMPT (always drawn): a text sprite's extent is font-size driven, NOT bounded by the entity's
   * w/h box, so culling it could clip a HUD/label — refuse to cull what we can't bound. Text entities are
   * few (HUD/score), so always drawing them costs nothing measurable.
   */
  private inView(e: Entity, alpha: number, snap: number, cull: CullRect): boolean {
    const s = e.sprite;
    if (s.kind === "text") return true; // extent not bounded by the box — never cull (see above)
    const icx = e.cx + interpOffset(e.body.prevX, e.x, alpha, snap);
    const icy = e.cy + interpOffset(e.body.prevY, e.y, alpha, snap);
    // Scale bound: at alpha 1 the drawn scale IS cur (drawEntity gates the scale lerp on alpha<1), so
    // |cur| suffices; mid-interpolation the drawn scale lies between prev and cur, so bound by
    // max(|cur|,|prev|). Gating the prev read on alpha<1 mirrors drawEntity exactly and keeps the
    // byte-identical alpha-1 path from touching prevScale at all.
    const sxMax = alpha < 1 ? Math.max(Math.abs(e.scaleX), Math.abs(e.body.prevScaleX)) : Math.abs(e.scaleX);
    const syMax = alpha < 1 ? Math.max(Math.abs(e.scaleY), Math.abs(e.body.prevScaleY)) : Math.abs(e.scaleY);
    const strokeHalf = s.kind === "shape" && s.stroke ? (s.strokeWidth ?? 1) : 0;
    // Raw Math.hypot is fine: this cull radius only decides whether to DRAW an entity — it never
    // reaches `snapshotWorld`, so its cross-engine variance can't desync the simulation.
    const r = Math.hypot(sxMax * (e.w / 2 + strokeHalf), syMax * (e.h / 2 + strokeHalf));
    return icx + r >= cull.l && icx - r <= cull.r && icy + r >= cull.t && icy - r <= cull.b;
  }

  /**
   * Draw the active scene's tilemap UNDER the entities, so a scene's
   * road/lanes are one data tilemap — drawn AND queried (`world.isBuildable`) with
   * no entity/tilemap double-encoding. No-op when the scene has no tilemap, so a
   * tilemap-less scene renders exactly as before. When a `tileset` image is supplied each
   * non-empty index is blitted from the sheet; without one (or before it loads)
   * non-empty tiles fall back to a per-index fill — tinted by the cell's
   * `properties[idx].color` when authored (else a muted default) and outlined with a
   * subtle per-cell gridline, so a tileset-less map reads as structured terrain
   * rather than a flat slab (`color` rides the existing `properties` catchall,
   * no schema change).
   */
  private drawTilemap(ctx: Ctx, world: World, cull: CullRect): void {
    const t = world.tilemap;
    if (!t) return;
    const sheet = t.tileset ? this.loadImage(t.tileset) : null;
    const sheetReady = !!sheet && sheet.complete && sheet.naturalWidth > 0;
    const sheetCols = sheetReady ? Math.max(1, Math.floor(sheet!.naturalWidth / t.tileSize)) : 1;
    // Viewport CULL WINDOW: iterate only the cells intersecting the cull rect, not the whole
    // map — this is the one real fix for large worlds (the loop was O(cols×rows) every frame regardless
    // of what's on screen). floor/ceil + clamp give a SUPERSET of the visible cells (an off-canvas cell
    // at the ±CULL_MARGIN edge is harmless — the canvas clips it to identical pixels), so no visible tile
    // is ever dropped. Tiles carry no interpolation/rotation/scale, so the rect needs no per-cell extent.
    // An unscrolled / camera-less scene's rect spans the whole map ⇒ the window is every cell ⇒
    // byte-identical to the pre-cull full loop.
    const colStart = clamp(Math.floor(cull.l / t.tileSize), 0, t.cols);
    const colEnd = clamp(Math.ceil(cull.r / t.tileSize), 0, t.cols);
    const rowStart = clamp(Math.floor(cull.t / t.tileSize), 0, t.rows);
    const rowEnd = clamp(Math.ceil(cull.b / t.tileSize), 0, t.rows);
    for (let row = rowStart; row < rowEnd; row++) {
      for (let col = colStart; col < colEnd; col++) {
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
   * `background.layers` as image planes — each tiled to cover the viewport and offset
   * by two opt-in sources that COMPOSE: autonomous time-DRIFT (`scrollX`/`scrollY`
   * px-per-second against `world.time`, so the same data renders identically at any
   * frame rate) and camera COUPLING (`parallaxX`/`parallaxY` × the interpolated camera
   * position `camX`/`camY`, so the layer tracks the view at its depth — the
   * genre-standard parallax). Both default 0 ⇒ a fixed backdrop. The background is
   * drawn in SCREEN space (the world translate is applied after this), so coupling is
   * what makes a layer move WITH the scrolling world. For background depth, prefer this
   * over a full-field image entity: it stays declarative and needs no host scroll glue.
   */
  private drawBackground(ctx: Ctx, world: World, bg: Background | undefined, w: number, h: number, camX: number, camY: number): void {
    let color = "#0b0b12";
    let layers: ReadonlyArray<{ src: string; scrollX: number; scrollY: number; parallaxX?: number; parallaxY?: number }> | undefined;
    if (typeof bg === "string") color = bg;
    else if (bg && typeof bg === "object") {
      if (bg.color) color = bg.color;
      layers = bg.layers;
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    if (!layers) return;
    for (const layer of layers) this.drawParallaxLayer(ctx, layer, world.time, camX, camY, w, h);
  }

  /** Tile one parallax layer across the viewport, offset by its time-drift composed with camera coupling. */
  private drawParallaxLayer(
    ctx: Ctx,
    layer: { src: string; scrollX: number; scrollY: number; parallaxX?: number; parallaxY?: number },
    time: number,
    camX: number,
    camY: number,
    w: number,
    h: number,
  ): void {
    const img = this.loadImage(layer.src);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // Each axis offset COMPOSES two independent, opt-in sources: autonomous time-DRIFT (`scroll·time`,
    // px/sec — moves on its own) and camera COUPLING (`-cam·parallax` — tracks the view, so it stops when
    // the player stops and reverses when they walk back; factor 0 = locked to the viewport, ~0..1 = depth,
    // ~1 = pinned to the world). Both default 0 (the `?? 0` also covers a layer authored before this field /
    // passed un-parsed), so a layer that sets neither is static and one that sets only `scroll` is the pure
    // time-drift of before. Wrap the combined offset into (-iw, 0] / (-ih, 0] so the first tile starts just
    // left/above the viewport and the loop fills to the right/bottom edge.
    let startX = (layer.scrollX * time - camX * (layer.parallaxX ?? 0)) % iw;
    if (startX > 0) startX -= iw;
    let startY = (layer.scrollY * time - camY * (layer.parallaxY ?? 0)) % ih;
    if (startY > 0) startY -= ih;
    for (let x = startX; x < w; x += iw) {
      for (let y = startY; y < h; y += ih) {
        ctx.drawImage(img, x, y, iw, ih);
      }
    }
  }

  private drawEntity(ctx: Ctx, e: Entity, world: World, alpha = 1): void {
    // Honor the entity transform. `rotation` (radians, clockwise) and
    // `scaleX`/`scaleY` are in the FROZEN entity schema (`rotation`/`scale`) and
    // populated on the runtime Entity, applied here around the entity's CENTER so a
    // sprite spins/scales in place. Collision and `entityAt` still use the un-rotated
    // AABB (`collision.ts`, `world.ts`), so this is PURELY visual — no contract/shape
    // change. The transform is skipped entirely at the identity (rotation 0, scale 1),
    // so an entity that never sets them renders byte-identically to an untransformed
    // draw; only `ctx.translate/rotate/scale` are used, which any real 2D context provides.
    //
    // Render interpolation: rotation and scale are drawn lerped between the last two ticks by
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
    // Honor entity opacity: apply it as `globalAlpha`. `opacity`/`alpha` is whitelisted in the
    // schema, applied here multiplied (so it composes with any ambient alpha) and clamped to
    // [0,1]; skipped at 1 so an opaque entity (the default) is byte-identical.
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
