/**
 * Phase 6 bridge (LOG [010]): selection + commands. Screen coords are converted
 * back into fixed-point grid space here; every order flows through
 * issueCommand's sanitized latency queue — the UI has no side door into state.
 */
import { Container, Graphics } from "pixi.js";
import { GameState, Unit } from "../src/core/state.js";
import { CommandKind } from "../src/core/commands.js";
import { issueCommand } from "../src/core/api.js";
import { unitType } from "../src/data/units.js";
import { FX_ONE } from "../src/math/fixed.js";
import { pxToFxClamped, screenToWorldPx } from "./coords.js";

export class InputController {
  readonly selection = new Set<number>();
  private readonly state: GameState;
  private readonly playerId: number;
  private readonly world: Container;
  private readonly box: Graphics;
  private dragStartX = -1;
  private dragStartY = -1;
  private dragging = false;
  private attackMoveArmed = false;

  constructor(state: GameState, playerId: number, world: Container, overlay: Container, canvas: HTMLCanvasElement) {
    this.state = state;
    this.playerId = playerId;
    this.world = world;
    this.box = new Graphics();
    overlay.addChild(this.box);

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) {
        if (this.attackMoveArmed) {
          this.attackMoveArmed = false;
          this.dispatchAttackMove(e.clientX, e.clientY);
          return;
        }
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragging = true;
      } else if (e.button === 2) {
        this.dispatchContextCommand(e.clientX, e.clientY);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.dragging) this.drawBox(e.clientX, e.clientY);
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 0 && this.dragging) {
        this.dragging = false;
        this.box.clear();
        this.finishSelection(e.clientX, e.clientY, e.shiftKey);
      }
    });
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      // A arms attack-move only when fighters are selected, so it never
      // collides with the camera's A-pan for an empty selection.
      if (k === "a" && this.selection.size > 0) this.attackMoveArmed = true;
      if (k === "escape") {
        this.attackMoveArmed = false;
        this.selection.clear();
      }
    });
  }

  /** Selection can go stale as units die — prune it each frame. */
  prune(): void {
    if (this.selection.size === 0) return;
    const alive = new Set<number>();
    for (const u of this.state.units) alive.add(u.id);
    for (const id of this.selection) {
      if (!alive.has(id)) this.selection.delete(id);
    }
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
    // A click (tiny box) selects the nearest unit under the cursor instead.
    const isClick = Math.abs(x - this.dragStartX) < 4 && Math.abs(y - this.dragStartY) < 4;
    if (!additive) this.selection.clear();

    if (isClick) {
      const hit = this.pickUnit(fx0, fy0, (u) => u.playerId === this.playerId);
      if (hit) this.selection.add(hit.id);
      return;
    }
    for (const u of this.state.units) {
      if (u.playerId !== this.playerId) continue;
      if (unitType(u.typeId).isBuilding) continue; // drag selects armies, click selects buildings
      if (u.x >= fx0 && u.x <= fx1 && u.y >= fy0 && u.y <= fy1) this.selection.add(u.id);
    }
    if (this.selection.size === 0) {
      const b = this.pickUnit((fx0 + fx1) / 2 | 0, (fy0 + fy1) / 2 | 0, (u) => u.playerId === this.playerId);
      if (b) this.selection.add(b.id);
    }
  }

  private dispatchContextCommand(sx: number, sy: number): void {
    if (this.selection.size === 0) return;
    const fx = this.screenToFxX(sx);
    const fy = this.screenToFxY(sy);
    const ids = [...this.selection];

    const enemy = this.pickUnit(fx, fy, (u) => u.playerId !== this.playerId);
    if (enemy) {
      issueCommand(this.state, this.playerId, { kind: CommandKind.Attack, unitIds: ids, targetId: enemy.id });
      return;
    }
    const node = this.pickNode(fx, fy);
    if (node !== -1 && ids.some((id) => this.isWorker(id))) {
      issueCommand(this.state, this.playerId, {
        kind: CommandKind.Harvest,
        unitIds: ids.filter((id) => this.isWorker(id)),
        nodeId: node,
      });
      return;
    }
    issueCommand(this.state, this.playerId, { kind: CommandKind.Move, unitIds: ids, x: fx, y: fy });
  }

  private dispatchAttackMove(sx: number, sy: number): void {
    if (this.selection.size === 0) return;
    issueCommand(this.state, this.playerId, {
      kind: CommandKind.AttackMove,
      unitIds: [...this.selection],
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

  private pickUnit(fx: number, fy: number, filter: (u: Unit) => boolean): Unit | undefined {
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const u of this.state.units) {
      if (!filter(u)) continue;
      const r = Math.max(unitType(u.typeId).radius, FX_ONE / 2);
      const dx = (u.x - fx) / FX_ONE;
      const dy = (u.y - fy) / FX_ONE;
      const d = dx * dx + dy * dy; // render-side float math is fine here
      const rr = (r / FX_ONE) * (r / FX_ONE) * 2.25; // generous pick radius
      if (d <= rr && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private pickNode(fx: number, fy: number): number {
    for (const n of this.state.nodes) {
      const dx = (n.x - fx) / FX_ONE;
      const dy = (n.y - fy) / FX_ONE;
      if (dx * dx + dy * dy <= 1) return n.id;
    }
    return -1;
  }

  private isWorker(id: number): boolean {
    for (const u of this.state.units) {
      if (u.id === id) return unitType(u.typeId).isWorker;
    }
    return false;
  }
}
