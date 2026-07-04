import { describe, expect, it } from "vitest";
import {
  FX_ONE, fx, fxAdd, fxDiv, fxFloor, fxFromFloat, fxMul, fxMulSat, fxSqrt, fxSub,
} from "../src/math/fixed.js";
import { dist, distSq } from "../src/math/vec.js";
import { prngNext, prngSeed } from "../src/math/prng.js";

describe("Q16.16 fixed point", () => {
  it("round-trips integers", () => {
    expect(fxFloor(fx(123))).toBe(123);
    expect(fxFloor(fx(-5))).toBe(-5);
  });

  it("multiplies exactly on representable values", () => {
    expect(fxMul(fx(3), fx(4))).toBe(fx(12));
    expect(fxMul(fxFromFloat(2.5), fx(4))).toBe(fx(10));
    expect(fxMul(fx(-3), fx(4))).toBe(fx(-12));
    expect(fxMul(FX_ONE >> 1, FX_ONE >> 1)).toBe(FX_ONE >> 2); // 0.5 * 0.5 = 0.25
  });

  it("multiplication matches BigInt reference across a seeded sweep", () => {
    const st = prngSeed(42);
    for (let i = 0; i < 20000; i++) {
      const a = (prngNext(st) | 0) >> 8; // keep products in int32 result range
      const b = (prngNext(st) | 0) >> 8;
      const ref = Number((BigInt(a) * BigInt(b)) >> 16n);
      // fxMul floors (arithmetic shift semantics); BigInt >> also floors. int32 wrap both sides:
      expect(fxMul(a, b)).toBe(ref | 0);
    }
  });

  it("divides with truncation toward zero", () => {
    expect(fxDiv(fx(10), fx(4))).toBe(fxFromFloat(2.5));
    expect(fxDiv(fx(1), fx(3))).toBe(21845); // 65536/3 truncated
    expect(() => fxDiv(fx(1), 0)).toThrow();
  });

  it("sqrt is exact on perfect squares and monotonic elsewhere", () => {
    expect(fxSqrt(fx(4))).toBe(fx(2));
    expect(fxSqrt(fx(9))).toBe(fx(3));
    expect(fxSqrt(fx(2))).toBe(92681); // floor(sqrt(2) * 65536) = 92681
    expect(fxSqrt(0)).toBe(0);
    let prev = 0;
    const st = prngSeed(7);
    const vals: number[] = [];
    for (let i = 0; i < 500; i++) vals.push(prngNext(st) & 0x7fffffff);
    vals.sort((x, y) => x - y);
    for (const v of vals) {
      const r = fxSqrt(v);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
      // floor semantics: r² ≤ v<<16 < (r+1)²
      expect(r * r).toBeLessThanOrEqual(v * FX_ONE);
      expect((r + 1) * (r + 1)).toBeGreaterThan(v * FX_ONE);
    }
  });

  it("saturating multiply clamps instead of wrapping", () => {
    expect(fxMulSat(fx(300), fx(300))).toBe(0x7fffffff);
    expect(fxMulSat(fx(-300), fx(300))).toBe(-0x80000000);
    expect(fxMulSat(fx(3), fx(4))).toBe(fx(12));
  });

  it("distances behave", () => {
    expect(dist(0, 0, fx(3), fx(4))).toBe(fx(5));
    expect(distSq(0, 0, fx(3), fx(4))).toBe(fx(25));
    // Large separation takes the scaled path without overflowing.
    const d = dist(0, 0, fx(200), fx(200));
    expect(d).toBeGreaterThan(fx(282));
    expect(d).toBeLessThan(fx(284));
  });

  it("all ops stay in int32 (no float leakage)", () => {
    const st = prngSeed(99);
    for (let i = 0; i < 5000; i++) {
      const a = prngNext(st) | 0;
      const b = (prngNext(st) | 0) || 1;
      for (const v of [fxAdd(a, b), fxSub(a, b), fxMul(a >> 8, b >> 8), fxDiv(a >> 4, b), fxSqrt(a & 0x7fffffff)]) {
        expect(v).toBe(v | 0);
      }
    }
  });
});
