/**
 * Death & defeat resolution: runs last in the tick (LOG [004]). Order-preserving
 * compaction keeps the units array sorted by id (getUnit binary search relies
 * on it) and keeps iteration order deterministic.
 */
import { blockFootprint } from "../api.js";
import { GameState } from "../state.js";
import { unitType } from "../../data/units.js";

export function runDeaths(state: GameState): void {
  let anyDead = false;
  for (const u of state.units) {
    if (u.hp > 0) continue;
    anyDead = true;
    const t = unitType(u.typeId);
    const p = state.players[u.playerId]!;
    if (t.powerCost > 0) {
      p.powerUsed -= t.powerCost;
    } else if (t.powerCost < 0 && u.constructTicks === 0) {
      p.powerCap -= -t.powerCost;
    }
    if (t.isBuilding) {
      blockFootprint(state, u, false);
      // Power for queued units was committed at enqueue — refund it. Spent
      // Scrap/Aether stays sunk (LOG [007]).
      for (const queuedTypeId of u.trainQueue) {
        const qt = unitType(queuedTypeId);
        if (qt.powerCost > 0) p.powerUsed -= qt.powerCost;
      }
    }
  }
  if (anyDead) {
    state.units = state.units.filter((u) => u.hp > 0);
  }

  // Defeat: a player with no remaining units is out.
  for (const p of state.players) {
    if (!p.defeated) {
      let alive = false;
      for (const u of state.units) {
        if (u.playerId === p.id) {
          alive = true;
          break;
        }
      }
      if (!alive) p.defeated = true;
    }
  }

  // Expired resource nodes disappear.
  let anyEmpty = false;
  for (const n of state.nodes) if (n.amount <= 0) anyEmpty = true;
  if (anyEmpty) state.nodes = state.nodes.filter((n) => n.amount > 0);
}

/** Game over when at most one player remains. */
export function isGameOver(state: GameState): boolean {
  let standing = 0;
  for (const p of state.players) if (!p.defeated) standing++;
  return standing <= 1;
}
