# ARCHITECTURE_LOG — Clankerman: Iron Dominion

Persistent memory system for this project. **Append-only.** Every design decision,
math standard, structural change, and lesson learned from test runs gets a numbered
entry. Sub-agents and verifiers must read this file before touching the codebase.

Format: `[NNN] <date> <TYPE> — title` where TYPE ∈ {DECISION, STANDARD, CHANGE, LESSON, VERIFY}.

---

## [001] 2026-07-04 DECISION — Project identity & theme

StarCraft-style RTS with original characters (no Blizzard IP). Working title:
**Clankerman: Iron Dominion**. Three asymmetric factions:

| Faction | Archetype | Worker | Line units |
|---|---|---|---|
| **Cog Dominion** | industrial machine legion | Scrapling | Boltguard, Piston Knight, Forge Crawler |
| **Verdant Chorus** | bio-mechanical overgrowth swarm | Sporeling | Thornhound, Bramblefiend, Seed Titan |
| **Hollow Court** | spectral energy constructs | Wisp | Gloomblade, Echo Sentinel, Umbral Colossus |

Resources: **Scrap** (common, mined from Scrap Piles) and **Aether** (rare, drawn
from Aether Wells). Supply is called **Power**.

## [002] 2026-07-04 DECISION — Stack: TypeScript, headless, zero runtime deps

TypeScript (strict) on Node 22, Vitest for tests. The simulation core has **zero
runtime dependencies** — every line of math is ours, so determinism is auditable.
No rendering/UI in this phase; the core is a pure library plus a headless runner.

## [003] 2026-07-04 STANDARD — Fixed-point math (Q16.16), the determinism contract

RTS lockstep requires bit-identical simulation on every peer. Rules:

- All spatial/combat quantities are **Q16.16 fixed point** stored as JS numbers
  constrained to signed 32-bit integers (`| 0` after every op). Range ±32767.99998,
  resolution 1/65536.
- **Multiplication** (`fxMul`): the naive `(a*b)/65536` overflows float64's exact
  integer range (2^53) since a*b can reach 2^62. We split: with `ah = a >> 16`,
  `al = a & 0xffff`, result = `(Math.imul(ah, b) + Math.floor((al * b) / 65536)) | 0`.
  `al*b` ≤ 2^47 so it is exact in float64; dividing by 2^16 is a pure exponent
  shift (exact); `Math.floor` of an exact value is exact; `Math.imul` is defined
  32-bit. Every step is IEEE-754-specified → bit-identical everywhere.
- **Division** (`fxDiv`): `(a << 16) / b` needs a 48-bit intermediate. We use
  BigInt: `Number((BigInt(a) << 16n) / BigInt(b))`, truncation-toward-zero
  semantics. BigInt division is exact integer math → deterministic. Perf note:
  BigInt is slow; keep `fxDiv` out of per-unit-per-tick hot paths (precompute
  reciprocal-ish constants at data-definition time where possible).
- **Square root** (`fxSqrt`): digit-by-digit integer sqrt of the 48-bit value
  `v << 16`, using only exact-range float64 adds/shifts. No `Math.sqrt` ever.
- **Trigonometry**: none. Movement uses normalized fixed-point vectors
  (dx, dy scaled by fxDiv over length); no angles in the sim.
- **PRNG**: xorshift128 on 32-bit lanes (imul/xor/shift only), seeded from the
  match seed. `Math.random` is banned in `src/`.
- **Banned in `src/core|math|path|spatial`**: `Math.random`, `Math.sin/cos/tan/
  sqrt/pow/exp/log`, `Date`, `performance`, float literals as sim state.
  (`Math.floor/imul/abs/min/max` on exact-range integers are allowed — they are
  exactly specified and used only where every input is an integer.)
- **Iteration order**: sim iterates plain arrays with monotonic unit IDs. No
  reliance on object-key enumeration. `Map` insertion order is spec-defined in JS,
  but arrays keep it obvious.
- **Desync detection**: every state exposes `hashState()` — FNV-1a 32-bit over
  the canonical integer serialization. Peers exchange hashes every N ticks.

## [004] 2026-07-04 STANDARD — Tick model & command queue (lockstep-ready)

- Logic rate: **16 ticks/second** (62.5 ms). All game data (speeds, cooldowns,
  build times) is defined per-tick or in ticks — never in wall-clock seconds.
- Commands never mutate state on arrival. They are queued against a **future
  tick** (`issueTick + COMMAND_LATENCY_TICKS`, default 2 — stands in for network
  turn delay). `step()` drains the queue for exactly the current tick, sorted by
  (playerId, sequence) for cross-peer ordering, then runs sim systems in a fixed
  order: commands → production → economy → movement → combat → deaths.
- `GameState` is a plain serializable object (no closures, no class instances
  holding hidden state) so snapshots/replays are trivial: `initialState + command
  log = full replay`.

## [005] 2026-07-04 DECISION — Map & spatial model

- Map is a grid of walkable/blocked cells, `size ≤ 256×256`. Cell size = 1.0 in
  world units (Q16.16). Units occupy continuous positions but path on the grid.
- Pathfinding: A* on the cell grid with binary-heap open set and octile heuristic
  in integer math (cost 10 straight / 14 diagonal — classic integer trick, no
  floats). Target: 200+ units repathing without blowing the tick budget; paths
  are cached per unit and only recomputed on invalidation.
- Spatial partitioning: uniform hash grid (bucket = 4×4 cells) for neighbor
  queries (targeting, separation). Rebuilt incrementally as units cross bucket
  boundaries; query is O(nearby).
- Rationale vs alternatives: flow fields shine for shared destinations but cost
  memory per goal; quadtrees beat uniform grids only with wildly non-uniform
  densities. For ≤256² maps and ≤~1600 units, A* + uniform grid is the
  simple/fast/deterministic choice. Revisit (LESSON entry) if profiling says otherwise.

## [006] 2026-07-04 DECISION — Verification protocol

Every ~5 major structural changes: freeze, dispatch a fresh-context verifier
sub-agent to audit determinism + memory efficiency against this log. Findings
land here as VERIFY entries; refactors happen before any rendering/UI work.
Standing self-checks in CI-shape: (a) determinism test — same seed + same
commands run twice ⇒ identical hash at every 50th tick; (b) divergence test —
different seeds diverge; (c) float-ban lint test greps `src/` for banned calls.

## [007] 2026-07-04 CHANGE — Core implemented; Power accounting lesson

Phases 2–3 landed: math libs, state/commands/sim pipeline, all six systems,
A* + spatial grid (built by parallel sub-agents against pre-agreed contracts —
both delivered clean on first integration). 59 tests green.

**LESSON (from headless demo run):** Power (supply) was checked at Train-enqueue
but charged at spawn, so parallel/backed-up queues overshot the cap (observed
`power=13/10`). Fix: commit Power at enqueue; production spawns with
`powerPrepaid`; deaths refund queued Power when a building dies. Spent
Scrap/Aether on a destroyed queue stays sunk (no cancel command yet).

**LESSON (from first test run):** `fxSqrt`'s bit-walker used `bit /= 4` with a
`bit !== 0` guard — below 1 the divisions go fractional and the loop grinds
through subnormals before returning garbage. Guard must be `bit >= 1`. Caught
by the perfect-squares test; the float-ban lint also flagged banned API *names
in comments* — reworded rather than weakening the lint.

**Simplifications accepted for this phase** (revisit before UI):
- BuildStructure places remotely after footprint check (no worker travel/escrow).
- Resource nodes don't block pathing; no fog of war; no unit-on-site check for
  building placement; no leash on auto-acquired Attacking units.

## [008] 2026-07-04 STANDARD — Cross-cutting determinism invariants (as built)

- `getUnit` binary-searches `state.units`, which stays id-sorted because spawns
  append monotonic ids and deaths compact order-preserving. Any future insert
  must preserve this.
- `cooldown` doubles as the harvest gather timer; combat's global cooldown
  decrement explicitly skips `Harvesting` units. Don't add a third user.
- Auto-acquire and chase-repath are staggered by `(tick + unit.id) % k` — id is
  sim state, so this is deterministic; never stagger by anything wall-clock.
- `maxExpansions` (A*) is a sim input: all peers must use the default.
- SimContext (path scratch, spatial grid, query buffers) is derived data —
  proven by the scratch-reuse determinism test; never hash or serialize it.

## [009] 2026-07-04 VERIFY — First fresh-context verification round (Phase 4)

A fresh-context verifier sub-agent audited the core for strict determinism and
memory efficiency. It validated the foundations hard: fxMul/fxMulSat/fxSqrt
checked against a BigInt reference over 500k random int32 pairs plus edge cases
(including -0x80000000) — exact, zero failures; the grid's 2^53 overflow
argument holds; A* tie-breaking is a total order; the id-sorted units invariant
is preserved. It also confirmed real defects (all fixed same round):

1. **Repath storm (confirmed, 337 ms/tick)**: unreachable goals re-flooded A*
   every tick for every affected unit — player-triggerable by walling a target.
   → `Unit.repathWait` backoff (32 ticks) after a failed findPath; cleared on
   any new order/goal. Regression test pins ~7 ms/tick for the same scenario.
2. **Weak desync detector**: hashState omitted trainQueue, goals, path shape,
   harvest/carry intent, the pending command queue, and cmdSeq — divergences
   could hide for hundreds of ticks. → all hashed now, incl. per-command payload
   hashing.
3. **Separation order bug (confirmed)**: a mobile unit never pushed out of a
   LOWER-indexed building (`j <= i` dedup skipped the pair; buildings are never
   `a`). → dedup applies to mobile pairs only; plus `unstick()` is now invoked
   for bystanders when a building footprint is placed.
4. **Unsanitized command payloads (confirmed)**: a fractional Move coordinate
   ended up verbatim in unit position state — non-int32 values in "int32-only"
   state. → `sanitizeCommand` at the issueCommand boundary: `|0` coercion, map
   clamping, type-id validation (bad ids dropped, not thrown).
5. **Float-ban lint too narrow**: switched to an allowlist model — only
   Math.floor/imul/abs/min/max/round permitted, `**`/Date/performance./
   parseFloat/toFixed banned, scanning code with comments stripped.
6. **PRNG was dead code**: now consumed by the stacked-unit separation nudge
   (direction drawn from the match seed's stream). Seeds remain a minor
   gameplay input until more randomness (e.g. spawn jitter) lands — noted.
7. **Per-tick filter() allocation** in executeCommands → scan-before-allocate.

Verifier verdict pre-fix: "fit for lockstep on the determinism axis, not fit
to build UI on yet" (findings 1/2/4). All three blockers are now fixed and
regression-tested (test/verify-fixes.test.ts); 65 tests green.

## [010] 2026-07-15 DECISION — Phase 5/6: PixiJS v8 rendering layer (observer-only)

Renderer: PixiJS v8 (WebGPU with WebGL fallback), top-down 2D. Rules:

- **The renderer is an observer.** All view code lives in `web/`; `src/` is
  untouched. The renderer reads GameState and issues commands ONLY through
  `issueCommand` (the sanitized latency queue). It never writes sim fields.
  The float world exists only render-side: fx → px conversion happens at draw
  time; interpolation buffers are renderer-owned Maps keyed by unit id.
- **Fixed timestep + interpolation**: an accumulator drives `step()` at
  TICK_MS = 62.5; the driver snapshots each unit's (x, y) before every tick.
  Frames render at `lerp(prevTick, currTick, accumulator / TICK_MS)` so 16 t/s
  sim looks smooth at any refresh rate. Accumulator is clamped to 8 ticks/frame
  (backgrounded-tab catchup guard). `requestAnimationFrame` time NEVER reaches the sim —
  it only decides how many whole ticks to run and the render alpha.
- **Coordinate spaces**: cell = 32 px at zoom 1. screen ↔ world-px ↔ fx
  conversions centralized in `web/coords.ts` (pure, unit-tested; fx conversions
  round + clamp and use `| 0`).
- Placeholder art: generated textures — metallic squares (Cog Dominion), green
  circles (Verdant Chorus), translucent pentagons (Hollow Court); player color
  ring; hp bars; camera = WASD/edge-scroll pan + wheel zoom-to-cursor.
- Phase 6 input: drag-box selection (world-rect test against unit fx coords),
  right-click context command: enemy → Attack, resource node → Harvest
  (workers), ground → Move; A + left-click → AttackMove.

## [011] 2026-07-15 CHANGE — Phase 5/6 landed; verified in a real browser

`web/` implemented per LOG [010]: sim-driver (fixed timestep, 8-tick catchup
clamp, prev-position snapshots), renderer (texture-cached faction placeholders,
hp bars, selection rings, ground re-baked only when the structure count
changes), camera (WASD/edge pan, zoom-to-cursor, map-bounds clamp), input
(drag-box select with click fallback, context right-click → Attack/Harvest/
Move, A+click attack-move), scripted Verdant Chorus opponent that plays through
the same command queue. Vite build; vitest.config.ts split from vite.config.ts
(the app roots at web/, tests at repo root).

**Verified end-to-end in headless Chromium (SwiftShader)**: app boots, ticks
track wall clock (~176 ticks in ~11 s at 16 t/s), drag-select captured 4
workers, right-click move executed through the latency queue, units rendered
at the destination with separation visible; screenshots captured; no page
errors (one benign favicon 404). `git diff src/` after the whole phase: zero
files — the observer constraint held mechanically, not just by intent.

Renderer-side conversions live in web/coords.ts and are unit-tested, incl.
"pxToFx always yields int32" (the sim-safety property) — 70 tests green.
Known gaps queued for next phase: production/building UI, fog of war,
victory/defeat screen beyond the HUD tag, sound.

---
<!-- Append new entries below. Never edit or delete existing entries. -->
