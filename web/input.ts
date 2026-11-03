/**
 * Selection, orders, and macro. Screen coords convert back into fixed-point
 * grid space here. Every order flows through issueCommand's sanitized latency
 * queue — the UI has no side door into sim state (LOG [010], [012]).
 */
import { Container, Graphics } from "pixi.js";
import { GameState, Unit, getUnit } from "../src/core/state.js";
import { CommandKind } from "../src/core/commands.js";
import { issueCommand } from "../src/core/api.js";
import { unitType, UNIT_TYPES } from "../src/data/units.js";
import { fx, FX_ONE } from "../src/math/fixed.js";
import { worldToCellX, worldToCellY } from "../src/core/map.js";
import { PlacementReject } from "../src/core/placement.js";
import { pxToFxClamped, screenToWorldPx } from "./coords.js";
import { Camera } from "./camera.js";
import { CardModel, deriveCard } from "./card.js";
import { GhostView, effectiveQueueLength, ghostAt, spendable } from "./predict.js";

export type AlertKind = "scrap" | "aether" | "power" | "info" | "";

const PAN_KEYS = new Set(["w", "a", "s", "d"]);

export class InputController {
  readonly selection = new Set<number>();
  /** The human player. The HUD reads this; it is not a sim mutation. */
  readonly human: number;
  ghost: GhostView | null = null;
  alert = "";
  alertKind: AlertKind = "";

  private readonly state: GameState;
  private readonly world: Container;
  private readonly canvas: HTMLCanvasElement;
  private readonly box: Graphics;
  private readonly order: number[] = [];
  private readonly groups = new Map<number, number[]>();
  private placement: { workerId: number; typeId: number } | null = null;
  private dragStartX = -1;
  private dragStartY = -1;
  private dragging = false;
  private attackMoveArmed = false;
  private lastSX = 0;
  private lastSY = 0;
  private alertUntil = 0;

  constructor(
    state: GameState,
    playerId: number,
    world: Container,
    overlay: Container,
    canvas: HTMLCanvasElement,
  ) {
    this.state = state;
    this.human = playerId;
    this.world = world;
    this.canvas = canvas;
    this.box = new Graphics();
    overlay.addChild(this.box);
    this.lastSX = window.innerWidth / 2;
    this.lastSY = window.innerHeight / 2;

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e.clientX, e.clientY));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
  }

  get placingTypeId(): number {
    return this.placement ? this.placement.typeId : -1;
  }

  card(): CardModel {
    return deriveCard(this.state, this.human, this.order);
  }

  isAlertLive(): boolean {
    return this.alert !== "" && performance.now() < this.alertUntil;
  }

  /** Command-card letters that would otherwise pan the camera. */
  syncPan(camera: Camera): void {
    camera.panSuppressed.clear();
    for (const action of this.card().actions) {
      if (PAN_KEYS.has(action.hotkey)) camera.panSuppressed.add(action.hotkey);
    }
  }

  /** Selection can go stale as units die — prune it each frame. */
  prune(): void {
    if (this.selection.size === 0 && !this.placement) return;
    const alive = new Set<number>();
    for (const u of this.state.units) alive.add(u.id);
    for (const id of this.selection) {
      if (!alive.has(id)) this.selection.delete(id);
    }
    if (this.order.length !== this.selection.size) {
      const next = this.order.filter((id) => this.selection.has(id));
      this.order.length = 0;
      for (const id of next) this.order.push(id);
    }
    this.dropPlacementIfStale();
  }

  train(typeId: number): void {
    const card = this.card();
    if (card.mode !== "train") return;
    const spec = card.actions.find((a) => a.mode === "train" && a.typeId === typeId);
    const ut = UNIT_TYPES[typeId];
    if (!spec || !ut) return;

    let fail: { text: string; kind: AlertKind } | null = null;
    let issued = 0;
    for (const buildingId of card.trainBuildingIds) {
      const b = getUnit(this.state, buildingId);
      if (!b || b.hp <= 0) continue;
      const funds = spendable(this.state, this.human);
      const queued = effectiveQueueLength(this.state, this.human, b.id, b.trainQueue.length);
      if (b.constructTicks > 0) {
        fail = { text: "Still constructing", kind: "info" };
        continue;
      }
      if (queued >= 5) {
        fail = { text: "Queue is full", kind: "info" };
        continue;
      }
      if (funds.scrap < ut.costScrap) {
        fail = { text: "Not enough Scrap", kind: "scrap" };
        break;
      }
      if (funds.aether < ut.costAether) {
        fail = { text: "Not enough Aether", kind: "aether" };
        break;
      }
      if (ut.powerCost > 0 && funds.powerUsed + ut.powerCost > funds.powerCap) {
        fail = { text: "Not enough Power", kind: "power" };
        break;
      }
      issueCommand(this.state, this.human, { kind: CommandKind.Train, buildingId: b.id, unitTypeId: typeId });
      issued++;
    }
    if (fail && (issued === 0 || fail.kind !== "info")) this.flash(fail.text, fail.kind);
  }

  cancelTrain(queueIndex: number): void {
    const card = this.card();
    if (card.queueBuildingId < 0) return;
    const b = getUnit(this.state, card.queueBuildingId);
    if (!b || queueIndex < 0 || queueIndex >= b.trainQueue.length) return;
    issueCommand(this.state, this.human, {
      kind: CommandKind.CancelTrain,
      buildingId: b.id,
      queueIndex,
    });
  }

  beginPlace(typeId: number): void {
    const card = this.card();
    if (card.mode !== "build" || card.workerId < 0) return;
    const spec = card.actions.find((a) => a.mode === "build" && a.typeId === typeId);
    if (!spec) return;
    this.attackMoveArmed = false;
    this.placement = { workerId: card.workerId, typeId };
    this.canvas.style.cursor = "crosshair";
    this.refreshGhost(this.lastSX, this.lastSY);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 0) {
      if (this.placement) {
        this.confirmPlacement(e.shiftKey);
        return;
      }
      if (this.attackMoveArmed) {
        this.attackMoveArmed = false;
        this.dispatchAttackMove(e.clientX, e.clientY);
        return;
      }
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragging = true;
    } else if (e.button === 2) {
      if (this.placement) {
        this.clearPlacement();
        return;
      }
      this.dispatchContextCommand(e.clientX, e.clientY);
    }
  }

  private onPointerMove(sx: number, sy: number): void {
    this.lastSX = sx;
    this.lastSY = sy;
    if (this.dragging) this.drawBox(sx, sy);
    if (this.placement) this.refreshGhost(sx, sy);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 0 && this.dragging) {
      this.dragging = false;
      this.box.clear();
      this.finishSelection(e.clientX, e.clientY, e.shiftKey);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (this.placement) {
        this.clearPlacement();
        return;
      }
      this.attackMoveArmed = false;
      this.selection.clear();
      this.order.length = 0;
      return;
    }

    if (/^[1-9]$/.test(k) && !e.repeat) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, [...this.order]);
        this.flash(this.order.length ? `Group ${n} set` : `Group ${n} cleared`, "info");
        return;
      }
      if (!e.altKey) {
        this.recallGroup(n);
        return;
      }
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const hot = this.card().actions.find((a) => a.hotkey === k);
    if (hot) {
      e.preventDefault();
      if (e.repeat && hot.mode !== "train") return;
      if (hot.mode === "train") this.train(hot.typeId);
      else this.beginPlace(hot.typeId);
      return;
    }

    if (e.repeat) return;
    // A pans the camera too. Only arm attack-move when a mobile unit is
    // selected, so a building's next click still selects instead of no-opping.
    if (k === "a" && this.hasMobileSelected()) this.attackMoveArmed = true;
  }

  private hasMobileSelected(): boolean {
    for (const id of this.order) {
      const u = getUnit(this.state, id);
      if (u && u.hp > 0 && !unitType(u.typeId).isBuilding) return true;
    }
    return false;
  }

  private recallGroup(n: number): void {
    const ids = this.groups.get(n);
    if (!ids) return;
    const keep: number[] = [];
    for (const id of ids) {
      const u = getUnit(this.state, id);
      if (u && u.hp > 0 && u.playerId === this.human) keep.push(id);
    }
    this.replaceSelection(keep);
    if (keep.length === 0) this.flash(`Group ${n} empty`, "info");
  }

  private confirmPlacement(shift: boolean): void {
    if (!this.placement) return;
    this.refreshGhost(this.lastSX, this.lastSY);
    const ghost = this.ghost;
    const t = UNIT_TYPES[this.placement.typeId];
    if (!ghost || !t) return;
    if (ghost.reason !== PlacementReject.Ok) {
      const funds = spendable(this.state, this.human);
      if (ghost.reason === PlacementReject.Unaffordable) {
        if (funds.aether < t.costAether && funds.scrap >= t.costScrap) this.flash("Not enough Aether", "aether");
        else this.flash("Not enough Scrap", "scrap");
      } else if (ghost.reason === PlacementReject.BlockedTerrain) {
        this.flash("Can't build on blocked terrain", "info");
      } else if (ghost.reason === PlacementReject.BlockedBuilding) {
        this.flash("Can't build on a building", "info");
      } else if (ghost.reason === PlacementReject.BlockedUnit) {
        this.flash("Can't build on a unit", "info");
      } else {
        this.flash("Can't build there", "info");
      }
      return;
    }
    issueCommand(this.state, this.human, {
      kind: CommandKind.BuildStructure,
      workerId: this.placement.workerId,
      unitTypeId: this.placement.typeId,
      x: ghost.x,
      y: ghost.y,
    });
    if (shift) this.refreshGhost(this.lastSX, this.lastSY);
    else this.clearPlacement();
  }

  private refreshGhost(sx: number, sy: number): void {
    if (!this.placement) {
      this.ghost = null;
      return;
    }
    const cx = worldToCellX(this.screenToFxX(sx));
    const cy = worldToCellY(this.screenToFxY(sy));
    this.ghost = ghostAt(this.state, this.human, this.placement.typeId, fx(cx), fx(cy));
  }

  private clearPlacement(): void {
    this.placement = null;
    this.ghost = null;
    this.canvas.style.cursor = "default";
  }

  private dropPlacementIfStale(): void {
    if (!this.placement) return;
    const w = getUnit(this.state, this.placement.workerId);
    if (!w || w.hp <= 0 || !this.selection.has(w.id) || !unitType(w.typeId).isWorker) this.clearPlacement();
  }

  private flash(text: string, kind: AlertKind): void {
    this.alert = text;
    this.alertKind = kind;
    this.alertUntil = performance.now() + 1700;
  }

  private replaceSelection(ids: number[]): void {
    this.selection.clear();
    this.order.length = 0;
    for (const id of ids) {
      if (this.selection.has(id)) continue;
      this.selection.add(id);
      this.order.push(id);
    }
    this.dropPlacementIfStale();
  }

  private drawBox(x: number, y: number): void {
    const wx0 = screenToWorldPx(Math.min(this.dragStartX, x), this.world.x, this.world.scale.x);
    const wy0 = screenToWorldPx(Math.min(this.dragStartY, y), this.world.y, this.world.scale.y);
    const wx1 = screenToWorldPx(Math.max(this.dragStartX, x), this.world.x, this.world.scale.x);
    const wy1 = screenToWorldPx(Math.max(this.dragStartY, y), this.world.y, this.world.scale.y);
    this.box.clear();
    this.box
      .rect(wx0, wy0, wx1 - wx0, wy1 - wy0)
      .fill({ color: 0x6fd0ff, alpha: 0.08 })
      .stroke({ width: 1.5 / this.world.scale.x, color: 0x6fd0ff });
  }

  private finishSelection(x: number, y: number, additive: boolean): void {
    const fx0 = this.screenToFxX(Math.min(this.dragStartX, x));
    const fx1 = this.screenToFxX(Math.max(this.dragStartX, x));
    const fy0 = this.screenToFxY(Math.min(this.dragStartY, y));
    const fy1 = this.screenToFxY(Math.max(this.dragStartY, y));
    const isClick = Math.abs(x - this.dragStartX) < 4 && Math.abs(y - this.dragStartY) < 4;
    if (!additive) {
      this.selection.clear();
      this.order.length = 0;
    }

    if (isClick) {
      const hit = this.pickUnit(fx0, fy0, (u) => u.playerId === this.human);
      if (hit && !this.selection.has(hit.id)) {
        this.selection.add(hit.id);
        this.order.push(hit.id);
      }
      this.dropPlacementIfStale();
      return;
    }
    for (const u of this.state.units) {
      if (u.playerId !== this.human) continue;
      if (unitType(u.typeId).isBuilding) continue;
      if (u.x >= fx0 && u.x <= fx1 && u.y >= fy0 && u.y <= fy1 && !this.selection.has(u.id)) {
        this.selection.add(u.id);
        this.order.push(u.id);
      }
    }
    if (this.selection.size === 0) {
      const b = this.pickUnit((fx0 + fx1) / 2 | 0, (fy0 + fy1) / 2 | 0, (u) => u.playerId === this.human);
      if (b) {
        this.selection.add(b.id);
        this.order.push(b.id);
      }
    }
    this.dropPlacementIfStale();
  }

  private dispatchContextCommand(sx: number, sy: number): void {
    if (this.selection.size === 0) return;
    const fxX = this.screenToFxX(sx);
    const fy = this.screenToFxY(sy);
    const mobiles: number[] = [];
    const producers: number[] = [];
    for (const id of this.order) {
      const u = getUnit(this.state, id);
      if (!u || u.hp <= 0 || u.playerId !== this.human) continue;
      const t = unitType(u.typeId);
      if (t.isBuilding) {
        if (t.trains.length > 0) producers.push(id);
      } else {
        mobiles.push(id);
      }
    }

    for (const id of producers) {
      issueCommand(this.state, this.human, { kind: CommandKind.SetRally, buildingId: id, x: fxX, y: fy });
    }
    if (mobiles.length === 0) return;

    const enemy = this.pickUnit(fxX, fy, (u) => u.playerId !== this.human);
    if (enemy) {
      issueCommand(this.state, this.human, { kind: CommandKind.Attack, unitIds: mobiles, targetId: enemy.id });
      return;
    }
    const node = this.pickNode(fxX, fy);
    const workers = mobiles.filter((id) => this.isWorker(id));
    if (node !== -1 && workers.length > 0) {
      issueCommand(this.state, this.human, { kind: CommandKind.Harvest, unitIds: workers, nodeId: node });
      if (workers.length !== mobiles.length) {
        const rest = mobiles.filter((id) => !this.isWorker(id));
        if (rest.length > 0) {
          issueCommand(this.state, this.human, { kind: CommandKind.Move, unitIds: rest, x: fxX, y: fy });
        }
      }
      return;
    }
    issueCommand(this.state, this.human, { kind: CommandKind.Move, unitIds: mobiles, x: fxX, y: fy });
  }

  private dispatchAttackMove(sx: number, sy: number): void {
    const mobiles: number[] = [];
    for (const id of this.order) {
      const u = getUnit(this.state, id);
      if (!u || u.hp <= 0) continue;
      if (!unitType(u.typeId).isBuilding) mobiles.push(id);
    }
    if (mobiles.length === 0) return;
    issueCommand(this.state, this.human, {
      kind: CommandKind.AttackMove,
      unitIds: mobiles,
      x: this.screenToFxX(sx),
      y: this.screenToFxY(sy),
    });
  }

  private screenToFxX(sx: number): number {
    return pxToFxClamped(screenToWorldPx(sx, this.world.x, this.world.scale.x), this.state.map.width);
  }

  private screenToFxY(sy: number): number {
    return pxToFxClamped(screenToWorldPx(sy, this.world.y, this.world.scale.y), this.state.map.height);
  }

  private pickUnit(fxv: number, fy: number, filter: (u: Unit) => boolean): Unit | undefined {
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const u of this.state.units) {
      if (!filter(u)) continue;
      const r = Math.max(unitType(u.typeId).radius, FX_ONE / 2);
      const dx = (u.x - fxv) / FX_ONE;
      const dy = (u.y - fy) / FX_ONE;
      const d = dx * dx + dy * dy;
      const rr = (r / FX_ONE) * (r / FX_ONE) * 2.25;
      if (d <= rr && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private pickNode(fxv: number, fy: number): number {
    for (const n of this.state.nodes) {
      const dx = (n.x - fxv) / FX_ONE;
      const dy = (n.y - fy) / FX_ONE;
      if (dx * dx + dy * dy <= 1) return n.id;
    }
    return -1;
  }

  private isWorker(id: number): boolean {
    const u = getUnit(this.state, id);
    return !!u && unitType(u.typeId).isWorker;
  }
}
