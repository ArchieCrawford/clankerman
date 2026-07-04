/**
 * Uniform spatial hash grid for neighbor queries (targeting, collision,
 * separation). See ARCHITECTURE_LOG [005] (spatial model: bucket = 4x4 world
 * units, maps <= 256x256, ~2000 units) and [003] (determinism contract).
 *
 * The grid is TRANSIENT DERIVED DATA: rebuilt from the units array each tick,
 * never serialized, never hashed (LOG [003] hashState covers sim state only).
 * It may therefore use typed arrays and be reused across ticks — none of this
 * storage participates in the lockstep hash.
 *
 * Zero steady-state allocation: buckets are intrusive singly-linked lists.
 * `heads[bucket]` holds the first unit index (-1 = empty) and `next[i]` the
 * following unit index in the same bucket. `next` grows geometrically if the
 * unit count exceeds capacity; nothing else ever allocates after warm-up
 * (queries write into a caller-provided `out` array that the caller reuses).
 *
 * DETERMINISM: all query math is integer-exact. Positions are Q16.16 int32
 * (LOG [003]); differences, squares, and sums stay within float64's exact
 * integer range (< 2^53), so no rounding ever occurs and results are
 * bit-identical on every platform. Output index order (ascending) is part of
 * the contract so callers can take "first match" as a deterministic choice.
 */
import { Fx, FX_SHIFT } from "../math/fixed.js";

/** Bucket edge = 4 world units = 4 map cells (LOG [005]). */
export const BUCKET_WORLD_SHIFT = 2;
/** worldFx >> BUCKET_FX_SHIFT = bucket coordinate. */
export const BUCKET_FX_SHIFT = FX_SHIFT + BUCKET_WORLD_SHIFT; // 18
const BUCKET_FX = 1 << BUCKET_FX_SHIFT;

/**
 * Query radii are clamped to 1024 world units (2^26 raw Q16.16) so that
 * radius*radius <= 2^52 stays exact in float64. On maps <= 256x256 world units
 * (max diagonal ~362) the clamp can never change a query result.
 */
const MAX_QUERY_RADIUS = 1 << 26;

export interface SpatialGrid {
  /** Bucket columns/rows: ceil(worldWidth/4) x ceil(worldHeight/4). */
  readonly cols: number;
  readonly rows: number;
  /** Per-bucket head unit index, -1 = empty. Length cols*rows. */
  readonly heads: Int32Array;
  /** Intrusive per-unit-slot next pointer. Reassigned when capacity grows. */
  next: Int32Array;
  /** Unit count at the last gridRebuild (debug/inspection only). */
  count: number;
}

/**
 * Create a grid for a map of worldWidth x worldHeight WHOLE world units
 * (i.e. map.width / map.height — cell size is 1.0 world unit, LOG [005]).
 */
export function createSpatialGrid(
  worldWidth: number,
  worldHeight: number,
  initialCapacity = 256,
): SpatialGrid {
  if (worldWidth <= 0 || worldHeight <= 0) {
    throw new Error("createSpatialGrid: world dimensions must be positive");
  }
  const cols = (worldWidth + 3) >> BUCKET_WORLD_SHIFT;
  const rows = (worldHeight + 3) >> BUCKET_WORLD_SHIFT;
  return {
    cols,
    rows,
    heads: new Int32Array(cols * rows).fill(-1),
    next: new Int32Array(initialCapacity > 0 ? initialCapacity : 1),
    count: 0,
  };
}

/**
 * O(n) full rebuild from the units array. Call once per tick before queries.
 *
 * Units are pushed onto list heads in REVERSE array order, so walking a
 * bucket's list yields ASCENDING unit indices — the deterministic iteration
 * order the query contract relies on.
 *
 * Out-of-bounds positions are clamped into the edge buckets (never dropped):
 * a unit that strays past the map border must still be findable by queries.
 */
export function gridRebuild(
  grid: SpatialGrid,
  units: readonly { x: Fx; y: Fx }[],
): void {
  const n = units.length;
  if (n > grid.next.length) {
    // Geometric growth; no copy needed — the loop below overwrites slots 0..n-1.
    let cap = grid.next.length;
    while (cap < n) cap *= 2;
    grid.next = new Int32Array(cap);
  }
  grid.heads.fill(-1);
  grid.count = n;
  const cols = grid.cols;
  const maxCol = cols - 1;
  const maxRow = grid.rows - 1;
  const heads = grid.heads;
  const next = grid.next;
  for (let i = n - 1; i >= 0; i--) {
    const u = units[i]!;
    // x/y are int32 Q16.16, so >> is safe and exact (arithmetic shift).
    let bx = u.x >> BUCKET_FX_SHIFT;
    let by = u.y >> BUCKET_FX_SHIFT;
    if (bx < 0) bx = 0;
    else if (bx > maxCol) bx = maxCol;
    if (by < 0) by = 0;
    else if (by > maxRow) by = maxRow;
    const b = by * cols + bx;
    next[i] = heads[b]!;
    heads[b] = i;
  }
}

/**
 * Exact floor-division of a (possibly out-of-int32-range) Q16.16 coordinate
 * into a clamped bucket coordinate. `v` is an exact integer of magnitude
 * < 2^32 (int32 position +/- clamped radius); dividing an exact float64
 * integer by a power of two only shifts the exponent (exact), and Math.floor
 * of an exact value is exact — deterministic per LOG [003].
 */
function bucketClamped(v: number, max: number): number {
  const b = Math.floor(v / BUCKET_FX);
  return b < 0 ? 0 : b > max ? max : b;
}

/** Shared numeric comparator — hoisted so queries allocate no closures. */
function ascending(a: number, b: number): number {
  return a - b;
}

/**
 * Find all unit indices whose position lies within `radius` of (cx, cy),
 * boundary INCLUSIVE (dist == radius is a hit). cx/cy/radius are raw Q16.16.
 *
 * Fills `out` (cleared first) with indices in ASCENDING order and returns the
 * count. Only buckets overlapping the circle's AABB are visited; each
 * candidate gets an exact distance-squared test.
 *
 * OVERFLOW SAFETY / DETERMINISM ARGUMENT (LOG [003]):
 * dx = u.x - cx is a difference of two int32s computed in float64: magnitude
 * < 2^32, always an exact integer (int32 squaring would overflow — positions
 * reach ~2^24 raw, so dx*dx can reach ~2^48). We first early-reject with
 * |dx| > r (plain integer compares, no products, cannot overflow). Radius is
 * clamped to 2^26 (1024 world units — semantics-preserving on <= 256-unit
 * maps, see MAX_QUERY_RADIUS), so after the reject |dx|, |dy| <= 2^26 and
 * dx*dx, dy*dy <= 2^52; their sum <= 2^53 and rSq = r*r <= 2^52. Every one of
 * these values is an exact integer within float64's exact-integer range
 * (<= 2^53), so no operation ever rounds: the products, the sum, and the
 * final <= compare are exact and IEEE-754-bit-identical on every platform.
 */
export function gridQueryCircle(
  grid: SpatialGrid,
  units: readonly { x: Fx; y: Fx }[],
  cx: Fx,
  cy: Fx,
  radius: Fx,
  out: number[],
): number {
  out.length = 0;
  const r = radius < 0 ? 0 : radius > MAX_QUERY_RADIUS ? MAX_QUERY_RADIUS : radius;
  const rSq = r * r; // <= 2^52 — exact
  const cols = grid.cols;
  const b0x = bucketClamped(cx - r, cols - 1);
  const b1x = bucketClamped(cx + r, cols - 1);
  const b0y = bucketClamped(cy - r, grid.rows - 1);
  const b1y = bucketClamped(cy + r, grid.rows - 1);
  const heads = grid.heads;
  const next = grid.next;
  for (let by = b0y; by <= b1y; by++) {
    const rowBase = by * cols;
    for (let bx = b0x; bx <= b1x; bx++) {
      for (let i = heads[rowBase + bx]!; i !== -1; i = next[i]!) {
        const u = units[i]!;
        const dx = u.x - cx; // exact integer in float64, |dx| < 2^32
        if (dx > r || dx < -r) continue; // overflow-free early reject
        const dy = u.y - cy;
        if (dy > r || dy < -r) continue;
        if (dx * dx + dy * dy <= rSq) out.push(i);
      }
    }
  }
  // Each bucket's list is ascending, but bucket-to-bucket order interleaves
  // indices arbitrarily. A numeric sort on distinct integers has exactly one
  // result regardless of sort algorithm — deterministic. Skip it when only a
  // single bucket was visited (already ascending).
  if (b0x !== b1x || b0y !== b1y) out.sort(ascending);
  return out.length;
}

/**
 * Find all unit indices inside the axis-aligned rectangle
 * [minX, maxX] x [minY, maxY] (raw Q16.16, boundary INCLUSIVE on all edges).
 * Same output contract as gridQueryCircle: `out` cleared, filled in ASCENDING
 * index order, count returned. The containment test is four int32 compares —
 * no products, so no overflow concern (LOG [003]).
 */
export function gridQueryRect(
  grid: SpatialGrid,
  units: readonly { x: Fx; y: Fx }[],
  minX: Fx,
  minY: Fx,
  maxX: Fx,
  maxY: Fx,
  out: number[],
): number {
  out.length = 0;
  if (minX > maxX || minY > maxY) return 0;
  const cols = grid.cols;
  const b0x = bucketClamped(minX, cols - 1);
  const b1x = bucketClamped(maxX, cols - 1);
  const b0y = bucketClamped(minY, grid.rows - 1);
  const b1y = bucketClamped(maxY, grid.rows - 1);
  const heads = grid.heads;
  const next = grid.next;
  for (let by = b0y; by <= b1y; by++) {
    const rowBase = by * cols;
    for (let bx = b0x; bx <= b1x; bx++) {
      for (let i = heads[rowBase + bx]!; i !== -1; i = next[i]!) {
        const u = units[i]!;
        if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
          out.push(i);
        }
      }
    }
  }
  if (b0x !== b1x || b0y !== b1y) out.sort(ascending);
  return out.length;
}
