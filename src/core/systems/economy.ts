/**
 * Economy system: worker harvest cycle — travel to node, gather, haul to the
 * nearest depot, deposit, repeat. Movement itself is delegated to the movement
 * system: this system only sets goals (LOG [004] single-pathfinder rule).
 */
import { fx } from "../../math/fixed.js";
import { distSq } from "../../math/vec.js";
import { isDepot } from "../api.js";
import { GameState, ResourceKind, Unit, UnitBehavior, getNode } from "../state.js";
import { unitType } from "../../data/units.js";

export const CARRY_MAX = 8;
export const GATHER_TICKS = 24; // 1.5 s per load of 8
const HARVEST_RANGE_SQ = fx(2); // (~1.4 world units)² in Q16.16 via fxMul domain

export function runEconomy(state: GameState): void {
  for (const u of state.units) {
    if (u.hp <= 0 || u.behavior !== UnitBehavior.Harvesting) continue;
    const t = unitType(u.typeId);
    if (!t.isWorker) {
      u.behavior = UnitBehavior.Idle;
      continue;
    }

    if (u.carryAmount > 0 && u.carryAmount >= CARRY_MAX) {
      deliver(state, u);
      continue;
    }

    const node = getNode(state, u.harvestNodeId);
    if (!node || node.amount <= 0) {
      // Node exhausted: deliver a partial load, else go idle.
      if (u.carryAmount > 0) {
        deliver(state, u);
      } else {
        u.behavior = UnitBehavior.Idle;
        u.harvestNodeId = -1;
        u.path = null;
      }
      continue;
    }

    if (distSq(u.x, u.y, node.x, node.y) <= HARVEST_RANGE_SQ) {
      // At the node: stand and gather.
      haltAt(u);
      u.cooldown = u.cooldown > 0 ? u.cooldown - 1 : GATHER_TICKS;
      if (u.cooldown === 1) {
        const take = node.amount < CARRY_MAX ? node.amount : CARRY_MAX;
        node.amount -= take;
        u.carryAmount = take;
        u.carryKind = node.kind;
        u.cooldown = 0;
      }
    } else {
      setGoal(u, node.x, node.y);
    }
  }
}

function deliver(state: GameState, u: Unit): void {
  const depot = nearestDepot(state, u);
  if (!depot) {
    u.behavior = UnitBehavior.Idle;
    u.path = null;
    return;
  }
  const dt = unitType(depot.typeId);
  // Deposit range: within 1 world unit of the footprint edge.
  const reach = (dt.radius + fx(1)) | 0;
  const reachSq = Math.floor((reach * reach) / 65536) | 0;
  if (distSq(u.x, u.y, depot.x, depot.y) <= reachSq) {
    const p = state.players[u.playerId]!;
    if (u.carryKind === ResourceKind.Scrap) p.scrap += u.carryAmount;
    else p.aether += u.carryAmount;
    u.carryAmount = 0;
    // Back to work (the node may have died meanwhile; next tick handles it).
    u.path = null;
  } else {
    setGoal(u, depot.x, depot.y);
  }
}

function nearestDepot(state: GameState, u: Unit): Unit | null {
  let best: Unit | null = null;
  let bestD = 0x7fffffff;
  for (const c of state.units) {
    if (c.playerId !== u.playerId || c.hp <= 0 || !isDepot(c)) continue;
    const d = distSq(u.x, u.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function setGoal(u: Unit, x: number, y: number): void {
  if (u.goalX !== x || u.goalY !== y || u.path === null) {
    // Movement system computes the path when it sees path === null.
    if (u.goalX !== x || u.goalY !== y) u.path = null;
    u.goalX = x;
    u.goalY = y;
  }
}

function haltAt(u: Unit): void {
  u.path = null;
  u.velX = 0;
  u.velY = 0;
}
