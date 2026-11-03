/**
 * The observer (LOG [010]): reads GameState each frame, draws interpolated
 * sprites. Never writes sim state — every value taken from a Unit is copied
 * into render-space floats.
 */
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { GameState, Unit } from "../src/core/state.js";
import { Faction, UnitType, unitType } from "../src/data/units.js";
import { ResourceKind } from "../src/core/state.js";
import { CELL_PX, fxToPx, lerpFxToPx } from "./coords.js";
import { SimDriver } from "./sim-driver.js";
import { GhostView } from "./predict.js";

const PLAYER_COLORS = [0x4da3ff, 0xff5d5d, 0xffd44d, 0x9dff70];
const FACTION_BODY: Record<Faction, number> = {
  [Faction.CogDominion]: 0x9aa4b2, // gunmetal
  [Faction.VerdantChorus]: 0x3fae5a, // green
  [Faction.HollowCourt]: 0xb18cff, // pale violet
};

interface UnitView {
  root: Container;
  body: Sprite;
  ring: Graphics;
  hpBar: Graphics;
  lastHp: number;
  lastMaxW: number;
  selected: boolean;
}

export class Renderer {
  readonly ground: Container;
  readonly unitLayer: Container;
  readonly overlay: Container;
  private readonly views = new Map<number, UnitView>();
  private readonly textures = new Map<string, Texture>();
  private readonly app: Application;
  private readonly ghostGfx = new Graphics();
  private readonly rallyGfx = new Graphics();

  constructor(app: Application, world: Container) {
    this.app = app;
    this.ground = new Container();
    this.unitLayer = new Container();
    this.overlay = new Container();
    world.addChild(this.ground, this.unitLayer, this.overlay);
    this.overlay.addChild(this.rallyGfx, this.ghostGfx);
  }

  /** Draw static terrain + resource nodes once (nodes redrawn on depletion). */
  drawGround(state: GameState): void {
    const g = new Graphics();
    const { width, height, walkable } = state.map;
    g.rect(0, 0, width * CELL_PX, height * CELL_PX).fill(0x141a22);
    // Subtle grid.
    for (let x = 0; x <= width; x += 4) {
      g.moveTo(x * CELL_PX, 0).lineTo(x * CELL_PX, height * CELL_PX).stroke({ width: 1, color: 0x1c242f });
    }
    for (let y = 0; y <= height; y += 4) {
      g.moveTo(0, y * CELL_PX).lineTo(width * CELL_PX, y * CELL_PX).stroke({ width: 1, color: 0x1c242f });
    }
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        if (walkable[cy * width + cx] === 0) {
          g.rect(cx * CELL_PX, cy * CELL_PX, CELL_PX, CELL_PX).fill(0x232c38);
        }
      }
    }
    this.ground.removeChildren();
    this.ground.addChild(g);

    const nodes = new Graphics();
    for (const n of state.nodes) {
      const px = fxToPx(n.x);
      const py = fxToPx(n.y);
      if (n.kind === ResourceKind.Scrap) {
        nodes.regularPoly(px, py, CELL_PX * 0.45, 6).fill(0x7fb2d9).stroke({ width: 2, color: 0x2c4257 });
      } else {
        nodes.circle(px, py, CELL_PX * 0.4).fill(0x62e8c8).stroke({ width: 2, color: 0x1f5a4c });
      }
    }
    this.ground.addChild(nodes);
  }

  /** Per-frame: sync sprite pool with the unit list and interpolate positions. */
  render(driver: SimDriver, selection: ReadonlySet<number>, ghost: GhostView | null): void {
    const state = driver.state;
    const alpha = driver.alpha;
    const seen = new Set<number>();

    for (const u of state.units) {
      seen.add(u.id);
      let view = this.views.get(u.id);
      if (!view) {
        view = this.createView(u);
        this.views.set(u.id, view);
        this.unitLayer.addChild(view.root);
      }
      const prev = driver.prev.get(u.id);
      view.root.x = prev ? lerpFxToPx(prev.x, u.x, alpha) : fxToPx(u.x);
      view.root.y = prev ? lerpFxToPx(prev.y, u.y, alpha) : fxToPx(u.y);

      const t = unitType(u.typeId);
      const sel = selection.has(u.id);
      if (sel !== view.selected) {
        view.selected = sel;
        view.ring.visible = sel;
      }
      if (u.hp !== view.lastHp) {
        view.lastHp = u.hp;
        this.drawHpBar(view, u, t);
      }
    }

    // Remove views for dead units.
    if (this.views.size > seen.size) {
      for (const [id, view] of this.views) {
        if (!seen.has(id)) {
          view.root.destroy({ children: true });
          this.views.delete(id);
        }
      }
    }

    this.drawGhost(ghost);
    this.drawRallies(state, selection);
  }

  /** Cell-snapped footprint. Green is a legal placement; red is not. */
  private drawGhost(ghost: GhostView | null): void {
    const g = this.ghostGfx;
    g.clear();
    if (!ghost) return;
    const color = ghost.valid ? 0x3dff8a : 0xff4455;
    const x = ghost.minCx * CELL_PX;
    const y = ghost.minCy * CELL_PX;
    const w = (ghost.maxCx - ghost.minCx + 1) * CELL_PX;
    const h = (ghost.maxCy - ghost.minCy + 1) * CELL_PX;
    g.rect(x, y, w, h).fill({ color, alpha: 0.34 }).stroke({ width: 3, color, alpha: 0.95 });
    const cols = ghost.maxCx - ghost.minCx + 1;
    const rows = ghost.maxCy - ghost.minCy + 1;
    if (cols * rows <= 64) {
      for (let cx = ghost.minCx; cx <= ghost.maxCx; cx++) {
        for (let cy = ghost.minCy; cy <= ghost.maxCy; cy++) {
          g.rect(cx * CELL_PX + 4, cy * CELL_PX + 4, CELL_PX - 8, CELL_PX - 8).stroke({
            width: 1,
            color,
            alpha: 0.55,
          });
        }
      }
    }
  }

  /** Rally flag for each selected production building that has one. */
  private drawRallies(state: GameState, selection: ReadonlySet<number>): void {
    const g = this.rallyGfx;
    g.clear();
    for (const u of state.units) {
      if (!selection.has(u.id) || u.rallyX < 0 || u.rallyY < 0) continue;
      const t = unitType(u.typeId);
      if (!t.isBuilding || t.trains.length === 0) continue;
      const x0 = fxToPx(u.x);
      const y0 = fxToPx(u.y);
      const x1 = fxToPx(u.rallyX);
      const y1 = fxToPx(u.rallyY);
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 2, color: 0xffd44d, alpha: 0.9 });
      g.regularPoly(x1, y1, 9, 4).fill(0xffd44d).stroke({ width: 2, color: 0x3a2a08 });
    }
  }

  private createView(u: Unit): UnitView {
    const t = unitType(u.typeId);
    const root = new Container();
    const radiusPx = Math.max(6, fxToPx(t.radius));

    const ring = new Graphics();
    ring.circle(0, 0, radiusPx + 4).stroke({ width: 2, color: 0xffffff });
    ring.visible = false;

    const body = new Sprite(this.factionTexture(t, u.playerId));
    body.anchor.set(0.5);

    const hpBar = new Graphics();
    root.addChild(ring, body, hpBar);

    const view: UnitView = { root, body, ring, hpBar, lastHp: -1, lastMaxW: radiusPx * 2, selected: false };
    this.drawHpBar(view, u, t);
    view.lastHp = u.hp;
    return view;
  }

  private drawHpBar(view: UnitView, u: Unit, t: UnitType): void {
    const w = view.lastMaxW;
    const frac = Math.max(0, Math.min(1, u.hp / t.maxHp));
    const g = view.hpBar;
    g.clear();
    if (frac >= 1) return; // full hp: no bar clutter
    const y = -(w / 2) - 8;
    g.rect(-w / 2, y, w, 4).fill(0x30161a);
    g.rect(-w / 2, y, w * frac, 4).fill(frac > 0.5 ? 0x53d769 : frac > 0.25 ? 0xe8b93e : 0xe0483e);
  }

  /**
   * Placeholder art (LOG [010]): metallic squares (Cog), green circles
   * (Verdant), translucent pentagons (Hollow). One texture per
   * (faction, size, player) — sprites share GPU textures for batching.
   */
  private factionTexture(t: UnitType, playerId: number): Texture {
    const radiusPx = Math.max(6, fxToPx(t.radius));
    const key = `${t.faction}:${radiusPx}:${t.isBuilding ? "b" : "u"}:${playerId}`;
    const cached = this.textures.get(key);
    if (cached) return cached;

    const g = new Graphics();
    const body = FACTION_BODY[t.faction];
    const outline = PLAYER_COLORS[playerId % PLAYER_COLORS.length]!;
    const r = radiusPx;
    switch (t.faction) {
      case Faction.CogDominion: {
        // Metallic square with a highlight bevel.
        g.rect(-r, -r, 2 * r, 2 * r).fill(body).stroke({ width: 3, color: outline });
        g.rect(-r * 0.55, -r * 0.55, r * 1.1, r * 0.35).fill(0xc7ced8);
        break;
      }
      case Faction.VerdantChorus: {
        g.circle(0, 0, r).fill(body).stroke({ width: 3, color: outline });
        g.circle(-r * 0.3, -r * 0.3, r * 0.3).fill(0x6fd98a);
        break;
      }
      case Faction.HollowCourt: {
        g.regularPoly(0, 0, r, 5).fill({ color: body, alpha: 0.55 }).stroke({ width: 3, color: outline });
        g.regularPoly(0, 0, r * 0.45, 5).fill({ color: 0xe6dcff, alpha: 0.7 });
        break;
      }
    }
    if (t.isBuilding) {
      g.rect(-r * 0.2, -r * 0.2, r * 0.4, r * 0.4).fill(outline);
    }

    const tex: Texture = this.app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    this.textures.set(key, tex);
    return tex;
  }
}
