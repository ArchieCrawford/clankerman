/**
 * Grid A* pathfinding (LOG [005]) under the determinism contract (LOG [003]).
 *
 * - 8-directional movement over `GameMap.walkable`, pure integer costs:
 *   10 per straight step, 14 per diagonal (integer approximation of 10*sqrt(2),
 *   deliberately rounded DOWN so the octile heuristic stays admissible).
 * - Octile heuristic in the same scale: h = 10*max(dx,dy) + 4*min(dx,dy)
 *   (equivalently 14*min + 10*(max-min)). No floats, no float sqrt — every
 *   quantity in this module is a small int32, so results are bit-identical
 *   on every peer (LOG [003]).
 * - No corner cutting: a diagonal step is legal only if BOTH adjacent
 *   orthogonal cells are walkable.
 * - Open list is a binary min-heap with decrease-key (each cell appears at
 *   most once). Deterministic total order: smaller f wins; ties broken by
 *   LARGER g (deeper node — fewer re-expansions near the goal); remaining
 *   ties by a per-query monotonically incrementing push counter (larger =
 *   most recently pushed wins). Iteration order over neighbors is a fixed
 *   constant table, so expansion order — and therefore the returned path —
 *   is byte-identical across platforms and runs.
 * - Zero per-call allocation of big structures: `createPathScratch`
 *   preallocates every typed array sized to width*height, and a generation
 *   stamp (`stamp[cell] === scratch.gen`) marks which entries are valid for
 *   the current query, so nothing is ever cleared between calls. Only the
 *   returned `number[]` path is allocated per call (paths are stored on
 *   units, LOG [005]).
 */
import { GameMap } from "../core/map.js";

/** Cost of one orthogonal step. All path costs are in this integer scale. */
export const COST_STRAIGHT = 10;
/** Cost of one diagonal step (< 10*sqrt(2), keeps the heuristic admissible). */
export const COST_DIAGONAL = 14;

/** Default cap on node expansions per query (worst-case tick cost, LOG [004]/[005]). */
export const DEFAULT_MAX_EXPANSIONS = 20000;

/**
 * Neighbor tables: fixed iteration order (N, S, W, E, NW, NE, SW, SE).
 * First 4 entries are orthogonal, last 4 diagonal — `d >= 4` is the
 * corner-cut check gate.
 */
const NEIGHBOR_DX = [0, 0, -1, 1, -1, 1, -1, 1] as const;
const NEIGHBOR_DY = [-1, 1, 0, 0, -1, -1, 1, 1] as const;
const NEIGHBOR_COST = [10, 10, 10, 10, 14, 14, 14, 14] as const;

/**
 * Preallocated per-map pathfinding workspace. One scratch serves any number
 * of sequential queries on maps of the same (or smaller) size; it holds no
 * sim state, so it is NOT part of the hashed game state (LOG [003]) and may
 * be shared by all units on a peer.
 */
export interface PathScratch {
  /** Capacity in cells (width*height at creation time). */
  readonly capacity: number;
  /** Best known cost from start; valid only when stamp[cell] === gen. */
  readonly gScore: Int32Array;
  /** g + octile h; valid only when stamp[cell] === gen. */
  readonly fScore: Int32Array;
  /** Predecessor cell on the best known path; -1 for the start cell. */
  readonly parent: Int32Array;
  /** Generation stamp: stamp[cell] === gen ⇔ cell was touched this query. */
  readonly stamp: Int32Array;
  /** Heap slot of an open cell; -1 = closed. Valid only when stamped. */
  readonly heapPos: Int32Array;
  /** Per-cell push counter for deterministic tie-breaking. */
  readonly seq: Int32Array;
  /** Binary min-heap of open cell indices (decrease-key ⇒ ≤ 1 entry/cell). */
  readonly heap: Int32Array;
  /** Live entries in `heap`. */
  heapLen: number;
  /** Current generation; incremented at the start of every findPath call. */
  gen: number;
  /** Monotonic push counter, reset per query for scratch-history independence. */
  pushCounter: number;
}

/**
 * Preallocate a scratch for `map`. Never clears between queries: each
 * findPath bumps `gen`, and any slot whose stamp doesn't match is treated
 * as untouched — the classic generation-stamp trick.
 */
export function createPathScratch(map: GameMap): PathScratch {
  const n = map.width * map.height;
  return {
    capacity: n,
    gScore: new Int32Array(n),
    fScore: new Int32Array(n),
    parent: new Int32Array(n),
    stamp: new Int32Array(n), // zero-filled; gen starts at 0 and pre-increments to 1
    heapPos: new Int32Array(n),
    seq: new Int32Array(n),
    heap: new Int32Array(n),
    heapLen: 0,
    gen: 0,
    pushCounter: 0,
  };
}

/**
 * Deterministic strict-weak order for open cells `a`, `b` (both stamped this
 * generation): f ascending, then g DESCENDING, then push counter descending.
 */
function heapLess(s: PathScratch, a: number, b: number): boolean {
  const fa = s.fScore[a]!;
  const fb = s.fScore[b]!;
  if (fa !== fb) return fa < fb;
  const ga = s.gScore[a]!;
  const gb = s.gScore[b]!;
  if (ga !== gb) return ga > gb;
  return s.seq[a]! > s.seq[b]!;
}

function siftUp(s: PathScratch, i: number): void {
  const heap = s.heap;
  const pos = s.heapPos;
  const cell = heap[i]!;
  while (i > 0) {
    const p = (i - 1) >> 1;
    const pc = heap[p]!;
    if (!heapLess(s, cell, pc)) break;
    heap[i] = pc;
    pos[pc] = i;
    i = p;
  }
  heap[i] = cell;
  pos[cell] = i;
}

function siftDown(s: PathScratch, i: number): void {
  const heap = s.heap;
  const pos = s.heapPos;
  const len = s.heapLen;
  const cell = heap[i]!;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= len) break;
    const r = c + 1;
    if (r < len && heapLess(s, heap[r]!, heap[c]!)) c = r;
    const cc = heap[c]!;
    if (!heapLess(s, cc, cell)) break;
    heap[i] = cc;
    pos[cc] = i;
    i = c;
  }
  heap[i] = cell;
  pos[cell] = i;
}

function heapPush(s: PathScratch, cell: number): void {
  const i = s.heapLen++;
  s.heap[i] = cell;
  s.heapPos[cell] = i;
  siftUp(s, i);
}

function heapPop(s: PathScratch): number {
  const heap = s.heap;
  const top = heap[0]!;
  const lastIdx = --s.heapLen;
  if (lastIdx > 0) {
    const moved = heap[lastIdx]!;
    heap[0] = moved;
    s.heapPos[moved] = 0;
    siftDown(s, 0);
  }
  return top;
}

/** Octile heuristic in the 10/14 integer scale: 10*max + 4*min. Admissible. */
function octile(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return ax > ay ? ax * 10 + ay * 4 : ay * 10 + ax * 4;
}

/** Rebuild the path start→cell (exclusive of start) by walking parents. */
function reconstruct(s: PathScratch, startCell: number, cell: number): number[] {
  const path: number[] = [];
  let c = cell;
  while (c !== startCell) {
    path.push(c);
    c = s.parent[c]!;
  }
  path.reverse();
  return path;
}

/**
 * If `cell` is walkable return it; otherwise spiral outward in deterministic
 * order — increasing Chebyshev radius, and scanline order (y then x,
 * ascending) within each ring — up to `maxRadius` rings. Returns -1 if no
 * walkable cell exists in range. Pure integer math; order is fixed, so the
 * result is identical on every peer (LOG [003]).
 */
export function nearestWalkable(map: GameMap, cell: number, maxRadius: number): number {
  const w = map.width;
  const h = map.height;
  if (cell < 0 || cell >= w * h) return -1;
  const walk = map.walkable;
  if (walk[cell] === 1) return cell;
  const cx = cell % w;
  const cy = (cell / w) | 0;
  for (let r = 1; r <= maxRadius; r++) {
    const y0 = cy - r;
    const y1 = cy + r;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= h) continue;
      const row = y * w;
      if (y === y0 || y === y1) {
        // Top/bottom edge of the ring: full horizontal run.
        for (let x = cx - r; x <= cx + r; x++) {
          if (x >= 0 && x < w && walk[row + x] === 1) return row + x;
        }
      } else {
        // Interior rows: only the two vertical edges (left first — scanline).
        const xl = cx - r;
        if (xl >= 0 && walk[row + xl] === 1) return row + xl;
        const xr = cx + r;
        if (xr < w && walk[row + xr] === 1) return row + xr;
      }
    }
  }
  return -1;
}

/**
 * A* from `startCell` to `goalCell` over `map`, using (and mutating) the
 * preallocated `scratch`.
 *
 * Returns:
 * - `number[]` of cell indices from the FIRST STEP AFTER start, through and
 *   including the goal cell (all costs in the 10/14 integer scale);
 * - `[]` if start === goal (after any retarget);
 * - `null` if the goal is unreachable.
 *
 * If `goalCell` is blocked, the query retargets to
 * `nearestWalkable(goalCell, 8)` and paths there (null if that fails too).
 *
 * `maxExpansions` (default 20000) caps node expansions per query so a worst
 * case query cannot blow the 62.5 ms tick budget (LOG [004]); on abort the
 * function returns a best-effort partial path to the expanded node with the
 * lowest heuristic seen so far, or null if no progress was made. The cap is
 * part of the sim inputs — every peer must pass the same value (LOG [003]).
 */
export function findPath(
  map: GameMap,
  startCell: number,
  goalCell: number,
  scratch: PathScratch,
  maxExpansions: number = DEFAULT_MAX_EXPANSIONS
): number[] | null {
  const w = map.width;
  const h = map.height;
  const n = w * h;
  if (n > scratch.capacity) throw new Error("PathScratch smaller than map");
  if (startCell < 0 || startCell >= n || goalCell < 0 || goalCell >= n) return null;

  const walk = map.walkable;
  let goal = goalCell;
  if (walk[goal] !== 1) {
    goal = nearestWalkable(map, goal, 8);
    if (goal === -1) return null;
  }
  if (startCell === goal) return [];

  // New generation — invalidates every stamped slot without clearing.
  // Wrap defensively long before int32 overflow could alias old stamps.
  if (scratch.gen >= 0x7ffffffe) {
    scratch.stamp.fill(0);
    scratch.gen = 0;
  }
  const gen = ++scratch.gen;
  scratch.heapLen = 0;
  scratch.pushCounter = 0;

  const gScore = scratch.gScore;
  const fScore = scratch.fScore;
  const parent = scratch.parent;
  const stamp = scratch.stamp;
  const heapPos = scratch.heapPos;
  const seq = scratch.seq;

  const gx = goal % w;
  const gy = (goal / w) | 0;
  const startX = startCell % w;
  const startY = (startCell / w) | 0;

  stamp[startCell] = gen;
  gScore[startCell] = 0;
  fScore[startCell] = octile(startX - gx, startY - gy);
  parent[startCell] = -1;
  seq[startCell] = scratch.pushCounter++;
  heapPush(scratch, startCell);

  // Best-effort fallback for aborted queries: expanded node with lowest h.
  let bestCell = startCell;
  let bestH = fScore[startCell]!;

  let expansions = 0;
  let aborted = false;

  while (scratch.heapLen > 0) {
    const cur = heapPop(scratch);
    heapPos[cur] = -1; // closed

    if (cur === goal) return reconstruct(scratch, startCell, cur);

    const curH = fScore[cur]! - gScore[cur]!;
    if (curH < bestH) {
      bestH = curH;
      bestCell = cur;
    }

    if (expansions >= maxExpansions) {
      aborted = true;
      break;
    }
    expansions++;

    const cx = cur % w;
    const cy = (cur / w) | 0;
    const curG = gScore[cur]!;

    for (let d = 0; d < 8; d++) {
      const nx = cx + NEIGHBOR_DX[d]!;
      const ny = cy + NEIGHBOR_DY[d]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nc = ny * w + nx;
      if (walk[nc] !== 1) continue;
      // No corner cutting: both orthogonal cells beside a diagonal must be open.
      if (d >= 4 && (walk[cy * w + nx] !== 1 || walk[ny * w + cx] !== 1)) continue;

      const ng = curG + NEIGHBOR_COST[d]!;
      if (stamp[nc] !== gen) {
        // First touch this query.
        stamp[nc] = gen;
        gScore[nc] = ng;
        fScore[nc] = ng + octile(nx - gx, ny - gy);
        parent[nc] = cur;
        seq[nc] = scratch.pushCounter++;
        heapPush(scratch, nc);
      } else if (heapPos[nc] !== -1 && ng < gScore[nc]!) {
        // Still open with a worse g: decrease-key.
        fScore[nc] = fScore[nc]! - gScore[nc]! + ng; // keep h, swap g
        gScore[nc] = ng;
        parent[nc] = cur;
        seq[nc] = scratch.pushCounter++;
        siftUp(scratch, heapPos[nc]!);
      }
      // Closed cells are final: the octile heuristic is consistent for the
      // 10/14 cost model, so a settled g can never improve.
    }
  }

  if (aborted && bestCell !== startCell) {
    return reconstruct(scratch, startCell, bestCell);
  }
  return null; // open set exhausted: goal unreachable (or abort made no progress)
}
