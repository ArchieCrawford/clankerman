# Clankerman: Iron Dominion

A StarCraft-style RTS with original factions and characters, built core-first:
this repo currently contains the **headless deterministic simulation core** —
no rendering, no UI — engineered for multiplayer lockstep from day one.

## The world

Three factions fight over **Scrap** and **Aether** on gridded battlefields:

- **Cog Dominion** — an industrial machine legion. Scrapling workers feed the
  Grand Foundry; Assembly Lines churn out Boltguards, Piston Knights, and the
  long-range Forge Crawler.
- **Verdant Chorus** — a bio-mechanical overgrowth. Everything grows from the
  Heartroot: cheap fast Thornhounds, spine-throwing Bramblefiends, and the
  towering Seed Titan.
- **Hollow Court** — spectral constructs from the Vault of Echoes. Wisps light
  the way for Gloomblades, Echo Sentinels, and the Umbral Colossus.

Supply is **Power**, provided by each faction's mast/bloom/beacon structures.

## Why it's built this way

RTS multiplayer runs **deterministic lockstep**: peers exchange only commands,
and every machine simulates the same match bit-for-bit. A single floating-point
rounding difference desyncs the game. So the core:

- does **all** spatial/combat math in Q16.16 fixed point (int32) — custom
  `fxMul`/`fxDiv`/`fxSqrt`, no `Math.sqrt`, no `Math.random`, no floats in state;
- advances in fixed **16 ticks/second** steps; commands execute on a scheduled
  future tick in deterministic order;
- exposes an FNV-1a **state hash** every tick for desync detection;
- keeps `GameState` a plain serializable object: `initial state + command log =
  full replay`.

Pathfinding is integer-cost A* (binary heap, zero per-query allocation via
generation-stamped scratch arrays); neighbor queries use a uniform spatial hash
grid. A 240-unit battle simulates at ~0.5 ms/tick against the 62.5 ms budget.

Design history, math standards, and verification reports live in
[ARCHITECTURE_LOG.md](ARCHITECTURE_LOG.md).

## Run it

```bash
npm install
npm run dev       # play in the browser (PixiJS v8, WebGPU with WebGL fallback)
npm test          # 70 tests: math, pathfinding, spatial grid, gameplay, determinism, float-ban lint
npm run sim       # headless scripted match with per-10s economy/army/hash readout
npm run sim 1337  # different seed (browser: ?seed=1337)
npm run typecheck
npm run build     # production bundle in dist/
```

In the browser you command the Cog Dominion against a scripted Verdant Chorus:
left-drag to select, right-click to move / attack / harvest (context-sensitive),
`A`+click to attack-move, WASD or screen edges to pan, wheel to zoom.

The renderer (`web/`) is a strict observer of the deterministic core: it runs
the sim on a fixed 62.5 ms accumulator and interpolates sprite positions
between the previous and current tick for smooth motion at any refresh rate —
`requestAnimationFrame` time never reaches game logic, and every order flows
through the same sanitized command queue a network peer would use.

## Layout

```
src/math/      fixed.ts (Q16.16), vec.ts, prng.ts (xorshift128), hash.ts (FNV-1a)
src/core/      state.ts, commands.ts, api.ts, map.ts, sim.ts (tick pipeline)
src/core/systems/  execute, production, economy, movement, combat, deaths
src/path/      astar.ts — integer A*, no-corner-cut, capped expansions
src/spatial/   grid.ts — uniform spatial hash, overflow-safe fixed-point queries
src/data/      units.ts — the three factions' rosters
src/scenario.ts    mirrored 2-player skirmish setup
scripts/run-sim.ts headless demo match
test/          vitest suites incl. lockstep determinism + float-ban source lint
web/           PixiJS v8 view layer: sim-driver (fixed timestep + interpolation),
               renderer (observer), camera, input (selection/commands), scripted AI
```

## Not here yet (by design)

Networking transport, fog of war, build-worker travel (structures are placed
remotely after a footprint check), and production/building UI (train orders
come from the scripted layer for now). The sim core is the contract; those
layers attach to `step()`, `issueCommand()`, and `hashState()` without
touching the math.
