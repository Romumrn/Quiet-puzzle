# The level generator

Node only. Nothing served to the browser imports this folder — the game reads the
level database (Supabase first, `prototype/levels/` as a seed), never the
generator.

```
realms.js            the world table: identity, board, mechanic ramps, tier
tiers.js             TIERS — the named difficulty steps
curve.js             curve() ramps quantities inside a world; limitsFor() sets the limits
build.js             the backward placement algorithm
index.js             getLevel(n)
difficulty-map.mjs   renders the whole database as one page — read it before tuning
templates/           the map's HTML shell
```

---

## Adding a world

Five files, in this order. Skipping any one of them produces a world that half
exists.

**1. `generator/realms.js`** — one row. Keep it to identity, board and mechanic
ramps; name a `tier` and let it carry the difficulty knobs.

```js
{
  id: 30, tier: 'relentless',
  name: { fr: '…', en: '…', es: '…', it: '…', zh: '…' },
  difficulty: { fr: '…', en: '…', es: '…', it: '…', zh: '…' },
  hue: 345,
  palette: ['#…', '#…', '#…', '#…', '#…', '#…'],   // exactly six
  novelty: null,
  introduces: { fr: '…', en: '…', es: '…', it: '…', zh: '…' },
  W: 11, H: 13, colorCount: 6, gateCount: 8,
  walls: [7, 10], locks: [5, 7], rails: [10, 15],
  anchors: [8, 12], bulky: [6, 10], duals: [1, 3],
  sharedGates: [3, 5],
  demandTarget: 145,
},
```

**2. `prototype/tools/mondes.py`** — the matching row: key, display name, subject
to draw, flower palette, paper colour and hue. This is what the image generator
reads.

**3. The branch image** — see `prototype/docs/decor-de-la-carte.md`, which now
covers adding one world rather than regenerating all thirty.

**4. `prototype/styles/main.css`** — one more `.realm:nth-child(31)` rule
pointing at the new image and its paper colour, next to the existing thirty.

**5. Build, look, publish.**

```bash
node prototype/tools/build-levels.mjs --realm 30    # one world, minutes not tens of minutes
node generator/difficulty-map.mjs                   # look at it next to the others
node prototype/tools/test.mjs --solveur             # the grids are new: run the full pass
SUPABASE_TOKEN=sbp_xxx node tools/publish-levels.mjs --realm 30
```

---

## Two things that are expensive to forget

**Never switch a gesture floor on for a published world.** `minDrags` changes
which candidate grid is kept, hence the grid, hence the star thresholds, hence
the records already set against them. Floors are for new worlds.

**Adding a world loosens every earlier level.** `limitsFor()` derives its
`tighten` factor from `TOTAL_LEVELS`, so a thirty-first world raises the move and
time limits of levels 1–600. Grids and star thresholds do not move; the safety
nets do. If that is not wanted, freeze the span: replace `TOTAL_LEVELS` in
`limitsFor()` with a constant `PROGRESSION_SPAN = 600` — but that is itself a
one-way change, since it re-tightens nothing afterwards.

---

## What the levers actually do

Measured over the shipped database — regenerate the map to re-read any of this.

| Lever | Where | What it moves |
|---|---|---|
| `density` | tier | blocks on the board. **The only lever that raises the gesture ceiling.** |
| `minDrags` | tier | rejects candidate grids under a floor. Cannot invent gestures the board cannot hold. |
| `demandTarget` | world | how much the solver has to backtrack. Costs seconds per level at build time. |
| `margin` | tier | slack on gate capacity. `null` removes capacity entirely — nothing can be done wrong. |
| `minShapeSize`, `largeShapes` | tier | piece sizes. Bigger pieces mean *fewer* blocks, so fewer gestures. |
| `wideGateRatio`, `sharedGates` | tier / world | how contested the exits are. |
| `walls`, `locks`, `rails`, `anchors`, `bulky`, `duals` | world | which mechanics appear, ramped across the twenty levels. |

**Board size sets the ceiling.** A 9×11 board tops out near 29 gestures whatever
the floor asks for: `relentless` on world 29 lifted the median from 23 to 27 and
the minimum from 19 to 26, then stopped. A band of `[26, 34]` produced exactly
the same grids as `[26, 30]` and simply reported twice as many misses. To go
past 30, grow the board — that is the lever, not the floor.

---

## The ceiling is structural, and here is where it comes from

The difficulty map shows the curve climbing to world 15 and then flattening for
the last third of the game. That is not a tuning accident; it follows from how
levels are made.

`build()` generates **backwards**: each block is brought in through its gate and
walked back into the grid, so the level is solvable by construction and the walk
yields a reference solution for free. The consequence is easy to miss —
**every level is solvable by pure exit ordering**. No block ever has to be moved
aside and left there; each one goes from where it sits to its gate in one run.

`solver.js` says the same thing from the other end:

> Auxiliary moves — nudging a block aside without clearing it, to open a
> corridor — are not explored.

So the two halves agree, and together they bound the genre. `minDrags` counts
gestures along a solution where every move is an exit run, which makes it roughly
*blocks × gestures per run* — and gestures per run stays small because the
backward walk carved those paths clear. Density, gates, piece sizes and capacity
all change **how hard the ordering is to find**. None of them changes **what kind
of problem it is**.

### The mechanic that would move it: parking

Let a block need to be moved somewhere it does not exit from, so a later block
can pass. One extra idea for the player, a different kind of thinking, and it
lifts the gesture ceiling directly rather than asking the board for more blocks.

The engine already supports it. `board.dragTowards()` moves a block without
exiting — that is how `measureGestures()` and the test harness replay solutions
today. What is missing is upstream and downstream of it:

1. **Solution format** — a step is currently `{ id, gate, path }`, always an
   exit. Parking needs a second shape, `{ id, to: { x, y } }`, and every consumer
   of `solution` has to handle it: `measureGestures()`, `tools/test.mjs`
   (`rejouer`), and the hint system.
2. **`build()`** — during the backward walk, sometimes leave a block short of a
   position it could reach directly, in a spot a later block will block off. The
   reference solution then has to move it before the later block can leave.
3. **`solver.js`** — the expensive part. It currently searches exit orders only;
   verifying parked levels means searching moves as well, and the state space
   explodes. **Bound it**: at most one or two parking moves per level. That keeps
   the search tractable *and* is the right design bound anyway — a puzzle needing
   five parking moves is not harder, it is opaque.
4. **`starThresholds()`** — unchanged. It reads `minDrags`, which already counts
   whatever the solution does.

Worth staging: the format change and `measureGestures()` first, verified against
the existing database (where no level parks, so nothing may move); then one
parking move in `build()` behind a tier flag; then the solver.

### Cheaper things that also work

- **Grow the board.** Available today, zero code. Raises the ceiling roughly with
  area. This is what world 30 should do first.
- **Spend the finale mechanism where it still has room.** World finales average
  +39 % gestures against the +50 % the code aims for, and in worlds 17, 18 and 23
  the finale is not even the longest level of its world — the pool of candidates
  has run dry. More attempts there buy more than another knob.
- **Exit windows.** A gate that only accepts a colour once another colour is
  gone. `colorSeal` already does a version of this; per-gate, ramped, it is an
  ordering constraint the current solver can verify unchanged.
