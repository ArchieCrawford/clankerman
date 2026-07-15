/**
 * Minimal scripted opponent so the demo match fights back. It is a *player*:
 * it reads GameState and issues commands through the same sanitized queue as
 * the human. Keyed to state.tick, so it is deterministic given the same match.
 */
import { GameState } from "../src/core/state.js";
import { CommandKind } from "../src/core/commands.js";
import { issueCommand } from "../src/core/api.js";
import { UnitBehavior } from "../src/core/state.js";
import { unitType, unitTypeByKey } from "../src/data/units.js";

export class ScriptedAI {
  private readonly playerId: number;
  private lastTick = -1;

  constructor(playerId: number) {
    this.playerId = playerId;
  }

  update(state: GameState): void {
    // Act at most once per sim tick (the render loop calls this every frame).
    if (state.tick === this.lastTick) return;
    this.lastTick = state.tick;
    const pid = this.playerId;
    const p = state.players[pid];
    if (!p || p.defeated) return;

    if (state.tick % 16 === 0) {
      // Idle workers → nearest node with reserves.
      const idleWorkers = state.units
        .filter((u) => u.playerId === pid && unitType(u.typeId).isWorker && u.behavior === UnitBehavior.Idle)
        .map((u) => u.id);
      const node = state.nodes.find((n) => n.amount > 0);
      if (idleWorkers.length > 0 && node) {
        issueCommand(state, pid, { kind: CommandKind.Harvest, unitIds: idleWorkers, nodeId: node.id });
      }
    }

    if (state.tick % 32 === 0) {
      // Keep the army flowing from any building that can train.
      for (const b of state.units) {
        if (b.playerId !== pid || b.constructTicks > 0) continue;
        const bt = unitType(b.typeId);
        if (!bt.isBuilding || bt.trains.length === 0 || b.trainQueue.length > 1) continue;
        // Prefer a fighter; fall back to a worker if we have fewer than 8.
        const workerCount = state.units.filter((u) => u.playerId === pid && unitType(u.typeId).isWorker).length;
        const options = bt.trains.map((k) => unitTypeByKey(k));
        const pick =
          options.find((t) => !t.isWorker && p.scrap >= t.costScrap && p.aether >= t.costAether) ??
          (workerCount < 8 ? options.find((t) => t.isWorker && p.scrap >= t.costScrap) : undefined);
        if (pick) {
          issueCommand(state, pid, { kind: CommandKind.Train, buildingId: b.id, unitTypeId: pick.id });
        }
      }
    }

    // Attack wave once 8+ fighters are idle: charge the enemy main.
    if (state.tick % 160 === 0) {
      const fighters = state.units
        .filter(
          (u) =>
            u.playerId === pid &&
            !unitType(u.typeId).isWorker &&
            !unitType(u.typeId).isBuilding &&
            u.behavior === UnitBehavior.Idle,
        )
        .map((u) => u.id);
      const enemyMain = state.units.find((u) => u.playerId !== pid && unitType(u.typeId).isBuilding);
      if (fighters.length >= 8 && enemyMain) {
        issueCommand(state, pid, { kind: CommandKind.AttackMove, unitIds: fighters, x: enemyMain.x, y: enemyMain.y });
      }
    }
  }
}
