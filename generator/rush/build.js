/**
 * Builds one level from a world's profile — the "parks" generator.
 *
 * The previous generator walked every block backwards out of its own gate. That
 * guaranteed a solution and also guaranteed the level was easy: every block
 * inherited a free path home, and clearing whatever was free always freed the
 * rest. Measured over the thousand levels it produced, a player picking free
 * blocks AT RANDOM won every single one once gate capacity was set aside, and
 * not one reference solution contained a gesture that was not an exit.
 *
 * This one works the other way round, the way Rush Hour collections are made:
 * fill a board, ask an exact solver how many times a block must be moved ASIDE
 * before the board clears, and climb on that number. A level is hard when the
 * player has to see that something is in the way and find where to put it —
 * several times over, not just once at the start.
 *
 *   1. random board: gates first, then blocks whose colour lets them reach a gate
 *      under their own movement rules;
 *   2. hill climb: move a block within its reach, or re-draw it elsewhere; keep
 *      the change if the grid needs as many parks or more (`solve.js`);
 *   3. capacity, if the world has it: each gate gets exactly what the solution
 *      routes through it, and the search runs again under that constraint;
 *   4. the solution is replayed on the REAL `Board`. Any disagreement between
 *      the two engines discards the grid — nothing unverified reaches a player.
 */

import { Board } from '../../prototype/src/core/board.js';
import { pathTo } from '../../prototype/src/core/solver.js';
import { measureGestures } from './measure.js';
import { SIDE_VEC, colorsOf, reach, occupancy, occBits, newState } from './engine.js';
import { solveParks, replay, countTraps } from './solve.js';

const SHAPES = {
  n1: [[0, 0]],
  h2: [[0, 0], [1, 0]], v2: [[0, 0], [0, 1]],
  h3: [[0, 0], [1, 0], [2, 0]], v3: [[0, 0], [0, 1], [0, 2]],
  l3a: [[0, 0], [0, 1], [1, 1]], l3b: [[1, 0], [0, 1], [1, 1]],
  l3c: [[0, 0], [1, 0], [0, 1]], l3d: [[0, 0], [1, 0], [1, 1]],
  o4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  h4: [[0, 0], [1, 0], [2, 0], [3, 0]], v4: [[0, 0], [0, 1], [0, 2], [0, 3]],
};
const RAIL_H = ['h2', 'h2', 'h3'], RAIL_V = ['v2', 'v2', 'v3'];
const FREE = ['n1', 'n1', 'h2', 'v2', 'l3a', 'l3b', 'l3c', 'l3d'];
const LARGE_FREE = ['h3', 'v3', 'o4', 'h4', 'v4'];

/** Why candidate boards were thrown away — read it when a world under-delivers. */
export const BUILD_STATS = { boards: 0, noBoard: 0, unsolved: 0, capacityLost: 0, engineDisagreed: 0 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rng, [a, b]) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const shuffle = (rng, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const lr = (side) => side === 'left' || side === 'right';

// ---------------------------------------------------------------------------
// Random board
// ---------------------------------------------------------------------------

function makeGates(p, rng) {
  const gates = [];
  const colors = shuffle(rng, [...Array(p.colors).keys()]);
  let ci = 0;
  for (const side of shuffle(rng, ['left', 'right', 'top', 'bottom'])) {
    const span = lr(side) ? p.H : p.W;
    const n = range(rng, p.gatesPerSide);
    let at = Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const len = range(rng, p.gateLen);
      if (at + len > span) break;
      gates.push({ side, start: at, length: len, color: colors[ci++ % colors.length] });
      at += len + 1 + Math.floor(rng() * 2);
    }
  }
  // Shared gates serve a second colour; shutters open after a few exits.
  for (const g of shuffle(rng, gates.slice()).slice(0, p.sharedGates || 0)) {
    const other = pick(rng, [...Array(p.colors).keys()].filter((c) => c !== g.color));
    g.colors = [g.color, other];
  }
  for (const g of shuffle(rng, gates.slice()).slice(0, p.shutters || 0)) g.opensAfter = 1 + Math.floor(rng() * 3);
  return gates;
}

/**
 * The gates a block could ever leave by from here, under its own movement rule.
 * A rail or an anchor never leaves its line, so its gate must sit on that line;
 * a free block only needs a gate wide enough for it.
 */
function gateOptions(gates, b, x, y) {
  const rows = b.cells.map(([, cy]) => y + cy), cols = b.cells.map(([cx]) => x + cx);
  const h = new Set(rows).size, w = new Set(cols).size;
  const inLine = (g) => (lr(g.side) ? rows : cols).every((v) => v >= g.start && v < g.start + g.length);
  return gates.filter((g) => {
    if (b.kind === 'rail') return lr(g.side) === (b.axis === 'h') && inLine(g);
    if (b.kind === 'anchor') return g.side === b.dir && inLine(g);
    if (b.kind === 'slide') return inLine(g);
    return (lr(g.side) ? h : w) <= g.length;
  });
}

function drawShape(p, rng, kind) {
  if (kind === 'rail') {
    const k = pick(rng, rng() < 0.5 ? RAIL_H : RAIL_V);
    return { cells: SHAPES[k], axis: k[0] };
  }
  if (kind === 'anchor' || kind === 'slide') return { cells: SHAPES[pick(rng, ['n1', 'n1', 'h2', 'v2'])], axis: null };
  if (kind === 'wall') return { cells: SHAPES.n1, axis: null };
  let pool = p.largeShapes ? [...FREE, ...LARGE_FREE, ...LARGE_FREE] : FREE;
  if (p.minShapeSize) pool = pool.filter((k) => SHAPES[k].length >= p.minShapeSize);
  return { cells: SHAPES[pick(rng, pool)], axis: null };
}

/** Draws block `spec` somewhere free, with a colour it can actually use. */
function placeBlock(p, rng, gates, occ, spec) {
  for (let t = 0; t < 60; t++) {
    const { cells, axis } = drawShape(p, rng, spec.kind);
    const b = { ...spec, cells, axis, dir: spec.kind === 'anchor' ? pick(rng, ['left', 'right', 'top', 'bottom']) : null };
    const x = Math.floor(rng() * p.W), y = Math.floor(rng() * p.H);
    if (!cells.every(([cx, cy]) => x + cx < p.W && y + cy < p.H && occ[(y + cy) * p.W + x + cx] === -1)) continue;
    if (b.kind === 'wall') return { b: { ...b, color: -1 }, x, y };
    const opts = gateOptions(gates, b, x, y);
    if (!opts.length) continue;
    const g = pick(rng, opts);
    b.color = pick(rng, colorsOf(g));
    if (b.kind === 'dual') {
      const others = [...new Set(opts.flatMap(colorsOf))].filter((c) => c !== b.color);
      if (!others.length) continue;
      b.colors = [b.color, pick(rng, others)];
    }
    if (b.kind === 'joker') b.color = Math.floor(rng() * p.colors);
    return { b, x, y };
  }
  return null;
}

/** The kinds on this level, from the world's ramps. */
function composition(p, t, rng) {
  const at = ([a, b]) => Math.round(a + (b - a) * t);
  const specs = [];
  for (const [kind, span] of Object.entries(p.counts || {})) {
    for (let k = at(span); k > 0; k--) specs.push({ kind });
  }
  return specs;
}

export function randomBoard(p, t, rng) {
  const gates = makeGates(p, rng);
  if (!gates.length) return null;
  const occ = new Int16Array(p.W * p.H).fill(-1);
  const blocks = [], pos = [];
  const put = (b, x, y) => {
    const i = blocks.length;
    blocks.push(b); pos.push(y * p.W + x);
    for (const [cx, cy] of b.cells) occ[(y + cy) * p.W + x + cx] = i;
  };

  for (const spec of composition(p, t, rng)) {
    const r = placeBlock(p, rng, gates, occ, spec);
    if (r) put(r.b, r.x, r.y);
  }
  // Rails and free blocks fill the rest — rails most: they are what cannot
  // step aside, and that is where the difficulty lives.
  const target = Math.round(p.W * p.H * (p.fill[0] + (p.fill[1] - p.fill[0]) * t));
  let filled = blocks.reduce((s, b) => s + b.cells.length, 0);
  for (let tries = 0; filled < target && tries < 300; tries++) {
    const r = placeBlock(p, rng, gates, occ, { kind: rng() < p.railShare ? 'rail' : 'normal' });
    if (!r) continue;
    put(r.b, r.x, r.y);
    filled += r.b.cells.length;
  }

  // Conditions that name other blocks, once every block exists.
  const idx = blocks.map((b, i) => i);
  const locked = idx.filter((i) => blocks[i].kind === 'locked');
  if (p.key && locked.length) {
    const candidates = idx.filter((i) => blocks[i].kind === 'normal' || blocks[i].kind === 'rail');
    if (candidates.length) {
      const k = pick(rng, candidates);
      blocks[k].isKey = true;
      for (const i of locked.slice(0, Math.max(1, Math.ceil(locked.length / 2)))) blocks[i].condition = { type: 'block', index: k };
    }
  }
  for (const i of locked) {
    if (blocks[i].condition) continue;
    if (p.colorSeal && rng() < 0.5) {
      const colors = [...new Set(blocks.filter((b, j) => j !== i && b.kind !== 'wall' && b.kind !== 'joker').map((b) => b.color))]
        .filter((c) => c !== blocks[i].color);
      if (colors.length) { blocks[i].condition = { type: 'color', color: pick(rng, colors) }; continue; }
    }
    blocks[i].condition = { type: 'exits', count: 1 + Math.floor(rng() * (p.lockMax || 3)) };
  }

  const arrows = new Int8Array(p.W * p.H);
  const nArrows = p.oneWay ? range(rng, p.oneWay) : 0;
  for (let k = 0; k < nArrows; k++) arrows[Math.floor(rng() * p.W * p.H)] = 1 + Math.floor(rng() * 4);

  return finishCtx({ W: p.W, H: p.H, gates, blocks, arrows }, pos);
}

function finishCtx(ctx, pos) {
  for (const b of ctx.blocks) b.cost = b.cells.length * (b.kind === 'bulky' ? 2 : 1);
  ctx.hasArrows = !!ctx.arrows?.some((a) => a);
  return { ctx, pos: Int16Array.from(pos) };
}

// ---------------------------------------------------------------------------
// Climbing
// ---------------------------------------------------------------------------

function mutate(p, rng, cand) {
  const { ctx } = cand;
  const pos = Int16Array.from(cand.pos);
  const roll = rng();

  if (roll < 0.08 && p.oneWay) {
    const arrows = Int8Array.from(ctx.arrows);
    const on = [...arrows.keys()].filter((k) => arrows[k]);
    if (on.length) arrows[pick(rng, on)] = 0;
    arrows[Math.floor(rng() * p.W * p.H)] = 1 + Math.floor(rng() * 4);
    return finishCtx({ ...ctx, arrows }, pos);
  }

  const movable = ctx.blocks.map((b, i) => i).filter((i) => ctx.blocks[i].kind !== 'wall');
  const i = pick(rng, movable);
  if (roll < 0.55) {
    // Within reach: the grid stays the same grid, shuffled.
    const st = newState(ctx, pos);
    const cells = reach(ctx, st, occBits(ctx, st), i).cells;
    if (!cells.length) return null;
    pos[i] = pick(rng, cells);
    return { ctx, pos };
  }
  // Re-drawn: same kind and condition, new shape, place and colour.
  const occ = occupancy(ctx, newState(ctx, pos));
  for (let k = 0; k < occ.length; k++) if (occ[k] === i) occ[k] = -1;
  const old = ctx.blocks[i];
  const r = placeBlock(p, rng, ctx.gates, occ, { kind: old.kind, condition: old.condition, isKey: old.isKey });
  if (!r) return null;
  const blocks = ctx.blocks.slice();
  blocks[i] = r.b;
  // A colour seal must not wait on its own colour, nor on a colour gone from the grid.
  const seals = blocks.every((b) => b.condition?.type !== 'color'
    || blocks.some((o) => o !== b && o.color === b.condition.color && o.kind !== 'wall')
    && b.color !== b.condition.color);
  if (!seals) return null;
  pos[i] = r.y * p.W + r.x;
  return finishCtx({ ...ctx, blocks }, pos);
}

function evaluate(cand, budget) {
  const r = solveParks(cand.ctx, cand.pos, budget);
  if (!r || !Number.isFinite(r.parks)) return null;
  const { phases } = replay(cand.ctx, cand.pos, r.moves);
  // A "phase" is a park that unblocks something: the moments the player has
  // to stop and think again. Spread matters as much as the total — a level
  // whose parks are all at the start is easy once they are done.
  const stuckPhases = phases.slice(1).filter((e) => e > 0).length;
  const initialExits = phases[0];
  return { parks: r.parks, moves: r.moves, stuckPhases, initialExits,
    score: r.parks * 10 + stuckPhases * 6 - initialExits * 4 };
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * The capacities to try on a board, from its solution without capacity.
 *
 * First: each gate gets exactly what the solution sends through it, and the
 * gates it never uses go. Margin zero: a block routed to the wrong gate takes
 * room someone else needed.
 * Then, for worlds that want traps, the same with ONE joker re-routed: its
 * places moved from the gate it used to another one. The joker still has to
 * leave, but no longer by the first gate it reaches — and leaving by that one
 * takes places a coloured block needs, which then finds its gate at 0. When the
 * search confirms the board is still solvable that way, the gate that was
 * right is now a trap.
 */
function capacityVariants(cand, moves, traps) {
  const { steps } = replay(cand.ctx, cand.pos, moves);
  const used = cand.ctx.gates.map(() => 0);
  const jokers = [];
  for (const s of steps) {
    if (s.type !== 'exit') continue;
    used[s.gate] += cand.ctx.blocks[s.i].cost;
    if (cand.ctx.blocks[s.i].kind === 'joker') jokers.push(s);
  }
  const make = (caps) => ({
    ctx: { ...cand.ctx, gates: cand.ctx.gates.map((g, k) => ({ ...g, capacity: caps[k] })).filter((g) => g.capacity > 0) },
    pos: cand.pos,
  });
  const out = [make(used)];
  if (!traps) return out;
  for (const j of jokers) {
    const cost = cand.ctx.blocks[j.i].cost;
    for (let k = 0; k < used.length; k++) {
      if (k === j.gate) continue;
      const caps = used.slice();
      caps[j.gate] -= cost; caps[k] += cost;
      out.push(make(caps));
    }
  }
  return out;
}

const worth = (x) => x.parks * 10 + (x.traps || 0) * 12 + x.stuckPhases * 6 - x.initialExits * 4;

/** The best capacity variant that still solves (see `capacityVariants`). */
function bestCapped(p, cand, moves, budget) {
  let best = null;
  for (const c of capacityVariants(cand, moves, p.traps)) {
    const e = evaluate(c, budget);
    if (!e) continue;
    e.traps = p.traps ? countTraps(c.ctx, c.pos, e.moves) : 0;
    if (!best || worth(e) > worth(best.e)) best = { cur: c, e };
  }
  return best;
}

/**
 * A second climb, for worlds that want TRAPS (see `countTraps`): keep moving
 * blocks, keep the board if it needs as many parks and tempts the player into
 * more dead ends. It climbs on the board WITHOUT capacity and re-derives the
 * capacities from each candidate's own solution: capacities fixed once would
 * drop, one by one, every gate the first solution happened not to use — and
 * an unused gate is exactly where a joker gets tempted.
 */
function trapClimb(p, rng, raw, first, target, trapGoal, climb, budget, ceiling) {
  let best = { raw, ...first };
  // Stops at the goal: every try costs a solve per capacity variant and a
  // dead-end check per tempting exit, and 8×8 boards made this the longest
  // part of a level.
  for (let it = 0; it < (p.trapIterations || 60) && (best.e.traps < trapGoal || best.e.parks < target); it++) {
    const m = mutate(p, rng, best.raw);
    if (!m) continue;
    const me = evaluate(m, climb);
    if (!me) continue;
    const c = bestCapped(p, m, me.moves, budget);
    if (!c || c.e.parks < Math.min(best.e.parks, target) || c.e.parks > ceiling) continue;
    if (worth(c.e) >= worth(best.e)) best = { raw: m, ...c };
  }
  return { cur: best.cur, e: best.e };
}

// ---------------------------------------------------------------------------
// Real-engine replay
// ---------------------------------------------------------------------------

function toLevel(cand) {
  const { ctx, pos } = cand;
  const W = ctx.W;
  const blocks = ctx.blocks.map((b, i) => {
    const out = { id: i + 1, color: b.color, cells: b.cells, x: pos[i] % W, y: Math.floor(pos[i] / W),
      kind: b.kind, axis: b.axis || null, dir: b.dir || null };
    if (b.colors) out.colors = b.colors;
    if (b.isKey) out.isKey = true;
    if (b.condition) {
      out.condition = b.condition.type === 'block' ? { type: 'block', id: b.condition.index + 1 } : b.condition;
    }
    return out;
  });
  const oneWay = [];
  ctx.arrows?.forEach((a, k) => {
    if (a) { const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][a - 1]; oneWay.push({ x: k % W, y: Math.floor(k / W), dx, dy }); }
  });
  const gates = ctx.gates.map(({ side, start, length, color, colors, capacity, opensAfter }) => ({
    side, start, length, color,
    ...(colors ? { colors } : {}), ...(capacity !== undefined ? { capacity } : {}), ...(opensAfter ? { opensAfter } : {}),
  }));
  return { width: W, height: ctx.H, gates, blocks, ...(oneWay.length ? { oneWay } : {}) };
}

/** Replays on `Board`; returns the game's reference solution, or null on any disagreement. */
function verify(cand, moves) {
  const level = toLevel(cand);
  const board = new Board({ ...level, moveLimit: 9999, timeLimit: 9999, solution: [] });
  const { steps } = replay(cand.ctx, cand.pos, moves);
  const W = cand.ctx.W;
  const solution = [];
  const at = (id) => board.blocks.get(id);

  for (const s of steps) {
    const id = s.i + 1;
    const b = at(id);
    if (!b) return null;
    const slider = b.kind === 'slide';
    const home = { x: b.x, y: b.y };

    if (s.type === 'exit') {
      let path = [home];
      if (!slider && s.p !== home.y * W + home.x) {
        path = pathTo(board, id, s.p % W, Math.floor(s.p / W));
        if (!path) return null;
        for (const q of path.slice(1)) board.dragTowards(id, q.x, q.y);
      }
      const r = board.step(id, s.dx, s.dy);
      if (!r.ok || r.event.type !== 'exit') return null;
      if (board.gates.indexOf(r.event.gate) !== s.gate) return null;
      // The solution format wants a start and an end, even when the block
      // leaves from where it stands.
      solution.push({ id, gate: r.event.gate.side, path: path.length > 1 ? path : [home, home] });
    } else {
      const tx = s.to % W, ty = Math.floor(s.to / W);
      let path;
      if (slider) {
        const dx = Math.sign(tx - home.x), dy = Math.sign(ty - home.y);
        if (!board.step(id, dx, dy).ok) return null;
        path = [home, { x: tx, y: ty }];
      } else {
        path = pathTo(board, id, tx, ty);
        if (!path) return null;
        for (const q of path.slice(1)) board.dragTowards(id, q.x, q.y);
      }
      const now = at(id);
      if (!now || now.x !== tx || now.y !== ty) return null;
      solution.push({ id, gate: null, path });
    }
    board.endGesture(true);
  }
  if (!board.isSolved()) return null;
  return { level, solution };
}

// ---------------------------------------------------------------------------

/**
 * @param p     the world's profile (see realms.js)
 * @param t     position in the world, 0 … 1
 * @param seed  the level number — same seed, same grid
 */
export function buildLevel(p, t, seed) {
  const rng = mulberry32(seed * 7919 + 17);
  const target = Math.round(p.parks[0] + (p.parks[1] - p.parks[0]) * t);
  // A hard ceiling, whatever the climb stumbles on: past 30 parks a level stops
  // being a puzzle and becomes a chore (playtest, 2026-09-27).
  // And a level may overshoot its own target only so far: a climb can jump from
  // 4 parks to 10, and a first-world level at 10 is not a first-world level.
  // `overshoot` tightens that for a world that must read as a smooth ramp.
  const ceiling = Math.min(p.maxParks || 30, target + (p.overshoot ?? Math.max(3, Math.round(target * 0.7))));
  // One trap on the easiest levels of a trap world, four on its summit.
  const trapGoal = 1 + Math.round(3 * t);
  // Climbing tries thousands of boards, most of them dead ends: a small budget
  // there, the full one only for what is kept. SMALL on purpose, and not only
  // for speed: a board that needs many parks is a TIGHT board — few blocks can
  // move at all — and its whole search fits in a few thousand states (levels
  // at 13 to 19 parks solve within 10 000). A board that overflows the budget
  // is a loose one, full of pointless moves. A generous budget spent its time
  // on those, and the climb stalled at 8–10 parks; at 8 000 it reaches 13–22
  // on 7×7 and 8×8 in a couple of minutes.
  const budget = p.budget || 120000;
  const climb = p.climbBudget || 8000;
  let best = null;
  /**
   * A cap on the WORK per level, counted in solver runs rather than seconds so
   * the same seed still gives the same grid on any machine. Without it a level
   * that cannot reach its target spends every restart before giving up — the
   * few such levels were most of the build time.
   */
  const maxEvaluations = p.maxEvaluations || 12000;
  let evaluations = 0;
  const judge = (c, b) => { evaluations++; return evaluate(c, b); };

  for (let restart = 0; restart < (p.restarts || 30) && evaluations < maxEvaluations; restart++) {
    // Each restart asks for a slightly emptier board: a profile that jams
    // every board it draws (large pieces, anchors and walls on 7×7) otherwise
    // never gets a first solvable one to climb from.
    const fillScale = Math.max(0.75, 1 - 0.03 * restart);
    let cur = randomBoard({ ...p, fill: p.fill.map((f) => f * fillScale) }, t, rng);
    BUILD_STATS.boards++;
    if (!cur) { BUILD_STATS.noBoard++; continue; }
    let e = judge(cur, climb);
    // A jammed board is repaired, not thrown away: a few re-draws usually
    // unjam it, and it then climbs like any other.
    for (let fix = 0; !e && fix < 15 && evaluations < maxEvaluations; fix++) {
      const m = mutate(p, rng, cur);
      if (!m) continue;
      cur = m;
      e = judge(cur, climb);
    }
    if (!e) { BUILD_STATS.unsolved++; continue; }
    // Long climbs, sideways moves allowed (>=): the parks come in bursts after
    // long plateaus. A climb that has not improved in `stall` tries is spent,
    // and the next restart gets the evaluations.
    let bestScore = e.score, since = 0;
    for (let it = 0; it < (p.iterations || 4000) && e.parks < target && evaluations < maxEvaluations; it++) {
      const m = mutate(p, rng, cur);
      if (!m) continue;
      const me = judge(m, climb);
      if (me && me.parks <= ceiling && me.score >= e.score) { cur = m; e = me; }
      if (e.score > bestScore) { bestScore = e.score; since = 0; p.onProgress?.(e.parks); } else if (++since > (p.stall || 1500)) break;
    }
    if (p.capacity) {
      const capped = bestCapped(p, cur, e.moves, budget);
      if (!capped) { BUILD_STATS.capacityLost++; continue; }
      if (p.traps) ({ cur, e } = trapClimb(p, rng, cur, capped, target, trapGoal, climb, budget, ceiling));
      else ({ cur, e } = capped);
    }
    if (e.parks > ceiling) continue;
    const checked = verify(cur, e.moves);
    if (!checked) { BUILD_STATS.engineDisagreed++; continue; }
    // Closest to the target from above wins; below it, the highest.
    const better = !best
      || (e.parks >= target && (best.e.parks < target || e.parks < best.e.parks || (e.parks === best.e.parks && e.score > best.e.score)))
      || (e.parks < target && best.e.parks < target && e.score > best.e.score);
    if (better) best = { cand: cur, e, checked };
    if (best.e.parks >= target) break;
  }
  if (!best) return null;

  const { level, solution } = best.checked;
  // A gate no block's colour can use is a promise the board never keeps. Only
  // a joker could take it, so it goes when there is none.
  if (!level.blocks.some((b) => b.kind === 'joker')) {
    const used = new Set(level.blocks.filter((b) => b.kind !== 'wall').flatMap(colorsOf));
    level.gates = level.gates.filter((g) => colorsOf(g).some((c) => used.has(c)));
  }
  const minDrags = measureGestures({ ...level, solution });
  return {
    W: level.width, H: level.height, gates: level.gates, blocks: level.blocks, oneWay: level.oneWay,
    colorCount: new Set(level.gates.flatMap(colorsOf)).size,
    solution, minDrags,
    parks: best.e.parks, stuckPhases: best.e.stuckPhases, targetParks: target,
    ...(best.e.traps ? { traps: best.e.traps } : {}),
    ...(best.e.parks < target ? { parksShort: target } : {}),
  };
}

