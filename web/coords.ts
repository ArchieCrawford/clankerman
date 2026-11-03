/**
 * Coordinate spaces (LOG [010]) — the only place fx ↔ pixels conversion lives.
 *
 *   fx        Q16.16 fixed-point world units (sim space, int32)
 *   world px  float pixels in the world container (1 world unit = CELL_PX)
 *   screen px client pixels (world px transformed by camera pan/zoom)
 *
 * Conversions INTO sim space round and clamp and end in `| 0`; conversions out
 * of sim space are render-only floats and never flow back into GameState.
 */
import { FX_ONE, Fx } from "../src/math/fixed.js";

export const CELL_PX = 32;

/** fx → world pixels (render-only float). */
export function fxToPx(v: Fx): number {
  return (v / FX_ONE) * CELL_PX;
}

/** world pixels → fx, rounded and truncated to int32. */
export function pxToFx(px: number): Fx {
  return Math.round((px / CELL_PX) * FX_ONE) | 0;
}

/** world pixels → fx clamped onto a w×h-cell map (matches sanitizeCommand). */
export function pxToFxClamped(px: number, cells: number): Fx {
  const v = pxToFx(px);
  const max = ((cells * FX_ONE) - 1) | 0;
  return v < 0 ? 0 : v > max ? max : v;
}

/** Render-side interpolation between two fx coords; returns world px (float). */
export function lerpFxToPx(prev: Fx, curr: Fx, alpha: number): number {
  const a = fxToPx(prev);
  const b = fxToPx(curr);
  return a + (b - a) * alpha;
}

/** Screen → world px given camera offset/zoom (screen = world * zoom + offset). */
export function screenToWorldPx(screen: number, offset: number, zoom: number): number {
  return (screen - offset) / zoom;
}

export function worldToScreenPx(world: number, offset: number, zoom: number): number {
  return world * zoom + offset;
}
