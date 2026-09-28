# The level generator

Node only. Nothing served to the browser imports this folder — the game reads the
level database (Supabase first, `prototype/levels/` as a seed), never the
generator.

```
realms.js            the fifty worlds: identity, features, parks ramp → profileOf()
curve.js             limitsFor() — star thresholds, move and time limits
index.js             getLevel(n), and buildRealm() — the twenty levels, ordered
rush/engine.js       compact copy of board.js's rules, fast enough to search
rush/solve.js        solveParks() — the fewest parks that clear a board
rush/build.js        buildLevel() — random board, climb, capacity, real-engine check
rush/measure.js      measureGestures() — gestures of a reference solution
../prototype/src/core/sawtooth.js  realmShape() — a world's sawtooth, shared with the game
difficulty-map.mjs   renders the whole database as one page — read it before tuning
templates/           the map's HTML shell
```

**50 worlds, 1000 levels.** Worlds 1–17 introduce one mechanic each; 18–50
combine two or three the player already knows. (Worlds are numbered from 1 in
prose and from 0 in code: `realm 49` is world 50.)

---

## What makes a level hard

A **park** is a gesture that moves a block without taking it out. The generator
measures difficulty as the fewest parks a board needs, and how many separate
times the board jams along the way (`stuckPhases`).

Why parks: the thousand levels this generator replaced were built by walking
each block backwards out of its gate. Every block inherited a free path home, so
clearing whatever was free always freed the rest. Measured over that database, a
player picking free blocks **at random** won every level once gate capacity was
set aside, and not one reference solution contained a gesture that was not an
exit. Density, gate width, piece size, gesture floors — all turned up, none
changed that. Playtesting the replacement put "hard but fair" at **6 to 11
parks**, with the parks spread across the level rather than bunched at the start.

## How a level is built (`rush/build.js`)

1. **Random board.** Gates first; then the world's special blocks
   (`profile.counts`); then rails and free blocks up to the fill ratio. Every
   block gets a colour it can actually use under its own movement rule — a rail
   or an anchor never leaves its line, so its gate must sit on that line.
2. **Climb.** Move a block within its reach, re-draw one elsewhere, or move an
   arrow; keep the change if the board needs as many parks or more, and no more
   than the level's ceiling. Stops at the level's target (its sawtooth slot,
   between the world's `parks` bounds). Candidates get only 8 000 states.
3. **Capacity**, for worlds that have it: each gate gets exactly what the
   solution routes through it (margin zero), unused gates are dropped, and the
   search runs again under that constraint. Worlds with `traps` try the
   joker-re-routed variants too and climb once more for traps (`trapClimb`).
4. **Real-engine check.** The solution is replayed on `prototype/src/core/board.js`.
   Any disagreement discards the board. Nothing unverified reaches a player.

## The solver (`rush/solve.js`)

Every block leaves exactly once, so exits are a fixed cost. An exit is taken the
moment it is possible (`normalize`), which is always safe — it frees room,
advances countdowns, empties colours, opens shutters — **except under
capacity**: the room a block takes may be the room another needed. So a block
that could choose between gates with a capacity is a branch, a free one (it
costs no park). Hence a 0-1 breadth-first search: free branches stay in the
current layer, parks open the next.

A block that can reach only one gate is still taken greedily under capacity.
That is an approximation: a block's reachable gates change as others move, so
the search can overestimate parks on rare capacity boards. The reference
solution is still valid — it is replayed on the real engine.

## Adding or changing a world

**`realms.js`** — one line in `PLAN` (features, board, colours, parks ramp). A
new mechanic also needs an entry in `FEATURES` (name in five languages, what it
adds to the profile) and, if it introduces itself, a sentence in `INTRODUCES`.

A new world ALSO needs its identity row (`IDENTITY`), its branch image
(`prototype/tools/mondes.py`, `prototype/docs/decor-de-la-carte.md`) and one
`.realm:nth-child()` CSS rule in `prototype/styles/main.css`.

Then:

```bash
node prototype/tools/build-levels.mjs --realm 30    # one world
node prototype/tools/build-levels.mjs --index-only  # the catalogue, after names or texts
node generator/difficulty-map.mjs                   # look at it next to the others
node prototype/tools/test.mjs --solveur             # the grids are new: full pass
node tools/publish-levels.mjs --realm 30            # needs SUPABASE_TOKEN
```

A world takes minutes to hours, and a world is built ONE LEVEL AT A TIME on
one core. See "Rebuilding all 1000" below for how to keep a laptop busy.

## Two things that are expensive to forget

**Regenerating a published world changes its grids**, hence its star
thresholds, hence every record set against them. The 2026-09 rebuild was done
during the beta, with every player's progress reset.

**Level 1000 is hand-picked.** It was searched separately (world 50's profile,
seed 65352, target 23 parks → 24 with capacity) and pasted over the generated
summit. Rebuilding world 50 puts the generated 17-park summit back.

---

## History of the 2026-09 rebuild — what was tried, what held

Kept here because each of these cost hours to learn.

**1. Parks, not gestures.** The previous generator (backwards walks from each
gate) produced levels a random player cleared 100 % of the time. Difficulty is
now the fewest *parks*. Playtest put "hard but fair" at 6–11 parks spread across
the level.

**2. The validated ramp (playtest, 2026-09-27).** World 1: 5×5, 2–5 parks
("j'aime bien"). World 2: 5×6. World 3: 6×6, 8–10 ("exactement ce qu'on veut").
World 4: 6×7. Then 7×7 to level 200, 8×8 beyond. A 15-park level with traps at
level 141 needed its solution shown, so the 7×7 worlds peak around 12 (some
summits went higher; the user accepted it). Hard ceiling everywhere: 30 parks.

**3. The search budget was backwards.** The climb used to give each candidate
20 000–40 000 states and stalled at 8–10 parks on 7×7. Measured: levels at
13–19 parks solve within 10 000 states — hard boards are TIGHT, few blocks can
move. A generous budget spent its time on loose boards full of pointless moves.
At `climbBudget` 8 000 with long climbs (`iterations` 4000, `stall` 1500) the
climb reaches 13–22 parks on 7×7 and 8×8 in a couple of minutes.

**4. Solver speed.** `reach()` was 60 % of the time. Moves are now precomputed
per block and position as bitmasks over at most 64 cells (`precompute` in
engine.js): 5× faster, identical results on 800 boards, move for move.

**5. Traps — two false starts.** First attempt: count dead-end exits along the
solution. Always 0, because (a) a joker exits greedily by the first gate it
reaches and capacities are derived from that very solution, so that gate is
always the right one; (b) proving a state dead by search exhausted the budget.
Fixes: jokers under capacity are never greedy (`safeExit`); `capacityVariants`
re-routes a joker's places to ANOTHER gate, making the nearest one a trap;
`capacityDead` proves most dead ends by counting (Hall's condition over
colours) instead of searching. Result: 3–4 traps per level on trap worlds.

**6. Overshoot.** A climb can jump from 4 parks to 10. The first world's summit
came out at 10 for a target of 5. Each level is now capped at
`target + max(3, 70 % of target)`, and at 30 overall (`ceiling` in buildLevel).

**7. Sawtooth.** First version: a fixed cycle of 5 with a hard level every
fifth — the user found it predictable. Now random cycles of 3–6 per world,
seeded by the world's id, in `core/sawtooth.js` so the map's flames match what
was built. Levels are built for their slot's target, then dealt out by rank,
so the shape holds even when a level over- or undershoots.

**8. Daily challenges.** 6×6 rails and walls, 5–8 parks, one per date
(`prototype/tools/build-daily.mjs`). Capped effort (`maxEvaluations` 600): a
few seeds otherwise took 20 minutes. Days under 4 parks retry other seeds.

## Rebuilding all 1000

Measured on the 14-core laptop (2026-09-27/28): **about 9 hours**, 20:00 → 05:30.

- Keep the Mac awake: `caffeinate -is -t 86400 &`. An idle Mac on AC sleeps,
  and a build "running" at 3 % CPU is a suspended one.
- One process per world, 12–16 at once:
  `echo 49 47 45 … | tr ' ' '\n' | xargs -P 12 -I{} node prototype/tools/build-levels.mjs --realm {}`.
  **Order matters**: start the 8×8 trap worlds first (the build loads
  `--realm` in the order given). A first run put them in one pool and the other
  37 worlds queued behind a single free slot.
- Cost per level: 5×5–6×6 seconds; 7×7 a minute or two; 8×8 without traps
  2–5 min; **8×8 with traps 10–30 min**. Memory: ~650 MB per process — 22
  processes filled 36 GB; more would swap.
- The tail: when a few slow worlds remain, build them one LEVEL per process —
  same seeds, same grids:
  ```bash
  for k in $(seq 0 19); do node prototype/tools/build-slot.mjs 49 $k /tmp/slots & done; wait
  SLOTS_DIR=/tmp/slots node prototype/tools/build-levels.mjs --realm 49
  ```
  The night build ran a watchdog that did this automatically once the queue
  drained, then rebuilt any world with a level over the ceiling.
- Then `node prototype/tools/build-levels.mjs --index-only`, the base tests
  (`node prototype/tools/test.mjs` — NOT `--solveur`: it regenerates all 1000
  levels in one process, a day's work), and the difficulty map.
- Publishing: backup + reset player progress first (see AGENTS.md changelog
  2026-09-26), then `SUPABASE_TOKEN=… node tools/publish-levels.mjs` (51
  statements, a few minutes), then the web build (`prototype/tools/publier.mjs`
  → `docs/`, ships `daily.json` too) and a new Android versionCode.

## Mechanics the solver sees

All of the game's: rails, walls, countdown locks, colour seals, key, joker,
anchors, heavy blocks (capacity cost ×2), two-colour blocks, shared gates,
narrow gates, large pieces, one-way cells, late gates, sliders. Each rule in
`rush/engine.js` names the `Board` method it mirrors — change one, change both.

Sliders are one gesture per run: a slider cannot be stopped short, so its
reachable positions are single runs, not a connected region, and
`measureGestures` counts a slide as one gesture whatever its length.
