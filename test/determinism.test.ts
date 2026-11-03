/**
 * The lockstep contract (LOG [003]/[006]): identical seed + identical commands
 * ⇒ bit-identical state hash on every tick, regardless of scratch reuse.
 * Different seeds must diverge once randomness matters.
 */
import { describe, expect, it } from "vitest";
import { fx } from "../src/math/fixed.js";
import { CommandKind } from "../src/core/commands.js";
import { GameState, createGameState, hashState } from "../src/core/state.js";
import { issueCommand, spawnUnit } from "../src/core/api.js";
import { SimContext, createSimContext, step } from "../src/core/sim.js";
import { Faction, unitType, unitTypeByKey } from "../src/data/units.js";
import { createSkirmish } from "../src/scenario.js";
import { prngNext, prngSeed } from "../src/math/prng.js";

/** A scripted, eventful 1200-tick match: harvest, train, attack-move, fight. */
function playMatch(seed: number, hashEvery: number): number[] {
  const state = createSkirmish(seed, Faction.CogDominion, Faction.HollowCourt);
  const ctx = createSimContext(state);
  const hashes: number[] = [];
  driveAndRecord(state, ctx, hashEvery, hashes);
  return hashes;
}

function driveAndRecord(state: GameState, ctx: SimContext, hashEvery: number, hashes: number[]): void {
  // Send both players' workers to harvest, queue production, then attack —
  // faction-agnostic so the same driver works for any skirmish.
  const workersOf = (pid: number): number[] =>
    state.units.filter((u) => u.playerId === pid && unitType(u.typeId).isWorker).map((u) => u.id);
  const mainOf = (pid: number) =>
    state.units.find((u) => u.playerId === pid && unitType(u.typeId).isBuilding)!;
  const p0Workers = workersOf(0);
  const p1Workers = workersOf(1);
  issueCommand(state, 0, { kind: CommandKind.Harvest, unitIds: p0Workers, nodeId: state.nodes[0]!.id });
  issueCommand(state, 1, { kind: CommandKind.Harvest, unitIds: p1Workers, nodeId: state.nodes[5]!.id });

  const p0Main = mainOf(0);
  const p1Main = mainOf(1);
  const p0WorkerType = unitType(state.units.find((u) => u.id === p0Workers[0])!.typeId);
  const p1WorkerType = unitType(state.units.find((u) => u.id === p1Workers[0])!.typeId);

  for (let t = 0; t < 1200; t++) {
    // Scripted "AI": keep worker production flowing and poke the enemy.
    if (t === 10) {
      issueCommand(state, 0, { kind: CommandKind.Train, buildingId: p0Main.id, unitTypeId: p0WorkerType.id });
      issueCommand(state, 1, { kind: CommandKind.Train, buildingId: p1Main.id, unitTypeId: p1WorkerType.id });
    }
    if (t === 400) {
      // March two workers from each side at the enemy main — guarantees combat.
      issueCommand(state, 0, { kind: CommandKind.AttackMove, unitIds: p0Workers.slice(0, 2), x: fx(54), y: fx(54) });
      issueCommand(state, 1, { kind: CommandKind.AttackMove, unitIds: p1Workers.slice(0, 2), x: fx(10), y: fx(10) });
    }
    step(state, ctx);
    if (state.tick % hashEvery === 0) hashes.push(hashState(state));
  }
}

describe("lockstep determinism", () => {
  it("same seed + same commands ⇒ identical hashes at every checkpoint", () => {
    const a = playMatch(1234, 50);
    const b = playMatch(1234, 50);
    expect(a.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
  });

  it("scratch reuse does not leak state between matches", () => {
    // Run one match to dirty a context, then replay the reference seed on a
    // fresh state but the SAME context — must match a fresh-context run.
    const ref = playMatch(777, 50);
    const dirtyState = createSkirmish(31337, Faction.VerdantChorus, Faction.CogDominion);
    const ctx = createSimContext(dirtyState);
    const junk: number[] = [];
    driveAndRecord(dirtyState, ctx, 50, junk);

    const state2 = createSkirmish(777, Faction.CogDominion, Faction.HollowCourt);
    const reused: number[] = [];
    driveAndRecord(state2, ctx, 50, reused);
    expect(reused).toEqual(ref);
  });

  it("different seeds diverge in hash; PRNG consumption is deterministic", () => {
    // The PRNG's only gameplay consumer today is the stacked-unit separation
    // nudge (VERIFY [009] finding 6), which this scripted match may or may not
    // trigger — so this asserts hash divergence (prng lanes are hashed) plus
    // that a direct PRNG-consuming path is reproducible, not that seeds alter
    // unit positions in every match.
    const a = playMatch(1, 400);
    const b = playMatch(2, 400);
    expect(a).not.toEqual(b);
  });

  it("stacked units resolve via the seeded PRNG, reproducibly", () => {
    const build = (seed: number): number => {
      const s = createGameState(seed, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
      const ctx = createSimContext(s);
      const bolt = unitTypeByKey("cog_boltguard").id;
      // Two units at the exact same position force the d === 0 nudge path.
      spawnUnit(s, 0, bolt, fx(10), fx(10));
      spawnUnit(s, 0, bolt, fx(10), fx(10));
      for (let i = 0; i < 20; i++) step(s, ctx);
      const [u1, u2] = s.units;
      expect(u1!.x !== u2!.x || u1!.y !== u2!.y).toBe(true); // nudge happened
      return hashState(s);
    };
    expect(build(11)).toBe(build(11)); // reproducible
    // Different seeds may pick different nudge directions; we don't assert
    // divergence here (4 directions can collide) — reproducibility is the contract.
  });

  it("PRNG streams are reproducible and seed-sensitive", () => {
    const s1 = prngSeed(5);
    const s2 = prngSeed(5);
    const s3 = prngSeed(6);
    const seq1 = Array.from({ length: 100 }, () => prngNext(s1));
    const seq2 = Array.from({ length: 100 }, () => prngNext(s2));
    const seq3 = Array.from({ length: 100 }, () => prngNext(s3));
    expect(seq2).toEqual(seq1);
    expect(seq3).not.toEqual(seq1);
  });
});
