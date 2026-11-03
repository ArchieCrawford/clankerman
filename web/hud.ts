/**
 * DOM HUD. Reads sim state and paints the resource bar, denial toasts, and
 * the command card. Clicks call back into InputController, which is the only
 * place that issues commands.
 */
import { GameState, getUnit } from "../src/core/state.js";
import { unitType } from "../src/data/units.js";
import { PlacementReject } from "../src/core/placement.js";
import { InputController } from "./input.js";
import { CardModel } from "./card.js";
import { placementStatus, spendable } from "./predict.js";

const FACTION_SWATCH = ["#9aa4b2", "#3fae5a", "#b18cff"];

export class Hud {
  private readonly scrapVal: HTMLElement;
  private readonly aetherVal: HTMLElement;
  private readonly powerVal: HTMLElement;
  private readonly scrapRes: HTMLElement;
  private readonly aetherRes: HTMLElement;
  private readonly powerRes: HTMLElement;
  private readonly powerFill: HTMLElement;
  private readonly alertEl: HTMLElement;
  private readonly card: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly swatch: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly queueEl: HTMLElement;
  private actionSig = "";
  private queueSig = "";

  constructor(private readonly input: InputController) {
    this.scrapVal = must("val-scrap");
    this.aetherVal = must("val-aether");
    this.powerVal = must("val-power");
    this.scrapRes = must("res-scrap");
    this.aetherRes = must("res-aether");
    this.powerRes = must("res-power");
    this.powerFill = must("power-fill");
    this.alertEl = must("alert");
    this.card = must("command-card");
    this.nameEl = must("card-name");
    this.subEl = must("card-sub");
    this.swatch = must("card-swatch");
    this.hpFill = must("card-hp");
    this.actionsEl = must("card-actions");
    this.statusEl = must("card-status");
    this.queueEl = must("card-queue");

    this.card.addEventListener("pointerdown", (e) => {
      const el = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const typeId = Number(el.dataset.type);
      if (el.dataset.act === "train") this.input.train(typeId);
      else if (el.dataset.act === "build") this.input.beginPlace(typeId);
      else if (el.dataset.act === "cancel") this.input.cancelTrain(Number(el.dataset.index));
    });
  }

  update(state: GameState): void {
    const player = state.players[this.input.human]!;
    this.scrapVal.textContent = String(player.scrap);
    this.aetherVal.textContent = String(player.aether);
    this.powerVal.textContent = `${player.powerUsed}/${player.powerCap}`;
    const capped = player.powerCap > 0 && player.powerUsed >= player.powerCap;
    this.powerRes.classList.toggle("capped", capped);
    const pct = player.powerCap > 0 ? Math.min(100, (player.powerUsed / player.powerCap) * 100) : 0;
    this.powerFill.style.width = `${pct}%`;

    const live = this.input.isAlertLive();
    this.alertEl.textContent = live ? this.input.alert : "";
    this.alertEl.classList.toggle("show", live);
    this.alertEl.classList.toggle("info", live && this.input.alertKind === "info");
    this.scrapRes.classList.toggle("flash", live && this.input.alertKind === "scrap");
    this.aetherRes.classList.toggle("flash", live && this.input.alertKind === "aether");
    this.powerRes.classList.toggle("flash", live && this.input.alertKind === "power");

    const model = this.input.card();
    this.card.hidden = model.mode === "none";
    if (model.mode === "none") return;

    this.nameEl.textContent = model.title;
    this.subEl.textContent = model.subtitle;
    this.swatch.style.background = FACTION_SWATCH[model.faction] ?? "#9aa4b2";
    this.swatch.classList.toggle("round", model.mode === "build" || model.mode === "info");
    const hpPct = model.maxHp > 0 ? Math.max(0, Math.min(100, (model.hp / model.maxHp) * 100)) : 0;
    this.hpFill.style.width = `${model.constructing ? model.constructPct : hpPct}%`;

    const sig = `${model.mode}:${model.primaryId}:${model.actions.map((a) => a.typeId).join(",")}`;
    if (sig !== this.actionSig) {
      this.actionSig = sig;
      this.actionsEl.innerHTML = model.actions.map((a) => buttonHtml(a)).join("");
    }
    this.paintAfford(state, model);
    this.paintSide(state, model);
  }

  private paintAfford(state: GameState, model: CardModel): void {
    const funds = spendable(state, this.input.human);
    const buttons = this.actionsEl.querySelectorAll("button");
    buttons.forEach((btn) => {
      const typeId = Number((btn as HTMLButtonElement).dataset.type);
      const spec = model.actions.find((a) => a.typeId === typeId);
      if (!spec) return;
      const broke =
        funds.scrap < spec.costScrap ||
        funds.aether < spec.costAether ||
        (spec.powerCost > 0 && funds.powerUsed + spec.powerCost > funds.powerCap);
      btn.classList.toggle("broke", broke);
      btn.classList.toggle("armed", this.input.placingTypeId === typeId);
      const why = brokeReason(spec, funds);
      if (why) btn.title = why;
      else btn.removeAttribute("title");
    });
  }

  private paintSide(state: GameState, model: CardModel): void {
    if (model.mode === "build") {
      const placing = this.input.placingTypeId;
      if (placing < 0 || !this.input.ghost) {
        this.statusEl.textContent = "Choose a structure, then click the map.";
        this.statusEl.className = "status";
      } else {
        const t = unitType(placing);
        const funds = spendable(state, this.input.human);
        const shortAether = funds.aether < t.costAether && funds.scrap >= t.costScrap;
        const reason = this.input.ghost.reason;
        this.statusEl.textContent = placementStatus(reason, t.name, shortAether);
        this.statusEl.className = reason === PlacementReject.Ok ? "status ok" : "status bad";
      }
      if (this.queueSig !== "") {
        this.queueSig = "";
        this.queueEl.innerHTML = "";
      }
      return;
    }

    if (model.mode !== "train" || model.queueBuildingId < 0) {
      this.statusEl.textContent = "";
      this.statusEl.className = "status";
      if (this.queueSig !== "") {
        this.queueSig = "";
        this.queueEl.innerHTML = "";
      }
      return;
    }

    this.statusEl.textContent = "Queue";
    this.statusEl.className = "status label";
    const b = getUnit(state, model.queueBuildingId);
    const sig = b ? `${b.id}:${b.trainQueue.join(",")}` : "";
    if (sig !== this.queueSig) {
      this.queueSig = sig;
      if (!b || b.trainQueue.length === 0) {
        this.queueEl.innerHTML = `<div class="qempty">Queue empty</div>`;
      } else {
        this.queueEl.innerHTML = b.trainQueue
          .map((typeId, i) => {
            const ut = unitType(typeId);
            return `<div class="qrow" data-type="${typeId}">
              <div class="qtop"><span class="qname">${i + 1}. ${ut.name}</span><span class="qpct"></span></div>
              <div class="qtrack"><div class="qfill"></div></div>
              <button type="button" data-act="cancel" data-index="${i}">Cancel</button>
            </div>`;
          })
          .join("");
      }
    }
    if (!b) return;
    const rows = this.queueEl.querySelectorAll(".qrow");
    rows.forEach((row, i) => {
      const typeId = b.trainQueue[i];
      if (typeId === undefined) return;
      const ut = unitType(typeId);
      const pct = i === 0 ? Math.min(100, Math.floor((b.trainProgress / ut.buildTimeTicks) * 100)) : 0;
      const fill = row.querySelector(".qfill");
      const label = row.querySelector(".qpct");
      if (fill instanceof HTMLElement) fill.style.width = `${pct}%`;
      if (label) label.textContent = i === 0 ? `${pct}%` : "wait";
    });
  }
}

function buttonHtml(a: CardModel["actions"][number]): string {
  const hot = a.hotkey.toUpperCase();
  const costs = [
    `<span class="cost"><i class="gem scrap tiny"></i>${a.costScrap}</span>`,
    a.costAether > 0 ? `<span class="cost"><i class="gem aether tiny"></i>${a.costAether}</span>` : "",
    a.powerCost > 0
      ? `<span class="cost"><i class="gem power tiny"></i>${a.powerCost}</span>`
      : a.powerCost < 0
        ? `<span class="cost give">+${-a.powerCost} power</span>`
        : "",
  ].join("");
  return `<button type="button" class="cmd" data-act="${a.mode}" data-type="${a.typeId}" data-testid="cmd-${a.hotkey}">
    <kbd>${hot}</kbd>
    <span class="nm">${a.name}</span>
    ${costs}
  </button>`;
}

function brokeReason(
  spec: CardModel["actions"][number],
  funds: { scrap: number; aether: number; powerUsed: number; powerCap: number },
): string {
  if (funds.scrap < spec.costScrap) return "Not enough Scrap";
  if (funds.aether < spec.costAether) return "Not enough Aether";
  if (spec.powerCost > 0 && funds.powerUsed + spec.powerCost > funds.powerCap) return "Not enough Power";
  return "";
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}
