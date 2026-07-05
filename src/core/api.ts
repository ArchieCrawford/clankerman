/**
 * Public mutation API: everything a match harness (or later a UI/network layer)
 * uses to set up and drive a game. Commands go through the latency queue
 * (LOG [004]); spawn helpers are for match setup and internal systems only.
 */
import { Fx, fx, fxClamp, fxFloor } from "../math/fixed.js";
import { setBlocked } from "./map.js";
import { Command, CommandKind, ScheduledCommand } from "./commands.js";
import {
  COMMAND_LATENCY_TICKS, GameState, ResourceKind, ResourceNode, Unit, UnitBehavior,
} from "./state.js";
import { UNIT_TYPES, unitType, unitTypeByKey } from "../data/units.js";

/**
 * Queue a command for execution at tick + COMMAND_LATENCY_TICKS.
 *
 * This is the network boundary (LOG [004]): payloads are sanitized here so a
 * malformed or hostile command can never inject non-int32 values into sim
 * state or crash the sim with an unknown type id (VERIFY [009] finding 4).
 * In multiplayer, commands received from peers must pass through the same
 * sanitizer before scheduling.
 */
export function issueCommand(state: GameState, playerId: number, cmd: Command): void {
  const seq = state.cmdSeq[playerId];
  if (seq === undefined) throw new Error(`unknown player ${playerId}`);
  const clean = sanitizeCommand(state, cmd);
  if (clean === null) return; // structurally invalid: dropped identically on every peer
  state.cmdSeq[playerId] = seq + 1;
  const sc: ScheduledCommand = {
    execTick: state.tick + COMMAND_LATENCY_TICKS,
    playerId,
    seq,
    cmd: clean,
  };
  state.pending.push(sc);
}

/** Coerce every payload field to int32 and clamp coordinates onto the map. */
export function sanitizeCommand(state: GameState, cmd: Command): Command | null {
  const clampX = (v: number): Fx => fxClamp(v | 0, 0, (fx(state.map.width) - 1) | 0);
  const clampY = (v: number): Fx => fxClamp(v | 0, 0, (fx(state.map.height) - 1) | 0);
  const ids = (raw: number[]): number[] => raw.map((v) => v | 0);
  switch (cmd.kind) {
    case CommandKind.Move:
    case CommandKind.AttackMove:
      return { kind: cmd.kind, unitIds: ids(cmd.unitIds), x: clampX(cmd.x), y: clampY(cmd.y) };
    case CommandKind.Attack:
      return { kind: cmd.kind, unitIds: ids(cmd.unitIds), targetId: cmd.targetId | 0 };
    case CommandKind.Stop:
      return { kind: cmd.kind, unitIds: ids(cmd.unitIds) };
    case CommandKind.Harvest:
      return { kind: cmd.kind, unitIds: ids(cmd.unitIds), nodeId: cmd.nodeId | 0 };
    case CommandKind.Train: {
      const typeId = cmd.unitTypeId | 0;
      if (typeId < 0 || typeId >= UNIT_TYPES.length) return null;
      return { kind: cmd.kind, buildingId: cmd.buildingId | 0, unitTypeId: typeId };
    }
    case CommandKind.BuildStructure: {
      const typeId = cmd.unitTypeId | 0;
      if (typeId < 0 || typeId >= UNIT_TYPES.length) return null;
      return { kind: cmd.kind, workerId: cmd.workerId | 0, unitTypeId: typeId, x: clampX(cmd.x), y: clampY(cmd.y) };
    }
    default:
      return null; // unknown kind (corrupt packet)
  }
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
    repathWait: 0,
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
