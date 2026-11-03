/**
 * Standard skirmish setup used by tests and the headless runner: a mirrored
 * 2-player map so both spawns are symmetric (fair and easy to reason about).
 */
import { fx } from "./math/fixed.js";
import { GameState, ResourceKind, createGameState } from "./core/state.js";
import { spawnResourceNode, spawnUnit } from "./core/api.js";
import { Faction, unitTypeByKey } from "./data/units.js";

const MAIN_BY_FACTION: Record<Faction, string> = {
  [Faction.CogDominion]: "cog_foundry",
  [Faction.VerdantChorus]: "verdant_heartroot",
  [Faction.HollowCourt]: "hollow_spire",
};

const WORKER_BY_FACTION: Record<Faction, string> = {
  [Faction.CogDominion]: "cog_scrapling",
  [Faction.VerdantChorus]: "verdant_sporeling",
  [Faction.HollowCourt]: "hollow_wisp",
};

export const BARRACKS_BY_FACTION: Record<Faction, string> = {
  [Faction.CogDominion]: "cog_assembly",
  [Faction.VerdantChorus]: "verdant_heartroot", // Chorus trains everything from the Heartroot
  [Faction.HollowCourt]: "hollow_gate",
};

export function createSkirmish(seed: number, factionA: Faction, factionB: Faction): GameState {
  const state = createGameState(seed, 64, 64, [factionA, factionB]);
  setupBase(state, 0, factionA, 10, 10);
  setupBase(state, 1, factionB, 54, 54);
  return state;
}

function setupBase(state: GameState, playerId: number, faction: Faction, cx: number, cy: number): void {
  spawnUnit(state, playerId, unitTypeByKey(MAIN_BY_FACTION[faction]).id, fx(cx), fx(cy));
  const workerType = unitTypeByKey(WORKER_BY_FACTION[faction]).id;
  const side = cx < 32 ? 1 : -1;
  for (let i = 0; i < 4; i++) {
    spawnUnit(state, playerId, workerType, fx(cx + side * (3 + i)), fx(cy));
  }
  // Scrap line + one Aether well behind the main.
  for (let i = 0; i < 4; i++) {
    spawnResourceNode(state, ResourceKind.Scrap, fx(cx - side * 4), fx(cy - 3 + i * 2), 1500);
  }
  spawnResourceNode(state, ResourceKind.Aether, fx(cx - side * 6), fx(cy), 5000);
}
