# The level generator

Node only. Nothing served to the browser imports this folder — the game reads the
level database (Supabase first, `prototype/levels/` as a seed), never the
generator.

```
realms.js            the world table: identity, board, mechanic ramps, tier
tiers.js             TIERS — the named difficulty steps
curve.js             curve() ramps quantities inside a world; limitsFor() sets the limits
build.js             the backward placement algorithm
index.js             getLevel(n), and curateRealm() — the pool ordering
difficulty-map.mjs   renders the whole database as one page — read it before tuning
templates/           the map's HTML shell
```

**50 worlds, 1000 levels.** Median gesture count climbs from 6 to 35, with a step
at world 30 where the `relentless` tier starts (21 to 29).

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
`tighten` factor from `TOTAL_LEVELS`, so a fifty-first world would raise the move
and time limits of levels 1–1000. Grids and star thresholds do not move; the
safety nets do. Going from 600 to 1000 was done knowingly, at a moment when
`user_progress` held zero rows — nobody had a record to invalidate. **That window
is closed once the game ships.** After that, freeze the span: replace
`TOTAL_LEVELS` in `limitsFor()` with a constant `PROGRESSION_SPAN = 1000`.

---

## What the levers actually do

Measured over the shipped database — regenerate the map to re-read any of this.

| Lever | Where | What it moves |
|---|---|---|
| `density` | tier | blocks on the board — capped at 78 % fill, see below |
| `minDrags` | tier | rejects candidate grids under a gesture floor |
| `curated` | tier | order the realm's twenty levels by what they MEASURED, not what they were asked to be |
| `demandTarget` | world | how much the solver has to backtrack. Seconds per level at build time |
| `margin` | tier | slack on gate capacity. `null` removes capacity entirely |
| `minShapeSize`, `largeShapes` | tier | piece sizes. Bigger pieces mean *fewer* blocks, so fewer gestures |
| `wideGateRatio`, `sharedGates` | tier / world | how contested the exits are |
| `oneWay` | world | ONE-WAY cells — a block on one may only leave the way the arrow points |
| `shutters` | world | gates that stay SHUT until N blocks have left |
| `parking` | tier | a block that must be moved aside without exiting. **Does not deliver on dense boards** — see below |
| `walls`, `locks`, `rails`, `anchors`, `bulky`, `duals` | world | which mechanics appear, ramped across the twenty levels |

### The block-count ceiling

`density` is read against the board's AREA, but what a block costs is its CELLS,
and that average moves with the realm: barring one-cell pieces and allowing the
four-cell bar takes it from 2.3 up to 3.6. The same density therefore asks for a
comfortable grid on one realm and an impossible one on another — world 47
(11×13, density 0.32) came out asking for **110 % of its own board**, and
generation failed outright on level 960 after two thousand attempts.

`curve()` now caps the count at **78 % fill**, expressed in cells. Two things
follow. A new world can no longer ask for the impossible. And the old counts were
fiction: world 300 asked for 27 blocks at 94 % fill, which the generator never
reached — the `blockCount - 10` tolerance absorbed the gap silently.

**Board size sets the ceiling.** A 9×11 board tops out near 29 gestures whatever
the floor asks for: `relentless` on world 29 lifted the median from 23 to 27 and
the minimum from 19 to 26, then stopped. A band of `[26, 34]` produced exactly
the same grids as `[26, 30]` and simply reported twice as many misses. To go
past 30, grow the board — that is the lever, not the floor.

---

## What changes the KIND of problem, and what only changes its size

Every knob in the table above varies how hard the exit order is to FIND. None of
them changes what kind of question the level asks. Measured on the shipped
database, the first seven worlds clear on a uniformly random exit order a hundred
times out of a hundred: the player is not choosing, they are tidying.

`build()` generates **backwards** — each block is brought in through its gate and
walked back — so the walk only ever crosses free cells and **every level is
solvable by pure exit ordering**. `solver.js` says the same from the other end:
auxiliary moves, nudging a block aside to open a corridor, are not explored.

Three mechanics break out of that. Two are built.

### One-way cells (`oneWay`) — built

A block standing on one may only leave the way the arrow points. It is the first
genuinely SPATIAL constraint the board has: until now every route could be walked
backwards, so a mistake was always recoverable. An arrow makes a wrong entry
final.

Arrows are **read off the reference solution**, not scattered and then checked:
placed on a cell the solution already walks, pointing the way it already goes. The
level stays solvable by construction — no verification pass, no candidates thrown
away.

The condition is unanimity **over the block's whole body**, not its anchor cell.
The engine holds a block if ANY of its cells sits on an arrow, so agreement has to
be computed the same way. Scoring anchors alone was tried and it broke the
reference solution on all three test levels: a four-cell bar whose body crossed an
arrow placed for another block could no longer move.

Note for tuning: arrows PRUNE the solver's search — one test level fell from
26 000 states to 25. `demand` therefore understates the difficulty of an arrow
world, which is exactly right: fewer options for the machine, more traps for a
human.

### Shuttered gates (`shutters`) — built

A gate closed until N blocks have left, with the countdown shown and the gate
visibly dimmed. Also read off the solution: a gate first used at the seventh exit
can be shut for up to six.

One known coarseness: a solution step records a gate's SIDE, not its identity, so
two gates on the same side are conflated. The code always takes the earliest first
use, so it is conservative — a level can never be locked — but a gate that could
stay shut a long while is barely shut at all. Fixing it means giving solution
steps a gate index.

### Sliding blocks — NOT built

A block that slides until it hits something. It touches `step()`, the solver's
breadth-first walk (a cell CROSSED is no longer a cell you can STOP on, which
changes the successor function itself), `dragTowards`, and the backward walk. A
multi-file change to the engine a thousand levels depend on; it wants its own
pass.

---

## Two things that were measured and REJECTED

Recorded so nobody spends the afternoon again.

**Parking on dense boards.** A block moved somewhere it does not exit from, to
free the way for another. It works, it is verified by `solve(board, budget, 1)`,
and a playtest confirmed the levels are better. But it needs somewhere to park:
grafting it onto a finished grid landed three times in eight on world 2 and
**zero times in eight on world 15**. Built as a real world (10×12, 30-39 blocks)
it delivered on none of twenty levels. Dropping the density to `[0.18, 0.23]` got
one in twenty and cost the whole difficulty gain, back to 22-29 gestures.

Building the crossing into the walk instead — so the generator lays the remaining
pieces AROUND it and reserves the pocket — is implemented and still does not bite:
fourteen verifications out of eighteen came back "still solvable by ordering". The
reason is that the backward walk fixes only ONE valid order and the solver is
under no obligation to follow it; it sends the victim out first and the way is
clear. Requiring a mutual block was not enough either, because a large open board
almost always has another route. The next thing to try is targeting ARTICULATION
POINTS — cells whose removal disconnects the victim from every gate.

**Deliberate doubling back in the walk.** Buying gestures out of the route's
shape rather than its length. It makes levels EASIER: 29.3 gestures on average
without it, 26.5 with six reversals, 26.3 with twelve. A reversal costs walk
steps, so the block rests nearer its gate, and the distance lost outweighs the
gesture gained — and `dragTowards` cuts corners anyway, so most reversals collapse
back into one drag.
