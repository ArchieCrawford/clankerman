/**
 * Public mutation API: everything a match harness (or later a UI/network layer)
 * uses to set up and drive a game. Commands go through the latency queue
 * (LOG [004]); spawn helpers are for match setup and internal systems only.
 */
import { Fx, fxFloor } from "../math/fixed.js";
import { setBlocked } from "./map.js";
import { Command, ScheduledCommand } from "./commands.js";
import {
  COMMAND_LATENCY_TICKS, GameState, ResourceKind, ResourceNode, Unit, UnitBehavior,
} from "./state.js";
import { unitType, unitTypeByKey } from "../data/units.js";

/** Queue a command for execution at tick + COMMAND_LATENCY_TICKS. */
export function issueCommand(state: GameState, playerId: number, cmd: Command): void {
  const seq = state.cmdSeq[playerId];
  if (seq === undefined) throw new Error(`unknown player ${playerId}`);
  state.cmdSeq[playerId] = seq + 1;
  const sc: ScheduledCommand = {
    execTick: state.tick + COMMAND_LATENCY_TICKS,
    playerId,
    seq,
    cmd,
  };
  state.pending.push(sc);
}

/**
 * Spawn a unit at (x, y). Charges Power for mobile units and registers Power
 * capacity for completed buildings. `underConstruction` starts a building at
 * 1 hp with a construction countdown (production system ramps it up).
 * `powerPrepaid`: the training pipeline charges Power at enqueue (LOG [007]),
 * so the production system passes true to avoid double-charging.
 */
export function spawnUnit(
  state: GameState,
  playerId: number,
  typeId: number,
  x: Fx,
  y: Fx,
  underConstruction = false,
  powerPrepaid = false,
): Unit {
  const t = unitType(typeId);
  const player = state.players[playerId];
  if (!player) throw new Error(`unknown player ${playerId}`);
  const u: Unit = {
    id: state.nextUnitId++,
    typeId,
    playerId,
    x,
    y,
    hp: underConstruction ? 1 : t.maxHp,
    behavior: UnitBehavior.Idle,
    goalX: x,
    goalY: y,
    path: null,
    pathIndex: 0,
    velX: 0,
    velY: 0,
    targetId: -1,
    cooldown: 0,
    harvestNodeId: -1,
    carryKind: ResourceKind.Scrap,
    carryAmount: 0,
    trainQueue: [],
    trainProgress: 0,
    constructTicks: underConstruction ? t.buildTimeTicks : 0,
  };
  state.units.push(u); // ids are monotonic → array stays sorted (getUnit relies on it)
  if (t.powerCost > 0) {
    if (!powerPrepaid) player.powerUsed += t.powerCost;
  } else if (t.powerCost < 0 && !underConstruction) {
    player.powerCap += -t.powerCost;
  }
  if (t.isBuilding) blockFootprint(state, u, true);
  return u;
}

/** Mark the map cells under a building's square footprint blocked/unblocked. */
export function blockFootprint(state: GameState, u: Unit, blocked: boolean): void {
  const t = unitType(u.typeId);
  const r = t.radius;
  const minCx = fxFloor((u.x - r) | 0);
  const maxCx = fxFloor((u.x + r - 1) | 0);
  const minCy = fxFloor((u.y - r) | 0);
  const maxCy = fxFloor((u.y + r - 1) | 0);
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (cx >= 0 && cy >= 0 && cx < state.map.width && cy < state.map.height) {
        setBlocked(state.map, cx, cy, blocked);
      }
    }
  }
}

export function spawnResourceNode(
  state: GameState,
  kind: ResourceKind,
  x: Fx,
  y: Fx,
  amount: number,
): ResourceNode {
  const n: ResourceNode = { id: state.nextUnitId++, kind, x, y, amount };
  state.nodes.push(n);
  return n;
}

/** A depot is a completed building that can train a worker (LOG [001] mains). */
export function isDepot(u: Unit): boolean {
  if (u.constructTicks > 0) return false;
  const t = unitType(u.typeId);
  if (!t.isBuilding) return false;
  for (const key of t.trains) {
    if (unitTypeByKey(key).isWorker) return true;
  }
  return false;
}
