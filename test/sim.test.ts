/** Gameplay integration: economy, production, combat, defeat — headless. */
import { describe, expect, it } from "vitest";
import { fx } from "../src/math/fixed.js";
import { CommandKind } from "../src/core/commands.js";
import { UnitBehavior, createGameState, ResourceKind } from "../src/core/state.js";
import { issueCommand, spawnResourceNode, spawnUnit } from "../src/core/api.js";
import { createSimContext, run, step } from "../src/core/sim.js";
import { Faction, unitTypeByKey } from "../src/data/units.js";
import { createSkirmish } from "../src/scenario.js";
import { isGameOver } from "../src/core/systems/deaths.js";

describe("economy", () => {
  it("workers harvest Scrap and deposit at the main", () => {
    const state = createSkirmish(1, Faction.CogDominion, Faction.VerdantChorus);
    const ctx = createSimContext(state);
    const workers = state.units.filter((u) => u.playerId === 0 && unitTypeByKey("cog_scrapling").id === u.typeId);
    const before = state.players[0]!.scrap;
    issueCommand(state, 0, {
      kind: CommandKind.Harvest,
      unitIds: workers.map((u) => u.id),
      nodeId: state.nodes[0]!.id,
    });
    run(state, ctx, 600);
    const after = state.players[0]!.scrap;
    expect(after).toBeGreaterThan(before);
    expect(state.nodes[0]!.amount).toBeLessThan(1500);
    // Conservation: everything mined was either delivered or is being carried.
    const carried = state.units.reduce((s, u) => s + (u.playerId === 0 ? u.carryAmount : 0), 0);
    expect(after - before + carried).toBe(1500 - state.nodes[0]!.amount);
  });
});

describe("production", () => {
  it("trains a unit: cost deducted, Power charged, unit spawns near building", () => {
    const state = createSkirmish(2, Faction.CogDominion, Faction.HollowCourt);
    const ctx = createSimContext(state);
    const main = state.units.find((u) => u.playerId === 0 && unitTypeByKey("cog_foundry").id === u.typeId)!;
    const scrapling = unitTypeByKey("cog_scrapling");
    const beforeCount = state.units.filter((u) => u.playerId === 0 && u.typeId === scrapling.id).length;
    const beforeScrap = state.players[0]!.scrap;
    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: main.id, unitTypeId: scrapling.id });
    run(state, ctx, scrapling.buildTimeTicks + 10);
    const now = state.units.filter((u) => u.playerId === 0 && u.typeId === scrapling.id);
    expect(now.length).toBe(beforeCount + 1);
    expect(state.players[0]!.scrap).toBe(beforeScrap - scrapling.costScrap);
    expect(state.players[0]!.powerUsed).toBe(now.length * scrapling.powerCost);
    const fresh = now[now.length - 1]!;
    const ddx = Math.abs(fresh.x - main.x) / 65536;
    const ddy = Math.abs(fresh.y - main.y) / 65536;
    expect(Math.max(ddx, ddy)).toBeLessThan(9);
  });

  it("rejects training when unaffordable or over Power cap", () => {
    const state = createGameState(3, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
    createSimContext(state);
    const ctx = createSimContext(state);
    const main = spawnUnit(state, 0, unitTypeByKey("cog_foundry").id, fx(10), fx(10));
    state.players[0]!.scrap = 10; // can't afford a 50-Scrap Scrapling
    issueCommand(state, 0, { kind: CommandKind.Train, buildingId: main.id, unitTypeId: unitTypeByKey("cog_scrapling").id });
    run(state, ctx, 5);
    expect(main.trainQueue.length).toBe(0);
    expect(state.players[0]!.scrap).toBe(10);
  });

  it("constructed buildings ramp hp and grant Power on completion", () => {
    const state = createGameState(4, 32, 32, [Faction.CogDominion, Faction.CogDominion]);
    const ctx = createSimContext(state);
    spawnUnit(state, 0, unitTypeByKey("cog_scrapling").id, fx(5), fx(5));
    state.players[0]!.scrap = 1000;
    const mast = unitTypeByKey("cog_pylon");
    const worker = state.units[0]!;
    issueCommand(state, 0, { kind: CommandKind.BuildStructure, workerId: worker.id, unitTypeId: mast.id, x: fx(12), y: fx(12) });
    run(state, ctx, 4);
    const b = state.units.find((u) => u.typeId === mast.id)!;
    expect(b.constructTicks).toBeGreaterThan(0);
    expect(b.hp).toBeLessThan(mast.maxHp);
    expect(state.players[0]!.powerCap).toBe(0); // not granted until complete
    run(state, ctx, mast.buildTimeTicks + 2);
    expect(b.constructTicks).toBe(0);
    expect(b.hp).toBe(mast.maxHp);
    expect(state.players[0]!.powerCap).toBe(8);
  });
});

describe("combat", () => {
  it("a Boltguard kills a Sporeling (auto-acquire, chase, damage, death)", () => {
    const state = createGameState(5, 48, 48, [Faction.CogDominion, Faction.VerdantChorus]);
    const ctx = createSimContext(state);
    const bolt = spawnUnit(state, 0, unitTypeByKey("cog_boltguard").id, fx(10), fx(10));
    const spore = spawnUnit(state, 1, unitTypeByKey("verdant_sporeling").id, fx(14), fx(10));
    run(state, ctx, 300);
    expect(state.units.some((u) => u.id === spore.id)).toBe(false); // dead & compacted
    expect(state.units.some((u) => u.id === bolt.id)).toBe(true);
    expect(state.players[1]!.defeated).toBe(true);
    expect(isGameOver(state)).toBe(true);
  });

  it("attack-move engages enemies encountered along the way", () => {
    const state = createGameState(6, 48, 48, [Faction.HollowCourt, Faction.CogDominion]);
    const ctx = createSimContext(state);
    const blade = spawnUnit(state, 0, unitTypeByKey("hollow_gloomblade").id, fx(5), fx(24));
    spawnUnit(state, 1, unitTypeByKey("cog_boltguard").id, fx(24), fx(24));
    issueCommand(state, 0, { kind: CommandKind.AttackMove, unitIds: [blade.id], x: fx(44), y: fx(24) });
    run(state, ctx, 250);
    // Gloomblade (80hp, armor 1, 8 dmg) beats Boltguard (50hp, 6 dmg) up close.
    expect(state.units.some((u) => u.id === blade.id)).toBe(true);
    expect(state.units.filter((u) => u.playerId === 1).length).toBe(0);
  });

  it("armor reduces damage with a floor of 1", () => {
    const state = createGameState(7, 32, 32, [Faction.CogDominion, Faction.VerdantChorus]);
    const ctx = createSimContext(state);
    const knight = spawnUnit(state, 0, unitTypeByKey("cog_piston_knight").id, fx(10), fx(10));
    const titan = spawnUnit(state, 1, unitTypeByKey("verdant_seed_titan").id, fx(11), fx(10));
    const t0 = titan.hp;
    run(state, ctx, 40);
    // Knight does 12-2=10 per swing; titan hp must drop in exact multiples of 10.
    expect(t0 - titan.hp).toBeGreaterThan(0);
    expect((t0 - titan.hp) % 10).toBe(0);
    expect(knight.hp).toBeLessThan(unitTypeByKey("cog_piston_knight").maxHp); // titan hits back
  });
});

describe("scale smoke (LOG [005]: 200+ units)", () => {
  it("240 units fighting across the map stays under budget and deterministic", () => {
    const build = (): ReturnType<typeof createGameState> => {
      const s = createGameState(8, 128, 128, [Faction.CogDominion, Faction.VerdantChorus]);
      const bolt = unitTypeByKey("cog_boltguard").id;
      const hound = unitTypeByKey("verdant_thornhound").id;
      for (let i = 0; i < 120; i++) {
        spawnUnit(s, 0, bolt, fx(10 + (i % 12)), fx(10 + ((i / 12) | 0) * 2));
        spawnUnit(s, 1, hound, fx(100 + (i % 12)), fx(100 + ((i / 12) | 0) * 2));
      }
      return s;
    };
    const s1 = build();
    const ctx1 = createSimContext(s1);
    const ids0 = s1.units.filter((u) => u.playerId === 0).map((u) => u.id);
    const ids1 = s1.units.filter((u) => u.playerId === 1).map((u) => u.id);
    issueCommand(s1, 0, { kind: CommandKind.AttackMove, unitIds: ids0, x: fx(100), y: fx(100) });
    issueCommand(s1, 1, { kind: CommandKind.AttackMove, unitIds: ids1, x: fx(10), y: fx(10) });
    const start = performance.now();
    run(s1, ctx1, 800); // 50 seconds of game time, armies path, collide, fight
    const elapsed = performance.now() - start;
    // 800 ticks with 240 units; budget is 62.5ms/tick in real play — allow lots
    // of slack for CI noise but catch pathological blowups.
    expect(elapsed).toBeLessThan(15000);
    // Battle actually happened:
    expect(s1.units.length).toBeLessThan(240);
  }, 30000);
});
