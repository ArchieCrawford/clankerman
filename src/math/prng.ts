/**
 * Deterministic PRNG: xorshift128 on 32-bit lanes. Only xor/shift/imul — every
 * op is exactly specified. The four-lane state lives inside GameState so
 * snapshots capture it (LOG [003]/[004]).
 */

export interface PrngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

/** Seed expansion via splitmix32 so nearby seeds don't correlate. */
export function prngSeed(seed: number): PrngState {
  let h = seed | 0;
  const next = (): number => {
    h = (h + 0x9e3779b9) | 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) | 0;
  };
  const st = { s0: next(), s1: next(), s2: next(), s3: next() };
  // xorshift128 must never be all-zero.
  if ((st.s0 | st.s1 | st.s2 | st.s3) === 0) st.s3 = 1;
  return st;
}

/** Next uint32 (returned as int32 bit pattern reinterpreted ≥ 0 via >>> 0). */
export function prngNext(st: PrngState): number {
  let t = st.s3;
  const s = st.s0;
  st.s3 = st.s2;
  st.s2 = st.s1;
  st.s1 = s;
  t ^= (t << 11) | 0;
  t ^= t >>> 8;
  st.s0 = (t ^ s ^ (s >>> 19)) | 0;
  return st.s0 >>> 0;
}

/** Uniform integer in [0, n). Rejection-free modulo is fine for game logic. */
export function prngRange(st: PrngState, n: number): number {
  return prngNext(st) % n;
}
