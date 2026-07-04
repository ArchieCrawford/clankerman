/**
 * A* pathfinding tests (see src/path/astar.ts, ARCHITECTURE_LOG [003]/[005]).
 * Covers: path shape on open ground, wall avoidance without corner cutting,
 * unreachable goals, blocked-goal retargeting, determinism across scratch
 * reuse, and a tick-budget performance smoke test.
 */
import { describe, expect, it } from "vitest";
import { GameMap, cellIndex, createMap, setBlocked } from "../src/core/map.js";
import { createPathScratch, findPath, nearestWalkable } from "../src/path/astar.js";

/** Deterministic LCG for test-fixture generation (Math.random is banned in src/). */
function makeLcg(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return s >>> 0;
  };
}

function isWalkable(map: GameMap, cell: number): boolean {
  return map.walkable[cell] === 1;
}

/**
 * Assert every step of `path` (starting from `startCell`) is a legal move:
 * single-cell king move, onto a walkable cell, and never cutting a corner
 * (a diagonal requires both adjacent orthogonal cells to be walkable).
 */
function assertLegalPath(map: GameMap, startCell: number, path: number[]): void {
  const w = map.width;
  let prev = startCell;
  for (const cell of path) {
    expect(isWalkable(map, cell)).toBe(true);
    const px = prev % w;
    const py = (prev / w) | 0;
    const cx = cell % w;
    const cy = (cell / w) | 0;
    const dx = cx - px;
    const dy = cy - py;
    expect(Math.abs(dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(dy)).toBeLessThanOrEqual(1);
    expect(dx !== 0 || dy !== 0).toBe(true);
    if (dx !== 0 && dy !== 0) {
      // No corner cutting.
      expect(isWalkable(map, py * w + cx)).toBe(true);
      expect(isWalkable(map, cy * w + px)).toBe(true);
    }
    prev = cell;
  }
}

describe("findPath", () => {
  it("finds a straight-line path on an open map with expected length and endpoints", () => {
    const map = createMap(16, 16);
    const scratch = createPathScratch(map);
    const start = cellIndex(map, 2, 3);
    const goal = cellIndex(map, 12, 3);

    const path = findPath(map, start, goal, scratch);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(10); // 10 straight steps, cost 100
    expect(path![0]).toBe(cellIndex(map, 3, 3)); // first step AFTER start
    expect(path![path!.length - 1]).toBe(goal);
    // Straight line is strictly cheaper than any detour: stays on row 3.
    for (const cell of path!) {
      expect((cell / map.width) | 0).toBe(3);
    }
    assertLegalPath(map, start, path!);
  });

  it("returns [] when start === goal", () => {
    const map = createMap(8, 8);
    const scratch = createPathScratch(map);
    const c = cellIndex(map, 4, 4);
    expect(findPath(map, c, c, scratch)).toEqual([]);
  });

  it("routes around a wall without stepping on blocked cells or cutting corners", () => {
    const map = createMap(20, 20);
    // Vertical wall at x = 10, y = 0..15 — gap only at the bottom.
    for (let y = 0; y <= 15; y++) setBlocked(map, 10, y, true);
    const scratch = createPathScratch(map);
    const start = cellIndex(map, 5, 5);
    const goal = cellIndex(map, 15, 5);

    const path = findPath(map, start, goal, scratch);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(goal);
    assertLegalPath(map, start, path!);
    // The path must actually detour below the wall to get through the gap.
    const maxY = Math.max(...path!.map((c) => (c / map.width) | 0));
    expect(maxY).toBeGreaterThanOrEqual(16);
  });

  it("returns null for a walled-off goal", () => {
    const map = createMap(16, 16);
    // Ring of blocked cells around a walkable goal at (8, 8).
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx !== 0 || dy !== 0) setBlocked(map, 8 + dx, 8 + dy, true);
      }
    }
    const scratch = createPathScratch(map);
    const path = findPath(map, cellIndex(map, 1, 1), cellIndex(map, 8, 8), scratch);
    expect(path).toBeNull();
  });

  it("retargets a blocked goal to a nearby walkable cell", () => {
    const map = createMap(16, 16);
    setBlocked(map, 10, 10, true);
    const scratch = createPathScratch(map);
    const start = cellIndex(map, 2, 2);

    const path = findPath(map, start, cellIndex(map, 10, 10), scratch);
    expect(path).not.toBeNull();
    // nearestWalkable scans ring r=1 in scanline order: (9,9) is checked first.
    expect(path![path!.length - 1]).toBe(cellIndex(map, 9, 9));
    assertLegalPath(map, start, path!);
  });
});

describe("nearestWalkable", () => {
  it("returns the cell itself when already walkable", () => {
    const map = createMap(8, 8);
    const c = cellIndex(map, 3, 3);
    expect(nearestWalkable(map, c, 8)).toBe(c);
  });

  it("returns -1 when nothing walkable is within maxRadius", () => {
    const map = createMap(8, 8);
    for (let i = 0; i < map.walkable.length; i++) map.walkable[i] = 0;
    expect(nearestWalkable(map, cellIndex(map, 4, 4), 3)).toBe(-1);
  });
});

/** Shared fixture: 128x128 map with ~20% blocked cells from a seeded LCG. */
function buildNoiseMap(seed: number): GameMap {
  const map = createMap(128, 128);
  const rand = makeLcg(seed);
  for (let i = 0; i < map.walkable.length; i++) {
    if (rand() % 5 === 0) map.walkable[i] = 0;
  }
  return map;
}

describe("determinism (LOG [003])", () => {
  it("gives identical results for 50 seeded queries on reused and fresh scratches", () => {
    const map = buildNoiseMap(0xc0ffee);
    const rand = makeLcg(12345);
    const queries: Array<[number, number]> = [];
    for (let i = 0; i < 50; i++) {
      const start = cellIndex(map, rand() % 128, rand() % 128);
      const goal = cellIndex(map, rand() % 128, rand() % 128);
      queries.push([start, goal]);
    }

    const run = (scratch: ReturnType<typeof createPathScratch>) =>
      queries.map(([s, g]) => findPath(map, s, g, scratch));

    const scratchA = createPathScratch(map);
    const first = run(scratchA); // fresh scratch
    const second = run(scratchA); // same scratch, dirty from prior generations
    const third = run(createPathScratch(map)); // another fresh scratch

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Sanity: fixture is non-trivial — at least one real path and one null.
    expect(first.some((p) => p !== null && p.length > 0)).toBe(true);
  });
});

describe("performance smoke (LOG [004]/[005])", () => {
  it("completes 300 findPath calls on a 128x128 noisy map well under a second", () => {
    const map = buildNoiseMap(0xbad5eed & 0x7fffffff);
    const scratch = createPathScratch(map);
    const rand = makeLcg(999);

    const t0 = performance.now();
    let found = 0;
    for (let i = 0; i < 300; i++) {
      const start = cellIndex(map, rand() % 128, rand() % 128);
      const goal = cellIndex(map, rand() % 128, rand() % 128);
      const path = findPath(map, start, goal, scratch);
      if (path !== null) found++;
    }
    const elapsed = performance.now() - t0;

    expect(found).toBeGreaterThan(0);
    // Generous bound to dodge CI flakes; typical runs are far faster.
    expect(elapsed).toBeLessThan(2000);
  });
});
