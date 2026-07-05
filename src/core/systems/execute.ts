/**
 * Command execution: drains the latency queue for exactly the current tick in
 * (playerId, seq) order (LOG [004]). Invalid commands (dead units, wrong owner,
 * unaffordable) are dropped silently and identically on every peer.
 */
import { spawnUnit } from "../api.js";
import { unstick } from "./movement.js";
import { CommandKind } from "../commands.js";
import { GameState, Unit, UnitBehavior, getNode, getUnit } from "../state.js";
import { unitType } from "../../data/units.js";
import { isWalkableCell } from "../map.js";
import { fxFloor } from "../../math/fixed.js";

export function executeCommands(state: GameState): void {
  // Scan before allocating: this runs every tick and pending is usually empty
  // or has nothing due (VERIFY [009] finding 7).
  let anyDue = false;
  for (const c of state.pending) {
    if (c.execTick === state.tick) {
      anyDue = true;
      break;
    }
  }
  if (!anyDue) return;
  const due = state.pending.filter((c) => c.execTick === state.tick);
  state.pending = state.pending.filter((c) => c.execTick !== state.tick);
  due.sort((a, b) => (a.playerId !== b.playerId ? a.playerId - b.playerId : a.seq - b.seq));

  for (const sc of due) {
    const cmd = sc.cmd;
    switch (cmd.kind) {
      case CommandKind.Move:
      case CommandKind.AttackMove: {
        for (const id of cmd.unitIds) {
          const u = ownedMobile(state, sc.playerId, id);
          if (!u) continue;
          u.behavior = cmd.kind === CommandKind.Move ? UnitBehavior.Moving : UnitBehavior.AttackMoving;
          u.goalX = cmd.x;
          u.goalY = cmd.y;
          u.path = null;
          u.repathWait = 0;
          u.targetId = -1;
          u.harvestNodeId = -1;
        }
        break;
      }
      case CommandKind.Attack: {
        const target = getUnit(state, cmd.targetId);
        if (!target || target.hp <= 0 || target.playerId === sc.playerId) break;
        for (const id of cmd.unitIds) {
          const u = ownedMobile(state, sc.playerId, id);
          if (!u || unitType(u.typeId).damage === 0) continue;
          u.behavior = UnitBehavior.Attacking;
          u.targetId = cmd.targetId;
          u.goalX = target.x;
          u.goalY = target.y;
          u.path = null;
          u.repathWait = 0;
          u.harvestNodeId = -1;
        }
        break;
      }
      case CommandKind.Stop: {
        for (const id of cmd.unitIds) {
          const u = ownedMobile(state, sc.playerId, id);
          if (!u) continue;
          u.behavior = UnitBehavior.Idle;
          u.path = null;
          u.repathWait = 0;
          u.targetId = -1;
          u.harvestNodeId = -1;
          u.velX = 0;
          u.velY = 0;
        }
        break;
      }
      case CommandKind.Harvest: {
        const node = getNode(state, cmd.nodeId);
        if (!node || node.amount <= 0) break;
        for (const id of cmd.unitIds) {
          const u = ownedMobile(state, sc.playerId, id);
          if (!u || !unitType(u.typeId).isWorker) continue;
          u.behavior = UnitBehavior.Harvesting;
          u.harvestNodeId = cmd.nodeId;
          u.targetId = -1;
          u.path = null;
          u.repathWait = 0;
          u.cooldown = 0;
        }
        break;
      }
      case CommandKind.Train: {
        const b = getUnit(state, cmd.buildingId);
        if (!b || b.hp <= 0 || b.playerId !== sc.playerId || b.constructTicks > 0) break;
        const bt = unitType(b.typeId);
        const ut = unitType(cmd.unitTypeId);
        if (!bt.trains.includes(ut.key)) break;
        if (b.trainQueue.length >= 5) break;
        const p = state.players[sc.playerId]!;
        if (p.scrap < ut.costScrap || p.aether < ut.costAether) break;
        if (ut.powerCost > 0 && p.powerUsed + ut.powerCost > p.powerCap) break;
        p.scrap -= ut.costScrap;
        p.aether -= ut.costAether;
        // Power is committed at enqueue so parallel queues can't overshoot the
        // cap; deaths refund it if the building dies with a non-empty queue
        // (LOG [007]).
        if (ut.powerCost > 0) p.powerUsed += ut.powerCost;
        b.trainQueue.push(cmd.unitTypeId);
        break;
      }
      case CommandKind.BuildStructure: {
        const w = ownedMobile(state, sc.playerId, cmd.workerId);
        if (!w || !unitType(w.typeId).isWorker) break;
        const bt = unitType(cmd.unitTypeId);
        if (!bt.isBuilding || bt.faction !== unitType(w.typeId).faction) break;
        const p = state.players[sc.playerId]!;
        if (p.scrap < bt.costScrap || p.aether < bt.costAether) break;
        // Footprint must be fully walkable (no units-on-site check yet — LOG entry pending).
        const r = fxFloor(bt.radius) + 1;
        const cx = fxFloor(cmd.x);
        const cy = fxFloor(cmd.y);
        let clear = true;
        for (let dy = -r; dy < r && clear; dy++) {
          for (let dx = -r; dx < r && clear; dx++) {
            if (!isWalkableCell(state.map, cx + dx, cy + dy)) clear = false;
          }
        }
        if (!clear) break;
        p.scrap -= bt.costScrap;
        p.aether -= bt.costAether;
        spawnUnit(state, sc.playerId, cmd.unitTypeId, cmd.x, cmd.y, true);
        // Anyone standing on the now-blocked footprint gets re-anchored to the
        // nearest walkable cell — separation alone can't free a unit whose
        // every small push lands on blocked cells (VERIFY [009] findings 3/9).
        for (const bystander of state.units) {
          if (bystander.hp > 0 && !unitType(bystander.typeId).isBuilding) {
            unstick(state, bystander);
          }
        }
        break;
      }
    }
  }
}

function ownedMobile(state: GameState, playerId: number, unitId: number): Unit | undefined {
  const u = getUnit(state, unitId);
  if (!u || u.hp <= 0 || u.playerId !== playerId) return undefined;
  if (unitType(u.typeId).isBuilding) return undefined;
  return u;
}
