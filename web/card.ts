/**
 * What the command card shows for the current selection. Pure read of
 * GameState — issuing the action happens in InputController via issueCommand.
 */
import { GameState, Unit, getUnit } from "../src/core/state.js";
import { Faction, UnitType, unitType, unitTypeByKey, UNIT_TYPES } from "../src/data/units.js";

export const COMMAND_HOTKEYS = ["q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"] as const;

export interface CardAction {
  mode: "train" | "build";
  typeId: number;
  hotkey: string;
  name: string;
  costScrap: number;
  costAether: number;
  powerCost: number;
}

export interface CardModel {
  mode: "train" | "build" | "info" | "none";
  title: string;
  subtitle: string;
  actions: CardAction[];
  primaryId: number;
  /** Same-type production buildings that a train click applies to. */
  trainBuildingIds: number[];
  workerId: number;
  queueBuildingId: number;
  hp: number;
  maxHp: number;
  constructing: boolean;
  constructPct: number;
  rallySet: boolean;
  faction: Faction;
}

const EMPTY: CardModel = {
  mode: "none",
  title: "",
  subtitle: "",
  actions: [],
  primaryId: -1,
  trainBuildingIds: [],
  workerId: -1,
  queueBuildingId: -1,
  hp: 0,
  maxHp: 1,
  constructing: false,
  constructPct: 0,
  rallySet: false,
  faction: Faction.CogDominion,
};

function actionOf(mode: "train" | "build", t: UnitType, index: number): CardAction {
  return {
    mode,
    typeId: t.id,
    hotkey: COMMAND_HOTKEYS[index] ?? "?",
    name: t.name,
    costScrap: t.costScrap,
    costAether: t.costAether,
    powerCost: t.powerCost,
  };
}

export function factionStructures(faction: number): UnitType[] {
  const out: UnitType[] = [];
  for (const t of UNIT_TYPES) {
    if (t.isBuilding && t.faction === faction) out.push(t);
  }
  return out;
}

/** Last living selected unit wins, matching "current selection". */
export function deriveCard(state: GameState, playerId: number, orderedIds: readonly number[]): CardModel {
  const selected: Unit[] = [];
  for (const id of orderedIds) {
    const u = getUnit(state, id);
    if (u && u.hp > 0 && u.playerId === playerId) selected.push(u);
  }
  if (selected.length === 0) return EMPTY;

  const primary = selected[selected.length - 1]!;
  const t = unitType(primary.typeId);
  const sameType = selected.every((u) => u.typeId === primary.typeId);
  const title = sameType && selected.length > 1 ? `${t.name} × ${selected.length}` : t.name;
  const constructPct =
    t.buildTimeTicks > 0 && primary.constructTicks > 0
      ? Math.floor((1 - primary.constructTicks / t.buildTimeTicks) * 100)
      : 100;
  const hpLine = primary.constructTicks > 0 ? `Constructing ${constructPct}%` : `${primary.hp} / ${t.maxHp}`;

  const base = {
    title,
    primaryId: primary.id,
    trainBuildingIds: [] as number[],
    workerId: -1,
    queueBuildingId: -1,
    hp: primary.hp,
    maxHp: t.maxHp,
    constructing: primary.constructTicks > 0,
    constructPct,
    rallySet: primary.rallyX >= 0 && primary.rallyY >= 0,
    faction: t.faction,
  };

  if (t.isBuilding && t.trains.length > 0) {
    const ids = [];
    for (const u of selected) if (u.typeId === primary.typeId) ids.push(u.id);
    const actions = t.trains.map((key, i) => actionOf("train", unitTypeByKey(key), i));
    const rally = base.rallySet ? "Rally set — right-click to move it" : "Right-click the map to set a rally";
    return {
      ...base,
      mode: "train",
      subtitle: `${hpLine} · ${rally}`,
      actions,
      trainBuildingIds: ids,
      queueBuildingId: primary.id,
    };
  }

  if (t.isWorker) {
    const actions = factionStructures(t.faction).map((s, i) => actionOf("build", s, i));
    return {
      ...base,
      mode: "build",
      subtitle: `${hpLine} · Hotkey, then click to place. Shift queues placements`,
      actions,
      workerId: primary.id,
    };
  }

  return {
    ...base,
    mode: "info",
    subtitle: `${hpLine} · Right-click to move or attack · A then click to attack-move`,
    actions: [],
  };
}
