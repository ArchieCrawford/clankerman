/**
 * Fixed-point 2D vector helpers. Vectors are stored inline as (x, y) Fx pairs on
 * game objects — no vector class instances in sim state (LOG [004]: state stays
 * plain/serializable). These are pure functions over Fx scalars.
 */
import { Fx, FX_ONE, fxAbs, fxDiv, fxMax, fxMul, fxMulSat, fxSqrt } from "./fixed.js";

/**
 * Squared distance, saturating at FX_MAX (reached at ~181 wu of separation).
 * Prefer this for range checks; when used for *ordering* (nearest-of), ties
 * among saturated far-away candidates fall back to iteration order — fine for
 * gameplay, but don't use it to sort precisely beyond ~181 wu.
 */
export function distSq(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  const dx = (bx - ax) | 0;
  const dy = (by - ay) | 0;
  const dx2 = fxMulSat(dx, dx);
  const dy2 = fxMulSat(dy, dy);
  const sum = dx2 + dy2;
  return sum > 0x7fffffff ? 0x7fffffff : sum | 0;
}

/**
 * True distance. One fxSqrt — use only when the actual magnitude is needed.
 * Precondition: separations must fit the map model (≤ 256 wu per axis,
 * LOG [005]); beyond ~32767 wu the int32 delta itself would wrap.
 */
export function dist(ax: Fx, ay: Fx, bx: Fx, by: Fx): Fx {
  // Chebyshev/Manhattan-safe path: for very large separations dx²+dy² would
  // saturate, so fall back to a scaled computation.
  const dx = fxAbs((bx - ax) | 0);
  const dy = fxAbs((by - ay) | 0);
  const hi = fxMax(dx, dy);
  if (hi === 0) return 0;
  if (hi < 128 * FX_ONE) {
    return fxSqrt((fxMul(dx, dx) + fxMul(dy, dy)) | 0);
  }
  // Scale down by 256 to stay in range, sqrt, scale back up.
  const sdx = dx >> 8;
  const sdy = dy >> 8;
  return (fxSqrt((fxMul(sdx, sdx) + fxMul(sdy, sdy)) | 0) << 8) | 0;
}

/**
 * Normalize (dx, dy) to unit length and scale by `mag`, writing into out[0..1].
 * Two fxDivs — callers cache the result per path waypoint, not per tick.
 */
export function scaledDir(dx: Fx, dy: Fx, mag: Fx, out: Int32Array): void {
  const len = dist(0, 0, dx, dy);
  if (len === 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  out[0] = fxMul(fxDiv(dx, len), mag);
  out[1] = fxMul(fxDiv(dy, len), mag);
}
