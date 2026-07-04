/**
 * Command model (LOG [004]): commands never mutate state on arrival — they are
 * scheduled `COMMAND_LATENCY_TICKS` in the future and executed in deterministic
 * (tick, playerId, seq) order. This is the lockstep network boundary: in
 * multiplayer, peers exchange exactly these objects.
 */
import { Fx } from "../math/fixed.js";

export enum CommandKind {
  Move = 0,
  AttackMove = 1,
  Attack = 2,
  Stop = 3,
  Harvest = 4,
  Train = 5,
  BuildStructure = 6,
}

export interface MoveCommand {
  kind: CommandKind.Move | CommandKind.AttackMove;
  unitIds: number[];
  x: Fx;
  y: Fx;
}

export interface AttackCommand {
  kind: CommandKind.Attack;
  unitIds: number[];
  targetId: number;
}

export interface StopCommand {
  kind: CommandKind.Stop;
  unitIds: number[];
}

export interface HarvestCommand {
  kind: CommandKind.Harvest;
  unitIds: number[];
  nodeId: number;
}

export interface TrainCommand {
  kind: CommandKind.Train;
  buildingId: number;
  unitTypeId: number;
}

export interface BuildStructureCommand {
  kind: CommandKind.BuildStructure;
  workerId: number;
  unitTypeId: number;
  x: Fx;
  y: Fx;
}

export type Command =
  | MoveCommand
  | AttackCommand
  | StopCommand
  | HarvestCommand
  | TrainCommand
  | BuildStructureCommand;

export interface ScheduledCommand {
  execTick: number;
  playerId: number;
  seq: number;
  cmd: Command;
}

/** Deterministic cross-peer ordering within a tick. */
export function compareScheduled(a: ScheduledCommand, b: ScheduledCommand): number {
  if (a.execTick !== b.execTick) return a.execTick - b.execTick;
  if (a.playerId !== b.playerId) return a.playerId - b.playerId;
  return a.seq - b.seq;
}
