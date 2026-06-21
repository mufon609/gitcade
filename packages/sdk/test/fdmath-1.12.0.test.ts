import { describe, it, expect } from "vitest";
import {
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
  CanonicalMath,
} from "../src/runtime/fdmath.js";

/**
 * fdmath conformance — two properties, proven mechanically:
 *  1. ACCURACY: each function stays within a tight ULP bound of the native `Math.*` across a
 *     wide input range. A wrong transcribed constant blows the bound immediately, so this is the
 *     transcription-error tripwire. (V8's Math.* is itself fdlibm-derived, so the bound is small.)
 *  2. EDGE CASES: NaN / ±Inf / ±0 / domain-boundary inputs match IEEE / `Math.*`.
 * The CROSS-ENGINE determinism property (bit-identical on every engine) is structural — the module
 * uses only correctly-rounded primitives — and is anchored separately by the committed golden.
 */

// Monotonic IEEE-754 ordering → ULP distance between two doubles.
const __dv = new DataView(new ArrayBuffer(8));
function ordKey(x: number): bigint {
  __dv.setFloat64(0, x, false);
  const bits = __dv.getBigUint64(0, false);
  if (bits & 0x8000000000000000n) return 0x8000000000000000n - (bits & 0x7fffffffffffffffn);
  return bits | 0x8000000000000000n;
}
function ulps(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  const d = ordKey(a) - ordKey(b);
  return Number(d < 0n ? -d : d);
}

/** Max ULP error of `f` vs `ref` over `xs` (skipping samples the reference can't represent). */
function maxUlp(xs: number[], f: (x: number) => number, ref: (x: number) => number): number {
  let m = 0;
  for (const x of xs) {
    const a = f(x);
    const b = ref(x);
    if (!Number.isFinite(b)) continue;
    m = Math.max(m, ulps(a, b));
  }
  return m;
}

function range(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let x = lo; x <= hi; x += step) out.push(x);
  return out;
}

describe("fdmath — accuracy vs Math.* (transcription tripwire)", () => {
  it("sin within 1 ULP over [-20, 20]", () => {
    expect(maxUlp(range(-20, 20, 0.0007), sin, Math.sin)).toBeLessThanOrEqual(1);
  });
  it("cos within 1 ULP over [-20, 20]", () => {
    expect(maxUlp(range(-20, 20, 0.0007), cos, Math.cos)).toBeLessThanOrEqual(1);
  });
  it("tan within 1 ULP over [-15, 15] (away from poles; exercises range reduction)", () => {
    const xs = range(-15, 15, 0.0007).filter((x) => Math.abs(Math.cos(x)) > 1e-3);
    expect(maxUlp(xs, tan, Math.tan)).toBeLessThanOrEqual(1);
  });
  it("atan within 1 ULP over [-100, 100]", () => {
    expect(maxUlp(range(-100, 100, 0.003), atan, Math.atan)).toBeLessThanOrEqual(1);
  });
  it("asin within 1 ULP over [-1, 1]", () => {
    expect(maxUlp(range(-1, 1, 0.00005), asin, Math.asin)).toBeLessThanOrEqual(1);
  });
  it("acos within 1 ULP over [-1, 1]", () => {
    expect(maxUlp(range(-1, 1, 0.00005), acos, Math.acos)).toBeLessThanOrEqual(1);
  });
  it("exp within 1 ULP over [-700, 700]", () => {
    expect(maxUlp(range(-700, 700, 0.02), exp, Math.exp)).toBeLessThanOrEqual(1);
  });
  it("log within 1 ULP over (0, 1000] and tiny/huge", () => {
    const xs = [
      ...range(0.0005, 1000, 0.02),
      1e-300,
      1e-100,
      1e-10,
      1e10,
      1e100,
      1e300,
      Number.MIN_VALUE,
    ];
    expect(maxUlp(xs, log, Math.log)).toBeLessThanOrEqual(1);
  });
  it("atan2 within 1 ULP over a grid", () => {
    let m = 0;
    for (let y = -5; y <= 5; y += 0.05) {
      for (let x = -5; x <= 5; x += 0.05) {
        m = Math.max(m, ulps(atan2(y, x), Math.atan2(y, x)));
      }
    }
    expect(m).toBeLessThanOrEqual(1);
  });
});

describe("fdmath — pow / powInt / hypot", () => {
  it("powInt: within 1 ULP of Math.pow for integer exponents, and reciprocal-consistent", () => {
    for (const base of [1.5, 2, 0.5, 3.14159, 10, 0.1, -2, -1.5]) {
      for (let n = 0; n <= 12; n++) {
        // Exponentiation-by-squaring is deterministic, not correctly-rounded — the squaring
        // order accumulates O(log n) rounding (≤ a few ULP for these exponents). Bit-identity
        // across engines, not closeness to the true value, is the property that matters.
        expect(ulps(powInt(base, n), Math.pow(base, n))).toBeLessThanOrEqual(4);
        expect(powInt(base, -n)).toBe(1 / powInt(base, n)); // negative path is exactly 1/positive
      }
    }
    expect(powInt(2, 30)).toBe(2 ** 30); // exact for powers of two
  });
  it("pow within a few ULP of Math.pow for real exponents (exp∘log path)", () => {
    let m = 0;
    for (let base = 0.05; base <= 12; base += 0.05) {
      for (const y of [0.5, 1.5, 2.5, -0.5, -1.5, 0.3333, 7.25, -3.7]) {
        const a = pow(base, y);
        const b = Math.pow(base, y);
        if (Number.isFinite(b)) m = Math.max(m, ulps(a, b));
      }
    }
    // exp(y*log x) composes two ~1-ULP results, and exp AMPLIFIES the error in t=y*log(x) by
    // ~|t|, so a few tens of ULP at large |t| is inherent (and ~1e-14 relative — imperceptible
    // for difficulty curves / camera-shake falloff, the only consumers). Determinism is exact.
    expect(m).toBeLessThanOrEqual(32);
  });
  it("pow uses the exact integer path for integer exponents", () => {
    expect(pow(1.15, 7)).toBe(powInt(1.15, 7));
    expect(pow(2, 10)).toBe(1024);
    expect(pow(-2, 3)).toBe(-8); // negative base, odd integer exponent
    expect(pow(-2, 2)).toBe(4); // negative base, even integer exponent
  });
  it("hypot equals sqrt(x*x+y*y) exactly and approximates true length", () => {
    for (const [x, y] of [
      [3, 4],
      [3, 4.0000001],
      [-7, 24],
      [0.1, 0.2],
      [1e8, 1e8],
    ]) {
      expect(hypot(x, y)).toBe(Math.sqrt(x * x + y * y));
      expect(ulps(hypot(x, y), Math.hypot(x, y))).toBeLessThanOrEqual(2);
    }
  });
});

describe("fdmath — IEEE edge cases", () => {
  it("sin/cos/tan: NaN, ±Inf → NaN; tiny → identity-ish", () => {
    for (const f of [sin, cos, tan]) {
      expect(Number.isNaN(f(NaN))).toBe(true);
      expect(Number.isNaN(f(Infinity))).toBe(true);
      expect(Number.isNaN(f(-Infinity))).toBe(true);
    }
    expect(sin(0)).toBe(0);
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(tan(0)).toBe(0);
  });
  it("exp: ±Inf, overflow, underflow", () => {
    expect(exp(0)).toBe(1);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(-Infinity)).toBe(0);
    expect(Number.isNaN(exp(NaN))).toBe(true);
    expect(exp(710)).toBe(Infinity); // overflow
    expect(exp(-746)).toBe(0); // underflow
  });
  it("log: 0 → -Inf, negative → NaN, 1 → 0", () => {
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(Object.is(log(-0), -Infinity)).toBe(true);
    expect(Number.isNaN(log(-1))).toBe(true);
    expect(log(Infinity)).toBe(Infinity);
  });
  it("asin/acos: domain boundaries and out-of-domain NaN", () => {
    expect(asin(1)).toBe(Math.asin(1));
    expect(asin(-1)).toBe(Math.asin(-1));
    expect(acos(1)).toBe(0);
    expect(acos(-1)).toBe(Math.acos(-1));
    expect(Number.isNaN(asin(1.5))).toBe(true);
    expect(Number.isNaN(acos(-1.5))).toBe(true);
  });
  it("atan2: axis and infinity cases match Math.atan2", () => {
    const cases: [number, number][] = [
      [0, 0],
      [-0, 0],
      [0, -0],
      [0, -1],
      [-0, -1],
      [1, 0],
      [-1, 0],
      [Infinity, Infinity],
      [Infinity, -Infinity],
      [-Infinity, Infinity],
      [1, Infinity],
      [1, -Infinity],
      [Infinity, 1],
    ];
    for (const [y, x] of cases) {
      expect(Object.is(atan2(y, x), Math.atan2(y, x))).toBe(true);
    }
  });
  it("pow: IEEE special cases", () => {
    expect(pow(123, 0)).toBe(1);
    expect(pow(NaN, 0)).toBe(1); // per IEEE pow(NaN,0)=1
    expect(pow(1, NaN)).toBe(1);
    expect(Number.isNaN(pow(-2, 0.5))).toBe(true); // negative base, non-int exp
    expect(pow(0, 2)).toBe(0);
    expect(pow(0, -1)).toBe(Infinity);
  });
});

describe("fdmath — cross-engine golden (canonical bit patterns)", () => {
  // These are the EXACT IEEE-754 bit patterns fdmath produces. Because the module is built only
  // on correctly-rounded primitives, EVERY conformant JS engine must reproduce them — so this
  // table IS the cross-engine determinism contract for the math seam (any engine matching it is
  // bit-identical to Node here). It is also a regression fence: a later "optimization" that
  // perturbs an output trips this. Regenerate ONLY as a deliberate, surfaced fingerprint re-base.
  const fns: Record<string, (...a: number[]) => number> = {
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
  };
  const GOLDEN: [string, () => number, bigint][] = [
    ["sin(0.5)", () => sin(0.5), 0x3fdeaee8744b05f0n],
    ["sin(2.4)", () => sin(2.4), 0x3fe59d64f5c3d19bn],
    ["sin(-13.37)", () => sin(-13.37), 0xbfe70941bc53d621n],
    ["cos(0.5)", () => cos(0.5), 0x3fec1528065b7d50n],
    ["cos(2.4)", () => cos(2.4), 0xbfe798bab490d185n],
    ["cos(100.0)", () => cos(100.0), 0x3feb981dbf665fdfn],
    ["tan(1.1)", () => tan(1.1), 0x3fff6fa7d286214en],
    ["tan(-0.3)", () => tan(-0.3), 0xbfd3cc2a44e29998n],
    ["atan(0.7)", () => atan(0.7), 0x3fe38b112d7bd4adn],
    ["atan(42.0)", () => atan(42.0), 0x3ff8c079f3350d26n],
    ["atan2(3,4)", () => atan2(3, 4), 0x3fe4978fa3269ee1n],
    ["atan2(-1,-1)", () => atan2(-1, -1), 0xc002d97c7f3321d2n],
    ["asin(0.3)", () => asin(0.3), 0x3fd380159e14f6ffn],
    ["acos(-0.8)", () => acos(-0.8), 0x4003fc176b7a8560n],
    ["exp(1)", () => exp(1), 0x4005bf0a8b14576an],
    ["exp(-5.5)", () => exp(-5.5), 0x3f70bd4a5aca7728n],
    ["log(2)", () => log(2), 0x3fe62e42fefa39efn],
    ["log(11.95)", () => log(11.95), 0x4003d889a3f65da2n],
    ["log(0.001)", () => log(0.001), 0xc01ba18a998fffa0n],
    ["pow(1.15,2.5)", () => pow(1.15, 2.5), 0x3ff6b10adce2ce42n],
    ["pow(0.5,0.333)", () => pow(0.5, 0.333), 0x3fe9677f46057bden],
    ["powInt(1.15,7)", () => powInt(1.15, 7), 0x400547b880ca95b7n],
    ["powInt(2,20)", () => powInt(2, 20), 0x4130000000000000n],
    ["hypot(3,4)", () => hypot(3, 4), 0x4014000000000000n],
    ["hypot(0.1,0.2)", () => hypot(0.1, 0.2), 0x3fcc9f25c5bfeddan],
  ];
  const bitsOf = (x: number): bigint => {
    __dv.setFloat64(0, x, false);
    return __dv.getBigUint64(0, false);
  };
  for (const [label, run, expected] of GOLDEN) {
    it(`${label} reproduces the golden bits`, () => {
      expect(bitsOf(run())).toBe(expected);
    });
  }
  it("covers every exported op", () => {
    const covered = new Set(GOLDEN.map(([l]) => l.split("(")[0]));
    for (const name of Object.keys(fns)) expect(covered.has(name)).toBe(true);
  });
});

describe("fdmath — public seam", () => {
  it("CanonicalMath is frozen and wires every op", () => {
    expect(Object.isFrozen(CanonicalMath)).toBe(true);
    expect(CanonicalMath.sin(0.7)).toBe(sin(0.7));
    expect(CanonicalMath.hypot(3, 4)).toBe(5);
    expect(CanonicalMath.powInt(1.15, 5)).toBe(powInt(1.15, 5));
  });
});
