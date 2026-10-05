/**
 * The exact solver, asked about a board IN PLAY — what the hint runs before
 * pointing at anything or charging for it.
 *
 * Anchors and one-way cells make some gestures irreversible: an anchor pushed
 * too early can stand where another block had to pass, and nothing can move it
 * back. The reference solution cannot tell that the player has left it for good,
 * and a hint read from it can point at a block that moves but no longer leads
 * anywhere. A hint must never be wrong, so it comes from a search started where
 * the player stands.
 *
 * Only on a tap of the bulb, never after every gesture, and in a worker: on a
 * low-end phone the search can take a couple of seconds, and the screen must
 * not freeze while it thinks.
 */

import { newState, sideOf } from './engine.js';
import { findSolution, replay } from './solve.js';
import { pathTo } from '../solver.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Search budget, in states. Sized for a 1 GB phone: the search keeps every
 * state it has seen, and this bounds both the memory and the wait on a slow
 * CPU (measures in AGENTS.md). Past it nothing is proven either way, and the
 * bulb says it has no hint rather than guess.
 */
export const LIVE_BUDGET = 15000;

/**
 * The search engine's view of `board` as it stands: every block of the level,
 * the ones already out at position -1, so that a key's lock still finds its
 * key by index; the gates with the room they have LEFT.
 */
export function engineOf(board) {
  const W = board.W;
  const index = new Map(board.level.blocks.map((b, i) => [b.id, i]));
  const blocks = board.level.blocks.map((b) => {
    const c = b.condition;
    return {
      cells: b.cells, kind: b.kind || 'normal', axis: b.axis || null, dir: b.dir || null,
      color: b.color, ...(b.colors ? { colors: b.colors } : {}), ...(b.isKey ? { isKey: true } : {}),
      condition: c && c.type === 'block' ? { type: 'block', index: index.get(c.id) } : c || null,
      cost: b.cells.length * (b.kind === 'bulky' ? 2 : 1),
    };
  });
  const arrows = new Int8Array(W * board.H);
  for (const [k, [dx, dy]] of board.arrows) {
    arrows[k] = 1 + DIRS.findIndex(([ax, ay]) => ax === dx && ay === dy);
  }
  const ctx = { W, H: board.H, gates: board.gates.map((g) => ({ ...g })), blocks, arrows };
  ctx.hasArrows = arrows.some((a) => a);
  const pos = board.level.blocks.map((b) => {
    const live = board.blocks.get(b.id);
    return live ? live.y * W + live.x : -1;
  });
  return { ctx, state: newState(ctx, pos) };
}

/**
 * The search itself — what the worker runs.
 * @returns {{status:'dead'} | {status:'unknown'} | {status:'ok', first:object|null}}
 *          `first` is the first gesture of a solution from here, safe exits
 *          included: `{type:'exit', i, p, dx, dy, gate}` or `{type:'park', i, to}`.
 */
export function searchFrom(ctx, state, budget = LIVE_BUDGET) {
  const r = findSolution(ctx, state, budget);
  if (!r) return { status: 'unknown' };
  if (r.dead) return { status: 'dead' };
  return { status: 'ok', first: replay(ctx, state.pos, r.moves).steps[0] || null };
}

/** Can the board still be cleared from here? true / false, or null when out of budget. */
export function stillSolvable(board, budget = LIVE_BUDGET) {
  const { ctx, state } = engineOf(board);
  const r = searchFrom(ctx, state, budget);
  return r.status === 'unknown' ? null : r.status === 'ok';
}

let worker = null;
let jobs = 0;

/** Runs `searchFrom` in a worker when the platform has one, inline otherwise (Node, tests). */
function run(ctx, state) {
  if (worker === null && typeof Worker !== 'undefined') {
    try { worker = new Worker(new URL('./hintWorker.js', import.meta.url), { type: 'module' }); } catch { worker = false; }
  }
  if (!worker) return Promise.resolve(searchFrom(ctx, state));
  const job = ++jobs;
  return new Promise((resolve) => {
    const done = (result) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      resolve(result);
    };
    const onMessage = ({ data }) => { if (data.job === job) done(data.result); };
    // A worker that fails to load proves nothing: inline, this once and after.
    const onError = () => { worker.terminate(); worker = false; done(searchFrom(ctx, state)); };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ job, ctx, state });
  });
}

/**
 * A gesture of the search, as the game's hint `{ id, gate, path }`. The search
 * only knows destinations; the path is the cell-by-cell route, which is what
 * the hint's ghost travels along. A slider's gesture is one straight run.
 */
function toAdvice(board, step) {
  const id = board.level.blocks[step.i].id;
  const block = board.blocks.get(id);
  const from = { x: block.x, y: block.y };
  const p = step.type === 'park' ? step.to : step.p;
  const to = { x: p % board.W, y: Math.floor(p / board.W) };
  const path = (block.kind !== 'slide' && pathTo(board, id, to.x, to.y)) || [from, to];
  return { id, gate: step.type === 'park' ? null : sideOf(step.dx, step.dy), path };
}

/**
 * What the bulb should say.
 * @returns {Promise<{dead:true} | {advice:object|null}>}
 *   dead   : proven — no way to win from here; the player restarts.
 *   advice : a gesture that provably still leads to a win, or null when the
 *            search found none in budget. Never a guess.
 */
export async function askHint(board) {
  // Untouched, the board is the one the reference solution was replayed on
  // when the level was built: its first step is proven, and free to give.
  const untouched = !board.exited.length
    && board.level.blocks.every((b) => board.blocks.get(b.id)?.x === b.x && board.blocks.get(b.id)?.y === b.y);
  if (untouched && board.level.solution?.length) {
    const ref = board.hint();
    if (ref) return { advice: ref };
  }
  const { ctx, state } = engineOf(board);
  const r = await run(ctx, state);
  if (r.status === 'dead') return { dead: true };
  if (r.status === 'ok') return { advice: r.first ? toAdvice(board, r.first) : null };
  return { advice: null };
}
