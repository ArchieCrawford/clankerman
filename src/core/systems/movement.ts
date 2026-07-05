/**
 * Movement system: lazy path computation (single findPath call site for every
 * behavior that travels), waypoint following with cached per-waypoint velocity
 * (fxDiv only on waypoint change — LOG [003] perf rule), then grid-based
 * separation so units don't stack.
 */
import { Fx, FX_ONE, fx, fxClamp, fxDiv, fxMul } from "../../math/fixed.js";
import { dist, distSq } from "../../math/vec.js";
import { GameState, Unit, UnitBehavior } from "../state.js";
import { cellCenterX, cellCenterY, isWalkableCell, worldToCell, worldToCellX, worldToCellY } from "../map.js";
import { unitType } from "../../data/units.js";
import { PathScratch, findPath, nearestWalkable } from "../../path/astar.js";
import { SpatialGrid, gridQueryCircle, gridRebuild } from "../../spatial/grid.js";
import { prngRange } from "../../math/prng.js";

const ARRIVE_EPS_SQ = FX_ONE >> 4; // (0.25 wu)² = 0.0625 in distSq's Q16.16 domain

/** Backoff after a failed path attempt (VERIFY [009] finding 1): without it an
 * unreachable goal re-floods A* every tick — confirmed at 337 ms/tick with 100
 * units vs the 62.5 ms budget. */
const REPATH_BACKOFF_TICKS = 32;

function travels(u: Unit): boolean {
  return (
    u.behavior === UnitBehavior.Moving ||
    u.behavior === UnitBehavior.AttackMoving ||
    u.behavior === UnitBehavior.Attacking ||
    u.behavior === UnitBehavior.Harvesting
  );
}

export function runMovement(state: GameState, scratch: PathScratch): void {
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const t = unitType(u.typeId);
    if (t.isBuilding || t.speed === 0 || !travels(u)) continue;

    if (u.path === null) {
      if (distSq(u.x, u.y, u.goalX, u.goalY) <= ARRIVE_EPS_SQ) {
        arrive(u);
        continue;
      }
      if (u.repathWait > 0) {
        u.repathWait--;
        continue;
      }
      const start = worldToCell(state.map, u.x, u.y);
      const goal = worldToCell(state.map, u.goalX, u.goalY);
      const p = findPath(state.map, start, goal, scratch);
      if (p === null) {
        // Unreachable. Plain Move gives up; behaviors with a live intent
        // (Attacking/AttackMoving/Harvesting) keep the goal but back off so
        // they retry only every REPATH_BACKOFF_TICKS.
        u.repathWait = REPATH_BACKOFF_TICKS;
        if (u.behavior === UnitBehavior.Moving) arrive(u);
        continue;
      }
      u.path = p;
      u.pathIndex = 0;
      updateVelocity(state, u, t.speed);
    }

    stepAlongPath(state, u, t.speed);
  }
}

function waypointX(state: GameState, u: Unit): Fx {
  const path = u.path!;
  // The final waypoint is the exact goal, not the cell center, so formations
  // don't quantize to the grid.
  if (u.pathIndex >= path.length - 1) return u.goalX;
  return cellCenterX(state.map, path[u.pathIndex]!);
}

function waypointY(state: GameState, u: Unit): Fx {
  const path = u.path!;
  if (u.pathIndex >= path.length - 1) return u.goalY;
  return cellCenterY(state.map, path[u.pathIndex]!);
}

function updateVelocity(state: GameState, u: Unit, speed: Fx): void {
  const path = u.path;
  if (path === null || path.length === 0) {
    u.velX = 0;
    u.velY = 0;
    return;
  }
  const wx = waypointX(state, u);
  const wy = waypointY(state, u);
  const dx = (wx - u.x) | 0;
  const dy = (wy - u.y) | 0;
  const len = dist(0, 0, dx, dy);
  if (len === 0) {
    u.velX = 0;
    u.velY = 0;
    return;
  }
  u.velX = fxMul(fxDiv(dx, len), speed);
  u.velY = fxMul(fxDiv(dy, len), speed);
}

function stepAlongPath(state: GameState, u: Unit, speed: Fx): void {
  const path = u.path;
  if (path === null) return;
  if (path.length === 0) {
    arrive(u);
    return;
  }
  let budget = speed;
  // A unit can cross more than one waypoint per tick if waypoints are close.
  for (let hops = 0; hops < 4 && budget > 0; hops++) {
    const wx = waypointX(state, u);
    const wy = waypointY(state, u);
    const remaining = dist(u.x, u.y, wx, wy);
    if (remaining <= budget) {
      u.x = wx;
      u.y = wy;
      budget = (budget - remaining) | 0;
      u.pathIndex++;
      if (u.pathIndex >= path.length) {
        arrive(u);
        return;
      }
      updateVelocity(state, u, speed);
    } else {
      // Velocity is cached for the full speed; scale if budget was partially spent.
      if (budget === speed) {
        u.x = (u.x + u.velX) | 0;
        u.y = (u.y + u.velY) | 0;
      } else {
        u.x = (u.x + fxMul(u.velX, fxDiv(budget, speed))) | 0;
        u.y = (u.y + fxMul(u.velY, fxDiv(budget, speed))) | 0;
      }
      return;
    }
  }
}

function arrive(u: Unit): void {
  u.path = null;
  u.pathIndex = 0;
  u.velX = 0;
  u.velY = 0;
  if (u.behavior === UnitBehavior.Moving) u.behavior = UnitBehavior.Idle;
  // AttackMoving/Attacking/Harvesting arrival is handled by their systems.
}

/**
 * Separation: push overlapping mobile units apart (half the overlap each).
 * Deterministic: pairs visited in ascending (i, j) index order, j > i.
 * Buildings never move; a mobile unit overlapping a building is pushed alone.
 */
export function runSeparation(state: GameState, grid: SpatialGrid, queryBuf: number[]): void {
  gridRebuild(grid, state.units);
  const units = state.units;
  for (let i = 0; i < units.length; i++) {
    const a = units[i]!;
    if (a.hp <= 0) continue;
    const ta = unitType(a.typeId);
    if (ta.isBuilding) continue;
    const n = gridQueryCircle(grid, units, a.x, a.y, (ta.radius + fx(2)) | 0, queryBuf);
    for (let k = 0; k < n; k++) {
      const j = queryBuf[k]!;
      if (j === i) continue;
      const b = units[j]!;
      if (b.hp <= 0) continue;
      const tb = unitType(b.typeId);
      // Mobile pairs are deduped by index; buildings never appear as `a`
      // (skipped above), so a mobile unit must handle a lower-indexed building
      // itself or the pair is never resolved (VERIFY [009] finding 3).
      if (j < i && !tb.isBuilding) continue;
      const minDist = (ta.radius + tb.radius) | 0;
      const dSq = distSq(a.x, a.y, b.x, b.y);
      const minDistSq = fxMul(minDist, minDist);
      if (dSq >= minDistSq) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      let pushX: Fx;
      let pushY: Fx;
      if (d === 0) {
        // Perfectly stacked: nudge in a PRNG-chosen direction. The PRNG lives
        // in GameState, so this is deterministic — and it makes the match seed
        // a real gameplay input (VERIFY [009] finding 6).
        const dir = prngRange(state.prng, 4);
        const mag = FX_ONE >> 4;
        pushX = dir & 1 ? mag : -mag | 0;
        pushY = dir & 2 ? mag : -mag | 0;
      } else {
        const overlap = (minDist - d) | 0;
        const half = overlap >> 1;
        pushX = fxMul(fxDiv((b.x - a.x) | 0, d), half);
        pushY = fxMul(fxDiv((b.y - a.y) | 0, d), half);
      }
      if (tb.isBuilding) {
        nudgeTo(state, a, (a.x - (pushX << 1)) | 0, (a.y - (pushY << 1)) | 0);
      } else {
        nudgeTo(state, a, (a.x - pushX) | 0, (a.y - pushY) | 0);
        nudgeTo(state, b, (b.x + pushX) | 0, (b.y + pushY) | 0);
      }
    }
  }
}

/** Apply a separation push only if the destination cell is walkable. */
function nudgeTo(state: GameState, u: Unit, nx: Fx, ny: Fx): void {
  const maxX = (fx(state.map.width) - 1) | 0;
  const maxY = (fx(state.map.height) - 1) | 0;
  nx = fxClamp(nx, 0, maxX);
  ny = fxClamp(ny, 0, maxY);
  if (isWalkableCell(state.map, worldToCellX(nx), worldToCellY(ny))) {
    u.x = nx;
    u.y = ny;
  }
}

/** Re-anchor a unit onto a walkable cell (used after building placement). */
export function unstick(state: GameState, u: Unit): void {
  const cell = worldToCell(state.map, u.x, u.y);
  if (isWalkableCell(state.map, worldToCellX(u.x), worldToCellY(u.y))) return;
  const free = nearestWalkable(state.map, cell, 8);
  if (free !== -1) {
    u.x = cellCenterX(state.map, free);
    u.y = cellCenterY(state.map, free);
    u.path = null;
  }
}
