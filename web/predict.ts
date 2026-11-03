/**
 * View-side preview of a placement. The sim remains authoritative: this only
 * reads GameState (including the latency queue) so the ghost can turn red
 * for a building that is already paid for but not spawned yet.
 */
import { Fx } from "../src/math/fixed.js";
import { CommandKind } from "../src/core/commands.js";
import { GameState } from "../src/core/state.js";
import { UNIT_TYPES } from "../src/data/units.js";
import {
  Footprint,
  PlacementReject,
  footprintOf,
  footprintsOverlap,
  queryPlacement,
} from "../src/core/placement.js";

export interface GhostView {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
  x: number;
  y: number;
  valid: boolean;
  reason: PlacementReject;
}

export interface Spendable {
  scrap: number;
  aether: number;
  powerUsed: number;
  powerCap: number;
}

function pendingStructureBlocks(state: GameState, fp: Footprint): boolean {
  for (const sc of state.pending) {
    if (sc.cmd.kind !== CommandKind.BuildStructure) continue;
    const t = UNIT_TYPES[sc.cmd.unitTypeId];
    if (!t) continue;
    if (footprintsOverlap(fp, footprintOf(sc.cmd.x, sc.cmd.y, t.radius))) return true;
  }
  return false;
}

/** Resources already committed by this player's commands that have not resolved. */
export function spendable(state: GameState, playerId: number): Spendable {
  const p = state.players[playerId];
  let scrap = p ? p.scrap : 0;
  let aether = p ? p.aether : 0;
  let power = p ? p.powerUsed : 0;
  const powerCap = p ? p.powerCap : 0;
  for (const sc of state.pending) {
    if (sc.playerId !== playerId) continue;
    if (sc.cmd.kind !== CommandKind.Train && sc.cmd.kind !== CommandKind.BuildStructure) continue;
    const t = UNIT_TYPES[sc.cmd.unitTypeId];
    if (!t) continue;
    scrap -= t.costScrap;
    aether -= t.costAether;
    if (sc.cmd.kind === CommandKind.Train && t.powerCost > 0) power += t.powerCost;
  }
  return { scrap, aether, powerUsed: power, powerCap };
}

/** Queue length once pending trains and cancels for this building resolve. */
export function effectiveQueueLength(state: GameState, playerId: number, buildingId: number, queued: number): number {
  let n = queued;
  for (const sc of state.pending) {
    if (sc.playerId !== playerId) continue;
    if (sc.cmd.kind === CommandKind.Train && sc.cmd.buildingId === buildingId) n++;
    if (sc.cmd.kind === CommandKind.CancelTrain && sc.cmd.buildingId === buildingId) n--;
  }
  return n < 0 ? 0 : n;
}

export function previewPlacement(state: GameState, playerId: number, typeId: number, x: Fx, y: Fx): PlacementReject {
  const t = UNIT_TYPES[typeId];
  if (!t || !t.isBuilding) return PlacementReject.NotStructure;
  const live = queryPlacement(state, playerId, typeId, x, y);
  if (live !== PlacementReject.Ok && live !== PlacementReject.Unaffordable) return live;
  const fp = footprintOf(x, y, t.radius);
  if (pendingStructureBlocks(state, fp)) return PlacementReject.BlockedBuilding;
  if (live === PlacementReject.Unaffordable) return live;
  const funds = spendable(state, playerId);
  if (funds.scrap < t.costScrap || funds.aether < t.costAether) return PlacementReject.Unaffordable;
  return PlacementReject.Ok;
}

export function ghostAt(state: GameState, playerId: number, typeId: number, x: Fx, y: Fx): GhostView {
  const t = UNIT_TYPES[typeId];
  const radius = t ? t.radius : 0;
  const fp = footprintOf(x, y, radius);
  const reason = previewPlacement(state, playerId, typeId, x, y);
  return {
    minCx: fp.minCx,
    maxCx: fp.maxCx,
    minCy: fp.minCy,
    maxCy: fp.maxCy,
    x,
    y,
    valid: reason === PlacementReject.Ok,
    reason,
  };
}

export function placementStatus(reason: PlacementReject, typeName: string, shortAether: boolean): string {
  switch (reason) {
    case PlacementReject.Ok:
      return `Placing ${typeName} — click to build, Shift queues, right-click or Esc cancels`;
    case PlacementReject.BlockedTerrain:
      return `${typeName}: Can't build on blocked terrain`;
    case PlacementReject.BlockedBuilding:
      return `${typeName}: Can't build on a building`;
    case PlacementReject.BlockedUnit:
      return `${typeName}: Can't build on a unit`;
    case PlacementReject.Unaffordable:
      return shortAether ? `${typeName}: Not enough Aether` : `${typeName}: Not enough Scrap`;
    default:
      return `${typeName}: Can't build there`;
  }
}
