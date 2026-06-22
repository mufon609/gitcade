/**
 * gen-art.mjs — "Lumen: Echoes of the Dusklands" ORIGINAL art generator.
 *
 * Every visual asset for this game is generated HERE, by code: flat pixel art on
 * ONE original twilight palette (NOT the @gitcade/library Sweetie16 subset), on
 * 24px / 32px / 16px grids. Output is committed PNGs under
 * `games/lumen/public/assets/lumen/` (Vite serves `public/` at root, so the files
 * resolve at the URLs `assets/lumen/<name>.png`).
 *
 * This mirrors `packages/library/scripts/gen-assets.ts` exactly in approach — the
 * `Grid` drawing primitives + a hand-rolled, dependency-free PNG encoder over
 * `node:zlib` deflateSync — but it is plain ESM (no TS types) and ships its OWN
 * art and OWN palette. It adds two primitives the glow aesthetic wants: a filled
 * `ellipse` and an elliptical `radialGlow` (soft alpha falloff) for auras.
 *
 * DETERMINISM is a hard requirement: re-running this must reproduce byte-identical
 * files. So: a fixed palette, no `Date`/unseeded `Math.random` — the only scatter
 * (stone glimmers, portal/beacon sparkles) goes through a seeded mulberry32, and
 * the PNG encoder is the deterministic raw-scanline → deflateSync(level 9) path.
 *
 * Run: `npm run gen:art` (from games/lumen). Verify determinism with
 * `npm run gen:art && git status` (must show no diff).
 *
 * Runs directly on Node 22 — built-ins only (node:zlib, node:fs, node:path,
 * node:url). Zero dependencies, exactly like gen-assets.ts.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, ".."); // games/lumen
const ASSETS = join(ROOT, "public", "assets", "lumen"); // → URLs assets/lumen/<name>.png

// ─────────────────────────────────────────────────────────────────────────────
// THE LUMEN PALETTE — an original twilight/glow set (9 named colors). Deliberately
// NOT the library's Sweetie16 subset: a cool deep-indigo ground ramp, teal-lit
// stone, a warm amber hero, gold collectibles, magenta danger, violet rifts.
// This object is the single source of truth for ART.md too.
// ─────────────────────────────────────────────────────────────────────────────
const HEX = {
  void: "#070512", //  the void / kill-plane, outlines, deepest shadow, rift core
  dusk: "#15103a", //  primary background indigo/navy
  twilight: "#2c2660", //  drifting stone body (ground / platforms / ledges / decor)
  aqua: "#34c2b3", //  teal/cyan lit stone surfaces, ladders, rim light, driftstones
  ember: "#ff9a3c", //  Lumen's warm amber core; emberstone core
  glow: "#ffe0a8", //  pale warm light — Lumen's halo, eyes' glint, beacon, highlights
  gold: "#ffc12e", //  motes (coins), emberstone facets, HUD accents
  fuchsia: "#ff3fa4", //  gloomspikes, driftwraiths — danger
  violet: "#9a5cff", //  riftgates (portals), arcane echoes
};

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
const C = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexToRgba(v)]));
const WHITE = [255, 255, 255, 255];

/** Same RGB, new alpha — for soft (semi-transparent) glow/sparkle pixels. */
function withA(c, a) {
  return [c[0], c[1], c[2], a];
}
/** Linear RGBA blend a→b at t∈[0,1]. */
function lerp(a, b, t) {
  const f = (i) => Math.round((a[i] ?? 255) + ((b[i] ?? 255) - (a[i] ?? 255)) * t);
  return [f(0), f(1), f(2), f(3)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny deterministic PRNG (mulberry32). Scatter (glimmers, sparkles) goes through
// a SEEDED generator so output stays byte-stable across runs.
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
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
// Pixel grid + flat drawing primitives. Integer pixel coordinates. `px` OVERWRITES
// (it does not alpha-blend), so each pixel is authored once: draw soft auras first,
// then the opaque body on top. (Same model as gen-assets.ts's Grid, plus `ellipse`,
// `vline`/`hline`, and an elliptical `radialGlow`.)
// ─────────────────────────────────────────────────────────────────────────────
class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4); // transparent by default
  }
  px(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }
  rect(x, y, w, h, c) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }
  outline(x, y, w, h, c) {
    for (let xx = x; xx < x + w; xx++) {
      this.px(xx, y, c);
      this.px(xx, y + h - 1, c);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.px(x, yy, c);
      this.px(x + w - 1, yy, c);
    }
  }
  vline(x, y0, y1, c) {
    for (let y = y0; y <= y1; y++) this.px(x, y, c);
  }
  hline(x0, x1, y, c) {
    for (let x = x0; x <= x1; x++) this.px(x, y, c);
  }
  disc(cx, cy, r, c) {
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) this.px(cx + xx, cy + yy, c);
  }
  /** Filled ellipse, radii (rx,ry). */
  ellipse(cx, cy, rx, ry, c) {
    const rx2 = (rx || 1) * (rx || 1);
    const ry2 = (ry || 1) * (ry || 1);
    for (let yy = -ry; yy <= ry; yy++)
      for (let xx = -rx; xx <= rx; xx++) if ((xx * xx) / rx2 + (yy * yy) / ry2 <= 1) this.px(cx + xx, cy + yy, c);
  }
  /** Filled axis-aligned diamond (radii rx,ry). */
  diamond(cx, cy, rx, ry, c) {
    for (let yy = -ry; yy <= ry; yy++) {
      const span = Math.round(rx * (1 - Math.abs(yy) / ry));
      for (let xx = -span; xx <= span; xx++) this.px(cx + xx, cy + yy, c);
    }
  }
  /** Upward (apex at top) filled triangle inside the box. */
  triUp(x, y, w, h, c) {
    for (let row = 0; row < h; row++) {
      const frac = row / (h - 1 || 1);
      const half = (w / 2) * frac;
      const cx = x + w / 2;
      for (let xx = Math.round(cx - half); xx <= Math.round(cx + half); xx++) this.px(xx, y + row, c);
    }
  }
  /**
   * Soft elliptical aura centred at (cx,cy): alpha falls off from `innerA` at the
   * centre to 0 at the normalized edge (a (1−d)^1.8 curve for a glowy core), the
   * colour lerping inner→outer with distance. The "leans on opacity/soft light"
   * half of the theme — drawn FIRST so the opaque sprite body overwrites the core.
   */
  radialGlow(cx, cy, rx, ry, inner, outer, innerA) {
    const rx2 = (rx || 1) * (rx || 1);
    const ry2 = (ry || 1) * (ry || 1);
    for (let yy = -ry; yy <= ry; yy++)
      for (let xx = -rx; xx <= rx; xx++) {
        const d = Math.sqrt((xx * xx) / rx2 + (yy * yy) / ry2);
        if (d > 1) continue;
        const a = Math.round(innerA * Math.pow(1 - d, 1.8));
        if (a <= 0) continue;
        const col = lerp(inner, outer, d);
        col[3] = a;
        this.px(cx + xx, cy + yy, col);
      }
  }
  /** Stamp another grid at (ox,oy), respecting source alpha (skips transparent px). */
  blit(src, ox, oy) {
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
// Verbatim approach from gen-assets.ts.
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
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(g) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(g.w, 0);
  ihdr.writeUInt32BE(g.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
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

const written = [];
function write(name, g) {
  writeFileSync(join(ASSETS, name), encodePNG(g));
  written.push(`${name} ${g.w}×${g.h}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// LUMEN — the hero: a small luminous wisp/spark with expressive eyes, a warm amber
// glow, and a little crown flame. 24×24 frames, 10-frame single row (240×24).
// idle 0-1 · run 2-5 · jump 6 · fall 7 · land 8-9 (see ART.md for the clip map).
// Drawn facing right; the game's face-velocity behavior mirrors it for travel.
// ═════════════════════════════════════════════════════════════════════════════
const EMBER_SHADOW = lerp(C.ember, C.void, 0.42);
const HOT_CORE = lerp(C.glow, WHITE, 0.55);

/** A 2–5px crown flame at the wisp's top, gold body → glow tip, leaning by `lean`. */
function drawFlame(g, cx, baseY, lean, h) {
  for (let i = 0; i < h; i++) {
    const t = h > 1 ? i / (h - 1) : 0; // 0 base .. 1 tip
    const x = cx + Math.round(lean * t);
    const col = t > 0.55 ? C.glow : C.gold;
    const w = t < 0.45 ? 1 : 0; // a touch wider near the base
    for (let dx = -w; dx <= w; dx++) g.px(x + dx, baseY - i, col);
  }
}

/** Two expressive eyes centred on (ex,ey). Round/forward = friendly; modes vary. */
function drawEyes(g, ex, ey, mode) {
  const lx = ex - 3;
  const rx = ex + 3;
  if (mode === "squint") {
    for (const c of [lx, rx]) g.hline(c - 1, c + 1, ey, C.void);
    return;
  }
  const wide = mode === "wide";
  for (const c of [lx, rx]) {
    if (wide) g.rect(c - 1, ey - 1, 3, 3, C.void);
    else g.rect(c - 1, ey - 1, 2, 3, C.void);
    g.px(c - 1, ey - 1, C.glow); // catch-light glint
  }
}

/** One 24×24 Lumen frame from a tuned pose descriptor. */
function drawLumen(g, p) {
  const { cx, cy, rx, ry, eye, lookX, lookY, flame, flameH, halo, haloA } = p;
  // soft amber aura
  g.radialGlow(cx, cy, halo, halo, C.ember, withA(C.ember, 0), haloA);
  // sparkle trail (behind the body)
  for (const s of p.sparks || []) g.px(s[0], s[1], withA(s[2], s[3]));
  // body: dark base (roundness), amber body, gold inner, pale gloss + hot core
  g.ellipse(cx, cy + 1, rx, ry, EMBER_SHADOW);
  g.ellipse(cx, cy, rx, Math.max(2, ry - 1), C.ember);
  g.ellipse(cx - 1, cy - 1, Math.max(2, rx - 2), Math.max(2, ry - 3), C.gold);
  g.disc(cx - 2, cy - 2, 1, C.glow);
  g.px(cx - 2, cy - 2, HOT_CORE);
  // cool aqua rim (lower-right) — ties Lumen to the world's teal light
  g.px(cx + rx - 1, cy + 1, C.aqua);
  g.px(cx + rx - 2, cy + 2, C.aqua);
  // landing dust arc
  if (p.ring)
    for (const [dx, dy] of [[-8, 3], [-6, 4], [-3, 5], [3, 5], [6, 4], [8, 3]]) g.px(cx + dx, cy + dy, withA(C.aqua, 150));
  // crown flame, then eyes on top
  drawFlame(g, cx, cy - Math.max(2, ry - 1), flame, flameH);
  drawEyes(g, cx + lookX, cy - 1 + lookY, eye);
}

function lumenSheet() {
  // Per-frame poses. sparks are hand-placed (deterministic) for trail control.
  const F = [
    // 0 idle-a — settled, gentle aura
    { cx: 12, cy: 13, rx: 7, ry: 7, eye: "normal", lookX: 0, lookY: 0, flame: 0, flameH: 3, halo: 11, haloA: 120, sparks: [[12, 3, C.glow, 180]] },
    // 1 idle-b — bob up, taller, flame flick
    { cx: 12, cy: 11, rx: 7, ry: 8, eye: "normal", lookX: 0, lookY: 0, flame: 1, flameH: 4, halo: 12, haloA: 145, sparks: [[12, 2, C.glow, 220], [18, 7, C.gold, 150]] },
    // 2 run-a — lean forward, short trailing sparks
    { cx: 13, cy: 13, rx: 7, ry: 7, eye: "forward", lookX: 1, lookY: 0, flame: -2, flameH: 3, halo: 11, haloA: 130, sparks: [[5, 10, C.gold, 175], [3, 14, C.glow, 120]] },
    // 3 run-b — up + stretched, longer trail
    { cx: 13, cy: 11, rx: 8, ry: 7, eye: "forward", lookX: 1, lookY: 0, flame: -2, flameH: 3, halo: 12, haloA: 140, sparks: [[5, 9, C.glow, 200], [2, 12, C.gold, 150], [4, 16, C.aqua, 120]] },
    // 4 run-c — lean, longest trail
    { cx: 13, cy: 13, rx: 7, ry: 7, eye: "forward", lookX: 1, lookY: 0, flame: -3, flameH: 3, halo: 11, haloA: 130, sparks: [[4, 11, C.gold, 185], [1, 14, C.glow, 130], [6, 16, C.glow, 110]] },
    // 5 run-d — up + stretched (cycle back)
    { cx: 13, cy: 11, rx: 8, ry: 7, eye: "forward", lookX: 1, lookY: 0, flame: -2, flameH: 3, halo: 12, haloA: 140, sparks: [[5, 10, C.glow, 200], [2, 13, C.gold, 150]] },
    // 6 jump — stretched tall, eyes up, flame high, sparks below
    { cx: 12, cy: 11, rx: 6, ry: 9, eye: "up", lookX: 0, lookY: -1, flame: 0, flameH: 5, halo: 11, haloA: 150, sparks: [[12, 21, C.glow, 150], [9, 19, C.gold, 110], [15, 19, C.gold, 110]] },
    // 7 fall — squashed wide, eyes wide-down, sparks trailing up
    { cx: 12, cy: 13, rx: 9, ry: 6, eye: "wide", lookX: 0, lookY: 1, flame: 2, flameH: 3, halo: 12, haloA: 150, sparks: [[12, 2, C.glow, 170], [7, 3, C.gold, 120], [17, 3, C.gold, 120]] },
    // 8 land — big squash, squint, impact dust arc
    { cx: 12, cy: 16, rx: 10, ry: 4, eye: "squint", lookX: 0, lookY: 0, flame: 0, flameH: 2, halo: 12, haloA: 160, ring: true, sparks: [[3, 17, C.glow, 200], [21, 17, C.glow, 200], [6, 19, C.gold, 140], [18, 19, C.gold, 140]] },
    // 9 land-b — recover (slight overshoot), settle
    { cx: 12, cy: 12, rx: 7, ry: 8, eye: "normal", lookX: 0, lookY: 0, flame: 1, flameH: 4, halo: 11, haloA: 130, sparks: [[12, 3, C.glow, 160], [19, 8, C.gold, 120]] },
  ];
  const sheet = new Grid(240, 24);
  F.forEach((p, i) => {
    const g = new Grid(24, 24);
    drawLumen(g, p);
    sheet.blit(g, i * 24, 0);
  });
  return sheet;
}

// ═════════════════════════════════════════════════════════════════════════════
// DUSKLANDS TILESET — 32px tiles, single row (192×32). Index→meaning is a FROZEN
// contract for the scene that consumes it:
//   0 solid stone · 1 one-way ledge · 2 slope-left · 3 slope-right · 4 ladder · 5 decor stone
// All carved from one drifting twilight stone: indigo body, teal-lit surfaces,
// void shadow, seeded aqua/glow glimmers.
// ═════════════════════════════════════════════════════════════════════════════
const STONE_SEAM = lerp(C.twilight, C.void, 0.55);

/** 0 — solid stone block: opaque, teal-lit cap + left edge, void bottom/right. */
function tileStone() {
  const g = new Grid(32, 32);
  for (let y = 0; y < 32; y++) g.rect(0, y, 32, 1, lerp(C.twilight, C.dusk, (y / 31) * 0.6));
  // brick seams (running bond), kept under the lit cap
  g.hline(0, 31, 15, STONE_SEAM);
  g.vline(10, 3, 14, STONE_SEAM);
  g.vline(22, 16, 28, STONE_SEAM);
  // beveled lit cap + left edge; void shadow on bottom + right
  g.rect(0, 0, 32, 2, C.aqua);
  g.rect(0, 2, 32, 1, lerp(C.aqua, C.twilight, 0.5));
  g.vline(0, 0, 31, lerp(C.aqua, C.twilight, 0.45));
  g.rect(0, 30, 32, 2, C.void);
  g.vline(31, 0, 31, lerp(C.twilight, C.void, 0.6));
  // glimmers
  const rnd = mulberry32(0x1000);
  for (let i = 0; i < 6; i++) g.px(2 + Math.floor(rnd() * 28), 5 + Math.floor(rnd() * 22), withA(rnd() > 0.5 ? C.aqua : C.glow, 150));
  return g;
}

/** 1 — one-way ledge: a thin top-lit plank; the cell is transparent below it. */
function tileLedge() {
  const g = new Grid(32, 32);
  const top = 4;
  const ph = 9; // plank rows top..top+ph-1
  for (let i = 0; i < ph; i++) g.rect(0, top + i, 32, 1, lerp(C.twilight, C.dusk, (i / (ph - 1)) * 0.7));
  g.rect(0, top, 32, 2, C.aqua); // strong lit top edge — "top-lit plank"
  g.rect(0, top + 2, 32, 1, lerp(C.aqua, C.twilight, 0.5));
  g.hline(0, 31, top + 5, STONE_SEAM); // grain
  g.rect(0, top + ph - 1, 32, 1, C.void); // underside shadow
  g.px(3, top + 1, C.glow); // end bolts
  g.px(28, top + 1, C.glow);
  g.px(8, top + 6, withA(C.gold, 160)); // glimmers
  g.px(23, top + 6, withA(C.aqua, 150));
  return g;
}

/** 2/3 — slopes. 'left' is high on the LEFT (surface descends to the right);
 *  'right' mirrors. Solid below the lit diagonal; transparent above it. */
function tileSlope(dir) {
  const g = new Grid(32, 32);
  const top = 2;
  for (let x = 0; x < 32; x++) {
    const xx = dir === "left" ? x : 31 - x; // high side
    const surf = Math.round(top + (xx / 31) * (31 - top));
    for (let y = surf; y < 32; y++) g.px(x, y, lerp(C.twilight, C.dusk, Math.min(1, ((y - surf) / (32 - surf || 1)) * 0.8)));
    g.px(x, surf, C.aqua); // lit walk surface
    if (surf + 1 < 32) g.px(x, surf + 1, lerp(C.aqua, C.twilight, 0.5));
  }
  g.rect(0, 30, 32, 2, C.void); // base shadow
  const rnd = mulberry32(dir === "left" ? 0x1002 : 0x1003);
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(rnd() * 32);
    const surf = Math.round(top + ((dir === "left" ? x : 31 - x) / 31) * (31 - top));
    const room = 29 - (surf + 2);
    if (room > 0) g.px(x, surf + 2 + Math.floor(rnd() * room), withA(C.aqua, 130));
  }
  return g;
}

/** 4 — ladder: two teal rails + pale rungs on a faint backing; mostly transparent. */
function tileLadder() {
  const g = new Grid(32, 32);
  for (let y = 0; y < 32; y++) g.rect(11, y, 10, 1, withA(lerp(C.twilight, C.dusk, 0.5), 90)); // backing
  g.rect(8, 0, 3, 32, C.aqua); // rails
  g.rect(21, 0, 3, 32, C.aqua);
  g.vline(10, 0, 31, lerp(C.aqua, C.void, 0.4)); // rail shade (right)
  g.vline(23, 0, 31, lerp(C.aqua, C.void, 0.4));
  g.vline(8, 0, 31, C.glow); // rail highlight (left)
  g.vline(21, 0, 31, C.glow);
  for (let y = 3; y < 32; y += 7) {
    g.rect(8, y, 16, 2, C.glow); // rungs
    g.rect(8, y + 2, 16, 1, lerp(C.glow, C.gold, 0.6));
  }
  return g;
}

/** 5 — decorative/background stone: darker, mottled, no lit cap (reads as behind). */
function tileDecor() {
  const g = new Grid(32, 32);
  for (let y = 0; y < 32; y++) g.rect(0, y, 32, 1, lerp(C.dusk, C.void, (y / 31) * 0.5));
  const rnd = mulberry32(0x1005);
  for (let i = 0; i < 10; i++) {
    const s = 2 + Math.floor(rnd() * 3);
    g.rect(Math.floor(rnd() * 28), Math.floor(rnd() * 28), s, s, withA(lerp(C.twilight, C.dusk, rnd()), 120)); // mottle
  }
  g.hline(0, 31, 16, withA(C.void, 180)); // crack
  for (let i = 0; i < 6; i++) g.px(Math.floor(rnd() * 32), Math.floor(rnd() * 32), withA(rnd() > 0.5 ? C.violet : C.aqua, 110)); // arcane echoes
  g.outline(0, 0, 32, 32, withA(C.void, 120)); // subtle cell border
  return g;
}

function tilesSheet() {
  const sheet = new Grid(192, 32);
  [tileStone(), tileLedge(), tileSlope("left"), tileSlope("right"), tileLadder(), tileDecor()].forEach((t, i) => sheet.blit(t, i * 32, 0));
  return sheet;
}

// ═════════════════════════════════════════════════════════════════════════════
// COLLECTIBLES + PROPS (recommended). The game may fall back to shape primitives
// for any of these (see ART.md), but generating them keeps the world cohesive.
// ═════════════════════════════════════════════════════════════════════════════

/** mote (coin) — a glowing gold orb, 4-frame spin (width narrows). 16×16 → 64×16. */
function moteSheet() {
  const sheet = new Grid(64, 16);
  [5, 3, 1, 3].forEach((rx, i) => {
    const g = new Grid(16, 16);
    g.radialGlow(8, 8, 7, 7, C.gold, withA(C.gold, 0), 110);
    g.ellipse(8, 8, rx, 6, C.ember); // warm rim
    g.ellipse(8, 8, Math.max(1, rx - 1), 5, C.gold); // gold body
    g.ellipse(8, 7, Math.max(1, rx - 1), 3, C.glow); // top highlight
    g.px(8, 6, HOT_CORE); // glint
    sheet.blit(g, i * 16, 0);
  });
  return sheet;
}

/** emberstone (gem) — a faceted warm crystal with a hot core. 16×16. */
function emberstone() {
  const g = new Grid(16, 16);
  g.radialGlow(8, 8, 8, 8, C.ember, withA(C.ember, 0), 130);
  g.diamond(8, 8, 6, 8, C.void); // 1px outline (behind the facets)
  for (let yy = -7; yy <= 7; yy++) {
    const span = Math.round(5 * (1 - Math.abs(yy) / 7));
    for (let xx = -span; xx <= span; xx++) {
      let col;
      if (yy <= -1) col = xx < 0 ? C.glow : C.gold; // upper facets
      else if (yy <= 2) col = xx < 0 ? C.gold : C.ember; // mid
      else col = xx < 0 ? C.ember : lerp(C.ember, C.void, 0.35); // lower
      g.px(8 + xx, 8 + yy, col);
    }
  }
  g.vline(8, 2, 14, withA(C.glow, 150)); // central seam
  g.diamond(8, 6, 1, 2, HOT_CORE); // bright core
  return g;
}

/** driftwraith (enemy) — a fuchsia spectre with a tattered tail; 2-frame bob. 24×24 → 48×24. */
function wraithFrame(bob) {
  const g = new Grid(24, 24);
  const cy = 10 + bob;
  g.radialGlow(12, cy, 11, 11, C.fuchsia, withA(C.fuchsia, 0), 120);
  // tattered tail — three downward lobes that swap length per frame (a slow sway)
  const tailTop = cy + 5;
  const lobes = [[6, bob > 0 ? 4 : 6], [12, bob > 0 ? 6 : 4], [18, bob > 0 ? 4 : 6]];
  for (const [lx, len] of lobes)
    for (let i = 0; i < len; i++) {
      const w = Math.max(0, 2 - Math.floor(i / 2));
      for (let dx = -w; dx <= w; dx++) g.px(lx + dx, tailTop + i, lerp(C.fuchsia, C.violet, 0.4 + 0.3 * (i / len)));
    }
  // body — rounded top, violet underside
  g.ellipse(12, cy, 8, 7, C.fuchsia);
  g.ellipse(12, cy + 2, 8, 5, lerp(C.fuchsia, C.violet, 0.55));
  g.ellipse(12, cy - 1, 6, 5, C.fuchsia);
  g.disc(9, cy - 3, 1, withA(C.glow, 220)); // gloss
  // menacing face — angled void slits under a violet brow (≠ Lumen's round eyes)
  g.rect(7, cy - 2, 3, 2, C.void);
  g.rect(14, cy - 2, 3, 2, C.void);
  g.px(8, cy - 2, C.glow);
  g.px(15, cy - 2, C.glow);
  for (const [x, y] of [[7, cy - 3], [9, cy - 3], [14, cy - 3], [16, cy - 3]]) g.px(x, y, C.violet); // brow
  return g;
}
function wraithSheet() {
  const sheet = new Grid(48, 24);
  sheet.blit(wraithFrame(0), 0, 0);
  sheet.blit(wraithFrame(2), 24, 0);
  return sheet;
}

/** riftgate (portal) — a tall violet rift: concentric rings, void core, swirling sparks. 32×48. */
function riftgate() {
  const g = new Grid(32, 48);
  const cx = 16;
  const cy = 24;
  g.radialGlow(cx, cy, 14, 22, C.violet, withA(C.violet, 0), 110);
  // concentric rings (outer→inner overdraw leaves bands), violet/glow alternating, void core
  const rings = [
    [12, 23, C.violet],
    [10, 19, lerp(C.violet, C.glow, 0.45)],
    [8, 15, C.violet],
    [6, 11, lerp(C.violet, C.glow, 0.65)],
    [4, 7, C.violet],
    [2, 4, C.void],
  ];
  for (const [rx, ry, col] of rings) g.ellipse(cx, cy, rx, ry, col);
  // swirling sparks
  const rnd = mulberry32(0x2001);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = 0.25 + rnd() * 0.75;
    g.px(cx + Math.round(Math.cos(a) * rr * 9), cy + Math.round(Math.sin(a) * rr * 19), withA(rnd() > 0.5 ? C.glow : C.violet, 150 + Math.floor(rnd() * 90)));
  }
  // anchoring stone base
  g.rect(6, 44, 20, 4, C.twilight);
  g.rect(6, 44, 20, 1, C.aqua);
  return g;
}

/** beacon (goal) — a warm light column on a teal-lit pedestal; rising sparks. 32×64. */
function beacon() {
  const g = new Grid(32, 64);
  const cx = 16;
  g.radialGlow(cx, 38, 14, 26, C.glow, withA(C.glow, 0), 120);
  // rising light column (widens + warms toward the base)
  for (let y = 6; y < 54; y++) {
    const t = (y - 6) / (54 - 6);
    const w = Math.round(2 + t * 4);
    const col = lerp(C.glow, C.ember, t * 0.6);
    for (let dx = -w; dx <= w; dx++) g.px(cx + dx, y, withA(col, 200 - Math.floor(t * 60)));
  }
  g.vline(cx, 6, 52, HOT_CORE); // bright core line
  g.vline(cx - 1, 8, 52, C.glow);
  g.vline(cx + 1, 8, 52, C.glow);
  g.disc(cx, 7, 3, C.glow); // crown spark
  g.disc(cx, 7, 1, WHITE);
  const rnd = mulberry32(0x3001);
  for (let i = 0; i < 18; i++) g.px(cx + Math.round((rnd() - 0.5) * 14), 8 + Math.floor(rnd() * 46), withA(rnd() > 0.5 ? C.gold : C.glow, 120 + Math.floor(rnd() * 100)));
  // stone pedestal
  for (let i = 0; i < 10; i++) g.rect(4, 54 + i, 24, 1, lerp(C.twilight, C.dusk, (i / 10) * 0.8));
  g.rect(4, 54, 24, 2, C.aqua); // lit top
  g.outline(4, 54, 24, 10, C.void);
  g.rect(14, 57, 4, 5, C.gold); // base glyph
  g.px(16, 56, C.glow);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate. Clean ONLY this game's own art subdir (never the whole public/assets,
// which a later session may also fill with synced library art), then recreate it.
// ─────────────────────────────────────────────────────────────────────────────
rmSync(ASSETS, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });

write("player.png", lumenSheet()); // REQUIRED — hero sheet
write("tiles.png", tilesSheet()); // REQUIRED — Dusklands tileset
write("mote.png", moteSheet());
write("emberstone.png", emberstone());
write("driftwraith.png", wraithSheet());
write("riftgate.png", riftgate());
write("beacon.png", beacon());

console.log(`gen-art (Lumen): wrote ${written.length} PNG(s) to public/assets/lumen/ — ${written.join(", ")}.`);
