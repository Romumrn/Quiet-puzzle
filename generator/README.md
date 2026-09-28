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
difficulty-map.mjs   renders the whole database as one page — read it before tuning
templates/           the map's HTML shell
```

**50 worlds, 1000 levels.** Worlds 0–16 introduce one mechanic each; 17–49
combine two or three the player already knows.

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
   arrow; keep the change if the board needs as many parks or more. Stops at the
   level's target (`parks` ramped across the world).
3. **Capacity**, for worlds that have it: each gate gets exactly what the
   solution routes through it (margin zero), unused gates are dropped, and the
   search runs again under that constraint.
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

A world takes minutes to hours: 6×6 boards in seconds per level, 7×7 boards at
the top of the ramp several minutes. Build worlds in parallel (`--realm` per
process), then `--index-only`. The full 1000 took about nine hours on a
14-core laptop — under `caffeinate -is`: an idle Mac on AC still sleeps, and a
build that "runs" at 3 % CPU is a build the machine suspended.

## Two things that are expensive to forget

**Regenerating a published world changes its grids**, hence its star
thresholds, hence every record set against them. The 2026-09 rebuild was done
during the beta, with every player's progress reset.

**The ceiling is the search, not the board.** Past eight to eleven parks on a
7×7 board the state space outgrows the per-candidate budget (`climbBudget`,
40 000 states above 8 parks) and the climb stalls below its target — the build
reports it per level (`parksShort`). Asking for more parks there produces the
same boards and more warnings. Later worlds get harder by combining mechanics.

## Mechanics the solver sees

All of the game's: rails, walls, countdown locks, colour seals, key, joker,
anchors, heavy blocks (capacity cost ×2), two-colour blocks, shared gates,
narrow gates, large pieces, one-way cells, late gates, sliders. Each rule in
`rush/engine.js` names the `Board` method it mirrors — change one, change both.

Sliders are one gesture per run: a slider cannot be stopped short, so its
reachable positions are single runs, not a connected region, and
`measureGestures` counts a slide as one gesture whatever its length.
