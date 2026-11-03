/**
 * Regression tests for VERIFY [009] findings — each of these reproduced a
 * confirmed defect before the fix.
 */
import { describe, expect, it } from "vitest";
import { fx } from "../src/math/fixed.js";
import { CommandKind } from "../src/core/commands.js";
import { UnitBehavior, createGameState } from "../src/core/state.js";
import { issueCommand, spawnUnit } from "../src/core/api.js";
import { createSimContext, run } from "../src/core/sim.js";
import { Faction, unitTypeByKey } from "../src/data/units.js";
import { setBlocked } from "../src/core/map.js";

describe("VERIFY [009] finding 1 — unreachable-goal repath storm", () => {
  it("units with unreachable targets back off instead of flooding A* every tick", () => {
    const state = createGameState(1, 96, 96, [Faction.CogDominion, Faction.VerdantChorus]);
    const ctx = createSimContext(state);
    // Wall off a target in a sealed 3x3 chamber.
    for (let d = 0; d < 5; d++) {
      setBlocked(state.map, 45 + d, 45, true);
      setBlocked(state.map, 45 + d, 49, true);
      setBlocked(state.map, 45, 45 + d, true);
      setBlocked(state.map, 49, 45 + d, true);
    }
    const victim = spawnUnit(state, 1, unitTypeByKey("verdant_sporeling").id, fx(47), fx(47));
    const attackers: number[] = [];
    for (let i = 0; i < 100; i++) {
      const u = spawnUnit(state, 0, unitTypeByKey("cog_boltguard").id, fx(5 + (i % 20)), fx(5 + ((i / 20) | 0)));
      attackers.push(u.id);
    }
    issueCommand(state, 0, { kind: CommandKind.Attack, unitIds: attackers, targetId: victim.id });
    const start = performance.now();
    run(state, ctx, 100);
    const msPerTick = (performance.now() - start) / 100;
    // Pre-fix this measured ~337 ms/tick; the backoff caps A* attempts at one
    // per unit per REPATH_BACKOFF_TICKS. Generous bound for CI noise.
    expect(msPerTick).toBeLessThan(30);
    // Attackers keep their intent (they retry, just not every tick).
    const stillTrying = state.units.filter((u) => u.playerId === 0 && u.behavior === UnitBehavior.Attacking);
    expect(stillTrying.length).toBeGreaterThan(0);
  }, 20000);
});

describe("VERIFY [009] finding 3 — separation vs older buildings", () => {
  it("a unit spawned inside a LOWER-indexed building gets pushed out", () => {
    const state = createGameState(2, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
    const ctx = createSimContext(state);
    const foundry = spawnUnit(state, 0, unitTypeByKey("cog_foundry").id, fx(10), fx(10)); // index 0
    const worker = spawnUnit(state, 0, unitTypeByKey("cog_scrapling").id, (fx(10) + 60000) | 0, fx(10)); // overlapping, index 1
    run(state, ctx, 30);
    const dx = Math.abs(worker.x - foundry.x);
    const dy = Math.abs(worker.y - foundry.y);
    // Foundry radius 2.0 + worker radius 0.35: separated when clear of overlap.
    expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(fx(2));
  });
});

describe("VERIFY [009] finding 4 — command payload sanitization", () => {
  it("fractional / out-of-range command coords cannot poison int32 state", () => {
    const state = createGameState(3, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
    const ctx = createSimContext(state);
    const u = spawnUnit(state, 0, unitTypeByKey("cog_boltguard").id, fx(5), fx(5));
    issueCommand(state, 0, { kind: CommandKind.Move, unitIds: [u.id], x: fx(6) + 0.5, y: fx(90) + 0.25 });
    run(state, ctx, 200);
    for (const unit of state.units) {
      expect(unit.x).toBe(unit.x | 0);
      expect(unit.y).toBe(unit.y | 0);
      // Clamped onto the 32x32 map:
      expect(unit.x).toBeGreaterThanOrEqual(0);
      expect(unit.x).toBeLessThan(fx(32));
      expect(unit.y).toBeLessThan(fx(32));
    }
  });

  it("an out-of-range unitTypeId is dropped instead of crashing the sim", () => {
    const state = createGameState(4, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
    const ctx = createSimContext(state);
    const main = spawnUnit(state, 0, unitTypeByKey("cog_foundry").id, fx(10), fx(10));
    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: main.id, unitTypeId: 9999 });
    expect(() => run(state, ctx, 10)).not.toThrow();
    expect(main.trainQueue.length).toBe(0);
  });
});

describe("VERIFY [009] finding 2 — hash covers intent state", () => {
  it("trainQueue and pending-command divergences change the hash immediately", async () => {
    const { hashState } = await import("../src/core/state.js");
    const mk = () => {
      const s = createGameState(5, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
      spawnUnit(s, 0, unitTypeByKey("cog_foundry").id, fx(10), fx(10));
      return s;
    };
    const a = mk();
    const b = mk();
    expect(hashState(a)).toBe(hashState(b));
    b.units[0]!.trainQueue.push(unitTypeByKey("cog_scrapling").id);
    expect(hashState(a)).not.toBe(hashState(b));

    const c = mk();
    const d = mk();
    issueCommand(d, 0, { kind: CommandKind.Stop, unitIds: [1] });
    expect(hashState(c)).not.toBe(hashState(d));
  });
});
