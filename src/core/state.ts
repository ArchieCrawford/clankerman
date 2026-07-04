/**
 * The whole game is a plain serializable object (LOG [004]): no class instances,
 * no closures, no hidden fields. initialState + command log = replay.
 */
import { Fx } from "../math/fixed.js";
import { hashInit, hashInt } from "../math/hash.js";
import { PrngState, prngSeed } from "../math/prng.js";
import { GameMap, createMap } from "./map.js";
import { ScheduledCommand } from "./commands.js";

export const TICKS_PER_SECOND = 16;
export const COMMAND_LATENCY_TICKS = 2;

export enum ResourceKind {
  Scrap = 0,
  Aether = 1,
}

export enum UnitBehavior {
  Idle = 0,
  Moving = 1,       // move to goal, ignore enemies
  AttackMoving = 2, // move to goal, engage enemies on the way
  Attacking = 3,    // chase + hit explicit target
  Harvesting = 4,   // gather from node, return to depot, repeat
  Training = 5,     // building producing units (queue non-empty)
}

export interface Player {
  id: number;
  faction: number;
  scrap: number;
  aether: number;
  /** Supply used / capacity ("Power"). */
  powerUsed: number;
  powerCap: number;
  defeated: boolean;
}

export interface Unit {
  id: number;
  typeId: number;
  playerId: number;
  x: Fx;
  y: Fx;
  hp: number;
  behavior: UnitBehavior;
  /** Movement goal in world coords (valid when Moving/AttackMoving/Attacking). */
  goalX: Fx;
  goalY: Fx;
  /** Path as cell indices from pathfinder; -1 length marker not used, null = none. */
  path: number[] | null;
  pathIndex: number;
  /** Cached per-waypoint velocity (Q16.16), recomputed when waypoint changes. */
  velX: Fx;
  velY: Fx;
  /** Combat: current target unit id, -1 = none. Cooldown in ticks. */
  targetId: number;
  cooldown: number;
  /** Economy (workers): node being harvested, carried load. */
  harvestNodeId: number;
  carryKind: ResourceKind;
  carryAmount: number;
  /** Production (buildings): queued unit type ids + progress on head item. */
  trainQueue: number[];
  trainProgress: number;
  /** Buildings: remaining construction ticks; 0 = operational. */
  constructTicks: number;
}

export interface ResourceNode {
  id: number;
  kind: ResourceKind;
  x: Fx;
  y: Fx;
  amount: number;
}

export interface GameState {
  tick: number;
  prng: PrngState;
  map: GameMap;
  players: Player[];
  units: Unit[];
  nodes: ResourceNode[];
  nextUnitId: number;
  /** Commands scheduled for future ticks; drained exactly at their tick. */
  pending: ScheduledCommand[];
  /** Per-player command sequence counters (for deterministic ordering). */
  cmdSeq: number[];
}

export function createGameState(seed: number, mapWidth: number, mapHeight: number, playerFactions: number[]): GameState {
  return {
    tick: 0,
    prng: prngSeed(seed),
    map: createMap(mapWidth, mapHeight),
    players: playerFactions.map((faction, id) => ({
      id, faction, scrap: 500, aether: 0, powerUsed: 0, powerCap: 0, defeated: false,
    })),
    units: [],
    nodes: [],
    nextUnitId: 1,
    pending: [],
    cmdSeq: playerFactions.map(() => 0),
  };
}

export function getUnit(state: GameState, id: number): Unit | undefined {
  // Units are kept sorted by id (monotonic spawn order, order-preserving death
  // compaction) so binary search is valid.
  const arr = state.units;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const u = arr[mid]!;
    if (u.id === id) return u;
    if (u.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

export function getNode(state: GameState, id: number): ResourceNode | undefined {
  for (const n of state.nodes) if (n.id === id) return n;
  return undefined;
}

/**
 * FNV-1a over the canonical field order — the lockstep desync detector.
 * Every field that affects simulation must be included. (LOG [003])
 */
export function hashState(state: GameState): number {
  let h = hashInit();
  h = hashInt(h, state.tick);
  h = hashInt(h, state.prng.s0);
  h = hashInt(h, state.prng.s1);
  h = hashInt(h, state.prng.s2);
  h = hashInt(h, state.prng.s3);
  h = hashInt(h, state.nextUnitId);
  for (const p of state.players) {
    h = hashInt(h, p.scrap);
    h = hashInt(h, p.aether);
    h = hashInt(h, p.powerUsed);
    h = hashInt(h, p.powerCap);
    h = hashInt(h, p.defeated ? 1 : 0);
  }
  for (const u of state.units) {
    h = hashInt(h, u.id);
    h = hashInt(h, u.typeId);
    h = hashInt(h, u.playerId);
    h = hashInt(h, u.x);
    h = hashInt(h, u.y);
    h = hashInt(h, u.hp);
    h = hashInt(h, u.behavior);
    h = hashInt(h, u.targetId);
    h = hashInt(h, u.cooldown);
    h = hashInt(h, u.carryAmount);
    h = hashInt(h, u.trainProgress);
    h = hashInt(h, u.constructTicks);
  }
  for (const n of state.nodes) {
    h = hashInt(h, n.id);
    h = hashInt(h, n.amount);
  }
  return h;
}
