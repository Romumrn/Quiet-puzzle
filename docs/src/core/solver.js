/**
 * Solver — searches for a way to clear the grid.
 *
 * It serves two purposes:
 *  - the editor, which must be able to say whether a hand-drawn level holds up
 *    BEFORE it is handed to a player;
 *  - the tests, where it checks that generated levels are solvable WITHOUT
 *    using the reference solution, and therefore genuinely independently.
 *
 * TWO SHAPES OF SOLUTION
 *
 * By default the search looks only for an ORDER in which to clear the blocks,
 * each block reaching its gate along a breadth-first path. That is the shape the
 * generator produces: `build()` walks every block backwards in from its gate, so
 * the level is solvable by construction and no block ever has to be moved aside
 * and left there.
 *
 * It is also the ceiling of the genre. Measured over the shipped database, the
 * first seven realms clear on a UNIFORMLY RANDOM exit order a hundred times out
 * of a hundred: the player is not choosing, they are tidying. Density, gates,
 * piece sizes and capacity all change how hard the order is to find; none of
 * them changes what kind of problem it is.
 *
 * `maxParks` opens the second shape: a block may be moved somewhere it does not
 * exit from, to free the way for another. That is a spatial problem rather than
 * a bookkeeping one — you have to see that a block is in the way and that there
 * is somewhere to put it — and no amount of counting capacities answers it.
 *
 * It defaults to ZERO, which reproduces the previous search exactly, node for
 * node. Nothing that exists today changes shape because this was added; the
 * generator and the offline tools opt in.
 */

import { KIND } from './block.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Everywhere a block can go, every gate it can leave by, and everything
 * standing in its way.
 *
 * One breadth-first walk answers all three, and the three are wanted together:
 * the exits drive the ordering search, the cells are where a block can be
 * PARKED, and the blockers are who to park when a block is stuck.
 *
 * Every gate really must be enumerated: a joker leaves by any gate, and with
 * gates that have a capacity the choice of exit changes everything. Keeping only
 * the first gate found made levels that were perfectly solvable be declared
 * impossible.
 *
 * @returns {{exits: Array<{x,y,dx,dy,gate}>, cells: Array<[number,number]>, blockers: Set<number>}}
 */
function reachability(board, id) {
  const block = board.blocks.get(id);
  if (!block || !board.canMove(block)) {
    return { exits: [], cells: [], blockers: new Set() };
  }

  const start = { x: block.x, y: block.y };
  const seen = new Set([`${block.x},${block.y}`]);
  const cells = [[block.x, block.y]];
  const queue = [[block.x, block.y]];
  const byGate = new Map();
  const blockers = new Set();

  while (queue.length) {
    const [x, y] = queue.shift();
    block.x = x; block.y = y;
    board._reindex();

    for (const [dx, dy] of DIRS) {
      // Rails only travel on their axis, and an anchor only towards its gate —
      // so an anchor can never step aside for anything, which is the point of
      // it. The walk inherits both rules for free.
      if (!board.acceptsDirection(block, dx, dy)) continue;

      const gate = board.exitPossible(block, dx, dy);
      if (gate) {
        if (!byGate.has(gate)) byGate.set(gate, { x, y, dx, dy, gate });
        continue;
      }

      const target = block.absolute().map(([cx, cy]) => [cx + dx, cy + dy]);
      if (target.some(([cx, cy]) => !board.inside(cx, cy))) continue;

      let free = true;
      for (const [cx, cy] of target) {
        const occ = board._occupancy.get(board._key(cx, cy));
        if (occ === undefined || occ === id) continue;
        free = false;
        // Whoever is in the way is a parking candidate: moving THEM is the only
        // thing that can ever open this direction.
        blockers.add(occ);
      }
      if (!free) continue;

      /**
       * A SLIDER lands where the run ends, not one cell along.
       *
       * This is the whole reason sliding could not simply be bolted onto
       * `step()`: the search's successor function changes shape. A cell the
       * block passes OVER is not a cell it can stop ON, and walking the grid one
       * cell at a time would have the solver plan through positions no player
       * could ever reach — levels declared solvable that are not.
       */
      let nx = x + dx, ny = y + dy;
      if (block.kind === KIND.SLIDE) {
        const to = board.slideTarget(block, dx, dy);
        if (to.leaves) {
          // The run carries it out. The launch position is where it stands now —
          // that is what `step` replays — but the GATE is the one found at the
          // far end, which only `slideTarget` can name.
          if (to.gate && !byGate.has(to.gate)) byGate.set(to.gate, { x, y, dx, dy, gate: to.gate });
          continue;
        }
        if (!to.moved) continue;
        nx = to.x; ny = to.y;
      }

      const k = `${nx},${ny}`;
      if (!seen.has(k)) {
        seen.add(k);
        cells.push([nx, ny]);
        queue.push([nx, ny]);
      }
    }
  }

  block.x = start.x; block.y = start.y;
  board._reindex();
  return { exits: [...byGate.values()], cells, blockers };
}

/**
 * Can this block reach a gate right now, on its own?
 *
 * One breadth-first walk instead of a whole search. The generator uses it to
 * throw out a parking candidate before paying for the solver: if the block it
 * meant to trap can still walk to a gate, nothing was trapped, and a full search
 * would spend a second to say so.
 */
export function hasExit(board, id) {
  return reachability(board, id).exits.length > 0;
}

/**
 * The cell-by-cell route a block takes from where it stands to `tx,ty`.
 *
 * The search returns DESTINATIONS — it teleports a block to a reachable spot
 * and carries on, because for deciding solvability the route never matters. A
 * reference solution is the opposite: `measureGestures()` walks the waypoints to
 * count how many drags a finger really needs, and the test harness replays them
 * one by one. So a solution built from a search result has to be given its route
 * back, and this is what gives it.
 *
 * Breadth-first, so the route is the shortest one; `null` when the target is not
 * reachable. The board is left exactly as it was found.
 *
 * @returns {Array<{x:number,y:number}>|null} start position included.
 */
export function pathTo(board, id, tx, ty) {
  const block = board.blocks.get(id);
  if (!block || !board.canMove(block)) return null;

  const home = { x: block.x, y: block.y };
  const key = (x, y) => `${x},${y}`;
  const from = new Map([[key(home.x, home.y), null]]);
  const queue = [[home.x, home.y]];
  let found = home.x === tx && home.y === ty;

  while (queue.length && !found) {
    const [x, y] = queue.shift();
    block.x = x; block.y = y;
    board._reindex();

    for (const [dx, dy] of DIRS) {
      if (!board.acceptsDirection(block, dx, dy)) continue;
      const target = block.absolute().map(([cx, cy]) => [cx + dx, cy + dy]);
      if (target.some(([cx, cy]) => !board.inside(cx, cy))) continue;
      const free = target.every(([cx, cy]) => {
        const occ = board._occupancy.get(board._key(cx, cy));
        return occ === undefined || occ === id;
      });
      if (!free) continue;

      const k = key(x + dx, y + dy);
      if (from.has(k)) continue;
      from.set(k, [x, y]);
      if (x + dx === tx && y + dy === ty) { found = true; break; }
      queue.push([x + dx, y + dy]);
    }
  }

  block.x = home.x; block.y = home.y;
  board._reindex();
  if (!found) return null;

  const route = [];
  for (let at = [tx, ty]; at; at = from.get(key(at[0], at[1]))) route.push({ x: at[0], y: at[1] });
  return route.reverse();
}

/**
 * Search budget for the offline tools (tests, balancing). Far larger than the
 * default: the editor has to answer on click, whereas a command-line check can
 * afford to think for a few seconds. The grids of the last realm, whose gates
 * have no capacity slack left, open a tree of dead ends where an exhaustive
 * search goes well beyond the interactive budget — without the level being hard
 * to read for a player, who routes blocks by reading capacities instead of
 * enumerating orders.
 */
export const OFFLINE_BUDGET = 200000;

/**
 * Caps on the parking search.
 *
 * Free movement is not searchable: thirty blocks over twenty reachable cells is
 * six hundred branches per node, and unlike an exit a park does not remove a
 * block, so the tree never shrinks. These four caps are what keep it finite.
 *
 * They are also the right DESIGN bounds, which is why they are this tight. A
 * puzzle that needs five blocks shuffled before anything can leave is not
 * harder, it is unreadable; the interesting level is the one where a single
 * block is plainly in the way and there is exactly one sensible place to put it.
 */
const PARK_STUCK = 3;      // blocked blocks examined per dead end
const PARK_BLOCKERS = 3;   // blockers tried per blocked block
const PARK_CELLS = 12;     // destinations tried per blocker
const PARK_BRANCHES = 6;   // parks explored per dead end, all told

/**
 * Parks worth trying at a dead end.
 *
 * The filter is what makes this affordable: a park is only ever proposed if,
 * once applied, a block that could NOT leave now can. Moving a block for no
 * reason is the combinatorial disaster; moving one that demonstrably unblocks
 * something is a handful of branches.
 */
function usefulParks(board, candidates) {
  const parks = [];

  const stuck = candidates
    .filter((c) => c.reach.exits.length === 0 && board.canMove(c.block))
    .slice(0, PARK_STUCK);

  for (const { block: blocked } of stuck) {
    // Recomputed rather than reused: an earlier park in this same loop may have
    // changed who is in the way.
    const blockers = [...reachability(board, blocked.id).blockers].slice(0, PARK_BLOCKERS);

    for (const blockerId of blockers) {
      const mover = board.blocks.get(blockerId);
      if (!mover || mover.kind === KIND.WALL || !board.canMove(mover)) continue;

      const home = { x: mover.x, y: mover.y };
      const spots = reachability(board, blockerId).cells
        .filter(([x, y]) => x !== home.x || y !== home.y)
        .slice(0, PARK_CELLS);

      for (const [x, y] of spots) {
        mover.x = x; mover.y = y;
        board._reindex();
        const opened = reachability(board, blocked.id).exits.length > 0;
        mover.x = home.x; mover.y = home.y;
        board._reindex();

        if (!opened) continue;
        parks.push({ id: blockerId, x, y, frees: blocked.id });
        if (parks.length >= PARK_BRANCHES) return parks;
      }
    }
  }

  return parks;
}

/**
 * @param {Board} board  board to solve (restored untouched)
 * @param {number} maxStates search budget, in explored states
 * @param {number} maxParks  how many blocks may be moved WITHOUT exiting.
 *        Zero — the default — reproduces the exit-order-only search exactly.
 * @returns {{solvable:boolean, order:number[], moves:object[], parks:number,
 *            states:number, gaveUp:boolean}}
 *          `order` is the exit order, block ids only, unchanged by this option.
 *          `moves` is the full solution including parks, and is REPLAYABLE: each
 *          step carries the position to drag the block to, so a caller can
 *          `dragTowards(id, x, y)` and then, for an exit, step through the gate.
 *          `{type:'exit', id, gate, x, y}` — x,y is where the block leaves FROM,
 *          which is not where it started; `{type:'park', id, x, y}`.
 *          `gaveUp` signals that the search was cut short by the budget.
 */
export function solve(board, maxStates = 40000, maxParks = 0) {
  const start = board.snapshot();
  let states = 0;

  /**
   * DEEPENING ON PARKS, one pass per allowance, cheapest first.
   *
   * Exploring parks inside a single pass was measured and it is strictly worse:
   * on the dense realms it turned 3 solved out of 3 into 2, and 13 000 states
   * into 103 000. Those grids ARE solvable by ordering — but a dense grid has an
   * enormous number of dead ends, and branching on parks at every one of them
   * burned the budget before the ordering search could finish. The feature made
   * the solver fail on levels it used to clear.
   *
   * So each allowance gets its OWN pass and its OWN budget. Pass zero is the
   * old search, unchanged and uncontended; a level that clears by ordering costs
   * exactly what it always did and never pays for a feature it does not use.
   * Only a level that ordering genuinely cannot clear goes on to pass one.
   *
   * That ordering is also what the generator needs: a level REQUIRES parking
   * precisely when pass zero fails cleanly and a later pass succeeds. The
   * discriminator falls out of the search instead of having to be measured
   * separately.
   */
  for (let allowance = 0; allowance <= maxParks; allowance++) {
    const pass = attempt(allowance);
    states += pass.states;

    if (pass.moves) return report(pass.moves, states, false);

    // A pass that ran out of budget proved nothing: the ordering search did not
    // even finish, and handing it parks on top can only make it slower. Stop and
    // say so rather than spending the next budget to fail again.
    if (pass.gaveUp) return report(null, states, true);
  }

  return report(null, states, false);

  function report(moves, total, gaveUp) {
    board.restore(start);
    return {
      solvable: !!moves,
      order: (moves || []).filter((m) => m.type === 'exit').map((m) => m.id),
      moves: moves || [],
      parks: (moves || []).filter((m) => m.type === 'park').length,
      states: total,
      gaveUp,
    };
  }

/** One pass: clear the grid using at most `maxParks` parking moves. */
function attempt(maxParks) {
  const seen = new Set();
  let states = 0;
  let gaveUp = false;

  // The key must include the gates' remaining capacity: two identical block
  // layouts whose gates have been eaten into differently are not the same
  // state. It must also include the parks left, for the same reason — the same
  // position with a park in hand is not the same position without one.
  const key = (parksLeft) => [...board.blocks.values()]
    .map((b) => `${b.id}:${b.x},${b.y}`).sort().join('|')
    + '#' + board.gates.map((g) => g.capacity ?? '-').join(',')
    + '#' + parksLeft;

  function explore(parksLeft) {
    if (board.remaining() === 0) return [];
    if (states++ > maxStates) { gaveUp = true; return null; }
    const k = key(parksLeft);
    if (seen.has(k)) return null;
    seen.add(k);

    /**
     * THE MOST CONSTRAINED blocks first.
     *
     * Insertion order made the search start with blocks that have five possible
     * gates, whereas a block with only one leaves no choice at all: clearing it
     * early closes the tree instead of multiplying it. On grids with shared
     * gates, where every block aims at several exits, this single heuristic is
     * the difference between one second and giving up.
     *
     * A block with NO possible exit comes first and prunes the branch
     * immediately — and, when parking is allowed, it is also exactly the block
     * the parking search below is trying to free.
     */
    const candidates = [];
    for (const block of [...board.blocks.values()]) {
      if (block.kind === KIND.WALL) continue;
      candidates.push({ block, reach: reachability(board, block.id) });
    }
    candidates.sort((a, b) => a.reach.exits.length - b.reach.exits.length);

    for (const { block, reach } of candidates) {
      for (const exit of reach.exits) {
        const snap = board.snapshot();
        block.x = exit.x; block.y = exit.y;
        board._reindex();
        const r = board.step(block.id, exit.dx, exit.dy);
        if (!r.ok || r.event.type !== 'exit') { board.restore(snap); continue; }

        const rest = explore(parksLeft);
        if (rest) return [{ type: 'exit', id: block.id, gate: exit.gate, x: exit.x, y: exit.y }, ...rest];
        board.restore(snap);
        if (gaveUp) return null;
      }
    }

    /**
     * Only once every exit has failed. Parking is the expensive branch and the
     * rare one: a level that can be cleared by ordering alone never reaches
     * this line, so the cost is paid only where the ordering search was going
     * to fail anyway.
     */
    if (parksLeft > 0) {
      for (const park of usefulParks(board, candidates)) {
        const snap = board.snapshot();
        const mover = board.blocks.get(park.id);
        mover.x = park.x; mover.y = park.y;
        board._reindex();

        const rest = explore(parksLeft - 1);
        if (rest) return [{ type: 'park', id: park.id, x: park.x, y: park.y }, ...rest];
        board.restore(snap);
        if (gaveUp) return null;
      }
    }

    return null;
  }

  const moves = explore(maxParks);
  board.restore(start);
  return { moves, states, gaveUp };
}
}
