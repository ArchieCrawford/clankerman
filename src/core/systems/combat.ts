/**
 * Combat system: auto-acquisition via the spatial grid, chase, and damage.
 * Runs after movement so range checks see this tick's positions (LOG [004]).
 *
 * Determinism notes:
 * - target acquisition scans grid results in ascending unit index; nearest wins,
 *   ties broken by lower index — identical on every peer.
 * - acquisition is staggered by (tick + id) % 4 to cap per-tick query cost;
 *   id-based staggering is part of the deterministic state, not wall-clock.
 */
import { fxMul } from "../../math/fixed.js";
import { distSq } from "../../math/vec.js";
import { GameState, Unit, UnitBehavior, getUnit } from "../state.js";
import { unitType } from "../../data/units.js";
import { SpatialGrid, gridQueryCircle } from "../../spatial/grid.js";

const CHASE_REPATH_INTERVAL = 8;

export function runCombat(state: GameState, grid: SpatialGrid, queryBuf: number[]): void {
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    // Harvest workers reuse `cooldown` as a gather timer; leave it to economy.
    if (u.cooldown > 0 && u.behavior !== UnitBehavior.Harvesting) u.cooldown--;
  }

  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i]!;
    if (u.hp <= 0) continue;
    const t = unitType(u.typeId);
    if (t.damage === 0 || u.constructTicks > 0) continue;

    // Validate current target.
    let target: Unit | undefined;
    if (u.targetId !== -1) {
      target = getUnit(state, u.targetId);
      if (!target || target.hp <= 0 || target.playerId === u.playerId) {
        target = undefined;
        u.targetId = -1;
        if (u.behavior === UnitBehavior.Attacking) {
          u.behavior = UnitBehavior.Idle;
          u.path = null;
        } else if (u.behavior === UnitBehavior.AttackMoving) {
          u.path = null; // resume marching to goal
        }
      }
    }

    // Auto-acquire for idle fighters and attack-movers (not harvesting workers).
    if (
      target === undefined &&
      (u.behavior === UnitBehavior.Idle || u.behavior === UnitBehavior.AttackMoving) &&
      (state.tick + u.id) % 4 === 0
    ) {
      target = acquireTarget(state, grid, queryBuf, i, u, t.sightRange);
      if (target) {
        u.targetId = target.id;
        if (u.behavior === UnitBehavior.Idle) {
          u.behavior = UnitBehavior.Attacking;
          u.goalX = u.x; // no leash implemented; goal preserved for AttackMoving only
          u.goalY = u.y;
        }
      }
    }

    if (target === undefined) continue;

    const tt = unitType(target.typeId);
    const reach = (t.attackRange + t.radius + tt.radius) | 0;
    const reachSq = fxMul(reach, reach);
    if (distSq(u.x, u.y, target.x, target.y) <= reachSq) {
      // In range: halt and swing.
      u.path = null;
      u.velX = 0;
      u.velY = 0;
      if (u.cooldown === 0 && !t.isBuilding) {
        const dmg = t.damage - tt.armor;
        target.hp -= dmg < 1 ? 1 : dmg;
        u.cooldown = t.attackCooldownTicks;
      }
    } else if (!t.isBuilding && t.speed > 0) {
      // Chase: repath toward the target's current position on a staggered cadence.
      const due = u.path === null || (state.tick + u.id) % CHASE_REPATH_INTERVAL === 0;
      if (due && (u.goalX !== target.x || u.goalY !== target.y)) {
        u.goalX = target.x;
        u.goalY = target.y;
        u.path = null; // movement system repaths next tick
      }
    }
  }
}

function acquireTarget(
  state: GameState,
  grid: SpatialGrid,
  queryBuf: number[],
  selfIndex: number,
  u: Unit,
  sight: number,
): Unit | undefined {
  const n = gridQueryCircle(grid, state.units, u.x, u.y, sight, queryBuf);
  let best: Unit | undefined;
  let bestD = 0x7fffffff;
  for (let k = 0; k < n; k++) {
    const idx = queryBuf[k]!;
    if (idx === selfIndex) continue;
    const c = state.units[idx]!;
    if (c.hp <= 0 || c.playerId === u.playerId) continue;
    const d = distSq(u.x, u.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Kept for data-tuning sanity checks in tests. */
export function effectiveDamage(attackerTypeId: number, defenderTypeId: number): number {
  const a = unitType(attackerTypeId);
  const d = unitType(defenderTypeId);
  const dmg = a.damage - d.armor;
  return dmg < 1 ? 1 : dmg;
}
