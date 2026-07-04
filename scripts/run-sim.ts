/**
 * Headless demo match: Cog Dominion vs Verdant Chorus, scripted commands,
 * prints an economy/army summary and the state hash every 10 seconds of game
 * time. `npm run sim [seed]`.
 */
import { fx } from "../src/math/fixed.js";
import { CommandKind } from "../src/core/commands.js";
import { hashState } from "../src/core/state.js";
import { issueCommand } from "../src/core/api.js";
import { createSimContext, step } from "../src/core/sim.js";
import { FACTION_NAMES, Faction, unitType, unitTypeByKey } from "../src/data/units.js";
import { createSkirmish } from "../src/scenario.js";
import { isGameOver } from "../src/core/systems/deaths.js";

const seed = Number(process.argv[2] ?? 42) | 0;
const state = createSkirmish(seed, Faction.CogDominion, Faction.VerdantChorus);
const ctx = createSimContext(state);

console.log(`Clankerman: Iron Dominion — headless match, seed ${seed}`);
console.log(`P0 ${FACTION_NAMES[Faction.CogDominion]} vs P1 ${FACTION_NAMES[Faction.VerdantChorus]}\n`);

// Scripted openings: both players harvest, build army, then attack at 60s.
for (const pid of [0, 1]) {
  const workers = state.units.filter((u) => u.playerId === pid && unitType(u.typeId).isWorker);
  const nodes = state.nodes.filter((n) => Math.abs(n.x - workers[0]!.x) < fx(20));
  issueCommand(state, pid, {
    kind: CommandKind.Harvest,
    unitIds: workers.map((u) => u.id),
    nodeId: nodes[0]!.id,
  });
}

const p0Main = state.units.find((u) => u.playerId === 0 && unitType(u.typeId).isBuilding)!;
const p1Main = state.units.find((u) => u.playerId === 1 && unitType(u.typeId).isBuilding)!;

const MAX_TICKS = 16 * 60 * 5; // 5 minutes of game time
for (let t = 0; t <= MAX_TICKS && !isGameOver(state); t++) {
  // Simple scripted macro: train fighters whenever affordable.
  if (t % 32 === 0) {
    const p0 = state.players[0]!;
    const bolt = unitTypeByKey("cog_boltguard");
    if (p0.scrap >= bolt.costScrap) {
      // Cog needs an Assembly Line first — build one at t≈20s.
      const assembly = state.units.find((u) => u.playerId === 0 && u.typeId === unitTypeByKey("cog_assembly").id && u.constructTicks === 0);
      if (assembly) {
        issueCommand(state, 0, { kind: CommandKind.Train, buildingId: assembly.id, unitTypeId: bolt.id });
      } else if (t > 16 * 15 && p0.scrap >= unitTypeByKey("cog_assembly").costScrap && !state.units.some((u) => u.playerId === 0 && u.typeId === unitTypeByKey("cog_assembly").id)) {
        const worker = state.units.find((u) => u.playerId === 0 && unitType(u.typeId).isWorker);
        if (worker) issueCommand(state, 0, { kind: CommandKind.BuildStructure, workerId: worker.id, unitTypeId: unitTypeByKey("cog_assembly").id, x: fx(14), y: fx(14) });
      }
    }
    const p1 = state.players[1]!;
    const hound = unitTypeByKey("verdant_thornhound");
    if (p1.scrap >= hound.costScrap) {
      issueCommand(state, 1, { kind: CommandKind.Train, buildingId: p1Main.id, unitTypeId: hound.id });
    }
  }
  // Attack waves at 90s and every 45s after.
  if (t >= 16 * 90 && (t - 16 * 90) % (16 * 45) === 0) {
    for (const pid of [0, 1]) {
      const fighters = state.units.filter(
        (u) => u.playerId === pid && !unitType(u.typeId).isWorker && !unitType(u.typeId).isBuilding && u.behavior === 0,
      );
      const enemyMain = pid === 0 ? p1Main : p0Main;
      if (fighters.length >= 6) {
        issueCommand(state, pid, {
          kind: CommandKind.AttackMove,
          unitIds: fighters.map((u) => u.id),
          x: enemyMain.x,
          y: enemyMain.y,
        });
      }
    }
  }

  step(state, ctx);

  if (state.tick % 160 === 0) {
    const line = state.players
      .map((p) => {
        const army = state.units.filter((u) => u.playerId === p.id && !unitType(u.typeId).isWorker && !unitType(u.typeId).isBuilding).length;
        const w = state.units.filter((u) => u.playerId === p.id && unitType(u.typeId).isWorker).length;
        return `P${p.id} scrap=${p.scrap} aether=${p.aether} workers=${w} army=${army} power=${p.powerUsed}/${p.powerCap}${p.defeated ? " DEFEATED" : ""}`;
      })
      .join(" | ");
    console.log(`t=${String(state.tick).padStart(5)} (${(state.tick / 16).toFixed(0)}s)  ${line}  hash=${(hashState(state) >>> 0).toString(16)}`);
  }
}

const survivors = state.players.filter((p) => !p.defeated);
console.log(
  survivors.length === 1
    ? `\n${FACTION_NAMES[survivors[0]!.faction as Faction]} (P${survivors[0]!.id}) wins at tick ${state.tick}.`
    : `\nMatch ended at tick ${state.tick} with ${survivors.length} players standing.`,
);
console.log(`Final state hash: ${(hashState(state) >>> 0).toString(16)}`);
