/**
 * The headless deterministic core loop (LOG [004]).
 *
 * `step()` advances exactly one tick through the fixed system order:
 *   commands → production → economy → movement → separation → combat → deaths.
 *
 * `SimContext` is transient derived scratch (pathfinder arrays, spatial grid,
 * query buffers). It carries NO game state: two peers with different context
 * objects but identical GameState + commands produce identical states forever.
 * Never serialize or hash it (LOG [003]/[005]).
 */
import { GameState } from "./state.js";
import { executeCommands } from "./systems/execute.js";
import { runProduction } from "./systems/production.js";
import { runEconomy } from "./systems/economy.js";
import { runMovement, runSeparation } from "./systems/movement.js";
import { runCombat } from "./systems/combat.js";
import { runDeaths } from "./systems/deaths.js";
import { PathScratch, createPathScratch } from "../path/astar.js";
import { SpatialGrid, createSpatialGrid, gridRebuild } from "../spatial/grid.js";

export interface SimContext {
  pathScratch: PathScratch;
  grid: SpatialGrid;
  queryBuf: number[];
  combatBuf: number[];
}

export function createSimContext(state: GameState): SimContext {
  return {
    pathScratch: createPathScratch(state.map),
    grid: createSpatialGrid(state.map.width, state.map.height),
    queryBuf: [],
    combatBuf: [],
  };
}

export function step(state: GameState, ctx: SimContext): void {
  executeCommands(state);
  runProduction(state);
  runEconomy(state);
  runMovement(state, ctx.pathScratch);
  runSeparation(state, ctx.grid, ctx.queryBuf); // rebuilds the grid
  gridRebuild(ctx.grid, state.units); // re-sync after separation moved units
  runCombat(state, ctx.grid, ctx.combatBuf);
  runDeaths(state);
  state.tick++;
}

/** Convenience: run N ticks. */
export function run(state: GameState, ctx: SimContext, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(state, ctx);
}
