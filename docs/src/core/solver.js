/**
 * Solver — searches for an exit order that clears the grid.
 *
 * It serves two purposes:
 *  - the editor, which must be able to say whether a hand-drawn level holds up
 *    BEFORE it is handed to a player;
 *  - the tests, where it checks that generated levels are solvable WITHOUT
 *    using the reference solution, and therefore genuinely independently.
 *
 * Scope of the search: we look for the ORDER in which to clear the blocks, each
 * block reaching its gate along a breadth-first path. Auxiliary moves — nudging
 * a block aside without clearing it, to open a corridor — are not explored. So
 * "unsolved" means "no solution of this shape", not "unsolvable": the message
 * says as much.
 */

import { KIND } from './block.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Every gate this block can reach, one option per gate.
 *
 * They really must ALL be enumerated: a joker exits through any gate, and with
 * gates that have a capacity the choice of exit changes everything. Keeping
 * only the first gate found made levels that were perfectly solvable be
 * declared impossible.
 *
 * @returns {Array<{x,y,dx,dy,gate}>}
 */
function possibleExits(board, id) {
  const block = board.blocks.get(id);
  if (!block || !board.canMove(block)) return [];

  const start = { x: block.x, y: block.y };
  const seen = new Set([`${block.x},${block.y}`]);
  const queue = [[block.x, block.y]];
  const byGate = new Map();

  while (queue.length) {
    const [x, y] = queue.shift();
    block.x = x; block.y = y;
    board._reindex();

    for (const [dx, dy] of DIRS) {
      if (!board.acceptsDirection(block, dx, dy)) continue;

      const gate = board.exitPossible(block, dx, dy);
      if (gate) {
        if (!byGate.has(gate)) byGate.set(gate, { x, y, dx, dy, gate });
        continue;
      }

      const target = block.absolute().map(([cx, cy]) => [cx + dx, cy + dy]);
      if (target.some(([cx, cy]) => !board.inside(cx, cy))) continue;
      const free = target.every(([cx, cy]) => {
        const occ = board._occupancy.get(board._key(cx, cy));
        return occ === undefined || occ === id;
      });
      if (!free) continue;

      const k = `${x + dx},${y + dy}`;
      if (!seen.has(k)) { seen.add(k); queue.push([x + dx, y + dy]); }
    }
  }

  block.x = start.x; block.y = start.y;
  board._reindex();
  return [...byGate.values()];
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
 * @param {Board} board  board to solve (restored untouched)
 * @param {number} maxStates search budget, in explored states
 * @returns {{solvable:boolean, order:number[], states:number, gaveUp:boolean}}
 *          `gaveUp` signals that the search was cut short by the budget.
 */
export function solve(board, maxStates = 40000) {
  const start = board.snapshot();
  const seen = new Set();
  let states = 0;
  let gaveUp = false;

  // The key must include the gates' remaining capacity: two identical block
  // layouts whose gates have been eaten into differently are not the same
  // state.
  const key = () => [...board.blocks.values()]
    .map((b) => `${b.id}:${b.x},${b.y}`).sort().join('|')
    + '#' + board.gates.map((g) => g.capacity ?? '-').join(',');

  function explore() {
    if (board.remaining() === 0) return [];
    if (states++ > maxStates) { gaveUp = true; return null; }
    const k = key();
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
     * immediately — it will not leave until the grid changes, and nothing will
     * change if nobody leaves.
     */
    const candidates = [];
    for (const block of [...board.blocks.values()]) {
      if (block.kind === KIND.WALL) continue;
      candidates.push({ block, exits: possibleExits(board, block.id) });
    }
    candidates.sort((a, b) => a.exits.length - b.exits.length);

    for (const { block, exits } of candidates) {
      for (const exit of exits) {
        const snap = board.snapshot();
        block.x = exit.x; block.y = exit.y;
        board._reindex();
        const r = board.step(block.id, exit.dx, exit.dy);
        if (!r.ok || r.event.type !== 'exit') { board.restore(snap); continue; }

        const rest = explore();
        if (rest) return [block.id, ...rest];
        board.restore(snap);
        if (gaveUp) return null;
      }
    }
    return null;
  }

  const order = explore();
  board.restore(start);
  return { solvable: !!order, order: order || [], states, gaveUp };
}
