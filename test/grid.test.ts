/**
 * Spatial hash grid tests (LOG [005] spatial model, LOG [003] determinism).
 * Randomized cases use a hand-rolled seeded LCG — Math.random is banned in
 * sim-adjacent code and would make failures unreproducible.
 */
import { describe, expect, it } from "vitest";
import { FX_ONE, fx } from "../src/math/fixed.js";
import {
  SpatialGrid,
  createSpatialGrid,
  gridQueryCircle,
  gridQueryRect,
  gridRebuild,
} from "../src/spatial/grid.js";

/** Deterministic 32-bit LCG (Numerical Recipes constants). */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

interface Pt {
  x: number;
  y: number;
}

/** n units at raw Q16.16 positions in [0, span*FX_ONE). */
function randomUnits(n: number, span: number, seed: number): Pt[] {
  const rand = makeLcg(seed);
  const units: Pt[] = [];
  const range = span * FX_ONE;
  for (let i = 0; i < n; i++) {
    units.push({ x: rand() % range, y: rand() % range });
  }
  return units;
}

/**
 * Brute-force reference for the circle query, using the same overflow-safe
 * exact-integer pattern as the grid (early reject, then float64 squares).
 */
function bruteCircle(units: readonly Pt[], cx: number, cy: number, r: number): number[] {
  const rSq = r * r;
  const hits: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const dx = u.x - cx;
    if (dx > r || dx < -r) continue;
    const dy = u.y - cy;
    if (dy > r || dy < -r) continue;
    if (dx * dx + dy * dy <= rSq) hits.push(i);
  }
  return hits;
}

function bruteRect(
  units: readonly Pt[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[] {
  const hits: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) hits.push(i);
  }
  return hits;
}

function isAscending(arr: readonly number[]): boolean {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! <= arr[i - 1]!) return false;
  }
  return true;
}

describe("spatial grid", () => {
  it("circle query matches brute force on ~200 seeded-random units", () => {
    const units = randomUnits(200, 256, 0xdeadbeef);
    const grid: SpatialGrid = createSpatialGrid(256, 256);
    gridRebuild(grid, units);
    const rand = makeLcg(0xc0ffee);
    const out: number[] = [];
    for (let q = 0; q < 50; q++) {
      const cx = rand() % (256 * FX_ONE);
      const cy = rand() % (256 * FX_ONE);
      const r = rand() % (32 * FX_ONE);
      const n = gridQueryCircle(grid, units, cx, cy, r, out);
      expect(n).toBe(out.length);
      expect(out).toEqual(bruteCircle(units, cx, cy, r));
      expect(isAscending(out)).toBe(true);
    }
  });

  it("returns indices in ascending order even across many buckets", () => {
    // Units laid down in an order that scatters indices across buckets.
    const units = randomUnits(300, 64, 42);
    const grid = createSpatialGrid(64, 64);
    gridRebuild(grid, units);
    const out: number[] = [];
    // Big radius spanning many buckets.
    gridQueryCircle(grid, units, fx(32), fx(32), fx(30), out);
    expect(out.length).toBeGreaterThan(10);
    expect(isAscending(out)).toBe(true);
  });

  it("includes a unit exactly at radius distance (<= boundary)", () => {
    // 3-4-5 triangle: unit is exactly 5 world units from the query center.
    const units: Pt[] = [{ x: fx(13), y: fx(14) }];
    const grid = createSpatialGrid(256, 256);
    gridRebuild(grid, units);
    const out: number[] = [];
    expect(gridQueryCircle(grid, units, fx(10), fx(10), fx(5), out)).toBe(1);
    expect(out).toEqual([0]);
    // One raw LSB (1/65536 world unit) short of 5: excluded.
    expect(gridQueryCircle(grid, units, fx(10), fx(10), fx(5) - 1, out)).toBe(0);
  });

  it("finds units in edge/corner buckets and clamped out-of-bounds units", () => {
    const units: Pt[] = [
      { x: 0, y: 0 }, // exact corner
      { x: fx(255), y: fx(255) }, // far-corner bucket
      { x: fx(-3), y: fx(-2) }, // OOB negative — clamped into bucket (0,0)
      { x: fx(300), y: fx(128) }, // OOB past right edge — clamped into edge column
    ];
    const grid = createSpatialGrid(256, 256);
    gridRebuild(grid, units);
    const out: number[] = [];

    // Query circle straddling the origin corner reaches both the corner unit
    // and the clamped negative unit.
    expect(gridQueryCircle(grid, units, fx(0), fx(0), fx(4), out)).toBe(2);
    expect(out).toEqual([0, 2]);

    // Far corner.
    expect(gridQueryCircle(grid, units, fx(255), fx(255), fx(1), out)).toBe(1);
    expect(out).toEqual([1]);

    // OOB unit past the right edge is still findable — even by a query whose
    // own center is out of bounds.
    expect(gridQueryCircle(grid, units, fx(299), fx(128), fx(2), out)).toBe(1);
    expect(out).toEqual([3]);

    // Rect straddling the negative corner picks up only the OOB-negative unit.
    expect(gridQueryRect(grid, units, fx(-5), fx(-5), -1, -1, out)).toBe(1);
    expect(out).toEqual([2]);
  });

  it("rect query matches brute force on seeded-random units", () => {
    const units = randomUnits(200, 256, 0x5eed);
    const grid = createSpatialGrid(256, 256);
    gridRebuild(grid, units);
    const rand = makeLcg(0xfeed);
    const out: number[] = [];
    for (let q = 0; q < 50; q++) {
      const x0 = rand() % (256 * FX_ONE);
      const y0 = rand() % (256 * FX_ONE);
      const w = rand() % (48 * FX_ONE);
      const h = rand() % (48 * FX_ONE);
      const n = gridQueryRect(grid, units, x0, y0, x0 + w, y0 + h, out);
      expect(n).toBe(out.length);
      expect(out).toEqual(bruteRect(units, x0, y0, x0 + w, y0 + h));
      expect(isAscending(out)).toBe(true);
    }
    // Inverted rect is empty, not an error.
    expect(gridQueryRect(grid, units, fx(10), fx(10), fx(5), fx(5), out)).toBe(0);
  });

  it("rebuild fully replaces previous contents (no stale entries)", () => {
    const grid = createSpatialGrid(128, 128);
    const setA = randomUnits(150, 40, 7); // clustered in [0, 40)
    gridRebuild(grid, setA);
    const out: number[] = [];
    expect(gridQueryCircle(grid, setA, fx(20), fx(20), fx(30), out)).toBeGreaterThan(0);

    // Second build: fewer units, in a disjoint region [80, 120).
    const setB = randomUnits(20, 40, 8).map((u) => ({
      x: u.x + fx(80),
      y: u.y + fx(80),
    }));
    gridRebuild(grid, setB);

    // Old region is now empty — no stale indices from setA survive.
    expect(gridQueryCircle(grid, setB, fx(20), fx(20), fx(35), out)).toBe(0);
    // New region matches brute force exactly.
    gridQueryCircle(grid, setB, fx(100), fx(100), fx(25), out);
    expect(out).toEqual(bruteCircle(setB, fx(100), fx(100), fx(25)));
    for (const i of out) expect(i).toBeLessThan(setB.length);
  });

  it("grows capacity when unit count exceeds initialCapacity", () => {
    const grid = createSpatialGrid(64, 64, 4);
    const units = randomUnits(100, 64, 99);
    gridRebuild(grid, units);
    expect(grid.next.length).toBeGreaterThanOrEqual(100);
    const out: number[] = [];
    gridQueryCircle(grid, units, fx(32), fx(32), fx(20), out);
    expect(out).toEqual(bruteCircle(units, fx(32), fx(32), fx(20)));
    // All 100 present in a grid-covering query.
    expect(gridQueryRect(grid, units, 0, 0, fx(64), fx(64), out)).toBe(100);
  });

  it("large separations do not overflow the distance check", () => {
    // dx = 200 world units = 13_107_200 raw; dx*dx ~ 1.7e14 would wreck any
    // int32 product. The overflow-safe path must neither throw nor
    // false-positive.
    const units: Pt[] = [
      { x: fx(10), y: fx(10) },
      { x: fx(210), y: fx(10) },
    ];
    const grid = createSpatialGrid(256, 256);
    gridRebuild(grid, units);
    const out: number[] = [];

    expect(gridQueryCircle(grid, units, fx(10), fx(10), fx(5), out)).toBe(1);
    expect(out).toEqual([0]);
    expect(gridQueryCircle(grid, units, fx(210), fx(10), fx(5), out)).toBe(1);
    expect(out).toEqual([1]);

    // Radius spanning the pair includes both, ascending.
    expect(gridQueryCircle(grid, units, fx(110), fx(10), fx(150), out)).toBe(2);
    expect(out).toEqual([0, 1]);

    // Radius beyond the 2^26 exactness clamp still behaves (clamped to 1024
    // world units, which covers any <= 256-unit map).
    expect(gridQueryCircle(grid, units, fx(110), fx(10), fx(2000), out)).toBe(2);
    expect(out).toEqual([0, 1]);
  });

  it("is deterministic across rebuilds of the same data", () => {
    const units = randomUnits(200, 256, 123);
    const gridA = createSpatialGrid(256, 256);
    const gridB = createSpatialGrid(256, 256, 8); // different growth path
    gridRebuild(gridA, units);
    gridRebuild(gridB, units);
    gridRebuild(gridB, units); // rebuild again — must be idempotent
    const outA: number[] = [];
    const outB: number[] = [];
    const rand = makeLcg(321);
    for (let q = 0; q < 20; q++) {
      const cx = rand() % (256 * FX_ONE);
      const cy = rand() % (256 * FX_ONE);
      const r = rand() % (64 * FX_ONE);
      gridQueryCircle(gridA, units, cx, cy, r, outA);
      gridQueryCircle(gridB, units, cx, cy, r, outB);
      expect(outA).toEqual(outB);
    }
  });
});
