/**
 * Production macro commands (LOG [012]): placement query, SetRally, CancelTrain.
 * The query is a pure read; the commands are the only writers, and they share
 * the query so a green ghost cannot be rejected for a different spatial reason.
 */
import { describe, expect, it } from "vitest";
import { fx } from "../src/math/fixed.js";
import { CommandKind } from "../src/core/commands.js";
import { UnitBehavior, createGameState, hashState } from "../src/core/state.js";
import { issueCommand, spawnUnit } from "../src/core/api.js";
import { createSimContext, run } from "../src/core/sim.js";
import { Faction, unitTypeByKey } from "../src/data/units.js";
import { isWalkableCell, setBlocked } from "../src/core/map.js";
import { PlacementReject, footprintOf, queryPlacement } from "../src/core/placement.js";

function arena(seed = 1) {
  const state = createGameState(seed, 40, 40, [Faction.CogDominion, Faction.VerdantChorus]);
  const ctx = createSimContext(state);
  const foundry = spawnUnit(state, 0, unitTypeByKey("cog_foundry").id, fx(8), fx(8));
  const worker = spawnUnit(state, 0, unitTypeByKey("cog_scrapling").id, fx(3), fx(3));
  state.players[0]!.scrap = 2000;
  state.players[0]!.aether = 500;
  return { state, ctx, foundry, worker };
}

describe("queryPlacement", () => {
  it("accepts an open, affordable footprint and does not mutate state", () => {
    const { state } = arena();
    const mast = unitTypeByKey("cog_pylon");
    const before = hashState(state);
    const reason = queryPlacement(state, 0, mast.id, fx(20), fx(20));
    expect(reason).toBe(PlacementReject.Ok);
    expect(hashState(state)).toBe(before);
  });

  it("rejects terrain, buildings, units, and cost, in that order", () => {
    const { state, foundry } = arena();
    const mast = unitTypeByKey("cog_pylon");
    // Terrain: a blocked cell with no building on it.
    setBlocked(state.map, 30, 30, true);
    setBlocked(state.map, 31, 30, true);
    setBlocked(state.map, 30, 31, true);
    setBlocked(state.map, 31, 31, true);
    expect(queryPlacement(state, 0, mast.id, fx(31), fx(31))).toBe(PlacementReject.BlockedTerrain);

    // Off-map footprint is terrain, even if the anchor itself was clamped on-map.
    expect(queryPlacement(state, 0, mast.id, fx(0), fx(0))).toBe(PlacementReject.BlockedTerrain);

    // Building: mast footprint is 2×2 and the foundry already covers its origin.
    const fp = footprintOf(foundry.x, foundry.y, unitTypeByKey("cog_foundry").radius);
    expect(queryPlacement(state, 0, mast.id, foundry.x, foundry.y)).toBe(PlacementReject.BlockedBuilding);
    expect(fp.minCx).toBeLessThanOrEqual(8);

    // Unit: a fighter standing on an otherwise open cell.
    spawnUnit(state, 0, unitTypeByKey("cog_boltguard").id, fx(24), fx(24));
    expect(queryPlacement(state, 0, mast.id, fx(24), fx(24))).toBe(PlacementReject.BlockedUnit);

    state.players[0]!.scrap = 0;
    expect(queryPlacement(state, 0, mast.id, fx(20), fx(20))).toBe(PlacementReject.Unaffordable);

    // A non-building, or another faction's structure, is not a legal placement.
    expect(queryPlacement(state, 0, unitTypeByKey("cog_scrapling").id, fx(20), fx(20))).toBe(
      PlacementReject.NotStructure,
    );
    expect(queryPlacement(state, 0, unitTypeByKey("verdant_bloom").id, fx(20), fx(20))).toBe(
      PlacementReject.NotStructure,
    );
  });
});

describe("BuildStructure uses the placement query", () => {
  it("places on open ground and blocks exactly the footprint", () => {
    const { state, ctx, worker } = arena();
    const mast = unitTypeByKey("cog_pylon");
    const before = state.players[0]!.scrap;
    issueCommand(state, 0, {
      kind: CommandKind.BuildStructure,
      workerId: worker.id,
      unitTypeId: mast.id,
      x: fx(20),
      y: fx(20),
    });
    run(state, ctx, 4);
    const built = state.units.find((u) => u.typeId === mast.id);
    expect(built).toBeDefined();
    expect(state.players[0]!.scrap).toBe(before - mast.costScrap);
    const fp = footprintOf(fx(20), fx(20), mast.radius);
    for (let cy = fp.minCy; cy <= fp.maxCy; cy++) {
      for (let cx = fp.minCx; cx <= fp.maxCx; cx++) {
        expect(isWalkableCell(state.map, cx, cy)).toBe(false);
      }
    }
    // A cell just outside the footprint stays open (the old inflated check
    // would have demanded a wider box).
    expect(isWalkableCell(state.map, fp.minCx - 1, fp.minCy)).toBe(true);
  });

  it("rejects units, terrain, buildings, and unaffordable spots without spending", () => {
    const { state, ctx, worker } = arena();
    const mast = unitTypeByKey("cog_pylon");
    const scrap = state.players[0]!.scrap;
    spawnUnit(state, 0, unitTypeByKey("cog_boltguard").id, fx(24), fx(24));
    const tryPlace = (x: number, y: number) => {
      issueCommand(state, 0, {
        kind: CommandKind.BuildStructure,
        workerId: worker.id,
        unitTypeId: mast.id,
        x,
        y,
      });
      run(state, ctx, 3);
    };
    tryPlace(fx(24), fx(24)); // unit
    setBlocked(state.map, 30, 30, true);
    setBlocked(state.map, 31, 30, true);
    setBlocked(state.map, 30, 31, true);
    setBlocked(state.map, 31, 31, true);
    tryPlace(fx(31), fx(31)); // terrain
    tryPlace(fx(8), fx(8)); // foundry
    state.players[0]!.scrap = 10;
    tryPlace(fx(16), fx(16)); // can't afford
    expect(state.units.some((u) => u.typeId === mast.id)).toBe(false);
    expect(state.players[0]!.scrap).toBe(10);
    expect(scrap).toBeGreaterThan(10);
  });
});

describe("CancelTrain", () => {
  it("refunds Scrap, Aether, and Power and resets progress only for the head item", () => {
    const { state, ctx, foundry } = arena();
    const assembly = spawnUnit(state, 0, unitTypeByKey("cog_assembly").id, fx(20), fx(8));
    const knight = unitTypeByKey("cog_piston_knight");
    const p = state.players[0]!;
    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: assembly.id, unitTypeId: knight.id });
    run(state, ctx, 20);
    expect(assembly.trainQueue).toEqual([knight.id]);
    expect(assembly.trainProgress).toBe(18);
    expect(p.scrap).toBe(2000 - knight.costScrap);
    expect(p.aether).toBe(500 - knight.costAether);
    expect(p.powerUsed).toBe(1 + knight.powerCost); // the worker + the queued knight

    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: assembly.id, unitTypeId: knight.id });
    run(state, ctx, 3);
    expect(assembly.trainQueue).toEqual([knight.id, knight.id]);
    const progressWithTail = assembly.trainProgress;
    expect(progressWithTail).toBe(21);

    // Cancelling the tail leaves the head's progress running.
    issueCommand(state, 0, { kind: CommandKind.CancelTrain, buildingId: assembly.id, queueIndex: 1 });
    run(state, ctx, 3);
    expect(assembly.trainQueue).toEqual([knight.id]);
    expect(assembly.trainProgress).toBe(progressWithTail + 3);
    expect(p.aether).toBe(500 - knight.costAether);

    // Cancelling the head refunds the rest and zeroes progress.
    issueCommand(state, 0, { kind: CommandKind.CancelTrain, buildingId: assembly.id, queueIndex: 0 });
    run(state, ctx, 3);
    expect(assembly.trainQueue).toEqual([]);
    expect(assembly.trainProgress).toBe(0);
    expect(assembly.behavior).toBe(UnitBehavior.Idle);
    expect(p.scrap).toBe(2000);
    expect(p.aether).toBe(500);
    expect(p.powerUsed).toBe(1); // only the living worker
    expect(foundry.trainQueue).toEqual([]);
  });

  it("ignores a bad index, an empty queue, and an enemy building", () => {
    const { state, ctx, foundry } = arena();
    const scrapling = unitTypeByKey("cog_scrapling");
    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: foundry.id, unitTypeId: scrapling.id });
    run(state, ctx, 5);
    const scrap = state.players[0]!.scrap;
    const progress = foundry.trainProgress;
    issueCommand(state, 0, { kind: CommandKind.CancelTrain, buildingId: foundry.id, queueIndex: 4 });
    issueCommand(state, 1, { kind: CommandKind.CancelTrain, buildingId: foundry.id, queueIndex: 0 });
    run(state, ctx, 4);
    expect(foundry.trainQueue).toEqual([scrapling.id]);
    expect(state.players[0]!.scrap).toBe(scrap);
    expect(foundry.trainProgress).toBe(progress + 4);
  });
});

describe("SetRally", () => {
  it("sends the next trainee to the rally and ignores non-production targets", () => {
    const { state, ctx, foundry } = arena();
    const mast = spawnUnit(state, 0, unitTypeByKey("cog_pylon").id, fx(30), fx(30));
    const scrapling = unitTypeByKey("cog_scrapling");
    issueCommand(state, 0, { kind: CommandKind.SetRally, buildingId: mast.id, x: fx(36), y: fx(30) });
    issueCommand(state, 0, { kind: CommandKind.SetRally, buildingId: foundry.id, x: fx(500), y: fx(12) });
    run(state, ctx, 3);
    expect(mast.rallyX).toBe(-1); // pylons train nothing
    expect(foundry.rallyX).toBeLessThan(fx(40)); // clamped onto the map
    expect(foundry.rallyY).toBe(fx(12));
    const rallyX = foundry.rallyX;

    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: foundry.id, unitTypeId: scrapling.id });
    run(state, ctx, scrapling.buildTimeTicks + 4);
    const fresh = state.units.filter((u) => u.typeId === scrapling.id);
    expect(fresh.length).toBe(2); // the starting worker plus the trainee
    const trainee = fresh[fresh.length - 1]!;
    expect(trainee.behavior === UnitBehavior.Moving || trainee.x > fx(10)).toBe(true);
    const bornX = trainee.x;
    run(state, ctx, 40);
    expect(trainee.x).toBeGreaterThan(bornX);
    expect(Math.abs(trainee.x - rallyX)).toBeLessThan(Math.abs(bornX - rallyX));
  });

  it("a building with no rally spawns an idle trainee", () => {
    const { state, ctx, foundry } = arena();
    const scrapling = unitTypeByKey("cog_scrapling");
    expect(foundry.rallyX).toBe(-1);
    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: foundry.id, unitTypeId: scrapling.id });
    run(state, ctx, scrapling.buildTimeTicks + 4);
    const trainee = state.units.filter((u) => u.typeId === scrapling.id).at(-1)!;
    expect(trainee.behavior).toBe(UnitBehavior.Idle);
  });

  it("rally and cancel diverge the hash immediately and replay identically", () => {
    const play = (seed: number): number => {
      const { state, ctx, foundry, worker } = arena(seed);
      issueCommand(state, 0, { kind: CommandKind.SetRally, buildingId: foundry.id, x: fx(30), y: fx(8) });
      issueCommand(state, 0, {
        kind: CommandKind.Train,
        buildingId: foundry.id,
        unitTypeId: unitTypeByKey("cog_scrapling").id,
      });
      run(state, ctx, 8);
      issueCommand(state, 0, { kind: CommandKind.CancelTrain, buildingId: foundry.id, queueIndex: 0 });
      issueCommand(state, 0, {
        kind: CommandKind.BuildStructure,
        workerId: worker.id,
        unitTypeId: unitTypeByKey("cog_pylon").id,
        x: fx(20),
        y: fx(20),
      });
      run(state, ctx, 80);
      return hashState(state);
    };
    const a = play(4);
    const b = play(4);
    expect(b).toBe(a);
    const bare = arena(4);
    expect(hashState(bare.state)).not.toBe(a);

    const left = arena(5);
    const right = arena(5);
    expect(hashState(left.state)).toBe(hashState(right.state));
    issueCommand(left.state, 0, {
      kind: CommandKind.SetRally,
      buildingId: left.foundry.id,
      x: fx(12),
      y: fx(12),
    });
    expect(hashState(left.state)).not.toBe(hashState(right.state));
  });
});
