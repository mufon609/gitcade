import type { World } from "./world.js";
import type { Entity } from "./entity.js";
import type { Background } from "../schema/scene.js";
import type { ShapeSprite, SheetSprite, TextSprite } from "../schema/sprite.js";

/** A minimal 2D context surface (subset we use), so types don't require lib.dom everywhere. */
type Ctx = CanvasRenderingContext2D;

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

    const drawList = world.entities
      .filter((e) => e.alive && e.sprite.kind !== "none")
      .sort((a, b) => a.layer - b.layer || a.zIndex - b.zIndex);

    for (const e of drawList) this.drawEntity(ctx, e, world);
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
