/** Render-side coordinate conversions (LOG [010]): the fx ↔ px boundary. */
import { describe, expect, it } from "vitest";
import { FX_ONE, fx } from "../src/math/fixed.js";
import {
  CELL_PX, fxToPx, lerpFxToPx, pxToFx, pxToFxClamped, screenToWorldPx, worldToScreenPx,
} from "../web/coords.js";

describe("coords", () => {
  it("fx → px → fx round-trips exactly on cell-aligned values", () => {
    for (const v of [0, fx(1), fx(31), fx(255), fx(10) + (FX_ONE >> 1)]) {
      expect(pxToFx(fxToPx(v))).toBe(v);
    }
  });

  it("pxToFx always produces int32 (sim-safe) values", () => {
    for (const px of [0.1, 33.337, 1023.99, -5.5, 123456.789]) {
      const v = pxToFx(px);
      expect(v).toBe(v | 0);
    }
  });

  it("pxToFxClamped clamps onto the map like sanitizeCommand does", () => {
    expect(pxToFxClamped(-100, 64)).toBe(0);
    expect(pxToFxClamped(64 * CELL_PX + 999, 64)).toBe(fx(64) - 1);
    expect(pxToFxClamped(10 * CELL_PX, 64)).toBe(fx(10));
  });

  it("interpolation hits both endpoints and the midpoint", () => {
    const a = fx(2);
    const b = fx(4);
    expect(lerpFxToPx(a, b, 0)).toBe(fxToPx(a));
    expect(lerpFxToPx(a, b, 1)).toBe(fxToPx(b));
    expect(lerpFxToPx(a, b, 0.5)).toBe(fxToPx(fx(3)));
  });

  it("screen ↔ world transforms invert each other under pan+zoom", () => {
    for (const [offset, zoom] of [[0, 1], [-320.5, 2.4], [512, 0.35]] as const) {
      for (const s of [0, 17.25, 999]) {
        expect(worldToScreenPx(screenToWorldPx(s, offset, zoom), offset, zoom)).toBeCloseTo(s, 9);
      }
    }
  });
});
