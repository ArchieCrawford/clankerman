/**
 * Map model (LOG [005]): a grid of walkable cells, 1 world unit per cell.
 * Cells are addressed by index `cy * width + cx` and packed in a Uint8Array
 * (1 = walkable). Units live at continuous Q16.16 positions on top of the grid.
 */
import { Fx, FX_SHIFT, fx } from "../math/fixed.js";

export interface GameMap {
  width: number;
  height: number;
  /** 1 = walkable, 0 = blocked. Length = width * height. */
  walkable: Uint8Array;
}

export function createMap(width: number, height: number): GameMap {
  if (width > 256 || height > 256) throw new Error("map exceeds 256x256 (LOG [005])");
  return { width, height, walkable: new Uint8Array(width * height).fill(1) };
}

export function cellIndex(map: GameMap, cx: number, cy: number): number {
  return cy * map.width + cx;
}

export function worldToCellX(x: Fx): number {
  return x >> FX_SHIFT;
}

export function worldToCellY(y: Fx): number {
  return y >> FX_SHIFT;
}

export function worldToCell(map: GameMap, x: Fx, y: Fx): number {
  return cellIndex(map, x >> FX_SHIFT, y >> FX_SHIFT);
}

/** Center of a cell in world coordinates. */
export function cellCenterX(map: GameMap, cell: number): Fx {
  return (fx(cell % map.width) + (1 << (FX_SHIFT - 1))) | 0;
}

export function cellCenterY(map: GameMap, cell: number): Fx {
  return (fx((cell / map.width) | 0) + (1 << (FX_SHIFT - 1))) | 0;
}

export function isWalkableCell(map: GameMap, cx: number, cy: number): boolean {
  return (
    cx >= 0 && cy >= 0 && cx < map.width && cy < map.height &&
    map.walkable[cy * map.width + cx] === 1
  );
}

export function setBlocked(map: GameMap, cx: number, cy: number, blocked: boolean): void {
  map.walkable[cy * map.width + cx] = blocked ? 0 : 1;
}
