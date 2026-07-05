/**
 * Q16.16 fixed-point math. See ARCHITECTURE_LOG [003] for the determinism contract.
 *
 * Values are JS numbers constrained to signed 32-bit integers. The integer part
 * lives in the high 16 bits, the fraction in the low 16. Every operation ends in
 * `| 0` so intermediate float64 values can never leak into stored state.
 */

export type Fx = number; // branded by convention: always int32, Q16.16

export const FX_SHIFT = 16;
export const FX_ONE: Fx = 1 << FX_SHIFT; // 65536
export const FX_HALF: Fx = FX_ONE >> 1;
export const FX_MAX: Fx = 0x7fffffff;
export const FX_MIN: Fx = -0x80000000;

/** Integer → fixed. Input must be within ±32767. */
export function fx(n: number): Fx {
  return (n << FX_SHIFT) | 0;
}

/**
 * Data-authoring helper: convert a decimal literal (e.g. 2.5) to fixed at
 * definition time. Deterministic because it runs on constants before the sim
 * starts; never call it on sim state.
 */
export function fxFromFloat(n: number): Fx {
  return Math.floor(n * FX_ONE) | 0;
}

/** Fixed → integer part (floor). */
export function fxFloor(a: Fx): number {
  return a >> FX_SHIFT;
}

export function fxAdd(a: Fx, b: Fx): Fx {
  return (a + b) | 0;
}

export function fxSub(a: Fx, b: Fx): Fx {
  return (a - b) | 0;
}

/**
 * Fixed multiply: (a * b) >> 16 with a 48-bit-safe split.
 * `al * b` ≤ 2^16 * 2^31 = 2^47 — exact in float64. Division by 2^16 is an
 * exponent shift (exact), floor of an exact value is exact, imul is 32-bit exact.
 */
export function fxMul(a: Fx, b: Fx): Fx {
  const ah = a >> FX_SHIFT;
  const al = a & 0xffff;
  return (Math.imul(ah, b) + Math.floor((al * b) / FX_ONE)) | 0;
}

/**
 * Fixed divide: (a << 16) / b, truncated toward zero. BigInt keeps the 48-bit
 * intermediate exact. Slow — keep out of per-unit hot loops (LOG [003]).
 */
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) throw new Error("fxDiv by zero");
  return Number((BigInt(a) << 16n) / BigInt(b)) | 0;
}

export function fxAbs(a: Fx): Fx {
  return a < 0 ? (-a | 0) : a;
}

export function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

export function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/**
 * Fixed sqrt: digit-by-digit integer square root of the 48-bit value (a << 16),
 * so fxSqrt(fx(4)) === fx(2). Uses only adds/subtracts/multiplies-by-powers-of-2
 * on values ≤ 2^48 — all exact in float64. No floating-point sqrt anywhere.
 */
export function fxSqrt(a: Fx): Fx {
  if (a < 0) throw new Error("fxSqrt of negative");
  if (a === 0) return 0;
  // n is up to 2^47; float64 is exact for integers < 2^53.
  let n = a * FX_ONE;
  let root = 0;
  // Highest power-of-4 ≤ 2^46 (bit must be a power of 4 for the algorithm).
  // Written as a literal so the float-ban lint can outlaw `**` outright.
  let bit = 0x400000000000; // 2^46

  while (bit > n) bit /= 4;
  while (bit >= 1) {
    if (n >= root + bit) {
      n -= root + bit;
      root = root / 2 + bit;
    } else {
      root /= 2;
    }
    bit /= 4;
  }
  return root | 0;
}

/**
 * Saturating multiply. Unlike fxMul this must see the true product to test the
 * bounds, so it uses plain float64 products: ah is 16-bit signed and b is int32,
 * so ah*b ≤ 2^47 and the sum ≤ 2^48 — both within float64's exact-integer range.
 */
export function fxMulSat(a: Fx, b: Fx): Fx {
  const ah = a >> FX_SHIFT;
  const al = a & 0xffff;
  const exact = ah * b + Math.floor((al * b) / FX_ONE);
  if (exact > FX_MAX) return FX_MAX;
  if (exact < FX_MIN) return FX_MIN;
  return exact | 0;
}
