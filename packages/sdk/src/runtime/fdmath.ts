/**
 * fdmath — the engine-independent transcendental math seam.
 *
 * WHY THIS EXISTS. GitCade's determinism guarantee (replays, ghosts, seeded challenges,
 * verifiable speedruns) rests on a fixed-timestep sim whose only outputs are a function of
 * `world.rng` + input. ECMAScript mandates that `+ - * /` and `Math.sqrt` are correctly
 * rounded (IEEE-754 round-to-nearest-even), so those are BIT-IDENTICAL on every conformant
 * engine — but it leaves the transcendental `Math.*` functions (sin, cos, tan, atan, atan2,
 * exp, log, pow, asin, acos, …) "implementation-approximated". V8 and SpiderMonkey ship an
 * fdlibm port; JavaScriptCore (Safari/iOS) historically binds the system libm — so the last
 * ULP can differ across engines. A run verified headless in Node (V8) could therefore drift
 * when reproduced in another browser, breaking cross-engine ghosts and server-side speedrun
 * verification. `runDeterminismCheck` runs both passes in ONE engine, so it is blind to this
 * by construction.
 *
 * THE FIX. This module reimplements the transcendentals in PURE JS, built ONLY on the
 * correctly-rounded primitives (`+ - * /`, `Math.sqrt`) plus integer bit manipulation of the
 * IEEE-754 representation — so every function yields the bit-identical double on every
 * conformant engine, V8 / SpiderMonkey / JavaScriptCore alike. The algorithms are faithful
 * ports of Sun's freely-distributable fdlibm (the same lineage V8/SM derive from), which is
 * why accuracy stays within ~1 ULP of the native `Math.*`. This is the sanctioned seam for
 * simulation transcendentals, exactly as {@link World.rng} is the sanctioned seam for
 * simulation entropy: behaviors/systems reach it as `world.math`.
 *
 * SCOPE (deliberately minimal, grown on proven demand — DESIGN.md's catalog ethos):
 *  - `hypot` is `sqrt(x*x + y*y)` — already built only from correctly-rounded primitives, so
 *    it needs no polynomial. (It is NOT bit-equal to `Math.hypot`, which runs its own scaled
 *    algorithm; OURS is the canonical one. Prefer comparing SQUARED distances where the
 *    magnitude itself is not needed — `dx*dx+dy*dy <= r*r` avoids the sqrt entirely.)
 *  - `powInt` is exact exponentiation-by-squaring for INTEGER exponents (cost/upgrade curves).
 *  - `pow` (real exponent) is `exp(y*log(x))` with full IEEE edge-case handling — deterministic
 *    and accurate to a few ULP, which is ample for difficulty curves and camera-shake falloff.
 *    (A faithful fdlibm `pow` can replace the kernel later behind this same signature if a
 *    precision-critical consumer ever appears; the surface would not change.)
 *  - The exotics (cbrt, expm1, log1p, log2, log10, hyperbolics) are intentionally absent until
 *    a real consumer needs one.
 *
 * PORTABILITY NOTE. The ports read the high/low 32-bit words of a double. We use a single
 * shared big-endian {@link DataView} (`setFloat64`/`getInt32` with `littleEndian=false`), so
 * word offset 0 is ALWAYS the sign+exponent+high-mantissa word regardless of the host's native
 * endianness. The computed double depends only on the arithmetic, never on how we read the
 * bits, so the result is identical on every platform. The DataView is module-scoped and reused
 * (no per-call allocation) — JS is single-threaded, so the scratch is safe to share.
 *
 * Everything here is browser-safe (no Node built-ins) and PURELY ADDITIVE — it introduces a new
 * surface and reshapes nothing. Migrating the runtime's category-(a) sites onto it re-bases the
 * deterministic byte-fingerprint to a cross-engine baseline as of sdk 1.12.0 (see CHANGELOG).
 */

// ---------------------------------------------------------------------------
// IEEE-754 word access — one shared big-endian view; offset 0 = high word.
// `getInt32` returns a SIGNED 32-bit word, mirroring C's `int hx` so the fdlibm
// sign tests (`hx < 0`) and arithmetic shifts (`hx >> 20`) port verbatim.
// ---------------------------------------------------------------------------
const __dv = new DataView(new ArrayBuffer(8));

function high(x: number): number {
  __dv.setFloat64(0, x, false);
  return __dv.getInt32(0, false);
}
function low(x: number): number {
  __dv.setFloat64(0, x, false);
  return __dv.getInt32(4, false);
}
/** Rebuild a double from (signed) high+low words. */
function fromWords(hi: number, lo: number): number {
  __dv.setInt32(0, hi | 0, false);
  __dv.setInt32(4, lo | 0, false);
  return __dv.getFloat64(0, false);
}
/** Replace the high word of `x`, keeping its low word. */
function withHigh(x: number, hi: number): number {
  __dv.setFloat64(0, x, false);
  __dv.setInt32(0, hi | 0, false);
  return __dv.getFloat64(0, false);
}
/** Replace the low word of `x`, keeping its high word. */
function withLow(x: number, lo: number): number {
  __dv.setFloat64(0, x, false);
  __dv.setInt32(4, lo | 0, false);
  return __dv.getFloat64(0, false);
}

const PI = 3.141592653589793; // 0x400921FB54442D18
const PIO2 = 1.5707963267948966;

// ---------------------------------------------------------------------------
// exp — faithful port of fdlibm __ieee754_exp.
// ---------------------------------------------------------------------------
const E_ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
const E_ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const E_invln2 = 1.44269504088896341868e00;
const E_P1 = 1.66666666666666019037e-01;
const E_P2 = -2.77777777770155933842e-03;
const E_P3 = 6.61375632143793436117e-05;
const E_P4 = -1.65339022054652515390e-06;
const E_P5 = 4.13813679705723846039e-08;
const E_huge = 1e300;
const E_twom1000 = 9.33263618503218878990e-302; // 2^-1000
const E_o_threshold = 7.09782712893383973096e02;
const E_u_threshold = -7.45133219101941108420e02;

export function exp(x: number): number {
  let hx = high(x);
  const xsb = (hx >>> 31) & 1; // sign bit (0 = +, 1 = -)
  hx &= 0x7fffffff; // |x| high word

  // Filter out non-finite and out-of-range arguments.
  if (hx >= 0x40862e42) {
    // |x| >= 709.78...
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | low(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0.0; // exp(+inf)=inf, exp(-inf)=0
    }
    if (x > E_o_threshold) return E_huge * E_huge; // overflow → +inf
    if (x < E_u_threshold) return E_twom1000 * E_twom1000; // underflow → 0
  }

  // Argument reduction: x = k*ln2 + r, with |r| <= 0.5*ln2.
  let k = 0;
  let hi = 0;
  let lo = 0;
  if (hx > 0x3fd62e42) {
    // |x| > 0.5*ln2
    if (hx < 0x3ff0a2b2) {
      // |x| < 1.5*ln2
      hi = x - E_ln2HI[xsb];
      lo = E_ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(E_invln2 * x + (xsb === 0 ? 0.5 : -0.5));
      const t = k;
      hi = x - t * E_ln2HI[0]; // t*ln2HI is exact here
      lo = t * E_ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    // |x| < 2^-28 — exp(x) ≈ 1 + x
    if (E_huge + x > 1.0) return 1.0 + x;
  }

  const t = x * x;
  const c = x - t * (E_P1 + t * (E_P2 + t * (E_P3 + t * (E_P4 + t * E_P5))));
  if (k === 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    return withHigh(y, high(y) + (k << 20)); // y * 2^k
  }
  y = withHigh(y, high(y) + ((k + 1000) << 20));
  return y * E_twom1000;
}

// ---------------------------------------------------------------------------
// log — faithful port of fdlibm __ieee754_log.
// ---------------------------------------------------------------------------
// ln2_hi has its low 32 bits ZEROED (0x3fe62e42fee00000) so that `k*ln2_hi` is EXACT; ln2_lo
// carries the discarded tail. (This is a DIFFERENT constant from the full-precision ln2 — using
// the full value here double-counts ln2_lo and injects a ~k*1.9e-10 error.)
const L_ln2_hi = 6.93147180369123816490e-01;
const L_ln2_lo = 1.90821492927058770002e-10;
const L_two54 = 1.80143985094819840000e16;
const L_Lg1 = 6.666666666666735130e-01;
const L_Lg2 = 3.999999999940941908e-01;
const L_Lg3 = 2.857142874366239149e-01;
const L_Lg4 = 2.222219843214978396e-01;
const L_Lg5 = 1.818357216161805012e-01;
const L_Lg6 = 1.531383769920937332e-01;
const L_Lg7 = 1.479819860511658591e-01;

export function log(x: number): number {
  let hx = high(x);
  const lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    // x < 2^-1022 (subnormal, zero, or negative)
    if (((hx & 0x7fffffff) | lx) === 0) return -L_two54 / 0.0; // log(±0) = -inf
    if (hx < 0) return (x - x) / 0.0; // log(negative) = NaN
    k -= 54;
    x *= L_two54; // subnormal → scale up
    hx = high(x);
  }
  if (hx >= 0x7ff00000) return x + x; // +inf or NaN
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i = (hx + 0x95f64) & 0x100000;
  x = withHigh(x, hx | (i ^ 0x3ff00000)); // normalize x into [1,2)
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    // |f| < 2^-20
    if (f === 0.0) {
      if (k === 0) return 0.0;
      const dk0 = k;
      return dk0 * L_ln2_hi + dk0 * L_ln2_lo;
    }
    const R0 = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R0;
    const dk1 = k;
    return dk1 * L_ln2_hi - (R0 - dk1 * L_ln2_lo - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  let i2 = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (L_Lg2 + w * (L_Lg4 + w * L_Lg6));
  const t2 = z * (L_Lg1 + w * (L_Lg3 + w * (L_Lg5 + w * L_Lg7)));
  i2 |= j;
  const R = t2 + t1;
  if (i2 > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * L_ln2_hi - (hfsq - (s * (hfsq + R) + dk * L_ln2_lo) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * L_ln2_hi - (s * (f - R) - dk * L_ln2_lo - f);
}

// ---------------------------------------------------------------------------
// Trig kernels + range reduction — faithful ports of fdlibm k_sin/k_cos/k_tan
// and __ieee754_rem_pio2 (medium-size path). Game angles are tiny, so the medium
// 3-word reduction (accurate for |x| <= 2^20*(pi/2) ≈ 1.65e6) covers every real
// input; beyond that bound the SAME deterministic arithmetic is reused (accuracy
// degrades gracefully but stays bit-identical across engines — we don't port the
// huge-argument Payne-Hanek kernel since no game approaches that magnitude).
// ---------------------------------------------------------------------------
const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

function kernelSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

function kernelCos(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const w2 = 1.0 - hz;
  return w2 + (1.0 - w2 - hz + (z * r - x * y));
}

const T_tan = [
  3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02,
  2.18694882948595424599e-02, 8.86323982359930005737e-03, 3.59207910759131235356e-03,
  1.45620945432529025516e-03, 5.88041240820264096874e-04, 2.46463134818469906812e-04,
  7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
  2.59073051863633712884e-05,
];
const T_pio4 = 7.85398163397448278999e-01;
const T_pio4lo = 3.06161699786838301793e-17;

function kernelTan(x: number, y: number, iy: number): number {
  let z = 0;
  let w = 0;
  let hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3e300000) {
    // |x| < 2^-28
    if (Math.trunc(x) === 0) {
      if (((ix | low(x)) | (iy + 1)) === 0) return 1.0 / Math.abs(x);
      if (iy === 1) return x;
      // compute -1 / (x + T_pio4...) — but for tiny x, fall to general path below
      const w1 = x + y;
      const z1 = withLow(w1, 0);
      const v1 = y - (z1 - x);
      let a1 = -1.0 / w1;
      const t1 = withLow(a1, 0);
      const s1 = 1.0 + t1 * z1;
      return t1 + a1 * (s1 + t1 * v1);
    }
  }
  if (ix >= 0x3fe59428) {
    // |x| >= 0.6744
    if (hx < 0) {
      x = -x;
      y = -y;
    }
    z = T_pio4 - x;
    w = T_pio4lo - y;
    x = z + w;
    y = 0.0;
  }
  z = x * x;
  w = z * z;
  const r =
    T_tan[1] + w * (T_tan[3] + w * (T_tan[5] + w * (T_tan[7] + w * (T_tan[9] + w * T_tan[11]))));
  const v =
    z * (T_tan[2] + w * (T_tan[4] + w * (T_tan[6] + w * (T_tan[8] + w * (T_tan[10] + w * T_tan[12])))));
  const s = z * x;
  let rr = y + z * (s * (r + v) + y);
  rr += T_tan[0] * s;
  w = x + rr;
  if (ix >= 0x3fe59428) {
    const v2 = iy;
    return (1 - ((hx >> 30) & 2)) * (v2 - 2.0 * (x - (w * w / (w + v2) - rr)));
  }
  if (iy === 1) return w;
  // iy === -1 → compute -1/w with care
  z = withLow(w, 0);
  const v3 = rr - (z - x);
  let a = -1.0 / w;
  const t = withLow(a, 0);
  const sgn = 1.0 + t * z;
  return t + a * (sgn + t * v3);
}

// rem_pio2 medium-path constants.
const RP_invpio2 = 6.36619772367581382433e-01;
const RP_pio2_1 = 1.57079632673412561417e00;
const RP_pio2_1t = 6.07710050650619224932e-11;
const RP_pio2_2 = 6.07710050630396597660e-11;
const RP_pio2_2t = 2.02226624879595063154e-21;
const RP_pio2_3 = 2.02226624871116645580e-21;
const RP_pio2_3t = 8.47842766036889956997e-32;

// Scratch output for the reduced argument [hi, lo] — reused (single-threaded).
const __remy = [0, 0];

function remPio2(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    // |x| <= pi/4 — no reduction
    __remy[0] = x;
    __remy[1] = 0;
    return 0;
  }
  if (ix < 0x4002d97c) {
    // |x| < 3*pi/4 — one round of reduction
    if (hx > 0) {
      let z = x - RP_pio2_1;
      if (ix !== 0x3ff921fb) {
        __remy[0] = z - RP_pio2_1t;
        __remy[1] = z - __remy[0] - RP_pio2_1t;
      } else {
        z -= RP_pio2_2;
        __remy[0] = z - RP_pio2_2t;
        __remy[1] = z - __remy[0] - RP_pio2_2t;
      }
      return 1;
    }
    let z = x + RP_pio2_1;
    if (ix !== 0x3ff921fb) {
      __remy[0] = z + RP_pio2_1t;
      __remy[1] = z - __remy[0] + RP_pio2_1t;
    } else {
      z += RP_pio2_2;
      __remy[0] = z + RP_pio2_2t;
      __remy[1] = z - __remy[0] + RP_pio2_2t;
    }
    return -1;
  }
  // Medium size (and, deterministically, beyond): reduce by n*(pi/2).
  const t = Math.abs(x);
  const n = Math.trunc(t * RP_invpio2 + 0.5);
  const fn = n;
  let r = t - fn * RP_pio2_1;
  let w = fn * RP_pio2_1t;
  const j = ix >> 20;
  let y0 = r - w;
  let hi = high(y0);
  let i = j - ((hi >> 20) & 0x7ff);
  if (i > 16) {
    // 2nd iteration (needed when cancellation lost > 16 bits)
    const t1 = r;
    w = fn * RP_pio2_2;
    r = t1 - w;
    w = fn * RP_pio2_2t - (t1 - r - w);
    y0 = r - w;
    hi = high(y0);
    i = j - ((hi >> 20) & 0x7ff);
    if (i > 49) {
      // 3rd iteration (rare)
      const t2 = r;
      w = fn * RP_pio2_3;
      r = t2 - w;
      w = fn * RP_pio2_3t - (t2 - r - w);
      y0 = r - w;
    }
  }
  const y1 = r - y0 - w;
  if (hx < 0) {
    __remy[0] = -y0;
    __remy[1] = -y1;
    return -n;
  }
  __remy[0] = y0;
  __remy[1] = y1;
  return n;
}

export function sin(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e500000) return x; // |x| < 2^-27 → sin x ≈ x
    return kernelSin(x, 0.0, 0);
  }
  if (ix >= 0x7ff00000) return x - x; // NaN/inf → NaN
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(__remy[0], __remy[1], 1);
    case 1:
      return kernelCos(__remy[0], __remy[1]);
    case 2:
      return -kernelSin(__remy[0], __remy[1], 1);
    default:
      return -kernelCos(__remy[0], __remy[1]);
  }
}

export function cos(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e46a09e) return 1.0; // |x| < 2^-27 → cos x ≈ 1
    return kernelCos(x, 0.0);
  }
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(__remy[0], __remy[1]);
    case 1:
      return -kernelSin(__remy[0], __remy[1], 1);
    case 2:
      return -kernelCos(__remy[0], __remy[1]);
    default:
      return kernelSin(__remy[0], __remy[1], 1);
  }
}

export function tan(x: number): number {
  const ix = high(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) {
    if (ix < 0x3e400000) return x; // |x| < 2^-27 → tan x ≈ x
    return kernelTan(x, 0.0, 1);
  }
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  return kernelTan(__remy[0], __remy[1], 1 - ((n & 1) << 1)); // iy = +1 (even) / -1 (odd)
}

// ---------------------------------------------------------------------------
// atan / atan2 — faithful ports of fdlibm s_atan / e_atan2.
// ---------------------------------------------------------------------------
const AT_hi = [
  4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01,
  1.57079632679489655800e00,
];
const AT_lo = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01,
  -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02,
  -3.65315727442169155270e-02, 1.62858201153657823623e-02,
];

export function atan(x: number): number {
  let hx = high(x);
  let ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    // |x| >= 2^66
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && low(x) !== 0)) return x + x; // NaN
    if (hx > 0) return AT_hi[3] + AT_lo[3];
    return -AT_hi[3] - AT_lo[3];
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    // |x| < 0.4375
    if (ix < 0x3e400000) {
      // |x| < 2^-27
      if (E_huge + x > 1.0) return x;
    }
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      // |x| < 1.1875
      if (ix < 0x3fe60000) {
        // 7/16 <= |x| < 11/16
        id = 0;
        x = (2.0 * x - 1.0) / (2.0 + x);
      } else {
        // 11/16 <= |x| < 19/16
        id = 1;
        x = (x - 1.0) / (x + 1.0);
      }
    } else if (ix < 0x40038000) {
      // 19/16 <= |x| < 39/16
      id = 2;
      x = (x - 1.5) / (1.0 + 1.5 * x);
    } else {
      // |x| >= 39/16
      id = 3;
      x = -1.0 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const z2 = AT_hi[id] - (x * (s1 + s2) - AT_lo[id] - x);
  return hx < 0 ? -z2 : z2;
}

const A2_pi_lo = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  const lx = low(x);
  const hy = high(y);
  const iy = hy & 0x7fffffff;
  const ly = low(y);
  if (
    ix > 0x7ff00000 ||
    (ix === 0x7ff00000 && lx !== 0) || // x is NaN
    iy > 0x7ff00000 ||
    (iy === 0x7ff00000 && ly !== 0) // y is NaN
  ) {
    return x + y;
  }
  if (hx === 0x3ff00000 && lx === 0) return atan(y); // x == 1 → atan(y)
  const m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2); // 2*sign(x) + sign(y)

  // y == 0
  if ((iy | ly) === 0) {
    switch (m) {
      case 0:
      case 1:
        return y; // ±0
      case 2:
        return PI; // atan(+0, -) = pi
      default:
        return -PI; // atan(-0, -) = -pi
    }
  }
  // x == 0
  if ((ix | lx) === 0) return hy < 0 ? -PIO2 : PIO2;
  // x is INF
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) {
        case 0:
          return PI / 4;
        case 1:
          return -PI / 4;
        case 2:
          return (3.0 * PI) / 4;
        default:
          return (-3.0 * PI) / 4;
      }
    } else {
      switch (m) {
        case 0:
          return 0.0;
        case 1:
          return -0.0;
        case 2:
          return PI;
        default:
          return -PI;
      }
    }
  }
  // y is INF
  if (iy === 0x7ff00000) return hy < 0 ? -PIO2 : PIO2;

  // compute y/x
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) z = PIO2 + 0.5 * A2_pi_lo; // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0.0; // 0 > |y/x| > -2^-60, x < 0
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z; // (+,+)
    case 1:
      return -z; // (-,+)
    case 2:
      return PI - (z - A2_pi_lo); // (+,-)
    default:
      return z - A2_pi_lo - PI; // (-,-)
  }
}

// ---------------------------------------------------------------------------
// asin / acos — faithful ports of fdlibm e_asin / e_acos (shared rational poly).
// ---------------------------------------------------------------------------
const AS_pio2_hi = 1.57079632679489655800e00;
const AS_pio2_lo = 6.12323399573676603587e-17;
const AS_pio4_hi = 7.85398163397448278999e-01;
const AS_pS0 = 1.66666666666666657415e-01;
const AS_pS1 = -3.25565818622400915405e-01;
const AS_pS2 = 2.01212532134862925881e-01;
const AS_pS3 = -4.00555345006794114027e-02;
const AS_pS4 = 7.91534994289814532176e-04;
const AS_pS5 = 3.47933107596021167570e-05;
const AS_qS1 = -2.40339491173441421878e00;
const AS_qS2 = 2.02094576023350569471e00;
const AS_qS3 = -6.88283971605453293030e-01;
const AS_qS4 = 7.70381505559019352791e-02;

function asPoly(t: number): number {
  const p = t * (AS_pS0 + t * (AS_pS1 + t * (AS_pS2 + t * (AS_pS3 + t * (AS_pS4 + t * AS_pS5)))));
  const q = 1.0 + t * (AS_qS1 + t * (AS_qS2 + t * (AS_qS3 + t * AS_qS4)));
  return p / q;
}

export function asin(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | low(x)) === 0) return x * AS_pio2_hi + x * AS_pio2_lo; // ±1 → ±pi/2
    return (x - x) / (x - x); // |x| > 1 → NaN
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix < 0x3e400000) {
      if (E_huge + x > 1.0) return x; // |x| < 2^-27 → x
    }
    const t = x * x;
    return x + x * asPoly(t);
  }
  // |x| >= 0.5
  const w0 = 1.0 - Math.abs(x);
  const t = w0 * 0.5;
  const s = Math.sqrt(t);
  let res: number;
  if (ix >= 0x3fef3333) {
    // |x| > 0.975
    const w = asPoly(t);
    res = AS_pio2_hi - (2.0 * (s + s * w) - AS_pio2_lo);
  } else {
    let w = withLow(s, 0);
    const c = (t - w * w) / (s + w);
    const r = asPoly(t);
    const p = 2.0 * s * r - (AS_pio2_lo - 2.0 * c);
    const q = AS_pio4_hi - 2.0 * w;
    res = AS_pio4_hi - (p - q);
  }
  return hx > 0 ? res : -res;
}

export function acos(x: number): number {
  const hx = high(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    // |x| >= 1
    if (((ix - 0x3ff00000) | low(x)) === 0) {
      if (hx > 0) return 0.0; // acos(1) = 0
      return PI + 2.0 * AS_pio2_lo; // acos(-1) = pi
    }
    return (x - x) / (x - x); // |x| > 1 → NaN
  }
  if (ix < 0x3fe00000) {
    // |x| < 0.5
    if (ix <= 0x3c600000) return AS_pio2_hi + AS_pio2_lo; // |x| < 2^-57 → pi/2
    const z = x * x;
    const r = asPoly(z);
    return AS_pio2_hi - (x - (AS_pio2_lo - x * r));
  }
  if (hx < 0) {
    // x <= -0.5
    const z = (1.0 + x) * 0.5;
    const s = Math.sqrt(z);
    const r = asPoly(z);
    const w = r * s - AS_pio2_lo;
    return PI - 2.0 * (s + w);
  }
  // x >= 0.5
  const z = (1.0 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = withLow(s, 0);
  const c = (z - df * df) / (s + df);
  const r = asPoly(z);
  const w = r * s + c;
  return 2.0 * (df + w);
}

// ---------------------------------------------------------------------------
// hypot / pow / powInt — built on the seam above + correctly-rounded primitives.
// ---------------------------------------------------------------------------

/**
 * Euclidean length `sqrt(x*x + y*y)`. Built ONLY from correctly-rounded primitives, so it is
 * cross-engine bit-identical — unlike `Math.hypot`, which runs its own scaled algorithm.
 * Where the magnitude itself is not needed (range / arrival / aggro checks), prefer comparing
 * SQUARED distances directly (`dx*dx + dy*dy <= r*r`) — exact AND sqrt-free.
 */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * Integer power by exponentiation-by-squaring — `base ** n` for an INTEGER `n`, using ONLY
 * multiplication, so it is cross-engine bit-identical (deterministic). The right tool for
 * difficulty / cost / upgrade curves where the exponent is a count (`growth ** owned`).
 * Not correctly-rounded (the squaring order accumulates ≤ ~1 ULP vs the true value), but that
 * is irrelevant to replay — what matters is that every engine computes the SAME bits. A
 * non-integer `n` falls through to {@link pow}.
 */
export function powInt(base: number, n: number): number {
  if (!Number.isInteger(n)) return pow(base, n);
  let e = n < 0 ? -n : n;
  let b = base;
  let result = 1;
  while (e > 0) {
    if (e & 1) result *= b;
    e >>>= 1;
    if (e > 0) b *= b;
  }
  return n < 0 ? 1 / result : result;
}

/**
 * Real-exponent power. Deterministic across engines: integer exponents use the exact
 * {@link powInt}; the general case is `exp(y * log(x))` over the canonical {@link exp}/{@link log}
 * (a few ULP of error — ample for difficulty curves and camera-shake falloff), with the IEEE
 * special cases handled explicitly so it matches `Math.pow` on edge inputs.
 */
export function pow(x: number, y: number): number {
  if (y === 0) return 1; // pow(x, ±0) = 1 (incl. NaN base, per IEEE)
  if (x === 1) return 1; // pow(1, y) = 1 (incl. y = NaN, per IEEE) — BEFORE the NaN gate
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (Number.isInteger(y) && Math.abs(y) <= 0x7fffffff) {
    // Exact integer-exponent path (also gives correct sign for negative base).
    return powInt(x, y);
  }
  // Non-integer exponent: a negative base has no real result.
  if (x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (!Number.isFinite(x)) return x > 0 ? (y > 0 ? Infinity : 0) : NaN;
  if (!Number.isFinite(y)) {
    const ax = Math.abs(x);
    if (ax === 1) return NaN; // pow(±1, ±inf): we already handled x===1; (-1) handled above
    if (y > 0) return ax > 1 ? Infinity : 0;
    return ax > 1 ? 0 : Infinity;
  }
  return exp(y * log(x));
}

// ---------------------------------------------------------------------------
// The public seam — a frozen singleton shared by every World as `world.math`.
// ---------------------------------------------------------------------------

/**
 * The engine-independent transcendental surface exposed as {@link World.math}. Every function
 * is deterministic across conformant JS engines (built only on correctly-rounded primitives),
 * so simulation math routed through it replays byte-identically anywhere — the transcendental
 * analogue of {@link World.rng} for entropy. Authors: reach these as `world.math.sin(…)` etc.
 */
export interface MathOps {
  /** sin(x), radians. Cross-engine bit-identical. */
  sin(x: number): number;
  /** cos(x), radians. Cross-engine bit-identical. */
  cos(x: number): number;
  /** tan(x), radians. Cross-engine bit-identical. */
  tan(x: number): number;
  /** atan(x) → (-pi/2, pi/2). */
  atan(x: number): number;
  /** atan2(y, x) → (-pi, pi], the quadrant-aware angle of vector (x, y). */
  atan2(y: number, x: number): number;
  /** asin(x), x in [-1, 1]. */
  asin(x: number): number;
  /** acos(x), x in [-1, 1]. */
  acos(x: number): number;
  /** e**x. */
  exp(x: number): number;
  /** natural log. */
  log(x: number): number;
  /** x**y (real exponent) — deterministic; see {@link pow}. */
  pow(x: number, y: number): number;
  /** base**n for INTEGER n — deterministic, sqrt/exp-free. */
  powInt(base: number, n: number): number;
  /** sqrt(x*x + y*y) — exact from primitives; prefer squared-distance where possible. */
  hypot(x: number, y: number): number;
}

/** The shared, frozen {@link MathOps} singleton (pure + stateless, so one instance serves all worlds). */
export const CanonicalMath: MathOps = Object.freeze({
  sin,
  cos,
  tan,
  atan,
  atan2,
  asin,
  acos,
  exp,
  log,
  pow,
  powInt,
  hypot,
});
