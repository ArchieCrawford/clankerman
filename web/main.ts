/**
 * Entry point: boots PixiJS v8 (WebGPU preferred, WebGL fallback), creates the
 * match, and runs the render loop. The sim is advanced ONLY by SimDriver's
 * fixed-timestep accumulator (LOG [010]); rAF time never touches game logic.
 */
import { Application, Container } from "pixi.js";
import { Faction, FACTION_NAMES, unitType } from "../src/data/units.js";
import { createSkirmish } from "../src/scenario.js";
import { createSimContext } from "../src/core/sim.js";
import { hashState } from "../src/core/state.js";
import { isGameOver } from "../src/core/systems/deaths.js";
import { CELL_PX, fxToPx } from "./coords.js";
import { SimDriver } from "./sim-driver.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { InputController } from "./input.js";
import { ScriptedAI } from "./ai.js";

const HUMAN = 0;

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x0b0e12,
    antialias: true,
    preference: "webgpu", // falls back to WebGL automatically
  });
  document.body.appendChild(app.canvas);

  // Deterministic seed from the URL (?seed=123) for shareable matches.
  const seed = Number(new URLSearchParams(location.search).get("seed") ?? 42) | 0;
  const state = createSkirmish(seed, Faction.CogDominion, Faction.VerdantChorus);
  const ctx = createSimContext(state);
  const driver = new SimDriver(state, ctx);

  const world = new Container();
  app.stage.addChild(world);

  const renderer = new Renderer(app, world);
  renderer.drawGround(state);

  const camera = new Camera(
    world,
    app.screen.width,
    app.screen.height,
    state.map.width * CELL_PX,
    state.map.height * CELL_PX,
  );
  const humanMain = state.units.find((u) => u.playerId === HUMAN)!;
  camera.centerOn(fxToPx(humanMain.x), fxToPx(humanMain.y));
  window.addEventListener("resize", () => camera.resize(app.screen.width, app.screen.height));

  const input = new InputController(state, HUMAN, world, renderer.overlay, app.canvas);
  const ai = new ScriptedAI(1);

  const hud = document.getElementById("hud")!;
  let lastStructureCount = -1;

  app.ticker.add((ticker) => {
    // 1. Sim: fixed timestep, capped catchup.
    if (!isGameOver(state)) {
      ai.update(state);
      driver.update(ticker.deltaMS);
    }
    // 2. Camera + input housekeeping (render-side only).
    camera.update(ticker.deltaMS);
    input.prune();
    // 3. Draw. Terrain re-bakes only when buildings changed the walkable grid.
    const structures = state.units.reduce((n, u) => n + (unitType(u.typeId).isBuilding ? 1 : 0), 0);
    if (structures !== lastStructureCount) {
      lastStructureCount = structures;
      renderer.drawGround(state);
    }
    renderer.render(driver, input.selection);

    const p = state.players[HUMAN]!;
    const army = state.units.filter(
      (u) => u.playerId === HUMAN && !unitType(u.typeId).isWorker && !unitType(u.typeId).isBuilding,
    ).length;
    hud.textContent =
      `${FACTION_NAMES[p.faction as Faction]}  tick ${state.tick}  seed ${seed}\n` +
      `scrap ${p.scrap}  aether ${p.aether}  power ${p.powerUsed}/${p.powerCap}  army ${army}  sel ${input.selection.size}\n` +
      `hash ${(hashState(state) >>> 0).toString(16).padStart(8, "0")}` +
      (isGameOver(state) ? (p.defeated ? "  — DEFEAT" : "  — VICTORY") : "");
  });
}

boot().catch((err) => {
  document.getElementById("hud")!.textContent = `boot failed: ${err}`;
  throw err;
});
