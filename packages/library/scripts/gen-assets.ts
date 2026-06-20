/**
 * gen-assets.ts — GitCade procedural asset generator (art direction LOCKED).
 *
 * ALL v1 visual assets are generated HERE, by code: geometric/flat sprites on ONE
 * fixed 8-color palette, on 16px and 32px grids. Output is PNG sprite sheets under
 * `packages/library/assets/`. There is NO hand-drawn or AI-image art in the repo.
 *
 * DETERMINISM is a hard requirement: re-running this script must
 * reproduce byte-identical files. It therefore uses:
 *   - a pure, dependency-free PNG encoder (raw scanlines → node:zlib deflateSync,
 *     which is deterministic for a fixed level on a given zlib build);
 *   - a fixed palette and fully deterministic drawing (no Math.random — the one
 *     scattered field, the starfield, uses a seeded mulberry32 PRNG).
 *
 * Run: `npm run gen-assets` (from packages/library). Verify determinism with
 * `npm run gen-assets && git diff --stat assets/` (must be empty).
 *
 * Runs directly on Node 22 (built-in TypeScript type-stripping); this file uses
 * only erasable type syntax so `node scripts/gen-assets.ts` works with no loader.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ASSETS = join(ROOT, "assets");

// ─────────────────────────────────────────────────────────────────────────────
// The ONE fixed 8-color palette (a Sweetie16 subset). Every sprite, tile, and
// background draws from exactly these. Index 8 is reserved as transparent.
// Mirror of LIBRARY_PALETTE in src/palette.ts (kept in sync by a unit test).
// ─────────────────────────────────────────────────────────────────────────────
type RGBA = [number, number, number, number];
const HEX = [
  "#1a1c2c", // 0 ink (near-black)
  "#41a6f6", // 1 blue
  "#3b5dc9", // 2 deep blue
  "#ef7d57", // 3 orange
  "#ffcd75", // 4 yellow
  "#a7f070", // 5 green
  "#b13e53", // 6 red
  "#f4f4f4", // 7 light
] as const;

function hexToRgba(hex: string): RGBA {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
const PAL: RGBA[] = HEX.map(hexToRgba);
const CLEAR: RGBA = [0, 0, 0, 0];

// ─────────────────────────────────────────────────────────────────────────────
// Tiny deterministic PRNG (mulberry32) — only the starfield uses randomness, and
// only through this seeded generator, so output stays byte-stable.
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixel grid + flat drawing primitives. All coordinates are integer pixels.
// ─────────────────────────────────────────────────────────────────────────────
class Grid {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4); // all-transparent by default
  }
  px(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }
  /** 1px outline rectangle. */
  outline(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let xx = x; xx < x + w; xx++) {
      this.px(xx, y, c);
      this.px(xx, y + h - 1, c);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.px(x, yy, c);
      this.px(x + w - 1, yy, c);
    }
  }
  /** Filled disc centred at (cx,cy). */
  disc(cx: number, cy: number, r: number, c: RGBA): void {
    for (let yy = -r; yy <= r; yy++)
      for (let xx = -r; xx <= r; xx++)
        if (xx * xx + yy * yy <= r * r) this.px(cx + xx, cy + yy, c);
  }
  /** Filled axis-aligned diamond (radius rx,ry). */
  diamond(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    for (let yy = -ry; yy <= ry; yy++) {
      const span = Math.round(rx * (1 - Math.abs(yy) / ry));
      for (let xx = -span; xx <= span; xx++) this.px(cx + xx, cy + yy, c);
    }
  }
  /** Upward (apex at top) filled triangle inside the box. */
  triUp(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let row = 0; row < h; row++) {
      const frac = row / (h - 1 || 1);
      const half = (w / 2) * frac;
      const cx = x + w / 2;
      for (let xx = Math.round(cx - half); xx <= Math.round(cx + half); xx++) this.px(xx, y + row, c);
    }
  }
  /** Stamp another grid at (ox,oy), respecting source alpha. */
  blit(src: Grid, ox: number, oy: number): void {
    for (let yy = 0; yy < src.h; yy++)
      for (let xx = 0; xx < src.w; xx++) {
        const i = (yy * src.w + xx) * 4;
        if (src.data[i + 3] === 0) continue;
        this.px(ox + xx, oy + yy, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG encoder (RGBA, 8-bit, colour type 6). Zero dependencies; deterministic.
// ─────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(g: Grid): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(g.w, 0);
  ihdr.writeUInt32BE(g.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Raw scanlines, each prefixed with filter byte 0 (None).
  const stride = g.w * 4;
  const raw = Buffer.alloc(g.h * (stride + 1));
  for (let y = 0; y < g.h; y++) {
    const ro = y * (stride + 1);
    raw[ro] = 0; // filter type 0 (None)
    Buffer.from(g.data.subarray(y * stride, y * stride + stride)).copy(raw, ro + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

function write(rel: string, g: Grid): void {
  const out = join(ASSETS, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePNG(g));
  manifest.push({ path: `assets/${rel}`, w: g.w, h: g.h });
}
const manifest: Array<{ path: string; w: number; h: number }> = [];

// ─────────────────────────────────────────────────────────────────────────────
// SPRITES — each is a small flat design. Single-frame ⇒ `image`; multi-frame ⇒
// horizontal `sheet`. Outlines in ink (0) keep the set visually coherent.
// ─────────────────────────────────────────────────────────────────────────────

/** A 32×32 round "blob" hero, two-frame idle squash → sheet. */
function spriteBlob(): Grid {
  const frame = (squash: number): Grid => {
    const g = new Grid(32, 32);
    const cy = 18 + squash;
    g.disc(16, cy, 12 - squash, PAL[5]); // green body
    // outline ring
    for (let a = 0; a < 360; a += 6) {
      const r = 12 - squash;
      g.px(16 + Math.round(Math.cos((a * Math.PI) / 180) * r), cy + Math.round(Math.sin((a * Math.PI) / 180) * r), PAL[0]);
    }
    g.disc(12, cy - 2, 2, PAL[7]); // eyes
    g.disc(20, cy - 2, 2, PAL[7]);
    g.px(12, cy - 2, PAL[0]);
    g.px(20, cy - 2, PAL[0]);
    return g;
  };
  const sheet = new Grid(64, 32);
  sheet.blit(frame(0), 0, 0);
  sheet.blit(frame(2), 32, 0);
  return sheet;
}

/** A 32×32 player ship (upward triangle, cockpit). */
function spriteShip(): Grid {
  const g = new Grid(32, 32);
  g.triUp(4, 6, 24, 22, PAL[1]); // blue hull
  g.triUp(8, 12, 16, 14, PAL[2]); // inner shade
  g.disc(16, 18, 3, PAL[7]); // cockpit
  g.rect(6, 26, 6, 4, PAL[3]); // thrusters
  g.rect(20, 26, 6, 4, PAL[3]);
  return g;
}

/** A 32×32 humanoid (blocky body + head). */
function spriteHumanoid(): Grid {
  const g = new Grid(32, 32);
  g.rect(11, 4, 10, 9, PAL[4]); // head
  g.outline(11, 4, 10, 9, PAL[0]);
  g.rect(10, 14, 12, 12, PAL[3]); // torso
  g.outline(10, 14, 12, 12, PAL[0]);
  g.rect(9, 26, 4, 5, PAL[2]); // legs
  g.rect(19, 26, 4, 5, PAL[2]);
  return g;
}

/** A 16×16 snake body segment. */
function spriteSnakeSeg(): Grid {
  const g = new Grid(16, 16);
  g.rect(2, 2, 12, 12, PAL[5]);
  g.outline(2, 2, 12, 12, PAL[0]);
  g.rect(6, 6, 4, 4, PAL[6]);
  return g;
}

/** Generic 32×32 enemy body in a given palette colour, with eyes + outline. */
function spriteEnemy(body: RGBA, accent: RGBA, kind: "round" | "boxy" | "spiky"): Grid {
  const g = new Grid(32, 32);
  if (kind === "round") {
    g.disc(16, 16, 12, body);
    for (let a = 0; a < 360; a += 6)
      g.px(16 + Math.round(Math.cos((a * Math.PI) / 180) * 12), 16 + Math.round(Math.sin((a * Math.PI) / 180) * 12), PAL[0]);
  } else if (kind === "boxy") {
    g.rect(5, 5, 22, 22, body);
    g.outline(5, 5, 22, 22, PAL[0]);
  } else {
    g.diamond(16, 16, 13, 13, body);
    g.triUp(2, 2, 6, 6, accent);
    g.triUp(24, 2, 6, 6, accent);
  }
  g.disc(11, 14, 2, PAL[7]);
  g.disc(21, 14, 2, PAL[7]);
  g.px(11, 14, PAL[0]);
  g.px(21, 14, PAL[0]);
  g.rect(11, 21, 10, 2, accent); // mouth
  return g;
}

/** A 16×16 swarm bug (tiny). */
function spriteSwarm(): Grid {
  const g = new Grid(16, 16);
  g.disc(8, 8, 5, PAL[4]);
  g.disc(8, 8, 5, PAL[4]);
  g.outline(3, 3, 10, 10, CLEAR);
  for (let a = 0; a < 360; a += 12)
    g.px(8 + Math.round(Math.cos((a * Math.PI) / 180) * 5), 8 + Math.round(Math.sin((a * Math.PI) / 180) * 5), PAL[0]);
  g.px(6, 7, PAL[0]);
  g.px(10, 7, PAL[0]);
  return g;
}

/** A 16×16 coin, four-frame spin → sheet. */
function spriteCoin(): Grid {
  const widths = [6, 4, 2, 4];
  const sheet = new Grid(64, 16);
  widths.forEach((rx, i) => {
    const g = new Grid(16, 16);
    g.diamond(8, 8, rx, 6, PAL[4]);
    g.diamond(8, 8, Math.max(1, rx - 2), 4, PAL[3]);
    if (rx >= 4) g.px(7, 5, PAL[7]);
    sheet.blit(g, i * 16, 0);
  });
  return sheet;
}

/** A 16×16 gem (blue diamond). */
function spriteGem(): Grid {
  const g = new Grid(16, 16);
  g.diamond(8, 8, 6, 7, PAL[1]);
  g.diamond(8, 8, 3, 4, PAL[7]);
  g.diamond(8, 6, 2, 2, PAL[2]);
  return g;
}

/** A 16×16 capsule power-up. */
function spriteCapsule(): Grid {
  const g = new Grid(16, 16);
  g.rect(3, 6, 10, 5, PAL[5]);
  g.disc(4, 8, 2, PAL[5]);
  g.disc(12, 8, 2, PAL[5]);
  g.rect(3, 6, 5, 5, PAL[3]);
  g.outline(2, 5, 12, 7, PAL[0]);
  return g;
}

/** A 16×16 key. */
function spriteKey(): Grid {
  const g = new Grid(16, 16);
  g.disc(5, 6, 3, PAL[4]);
  g.disc(5, 6, 1, CLEAR);
  g.rect(7, 5, 7, 2, PAL[4]);
  g.rect(12, 7, 2, 3, PAL[4]);
  g.rect(10, 7, 2, 2, PAL[4]);
  return g;
}

/** A 16×16 wall brick. */
function spriteWall(): Grid {
  const g = new Grid(16, 16);
  g.rect(0, 0, 16, 16, PAL[2]);
  g.rect(0, 0, 16, 16, PAL[2]);
  for (let y = 0; y < 16; y += 8) g.rect(0, y, 16, 1, PAL[0]);
  g.rect(8, 0, 1, 8, PAL[0]);
  g.rect(4, 8, 1, 8, PAL[0]);
  g.rect(12, 8, 1, 8, PAL[0]);
  return g;
}

/** A 16×16 spike hazard. */
function spriteSpike(): Grid {
  const g = new Grid(16, 16);
  g.triUp(0, 4, 8, 12, PAL[7]);
  g.triUp(8, 4, 8, 12, PAL[7]);
  g.triUp(2, 8, 4, 8, PAL[0]);
  g.triUp(10, 8, 4, 8, PAL[0]);
  return g;
}

/** A 32×16 moving platform plank. */
function spritePlatform(): Grid {
  const g = new Grid(32, 16);
  g.rect(0, 3, 32, 9, PAL[3]);
  g.outline(0, 3, 32, 9, PAL[0]);
  for (let x = 4; x < 32; x += 8) g.rect(x, 5, 2, 5, PAL[4]);
  return g;
}

/** A 16×16 breakable block (cracked). */
function spriteBreakable(): Grid {
  const g = new Grid(16, 16);
  g.rect(1, 1, 14, 14, PAL[6]);
  g.outline(1, 1, 14, 14, PAL[0]);
  // crack
  g.px(8, 2, PAL[0]);
  g.px(8, 3, PAL[0]);
  g.px(7, 4, PAL[0]);
  g.px(8, 5, PAL[0]);
  g.px(9, 6, PAL[0]);
  g.px(8, 7, PAL[0]);
  g.px(7, 9, PAL[0]);
  g.px(8, 11, PAL[0]);
  return g;
}

/** A 16×16 bullet pellet. */
function spriteBullet(): Grid {
  const g = new Grid(16, 16);
  g.disc(8, 8, 3, PAL[4]);
  g.disc(8, 8, 1, PAL[7]);
  return g;
}

/** A 32×16 laser beam. */
function spriteLaser(): Grid {
  const g = new Grid(32, 16);
  g.rect(0, 6, 32, 4, PAL[1]);
  g.rect(0, 7, 32, 2, PAL[7]);
  g.disc(2, 8, 3, PAL[2]);
  g.disc(29, 8, 2, PAL[2]);
  return g;
}

/** A 16×16 lobbed bomb. */
function spriteBomb(): Grid {
  const g = new Grid(16, 16);
  g.disc(8, 10, 5, PAL[0]);
  g.disc(6, 8, 1, PAL[7]);
  g.rect(8, 2, 2, 4, PAL[2]);
  g.px(9, 1, PAL[3]);
  g.px(10, 0, PAL[4]);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// TILESETS — five 16×16 tiles per theme, packed in a row (80×16).
// ─────────────────────────────────────────────────────────────────────────────
function tileset(theme: "grass" | "dungeon" | "space" | "neon"): Grid {
  const sheet = new Grid(16 * 5, 16);
  const base: Record<string, RGBA[]> = {
    grass: [PAL[5], PAL[6], PAL[0], PAL[4], PAL[2]],
    dungeon: [PAL[2], PAL[0], PAL[1], PAL[5], PAL[3]],
    space: [PAL[0], PAL[2], PAL[1], PAL[7], PAL[4]],
    neon: [PAL[0], PAL[1], PAL[6], PAL[4], PAL[5]],
  };
  const cols = base[theme === "neon" ? "neon" : theme];
  // tile 0: ground/floor
  const t0 = new Grid(16, 16);
  t0.rect(0, 0, 16, 16, cols[0]);
  for (let i = 0; i < 16; i += 4) {
    t0.px(((i * 5) % 16), (i + 2) % 16, cols[2]);
    t0.px((i + 3) % 16, (i * 3) % 16, cols[2]);
  }
  sheet.blit(t0, 0, 0);
  // tile 1: solid wall/block
  const t1 = new Grid(16, 16);
  t1.rect(0, 0, 16, 16, cols[1]);
  t1.outline(0, 0, 16, 16, cols[2]);
  t1.rect(2, 2, 5, 5, cols[0]);
  t1.rect(9, 9, 5, 5, cols[0]);
  sheet.blit(t1, 16, 0);
  // tile 2: edge/border
  const t2 = new Grid(16, 16);
  t2.rect(0, 0, 16, 6, cols[1]);
  t2.rect(0, 6, 16, 10, cols[0]);
  t2.rect(0, 5, 16, 1, cols[2]);
  sheet.blit(t2, 32, 0);
  // tile 3: accent / decor
  const t3 = new Grid(16, 16);
  t3.rect(0, 0, 16, 16, cols[0]);
  t3.disc(8, 8, 4, cols[3]);
  t3.disc(8, 8, 2, cols[4]);
  sheet.blit(t3, 48, 0);
  // tile 4: hazard / glow
  const t4 = new Grid(16, 16);
  t4.rect(0, 0, 16, 16, cols[0]);
  t4.diamond(8, 8, 6, 6, cols[4]);
  t4.diamond(8, 8, 3, 3, cols[2]);
  sheet.blit(t4, 64, 0);
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUNDS — 256-wide tiles meant to scroll/tile.
// ─────────────────────────────────────────────────────────────────────────────
function bgGradient(): Grid {
  const g = new Grid(256, 256);
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    const c: RGBA = [
      Math.round(PAL[0][0] + (PAL[2][0] - PAL[0][0]) * t),
      Math.round(PAL[0][1] + (PAL[2][1] - PAL[0][1]) * t),
      Math.round(PAL[0][2] + (PAL[2][2] - PAL[0][2]) * t),
      255,
    ];
    g.rect(0, y, 256, 1, c);
  }
  return g;
}
function bgStarfield(): Grid {
  const g = new Grid(256, 256);
  g.rect(0, 0, 256, 256, PAL[0]);
  const rnd = mulberry32(0xc0ffee);
  for (let i = 0; i < 180; i++) {
    const x = Math.floor(rnd() * 256);
    const y = Math.floor(rnd() * 256);
    const c = rnd() > 0.85 ? PAL[1] : PAL[7];
    g.px(x, y, c);
    if (rnd() > 0.9) {
      g.px(x + 1, y, c);
      g.px(x, y + 1, c);
    }
  }
  return g;
}
function bgParallax(layer: "far" | "near"): Grid {
  const g = new Grid(256, 128);
  if (layer === "far") {
    g.rect(0, 0, 256, 128, PAL[2]);
    // rolling far hills
    for (let x = 0; x < 256; x++) {
      const h = 40 + Math.round(Math.sin(x / 26) * 10 + Math.sin(x / 9) * 4);
      g.rect(x, 128 - h, 1, h, PAL[1]);
    }
  } else {
    // near hills, taller, opaque colour; transparent sky so it overlays `far`
    for (let x = 0; x < 256; x++) {
      const h = 56 + Math.round(Math.sin(x / 18 + 1.5) * 16);
      g.rect(x, 128 - h, 1, h, PAL[5]);
      g.px(x, 128 - h, PAL[0]);
    }
  }
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate everything. Clean the output dir first so removed assets don't linger.
// ─────────────────────────────────────────────────────────────────────────────
function clean(): void {
  try {
    for (const f of readdirSync(ASSETS)) rmSync(join(ASSETS, f), { recursive: true, force: true });
  } catch {
    /* dir may not exist yet */
  }
}

clean();

// sprites
write("sprites/player-blob.png", spriteBlob());
write("sprites/player-ship.png", spriteShip());
write("sprites/player-humanoid.png", spriteHumanoid());
write("sprites/snake-segment.png", spriteSnakeSeg());
write("sprites/enemy-chaser.png", spriteEnemy(PAL[6], PAL[4], "round"));
write("sprites/enemy-shooter.png", spriteEnemy(PAL[2], PAL[3], "boxy"));
write("sprites/enemy-patroller.png", spriteEnemy(PAL[3], PAL[0], "boxy"));
write("sprites/enemy-swarm.png", spriteSwarm());
write("sprites/coin.png", spriteCoin());
write("sprites/gem.png", spriteGem());
write("sprites/powerup-capsule.png", spriteCapsule());
write("sprites/key.png", spriteKey());
write("sprites/wall.png", spriteWall());
write("sprites/spike.png", spriteSpike());
write("sprites/moving-platform.png", spritePlatform());
write("sprites/breakable-block.png", spriteBreakable());
write("sprites/bullet.png", spriteBullet());
write("sprites/laser.png", spriteLaser());
write("sprites/lobbed-bomb.png", spriteBomb());

// tilesets
write("tilesets/grass.png", tileset("grass"));
write("tilesets/dungeon.png", tileset("dungeon"));
write("tilesets/space.png", tileset("space"));
write("tilesets/neon-arcade.png", tileset("neon"));

// backgrounds
write("backgrounds/gradient.png", bgGradient());
write("backgrounds/starfield.png", bgStarfield());
write("backgrounds/parallax-far.png", bgParallax("far"));
write("backgrounds/parallax-near.png", bgParallax("near"));

// A machine-readable manifest of what was generated (handy for the proof + tests).
manifest.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(ASSETS, "manifest.json"), JSON.stringify({ palette: HEX, files: manifest }, null, 2) + "\n");

console.log(`gen-assets: wrote ${manifest.length} PNG(s) + manifest.json to assets/ (palette ${HEX.length} colors).`);
