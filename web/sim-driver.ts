/**
 * Fixed-timestep sim driver (LOG [010]). Owns the accumulator and the
 * previous-tick position snapshot used for render interpolation.
 *
 * THE RENDERER NEVER WRITES SIM STATE. rAF time never reaches the sim: it only
 * determines how many whole 62.5 ms ticks to run and the leftover alpha.
 */
import { GameState } from "../src/core/state.js";
import { SimContext, step } from "../src/core/sim.js";

export const TICK_MS = 1000 / 16;
/** Backgrounded-tab guard: never grind more than this many ticks per frame. */
const MAX_TICKS_PER_FRAME = 8;

export interface PrevPos {
  x: number; // fx, but stored render-side only
  y: number;
}

export class SimDriver {
  readonly state: GameState;
  readonly ctx: SimContext;
  /** Unit id → position at the START of the current tick (for interpolation). */
  readonly prev = new Map<number, PrevPos>();
  private accumulator = 0;
  /** 0..1 fraction of the current tick already elapsed in wall time. */
  alpha = 0;

  constructor(state: GameState, ctx: SimContext) {
    this.state = state;
    this.ctx = ctx;
    this.snapshot();
  }

  /** Advance wall time; runs 0..MAX_TICKS_PER_FRAME sim ticks. */
  update(dtMs: number): void {
    this.accumulator += dtMs;
    if (this.accumulator > TICK_MS * MAX_TICKS_PER_FRAME) {
      this.accumulator = TICK_MS * MAX_TICKS_PER_FRAME;
    }
    while (this.accumulator >= TICK_MS) {
      this.snapshot();
      step(this.state, this.ctx);
      this.accumulator -= TICK_MS;
    }
    this.alpha = this.accumulator / TICK_MS;
  }

  private snapshot(): void {
    // Reuse entries to avoid per-tick garbage; prune the dead afterwards.
    for (const u of this.state.units) {
      const p = this.prev.get(u.id);
      if (p) {
        p.x = u.x;
        p.y = u.y;
      } else {
        this.prev.set(u.id, { x: u.x, y: u.y });
      }
    }
    if (this.prev.size > this.state.units.length) {
      const alive = new Set<number>();
      for (const u of this.state.units) alive.add(u.id);
      for (const id of this.prev.keys()) {
        if (!alive.has(id)) this.prev.delete(id);
      }
    }
  }
}
