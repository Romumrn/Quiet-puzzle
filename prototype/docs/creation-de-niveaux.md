# Level creation guide

This document explains how to add, tune, and validate levels in Quiet Puzzle without rereading the generator in full.

The short version: levels are JSON files under `levels/`, and the app reads them directly. A generator builds them offline, and a whole world—20 levels, one palette, one mechanic, one difficulty ramp—fits in a single row of `REALMS`.

---

## 1. Model

### The runtime reads the generated base

```
levels/
  index.json      catalog: total levels and per-world name, hue, palette, and feature
  world-0.json    twenty levels for a world, matching `GET /api/level/{n}`
  world-1.json
  …
```

The app opens `index.json` on startup and loads a world only when it is requested. Loading everything at once would waste bandwidth and delay gameplay. `src/data/levelStore.js` is the only module that reads these files; the rest of the app accesses levels through it.

This leads to three practical advantages:

- a level can be manually edited without being overwritten on the next run, as nothing recalculates it during startup;
- the shipped levels are exactly the ones that have been tested; they are not affected by an unseen generator drift;
- adding content does not require touching the application code; regeneration or manual file drops are enough.

### The generator fills the base

```bash
cd prototype && node tools/build-levels.mjs
node tools/build-levels.mjs --garder
```

`src/core/levels.js` creates level `n` from its number alone. The draw is seeded on `n`, so rerunning the tool without changing the generator rewrites identical files. This is why `--garder` exists: it prevents accidental manual edits from being erased.

The grid is built in reverse. Each block is first placed into a door of its own color, then moved backward through the board. The player experiences this construction in reverse: the last block placed leaves first, and its route is already validated by the earlier construction.

Two consequences drive the rest of the design:

- no level can be unsolvable; solvability is guaranteed by construction;
- the reference solution is free; it is stored in `level.solution` and used by tests, balancing, the QA panel, and in-game hints.

The generator does not decide design; it executes rules. Those rules live in `REALMS`, which `curve(n)` consumes.

---

## 2. World structure

A world spans 20 levels (`LEVELS_PER_REALM`) and always brings three things together:

1. a new mechanic or new block type;
2. a palette; the six families keep their glyphs (`●◆▲★■⬢`) but change hue;
3. a difficulty ramp: larger boards, more colors or gates, and a tighter capacity margin.

Twenty levels are used instead of five because a new mechanic needs to be practiced before it is combined with the next one. That creates two scales:

- difficulty rises inside a world, by interpolating quantities noted as `[start, end]` across the 20 levels;
- difficulty also steps between worlds via board size, color count, gate count, and capacity margin.

The internal ramp is what makes a 20-level world playable; without it, the 19 levels after entry would feel identical.

---

## 3. Material constraints and balancing

The generator must keep a valid board density and path shape. Typical constraints are:

- target occupied cells: 55% to 70%; below 45% the board is too obvious, above 75% there is no room for meaningful backtracking;
- distance from a block to its door: too small and the puzzle becomes purely mechanical; too large and the board becomes a set of disconnected dead ends;
- door capacity and move limits: these are the main levers that create genuine decision-making.

The design goal is not to maximize density; it is to create a level where a player must decide, not merely drag the obvious route.

---

## 4. Validation checklist

Before shipping a level or a world, check:

- the board is solvable by construction;
- the door capacity remains consistent with the engine (`capacityCost()`);
- the reference solution can be replayed by the runtime;
- the move/time limits remain fair for the level's density;
- the resulting board meets the expected difficulty for the world stage.

The balancing script (`node tools/balance.mjs`) is the quickest sanity check for density, distances, and solver-state counts.
