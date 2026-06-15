import type { World } from "./world.js";
import type { Entity } from "./entity.js";
import type { Background } from "../schema/scene.js";
import type { ShapeSprite, SheetSprite, TextSprite } from "../schema/sprite.js";

/** A minimal 2D context surface (subset we use), so types don't require lib.dom everywhere. */
type Ctx = CanvasRenderingContext2D;

/** Muted fallback fills for tilemap indices when no tileset image is available. */
const TILE_FALLBACK_COLORS = ["#2a2f3a", "#3a3030", "#30343a", "#2f3a30", "#3a3a2f", "#352f3a"];

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

  render(world: World, background?: Background): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = world.bounds;

    this.drawBackground(ctx, background, width, height);
    this.drawTilemap(ctx, world);

    const drawList = world.entities
      .filter((e) => e.alive && e.sprite.kind !== "none")
      .sort((a, b) => a.layer - b.layer || a.zIndex - b.zIndex);

    for (const e of drawList) this.drawEntity(ctx, e, world);
  }

  /**
   * Draw the active scene's tilemap (0.2.0, OQ-3) UNDER the entities, so a scene's
   * road/lanes are one data tilemap — drawn AND queried (`world.isBuildable`) with
   * no entity/tilemap double-encoding. No-op when the scene has no tilemap, so a
   * 0.1.x scene renders exactly as before. When a `tileset` image is supplied each
   * non-empty index is blitted from the sheet; without one (or before it loads)
   * non-empty tiles fall back to a flat per-index color so the map is still visible.
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
          ctx.fillStyle = TILE_FALLBACK_COLORS[idx % TILE_FALLBACK_COLORS.length];
          ctx.fillRect(x, y, t.tileSize, t.tileSize);
        }
      }
    }
  }

  private drawBackground(ctx: Ctx, bg: Background | undefined, w: number, h: number): void {
    let color = "#0b0b12";
    if (typeof bg === "string") color = bg;
    else if (bg && typeof bg === "object" && bg.color) color = bg.color;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }

  private drawEntity(ctx: Ctx, e: Entity, world: World): void {
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
