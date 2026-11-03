/**
 * Unit/building data for the three factions (LOG [001]). All original characters.
 * Every rate is authored in ticks or Q16.16-per-tick; fxFromFloat runs on
 * constants at module load, never on sim state (LOG [003]).
 */
import { Fx, fx, fxFromFloat } from "../math/fixed.js";

export enum Faction {
  CogDominion = 0,
  VerdantChorus = 1,
  HollowCourt = 2,
}

export const FACTION_NAMES = ["Cog Dominion", "Verdant Chorus", "Hollow Court"] as const;

export interface UnitType {
  /** Index into UNIT_TYPES — assigned at registration. */
  id: number;
  key: string;
  name: string;
  faction: Faction;
  maxHp: number;
  armor: number;
  /** 0 damage = cannot attack. */
  damage: number;
  attackRange: Fx;
  attackCooldownTicks: number;
  /** World units per tick (16 ticks/s). */
  speed: Fx;
  radius: Fx;
  sightRange: Fx;
  costScrap: number;
  costAether: number;
  buildTimeTicks: number;
  /** Negative = provides supply ("Power"). */
  powerCost: number;
  isBuilding: boolean;
  isWorker: boolean;
  /** Keys of unit types this building can train. */
  trains: readonly string[];
}

const REGISTRY: UnitType[] = [];
const BY_KEY = new Map<string, UnitType>();

type UnitSpec = Omit<UnitType, "id">;

function def(spec: UnitSpec): UnitType {
  const t: UnitType = { ...spec, id: REGISTRY.length };
  REGISTRY.push(t);
  BY_KEY.set(t.key, t);
  return t;
}

const secs = (s: number): number => Math.round(s * 16); // authoring helper, constants only
const perSec = (u: number): Fx => fxFromFloat(u / 16); // world units/sec → per tick

// ---------------------------------------------------------------- Cog Dominion
def({
  key: "cog_foundry", name: "Grand Foundry", faction: Faction.CogDominion,
  maxHp: 1500, armor: 2, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(2.0), sightRange: fx(9),
  costScrap: 400, costAether: 0, buildTimeTicks: secs(70), powerCost: -10,
  isBuilding: true, isWorker: false, trains: ["cog_scrapling"],
});
def({
  key: "cog_assembly", name: "Assembly Line", faction: Faction.CogDominion,
  maxHp: 1000, armor: 1, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(1.5), sightRange: fx(8),
  costScrap: 150, costAether: 0, buildTimeTicks: secs(50), powerCost: 0,
  isBuilding: true, isWorker: false, trains: ["cog_boltguard", "cog_piston_knight", "cog_forge_crawler"],
});
def({
  key: "cog_pylon", name: "Dynamo Mast", faction: Faction.CogDominion,
  maxHp: 400, armor: 0, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(1.0), sightRange: fx(8),
  costScrap: 100, costAether: 0, buildTimeTicks: secs(25), powerCost: -8,
  isBuilding: true, isWorker: false, trains: [],
});
def({
  key: "cog_scrapling", name: "Scrapling", faction: Faction.CogDominion,
  maxHp: 45, armor: 0, damage: 5, attackRange: fxFromFloat(0.4), attackCooldownTicks: secs(1.2),
  speed: perSec(2.8), radius: fxFromFloat(0.35), sightRange: fx(7),
  costScrap: 50, costAether: 0, buildTimeTicks: secs(12), powerCost: 1,
  isBuilding: false, isWorker: true, trains: [],
});
def({
  key: "cog_boltguard", name: "Boltguard", faction: Faction.CogDominion,
  maxHp: 50, armor: 0, damage: 6, attackRange: fx(5), attackCooldownTicks: secs(0.6),
  speed: perSec(2.5), radius: fxFromFloat(0.4), sightRange: fx(8),
  costScrap: 50, costAether: 0, buildTimeTicks: secs(18), powerCost: 1,
  isBuilding: false, isWorker: false, trains: [],
});
def({
  key: "cog_piston_knight", name: "Piston Knight", faction: Faction.CogDominion,
  maxHp: 130, armor: 1, damage: 12, attackRange: fxFromFloat(0.5), attackCooldownTicks: secs(1.0),
  speed: perSec(2.9), radius: fxFromFloat(0.5), sightRange: fx(7),
  costScrap: 100, costAether: 25, buildTimeTicks: secs(24), powerCost: 2,
  isBuilding: false, isWorker: false, trains: [],
});
def({
  key: "cog_forge_crawler", name: "Forge Crawler", faction: Faction.CogDominion,
  maxHp: 160, armor: 1, damage: 30, attackRange: fx(7), attackCooldownTicks: secs(2.0),
  speed: perSec(2.2), radius: fxFromFloat(0.75), sightRange: fx(9),
  costScrap: 150, costAether: 125, buildTimeTicks: secs(32), powerCost: 3,
  isBuilding: false, isWorker: false, trains: [],
});

// -------------------------------------------------------------- Verdant Chorus
def({
  key: "verdant_heartroot", name: "Heartroot", faction: Faction.VerdantChorus,
  maxHp: 1400, armor: 1, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(2.0), sightRange: fx(9),
  costScrap: 350, costAether: 0, buildTimeTicks: secs(65), powerCost: -10,
  isBuilding: true, isWorker: false, trains: ["verdant_sporeling", "verdant_thornhound", "verdant_bramblefiend", "verdant_seed_titan"],
});
def({
  key: "verdant_bloom", name: "Choir Bloom", faction: Faction.VerdantChorus,
  maxHp: 300, armor: 0, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(1.0), sightRange: fx(8),
  costScrap: 90, costAether: 0, buildTimeTicks: secs(20), powerCost: -8,
  isBuilding: true, isWorker: false, trains: [],
});
def({
  key: "verdant_sporeling", name: "Sporeling", faction: Faction.VerdantChorus,
  maxHp: 40, armor: 0, damage: 5, attackRange: fxFromFloat(0.4), attackCooldownTicks: secs(1.2),
  speed: perSec(2.9), radius: fxFromFloat(0.3), sightRange: fx(7),
  costScrap: 50, costAether: 0, buildTimeTicks: secs(11), powerCost: 1,
  isBuilding: false, isWorker: true, trains: [],
});
def({
  key: "verdant_thornhound", name: "Thornhound", faction: Faction.VerdantChorus,
  maxHp: 35, armor: 0, damage: 5, attackRange: fxFromFloat(0.3), attackCooldownTicks: secs(0.55),
  speed: perSec(3.6), radius: fxFromFloat(0.35), sightRange: fx(6),
  costScrap: 25, costAether: 0, buildTimeTicks: secs(15), powerCost: 1,
  isBuilding: false, isWorker: false, trains: [],
});
def({
  key: "verdant_bramblefiend", name: "Bramblefiend", faction: Faction.VerdantChorus,
  maxHp: 90, armor: 0, damage: 9, attackRange: fx(4), attackCooldownTicks: secs(0.9),
  speed: perSec(2.6), radius: fxFromFloat(0.45), sightRange: fx(7),
  costScrap: 60, costAether: 30, buildTimeTicks: secs(20), powerCost: 1,
  isBuilding: false, isWorker: false, trains: [],
});
def({
  key: "verdant_seed_titan", name: "Seed Titan", faction: Faction.VerdantChorus,
  maxHp: 320, armor: 2, damage: 22, attackRange: fxFromFloat(0.8), attackCooldownTicks: secs(1.4),
  speed: perSec(2.1), radius: fxFromFloat(0.9), sightRange: fx(8),
  costScrap: 200, costAether: 150, buildTimeTicks: secs(40), powerCost: 4,
  isBuilding: false, isWorker: false, trains: [],
});

// ---------------------------------------------------------------- Hollow Court
def({
  key: "hollow_spire", name: "Vault of Echoes", faction: Faction.HollowCourt,
  maxHp: 1300, armor: 2, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(2.0), sightRange: fx(9),
  costScrap: 400, costAether: 0, buildTimeTicks: secs(75), powerCost: -10,
  isBuilding: true, isWorker: false, trains: ["hollow_wisp"],
});
def({
  key: "hollow_gate", name: "Umbral Gate", faction: Faction.HollowCourt,
  maxHp: 900, armor: 1, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(1.5), sightRange: fx(8),
  costScrap: 150, costAether: 0, buildTimeTicks: secs(55), powerCost: 0,
  isBuilding: true, isWorker: false, trains: ["hollow_gloomblade", "hollow_echo_sentinel", "hollow_umbral_colossus"],
});
def({
  key: "hollow_beacon", name: "Pale Beacon", faction: Faction.HollowCourt,
  maxHp: 350, armor: 0, damage: 0, attackRange: 0, attackCooldownTicks: 0,
  speed: 0, radius: fxFromFloat(1.0), sightRange: fx(9),
  costScrap: 100, costAether: 0, buildTimeTicks: secs(22), powerCost: -8,
  isBuilding: true, isWorker: false, trains: [],
});
def({
  key: "hollow_wisp", name: "Wisp", faction: Faction.HollowCourt,
  maxHp: 40, armor: 0, damage: 4, attackRange: fxFromFloat(0.5), attackCooldownTicks: secs(1.2),
  speed: perSec(2.8), radius: fxFromFloat(0.3), sightRange: fx(8),
  costScrap: 50, costAether: 0, buildTimeTicks: secs(13), powerCost: 1,
  isBuilding: false, isWorker: true, trains: [],
});
def({
  key: "hollow_gloomblade", name: "Gloomblade", faction: Faction.HollowCourt,
  maxHp: 80, armor: 1, damage: 8, attackRange: fxFromFloat(0.4), attackCooldownTicks: secs(0.8),
  speed: perSec(2.7), radius: fxFromFloat(0.4), sightRange: fx(8),
  costScrap: 100, costAether: 0, buildTimeTicks: secs(24), powerCost: 2,
  isBuilding: false, isWorker: false, trains: [],
});
def({
  key: "hollow_echo_sentinel", name: "Echo Sentinel", faction: Faction.HollowCourt,
  maxHp: 110, armor: 1, damage: 14, attackRange: fx(6), attackCooldownTicks: secs(1.1),
  speed: perSec(2.4), radius: fxFromFloat(0.5), sightRange: fx(9),
  costScrap: 125, costAether: 50, buildTimeTicks: secs(28), powerCost: 2,
  isBuilding: false, isWorker: false, trains: [],
});
def({
  key: "hollow_umbral_colossus", name: "Umbral Colossus", faction: Faction.HollowCourt,
  maxHp: 300, armor: 2, damage: 26, attackRange: fx(6), attackCooldownTicks: secs(1.8),
  speed: perSec(2.0), radius: fxFromFloat(1.0), sightRange: fx(10),
  costScrap: 250, costAether: 200, buildTimeTicks: secs(45), powerCost: 5,
  isBuilding: false, isWorker: false, trains: [],
});

export const UNIT_TYPES: readonly UnitType[] = REGISTRY;

export function unitType(id: number): UnitType {
  const t = REGISTRY[id];
  if (!t) throw new Error(`unknown unit type id ${id}`);
  return t;
}

export function unitTypeByKey(key: string): UnitType {
  const t = BY_KEY.get(key);
  if (!t) throw new Error(`unknown unit type key ${key}`);
  return t;
}
