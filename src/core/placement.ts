/**
 * Building placement (LOG [012]). One footprint definition shared by
 * blockFootprint, BuildStructure, and the client ghost. `queryPlacement` is a
 * pure read: it never writes GameState, so the renderer can call it every
 * frame and stay an observer.
 *
 * Reject order is fixed so every peer agrees on the reason:
 *   terrain (including off-map) → building → unit → unaffordable.
 */
import { Fx, fxFloor } from "../math/fixed.js";
import { UNIT_TYPES, UnitType } from "../data/units.js";
import { GameState } from "./state.js";
import { worldToCellX, worldToCellY } from "./map.js";

export enum PlacementReject {
  Ok = 0,
  NotStructure = 1,
  BlockedTerrain = 2,
  BlockedBuilding = 3,
  BlockedUnit = 4,
  Unaffordable = 5,
}

export interface Footprint {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

/**
 * Cells a square occupant covers. Matches the historical blockFootprint math:
 * the max edge subtracts one fixed-point unit so an exact cell boundary does
 * not spill into the next cell.
 */
export function footprintOf(x: Fx, y: Fx, radius: Fx): Footprint {
  return {
    minCx: fxFloor((x - radius) | 0),
    maxCx: fxFloor((x + radius - 1) | 0),
    minCy: fxFloor((y - radius) | 0),
    maxCy: fxFloor((y + radius - 1) | 0),
  };
}

export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  return a.minCx <= b.maxCx && a.maxCx >= b.minCx && a.minCy <= b.maxCy && a.maxCy >= b.minCy;
}

function buildingCovers(state: GameState, cx: number, cy: number): boolean {
  const units = state.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.hp <= 0) continue;
    const t = UNIT_TYPES[u.typeId];
    if (!t || !t.isBuilding) continue;
    const fp = footprintOf(u.x, u.y, t.radius);
    if (cx >= fp.minCx && cx <= fp.maxCx && cy >= fp.minCy && cy <= fp.maxCy) return true;
  }
  return false;
}

function unitOccupies(state: GameState, fp: Footprint): boolean {
  const units = state.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.hp <= 0) continue;
    const t = UNIT_TYPES[u.typeId];
    if (!t || t.isBuilding) continue;
    const cx = worldToCellX(u.x);
    const cy = worldToCellY(u.y);
    if (cx >= fp.minCx && cx <= fp.maxCx && cy >= fp.minCy && cy <= fp.maxCy) return true;
  }
  return false;
}

/**
 * Can `playerId` place structure `typeId` centered at (x, y) right now?
 * Spatial checks use the live map and unit list. Affordability uses the
 * player's current Scrap and Aether (structures do not spend Power).
 */
export function queryPlacement(
  state: GameState,
  playerId: number,
  typeId: number,
  x: Fx,
  y: Fx,
): PlacementReject {
  const t: UnitType | undefined = UNIT_TYPES[typeId];
  const player = state.players[playerId];
  if (!t || !t.isBuilding || !player || t.faction !== player.faction) return PlacementReject.NotStructure;

  const fp = footprintOf(x, y, t.radius);
  const map = state.map;
  let terrain = false;
  let building = false;
  for (let cy = fp.minCy; cy <= fp.maxCy; cy++) {
    for (let cx = fp.minCx; cx <= fp.maxCx; cx++) {
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) {
        terrain = true;
        continue;
      }
      if (map.walkable[cy * map.width + cx] !== 1) {
        if (buildingCovers(state, cx, cy)) building = true;
        else terrain = true;
      }
    }
  }
  if (terrain) return PlacementReject.BlockedTerrain;
  if (building) return PlacementReject.BlockedBuilding;
  if (unitOccupies(state, fp)) return PlacementReject.BlockedUnit;
  if (player.scrap < t.costScrap || player.aether < t.costAether) return PlacementReject.Unaffordable;
  return PlacementReject.Ok;
}
