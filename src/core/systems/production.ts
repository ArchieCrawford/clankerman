/**
 * Production system: building construction ramp-up and unit training.
 * Runs second in the tick pipeline (LOG [004]).
 */
import { spawnUnit } from "../api.js";
import { cellCenterX, cellCenterY, worldToCell } from "../map.js";
import { GameState, UnitBehavior } from "../state.js";
import { unitType } from "../../data/units.js";
import { nearestWalkable } from "../../path/astar.js";

export function runProduction(state: GameState): void {
  // Iterate by index over the current length: units spawned this tick are
  // appended past `len` and first act next tick — keeps peers identical even
  // if an engine ever batches differently.
  const len = state.units.length;
  for (let i = 0; i < len; i++) {
    const u = state.units[i]!;
    if (u.hp <= 0) continue;
    const t = unitType(u.typeId);
    if (!t.isBuilding) continue;

    // Construction: hp ramps from 1 to maxHp over buildTimeTicks.
    if (u.constructTicks > 0) {
      u.constructTicks--;
      const hpPerTick = ((t.maxHp + t.buildTimeTicks - 1) / t.buildTimeTicks) | 0;
      u.hp = u.hp + hpPerTick > t.maxHp ? t.maxHp : u.hp + hpPerTick;
      if (u.constructTicks === 0) {
        u.hp = t.maxHp;
        if (t.powerCost < 0) {
          state.players[u.playerId]!.powerCap += -t.powerCost;
        }
      }
      continue; // can't train while under construction
    }

    // Training.
    const head = u.trainQueue[0];
    if (head === undefined) {
      if (u.behavior === UnitBehavior.Training) u.behavior = UnitBehavior.Idle;
      continue;
    }
    u.behavior = UnitBehavior.Training;
    const ht = unitType(head);
    u.trainProgress++;
    if (u.trainProgress >= ht.buildTimeTicks) {
      // Spawn next to the building on the nearest walkable cell.
      const cell = nearestWalkable(state.map, worldToCell(state.map, u.x, u.y), 8);
      if (cell === -1) {
        // Fully walled in: hold the finished unit until space opens up.
        u.trainProgress = ht.buildTimeTicks;
        continue;
      }
      u.trainQueue.shift();
      u.trainProgress = 0;
      // Power was committed at enqueue (LOG [007]) — don't charge again.
      spawnUnit(state, u.playerId, head, cellCenterX(state.map, cell), cellCenterY(state.map, cell), false, true);
    }
  }
}
