/**
 * The placement algorithm — levels are generated BACKWARDS.
 *
 * Instead of dropping blocks at random and hoping the result is playable, each
 * block is brought IN through its gate and then walked back into the grid. A
 * level built this way is solvable by construction, and the backward walk
 * yields a reference solution for free — used by the tests, by balancing, and
 * available to the hint system.
 *
 * The solving order is the reverse of the placement order: the last block
 * placed is the first to leave, and its path is clear since it was carved out
 * when only the earlier blocks were there.
 *
 * The RNG is seeded: level n always produces the same grid. Nothing in this
 * file may depend on TOTAL_LEVELS — adding a realm must not change a grid that
 * is already published.
 */

import { SHAPES, LARGE_SHAPES, KIND, capacityCost, colorsOf } from '../prototype/src/core/block.js';
import { Board, SIDES as EXIT_VECTORS } from '../prototype/src/core/board.js';
import { solve } from '../prototype/src/core/solver.js';
import { LEVELS_PER_REALM } from './realms.js';
import { curve } from './curve.js';

const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Can a block placed in a gate's opening really get out of it?
 *
 * A non-rectangular shape (T, L) hangs over on both sides of the gate: its
 * shoulders must be able to advance too. Without this check, generation
 * produced levels whose solution only held together because the engine let a
 * block pass straight through its neighbours.
 */
function canLeaveItsGate(grid, gate, shape, x, y, id) {
  const [dx, dy] = EXIT_VECTORS[gate.side];
  return shape.cells.every(([cx, cy]) => {
    const nx = x + cx + dx, ny = y + cy + dy;
    if (!grid.inside(nx, ny)) return true;
    const occ = grid.occ.get(grid.key(nx, ny));
    return occ === undefined || occ === id;
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffled = (rng, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ---------------------------------------------------------------------------
// Working grid
// ---------------------------------------------------------------------------

class Grid {
  constructor(W, H) { this.W = W; this.H = H; this.occ = new Map(); }
  key(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }
  free(cells, except) {
    return cells.every(([x, y]) => {
      if (!this.inside(x, y)) return false;
      const o = this.occ.get(this.key(x, y));
      return o === undefined || o === except;
    });
  }
  place(id, cells) { for (const [x, y] of cells) this.occ.set(this.key(x, y), id); }
  remove(cells) { for (const [x, y] of cells) this.occ.delete(this.key(x, y)); }
}

const absolute = (shape, x, y) => shape.cells.map(([dx, dy]) => [x + dx, y + dy]);

/** Gates: spread over the sides, never overlapping, every colour served. */
function makeGates({ W, H, colorCount, gateCount, wideGateRatio, sharedGates }, rng) {
  const gates = [];
  const bySide = { top: [], right: [], bottom: [], left: [] };
  const lengthOf = (side) => (side === 'top' || side === 'bottom' ? W : H);

  const colors = shuffled(rng, [...Array(colorCount).keys()]);
  for (let i = 0; i < gateCount; i++) {
    const color = colors[i % colorCount];
    for (let attempt = 0; attempt < 40; attempt++) {
      const side = pick(rng, SIDES);
      const max = lengthOf(side);
      // `wideGateRatio` is the share of three-cell gates. Bringing it down to
      // zero only ever opens two-cell passages: bulky shapes then have to aim
      // precisely, and the choice of gate stops being a formality.
      const length = Math.min(max, rng() < wideGateRatio ? 3 : 2);
      const start = Math.floor(rng() * (max - length + 1));
      const overlaps = bySide[side].some((g) => start < g.start + g.length && g.start < start + length);
      if (overlaps) continue;
      const gate = { side, start, length, color };
      bySide[side].push(gate);
      gates.push(gate);
      break;
    }
  }

  // Shared gates: a second colour admitted. The player gains an option, and
  // loses the certainty that a gate only serves one family — two colours then
  // compete for the same capacity.
  for (let i = 0; i < (sharedGates || 0) && i < gates.length; i++) {
    const g = gates[gates.length - 1 - i];
    const others = colors.filter((c) => c !== g.color);
    if (!others.length) break;
    g.colors = [g.color, pick(rng, others)];
  }
  return gates;
}

/**
 * Keeps only the gates a placed block can actually use.
 *
 * Gates are opened BEFORE any block — one per realm colour — and the backward
 * placement starts from them. When it never manages to bring a block in through
 * one of them (walls, capacity, a shape too big, or the block quota reached
 * before its turn), that gate is left with no customers. This is not difficulty
 * but a FALSE CLUE: the player hunts for blocks of a colour that is not on the
 * grid. There were 125 of them, across 117 levels.
 *
 * Removing them cannot break anything: a gate no block accepts appears in no
 * solution — steps name a SIDE, not an index — and capacity is provisioned gate
 * by gate.
 *
 * A joker exits through any gate: its presence makes them all useful, and there
 * is nothing to remove.
 */
function usefulGates(gates, blocks) {
  if (blocks.some((b) => b.kind === KIND.JOKER)) return gates;
  const colors = new Set();
  for (const b of blocks) {
    if (b.kind === KIND.WALL) continue;
    for (const c of colorsOf(b)) if (c >= 0) colors.add(c);
  }
  const useful = gates.filter((g) => colorsOf(g).some((c) => colors.has(c)));
  // Safety net: a grid without a gate cannot be played. The case cannot occur —
  // every block came in through a gate — but the invariant costs one line and
  // the failure would cost an unplayable level.
  return useful.length ? useful : gates;
}

/**
 * Distance from a shape to its gate, in cells. This is the measure the backward
 * walk tries to maximise: a block sitting right in front of its gate asks the
 * player no question at all.
 */
function distanceToGate(gate, shape, x, y, W, H) {
  if (gate.side === 'right') return W - (x + shape.w);
  if (gate.side === 'left') return x;
  if (gate.side === 'bottom') return H - (y + shape.h);
  return y;
}

/** Placement position of a shape, pressed into a gate's opening. */
function placeAtGate(gate, shape, W, H, rng) {
  if (shape.w > (gate.side === 'top' || gate.side === 'bottom' ? gate.length : W)) return null;
  if (shape.h > (gate.side === 'left' || gate.side === 'right' ? gate.length : H)) return null;

  if (gate.side === 'right') {
    if (shape.h > gate.length) return null;
    return { x: W - shape.w, y: gate.start + Math.floor(rng() * (gate.length - shape.h + 1)) };
  }
  if (gate.side === 'left') {
    if (shape.h > gate.length) return null;
    return { x: 0, y: gate.start + Math.floor(rng() * (gate.length - shape.h + 1)) };
  }
  if (gate.side === 'bottom') {
    if (shape.w > gate.length) return null;
    return { x: gate.start + Math.floor(rng() * (gate.length - shape.w + 1)), y: H - shape.h };
  }
  if (shape.w > gate.length) return null;
  return { x: gate.start + Math.floor(rng() * (gate.length - shape.w + 1)), y: 0 };
}

/**
 * Number of GESTURES actually needed to solve the level.
 *
 * It cannot be deduced from the turns in the path: a finger following an
 * L-shaped track turns the block in a single drag, the engine advancing cell by
 * cell towards the target position. Counting direction changes therefore
 * overestimated the cost by 60 %, and the star thresholds became unreachable
 * the other way round — everybody got 3★.
 *
 * So we measure: for each block, we look for the furthest point on its path
 * reachable in a single gesture, play it, and start again.
 */
export function measureGestures(base) {
  const b = new Board({ ...base, moveLimit: 9999, timeLimit: 9999, starDrags: [0, 0] });
  let gestures = 0;

  for (const step of base.solution) {
    const path = step.path;
    const last = path.length - 1;
    let pos = 0;
    let guard = 0;

    while (pos < last && guard++ < 40) {
      let reached = pos;
      for (let j = last; j > pos; j--) {
        const snap = b.snapshot();
        b.dragTowards(step.id, path[j].x, path[j].y);
        const block = b.blocks.get(step.id);
        const ok = block && block.x === path[j].x && block.y === path[j].y;
        b.restore(snap);
        if (ok) { reached = j; break; }
      }
      if (reached === pos) reached = pos + 1; // safety: advance one notch
      b.dragTowards(step.id, path[reached].x, path[reached].y);
      gestures++;
      pos = reached;
    }

    // The exit extends the last drag: the finger does not lift.
    if (b.blocks.has(step.id)) {
      const [dx, dy] = EXIT_VECTORS[step.gate];
      if (b.step(step.id, dx, dy).ok && pos === 0) gestures++;
    }
    b.endGesture(true);
  }
  return Math.max(base.solution.length, gestures);
}

// ---------------------------------------------------------------------------

/**
 * How much BACKTRACKING a grid imposes.
 *
 * This is the only honest measure of "you have to think". Density, block count,
 * effects: all of those can be high without any choice ever being a bad one —
 * the solver then plays its first move and wins, and so does the player. The
 * measurements taken on the first eighteen realms are damning: nearly every
 * grid solves in as many states as it has blocks, that is, without going wrong
 * even once.
 *
 * A demanding grid is one where the solver has to undo what it just did. We
 * give it a tight budget: beyond that the grid is already devious enough, and
 * knowing the exact figure would not change the choice.
 */
/**
 * Budget for the demand measurement, sized to what we are looking for.
 *
 * It used to be a flat thirty thousand states — fifteen times the highest
 * target (sixty-four states per block across some thirty blocks). The most
 * devious grids, precisely the ones we want to keep, were therefore the most
 * expensive to measure, for a figure of which only the order of magnitude
 * mattered. Half again above the target is enough to arbitrate, and the build
 * drops from seventeen minutes to under five.
 */
const demandBudget = (target, blocks) => Math.max(1500, Math.round(target * blocks * 1.5));

function demandOf(g, budget = 30000) {
  const board = new Board({
    width: g.W, height: g.H, gates: g.gates, blocks: g.blocks,
    moveLimit: 9999, timeLimit: 9999, solution: [],
  });
  const r = solve(board, budget);
  // A grid the solver cannot clear within its budget is not thereby a good one:
  // we do not arbitrate at random, we take it as it stands — its reference
  // solution still exists.
  return r.states;
}

export function build(n) {
  const rng = mulberry32(0x5eed * n + 1013904223);
  const p = curve(n);
  const { W, H } = p;

  /**
   * Last level of a realm: roughly 50 % more gestures than this level would
   * have yielded without this treatment, at unchanged size and block count — we
   * only pick, among the grids already explored for the same position in the
   * realm, the one that demands the most. Depends on `LEVELS_PER_REALM`, never
   * on `TOTAL_LEVELS`: adding a realm must change nothing about levels that are
   * already published.
   */
  const realmFinale = (n - 1) % LEVELS_PER_REALM === LEVELS_PER_REALM - 1;

  // Allowed shapes. Forbidding small pieces is a lever in its own right: a lone
  // cell slips in anywhere and acts as a gap filler, whereas a tetromino has to
  // find a passage its own size. The four-cell bar and the six-cell slab stay
  // reserved for the realms that announce them.
  const shapes = SHAPES.filter((f) =>
    f.cells.length >= p.minShapeSize && (p.largeShapes || !LARGE_SHAPES.has(f.key)));

  // Several grids are explored and the DENSEST is kept: difficulty in this
  // genre comes from congestion, and settling for the first acceptable grid
  // gave half-empty levels.
  let best = null;

  /**
   * Selection on DEMAND, for the realms that make it their subject.
   *
   * We evaluate as we go rather than ranking at the end: the ranking is done on
   * the score — density, distance, load — which says nothing about how awkward
   * a grid is. Ten well-filled grids can all solve on the first try, and that is
   * exactly what we were getting.
   *
   * So only the top candidates are evaluated, we stop as soon as a grid reaches
   * the target, and the number of calls is bounded: the solver costs seconds,
   * and spending a hundred of them per level is out of the question.
   */
  const finalists = [];
  // The higher the target, the more candidates are needed to arbitrate: in the
  // last realms only one grid in ten reaches the required level.
  const FINALISTS = p.demanding ? Math.min(60, 20 + Math.round(p.demandTarget)) : 30;

  /**
   * Selection on GESTURES, for the last level of each realm.
   *
   * `measureGestures` only costs a simulation — not the solver — so we can
   * afford to run it on EVERY valid candidate rather than on a short list
   * restricted by score: it is precisely outside that short list (grids whose
   * exit order gets in its own way more than average) that the candidates
   * demanding genuinely more gestures are found. Limiting them to the top of
   * the pile by score excluded them systematically, and the best found capped at
   * 20-25 % better instead of 50.
   *
   * They are all kept (candidate, gestures, playable blocks) rather than
   * tracking only the best as we go: the "no fewer blocks than normal" floor is
   * read off `best`, which is only known once the loop ends — filtering too
   * early would have discarded every grid while the reference was not yet set.
   */
  const hardCandidates = [];

  /**
   * Gesture floor: the minimum number of drags the reference solution must
   * need. Zero on every realm published so far, so everything below is inert
   * for them — see `TIERS` in `tiers.js` for why turning it on retroactively is
   * not an option.
   *
   * `floored` is the best candidate that clears it; `nearest` the closest one
   * in case none does.
   */
  const floor = p.minDragsFloor || 0;
  let floored = null;
  let nearest = null;
  let nearestGestures = -1;

  // A demanding realm needs a pool: on very constrained grids most attempts
  // fail, and without extra attempts only one or two candidates are left to
  // arbitrate — arbitration then arbitrates nothing. The last level of a realm
  // needs it for the same reason: searching harder than average assumes there
  // is something to choose from.
  const ATTEMPTS = realmFinale ? 2000 : p.demanding ? 700 : 220;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const grid = new Grid(W, H);
    const gates = makeGates(p, rng);
    if (gates.length === 0) continue;
    const blocks = [];
    let nextId = 1;

    // Walls first: block paths will be carved out around them.
    for (let i = 0; i < p.walls; i++) {
      const x = 1 + Math.floor(rng() * (W - 2));
      const y = 1 + Math.floor(rng() * (H - 2));
      if (!grid.free([[x, y]])) continue;
      const b = { id: nextId++, color: -1, cells: [[0, 0]], x, y, kind: KIND.WALL };
      grid.place(b.id, [[x, y]]);
      blocks.push(b);
    }

    // Backward placement: in through the gate, then walk back into the grid.
    const placements = [];
    const perGate = new Map(gates.map((g) => [g, 0]));
    const placedPerKind = { [KIND.RAIL]: 0, [KIND.ANCHOR]: 0, [KIND.BULKY]: 0 };
    const ceiling = { [KIND.RAIL]: p.rails, [KIND.ANCHOR]: p.anchors, [KIND.BULKY]: p.bulky };

    for (let i = 0; i < p.blockCount; i++) {
      // Several attempts per block: we keep the first one that pushes the block
      // far enough from its gate, otherwise the best obtained. Flatly rejecting
      // a placement that was too close lost blocks and made generation
      // impossible on dense grids.
      let bestAttempt = null;

      for (let a = 0; a < 8 && (!bestAttempt || bestAttempt.distance < 3); a++) {
        const order = [gates[(i + a) % gates.length], ...shuffled(rng, gates)];
        let spot = null;
        let gate = null;

        for (const candidate of order) {
          for (const shape of shuffled(rng, shapes)) {
            const at = placeAtGate(candidate, shape, W, H, rng);
            if (!at) continue;
            if (!grid.free(absolute(shape, at.x, at.y))) continue;
            // Placing at the gate is not enough: it must be able to get back out.
            grid.place(-1, absolute(shape, at.x, at.y));
            const canLeave = canLeaveItsGate(grid, candidate, shape, at.x, at.y, -1);
            grid.remove(absolute(shape, at.x, at.y));
            if (!canLeave) continue;
            spot = { shape, x: at.x, y: at.y };
            gate = candidate;
            break;
          }
          if (spot) break;
        }
        if (!spot) break; // no room left at all: no point insisting

        const id = nextId++;
        let { x, y } = spot;
        grid.place(id, absolute(spot.shape, x, y));
        const path = [{ x, y }];

        // This block's special kind. It is decided BEFORE the backward walk,
        // because a block restricted in movement must walk back under the same
        // restriction: otherwise the return path, which is the solution read
        // backwards, would be unplayable. The anchor comes first — it is the
        // strongest constraint, and leaving it second made it unfindable.
        const gateAxis = gate.side === 'left' || gate.side === 'right' ? 'h' : 'v';
        const available = (k) => placedPerKind[k] < ceiling[k];
        const special =
          available(KIND.ANCHOR) && rng() < 0.4 ? KIND.ANCHOR :
          available(KIND.RAIL) && rng() < 0.55 ? KIND.RAIL :
          available(KIND.BULKY) && rng() < 0.5 ? KIND.BULKY :
          null;
        const axis = special === KIND.RAIL ? gateAxis : null;

        // ORIENTED backward walk: at each step we favour the direction that
        // moves the block AWAY from its gate. A purely random walk left it one
        // or two cells from its exit, and the level played itself.
        const steps = p.walkBack[0] + Math.floor(rng() * (p.walkBack[1] - p.walkBack[0] + 1));
        // An anchor knows only one way to travel: for it, walking back means
        // moving away in a straight line, exactly opposite its gate.
        const [sx, sy] = EXIT_VECTORS[gate.side];
        for (let r = 0; r < steps; r++) {
          const all = special === KIND.ANCHOR ? [[-sx, -sy]]
            : axis === 'h' ? [[1, 0], [-1, 0]]
            : axis === 'v' ? [[0, 1], [0, -1]]
            : [[1, 0], [-1, 0], [0, 1], [0, -1]];

          const legal = all.filter(([dx, dy]) =>
            grid.free(absolute(spot.shape, x + dx, y + dy), id));
          if (!legal.length) break;

          // 80 % of the time we move away, otherwise at random: without that
          // grain of chance every block runs in a straight line to the back of
          // the grid.
          const chosen = rng() < 0.8
            ? legal.reduce((bestDir, d) =>
                distanceToGate(gate, spot.shape, x + d[0], y + d[1], W, H) >
                distanceToGate(gate, spot.shape, x + bestDir[0], y + bestDir[1], W, H) ? d : bestDir)
            : pick(rng, legal);

          grid.remove(absolute(spot.shape, x, y));
          x += chosen[0]; y += chosen[1];
          grid.place(id, absolute(spot.shape, x, y));
          path.push({ x, y });
        }

        const distance = distanceToGate(gate, spot.shape, x, y, W, H);
        const candidate = { id, gate, path, spot, x, y, axis, distance, special };

        if (!bestAttempt || distance > bestAttempt.distance) {
          if (bestAttempt) grid.remove(absolute(bestAttempt.spot.shape, bestAttempt.x, bestAttempt.y));
          bestAttempt = candidate;
        } else {
          grid.remove(absolute(spot.shape, x, y));
        }
      }

      // A block still touching its gate brings nothing to the puzzle.
      if (!bestAttempt || bestAttempt.distance < 1 || bestAttempt.path.length < 2) {
        if (bestAttempt) grid.remove(absolute(bestAttempt.spot.shape, bestAttempt.x, bestAttempt.y));
        continue;
      }

      const { id, gate, path, spot, x, y, axis, special } = bestAttempt;
      if (special) placedPerKind[special]++;
      blocks.push({
        id, color: gate.color, cells: spot.shape.cells, x, y,
        kind: special || KIND.NORMAL,
        axis: special === KIND.RAIL ? axis : null,
        dir: special === KIND.ANCHOR ? gate.side : null,
      });
      perGate.set(gate, (perGate.get(gate) || 0) + 1);
      placements.push({ id, gate, path });
    }

    // Widened from 6 to 10: large shapes (four-cell bar, six-cell slab) take up
    // more room per placed piece, and in the already most constrained realms
    // (walls, rails, anchors, bulky blocks all at maximum) a few seeds never
    // reached the full count — without this slack, 3 levels out of 600 found no
    // valid grid at all.
    if (placements.length < Math.max(5, p.blockCount - 10)) continue;

    // Reference solution: last placed, first out.
    const solution = [...placements].reverse().map(({ id, gate, path }) => ({
      id, gate: gate.side, path: [...path].reverse(),
    }));

    const byId = new Map(blocks.map((b) => [b.id, b]));

    // Colour seals: "I open once every ▲ has left the grid". The condition is
    // only set if the reference solution already satisfies it at the right
    // moment — that is, if the whole target colour exits BEFORE this block. The
    // player reads it off the block and counts the ▲ still on screen.
    // It comes BEFORE countdown locks: its condition is far more demanding — it
    // needs a colour entirely cleared — and letting the countdown help itself
    // first left it a candidate in only one level out of four, the realm's
    // novelty missing from the other three.
    if (p.colorSeal) {
      const rankOf = new Map(solution.map((step, i) => [step.id, i]));
      const lastRank = new Map();
      for (const b of blocks) {
        if (b.kind === KIND.WALL) continue;
        const r = rankOf.get(b.id);
        if (r === undefined) continue;
        lastRank.set(b.color, Math.max(lastRank.get(b.color) ?? -1, r));
      }
      for (let rank = solution.length - 1; rank >= 0; rank--) {
        const b = byId.get(solution[rank].id);
        if (!b || b.kind !== KIND.NORMAL) continue;
        // A colour fully cleared before this block, and not its own: otherwise
        // the block would be waiting on itself and never open.
        const colors = [...lastRank.entries()]
          .filter(([c, last]) => c !== b.color && last < rank);
        if (!colors.length) continue;
        b.kind = KIND.LOCKED;
        b.axis = null;
        b.dir = null;
        b.condition = { type: 'color', color: pick(rng, colors)[0] };
        break; // one per grid: two colour waits are unreadable
      }
    }

    // Locks: a block can only be locked by a condition already satisfied at the
    // moment the solution asks it to move.
    let locksPlaced = 0;
    for (let rank = solution.length - 1; rank >= 0 && locksPlaced < p.locks; rank--) {
      const exitedBefore = rank; // number of blocks leaving before this one
      if (exitedBefore < 2) continue;
      const b = byId.get(solution[rank].id);
      if (!b || b.kind !== KIND.NORMAL) continue;

      // A countdown only: the player must be able to READ what will open the
      // block. A condition like "the whole ▲ colour has left" is unguessable
      // mid-game and reads like a bug.
      b.kind = KIND.LOCKED;
      b.axis = null;
      b.condition = { type: 'exits', count: Math.min(exitedBefore, 2 + Math.floor(rng() * 3)) };
      locksPlaced++;
    }

    // Dual blocks: a second colour accepted on top of their own. Safe for
    // solvability — their original gate stays valid — and they open only one
    // more family, where the joker opens them all.
    // The draw only happens if the realm asks for it: `shuffled` consumes the
    // RNG, and calling it for nothing would shift every grid of the earlier
    // realms — level n must yield the same grid as yesterday.
    let dualsPlaced = 0;
    for (const step of (p.duals > 0 ? shuffled(rng, solution) : [])) {
      if (dualsPlaced >= p.duals) break;
      const b = byId.get(step.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      const others = [...Array(p.colorCount).keys()].filter((c) => c !== b.color);
      if (!others.length) break;
      b.kind = KIND.DUAL;
      b.colors = [b.color, pick(rng, others)];
      dualsPlaced++;
    }

    // Jokers: a normal block becomes multicoloured. Always safe for solvability
    // — a joker accepts its original gate as well as all the others.
    let jokersPlaced = 0;
    for (const s of shuffled(rng, solution)) {
      if (jokersPlaced >= p.jokers) break;
      const b = byId.get(s.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      b.kind = KIND.JOKER;
      jokersPlaced++;
    }

    /**
     * The key. A block whose exit opens every lock in a level at once — the
     * locks no longer count exits, they wait for it.
     *
     * It has to leave BEFORE them in the reference solution, otherwise the
     * condition would never be met at the right moment. So we take the last
     * ordinary block preceding the first lock.
     */
    if (p.key) {
      const locked = solution
        .map((step, rank) => ({ b: byId.get(step.id), rank }))
        .filter(({ b }) => b && b.kind === KIND.LOCKED && b.condition?.type === 'exits');
      const firstLock = Math.min(...locked.map((v) => v.rank));
      if (locked.length && Number.isFinite(firstLock)) {
        // Any block the player can grab makes a key: the role does not restrict
        // movement. Reserving it for ordinary blocks left a candidate in only
        // three levels out of five, the others having nothing but rails and
        // anchors ahead of their first lock.
        const KEY_BEARERS = [KIND.NORMAL, KIND.RAIL, KIND.ANCHOR, KIND.BULKY];
        for (let rank = firstLock - 1; rank >= 0; rank--) {
          const b = byId.get(solution[rank].id);
          if (!b || !KEY_BEARERS.includes(b.kind)) continue;
          b.isKey = true;
          for (const v of locked) v.b.condition = { type: 'block', id: b.id };
          break;
        }
      }
    }

    // Gate capacity: each gate only accepts the number of cells the reference
    // solution routes through it, plus a small margin. Routing a block to the
    // wrong gate of the right colour then becomes a mistake — and that is what
    // turns the grid into a puzzle.
    if (p.capacity) {
      const demand = new Map(gates.map((g) => [g, 0]));
      let jokerQuota = 0;
      for (const placement of placements) {
        const b = byId.get(placement.id);
        // `capacityCost` and not `cells.length`: a bulky block consumes double,
        // and provisioning less than what the engine takes away would make the
        // level impossible without the player being able to see it coming.
        const cost = capacityCost(b);
        if (b.kind === KIND.JOKER) { jokerQuota += cost; continue; }
        demand.set(placement.gate, demand.get(placement.gate) + cost);
      }
      // The joker exits through whichever gate it likes: if its quota were only
      // counted against its original gate, sending it elsewhere would starve
      // that other gate and make the level impossible — without the player
      // being able to see it coming. So its size is provisioned on EVERY gate.
      //
      // On EVERY one, without exception: a gate the reference solution never
      // uses (two gates of the same colour, only one picked by the backward
      // placement) was left with no capacity — unlimited, as far as the engine
      // is concerned. The player could then clear any block of that colour
      // through that free gate, bypassing the whole capacity puzzle. As soon as
      // one gate in the level is limited, none may be left without a counter.
      for (const g of gates) {
        const need = demand.get(g) || 0;
        g.capacity = need + jokerQuota + p.margin;
      }
    }

    const occupied = blocks.reduce((sum, b) => sum + b.cells.length, 0);
    const meanDistance = placements.reduce((sum, placement) => {
      const b = byId.get(placement.id);
      const shape = { w: Math.max(...b.cells.map((c) => c[0])) + 1, h: Math.max(...b.cells.map((c) => c[1])) + 1 };
      return sum + distanceToGate(placement.gate, shape, b.x, b.y, W, H);
    }, 0) / Math.max(1, placements.length);

    // Share of the most represented colour. A grid can be dense and well spread
    // out while being three quarters a single colour: gates clog up as pieces
    // are placed, and every later block falls back on the last one still clear.
    // The result plays worse and looks worse, so it has to be penalised
    // explicitly.
    const perColor = new Map();
    for (const placement of placements) {
      const c = byId.get(placement.id).color;
      perColor.set(c, (perColor.get(c) || 0) + 1);
    }
    const dominant = Math.max(...perColor.values()) / Math.max(1, placements.length);

    const density = occupied / (W * H);

    // The NUMBER of blocks counts towards the score, not just the occupied
    // cells: at equal density, a grid of fifteen large blocks needs fewer exits
    // than one of twenty small ones. Without this term, the load from one level
    // to the next dipped by four blocks inside the same realm, and progression
    // felt like it was going backwards.
    const load = placements.length / p.blockCount;
    const score = density + meanDistance / 8 + load / 3
      - 1.6 * Math.max(0, dominant - 0.4);
    // The filter is applied BEFORE the difficulty measurement: what the solver
    // weighs must be exactly the grid that will ship.
    const candidate = { W, H, gates: usefulGates(gates, blocks), blocks, solution,
      occupied, score, meanDistance, dominant, colorCount: p.colorCount };
    if (!best || score > best.score) best = candidate;

    // One measurement, shared by the two selections that need it: the gesture
    // floor below, and the realm-finale arbitration further down.
    let gestures = null;
    if (realmFinale || floor > 0) {
      gestures = measureGestures({ width: W, height: H, gates: candidate.gates, blocks: candidate.blocks, solution: candidate.solution });
    }

    /**
     * The floor is a REQUIREMENT, not a preference: a grid under it is dropped
     * here, before it can win on score, on demand, or on gestures. That is the
     * whole difference with the realm-finale treatment, which only ever picks
     * the best of what turned up.
     *
     * The closest attempt is kept aside all the same. A level must always come
     * out — failing to generate one would leave a hole in the progression — so
     * when nothing reaches the floor we ship the nearest miss and say so.
     */
    if (floor > 0) {
      if (gestures > nearestGestures) { nearestGestures = gestures; nearest = candidate; }
      if (gestures < floor) continue;
      if (!floored || score > floored.score) floored = candidate;
    }

    if (realmFinale) {
      hardCandidates.push({ candidate, gestures, playable: placements.length });
    }

    if (p.demanding) {
      // Accumulate first, measure later. Evaluating as we went spent the solver
      // budget on whatever grids came first: the comparison threshold rises with
      // the best known score, so the mediocre early candidates all got through.
      finalists.push(candidate);
      finalists.sort((a, b) => b.score - a.score);
      if (finalists.length > FINALISTS) finalists.length = FINALISTS;
      continue;
    }
    // The last level of a realm needs the whole pool of attempts: stopping
    // early on the first acceptable grid, as an ordinary level does, would
    // deprive it of the hardest candidates.
    if (!realmFinale && density >= 0.6 && meanDistance >= 3.2 && dominant <= 0.4 && load >= 0.9) break;
  }

  /**
   * The floor arbitrates FIRST, because the two selections below read `best`
   * and would otherwise measure themselves against a grid the realm has already
   * rejected. Both pools they draw from are floor-filtered already: a candidate
   * under the floor never reached `finalists` or `hardCandidates`.
   */
  if (floor > 0) {
    best = floored || nearest || best;
    if (best && !floored) best.minDragsShort = floor;
  }

  /**
   * Arbitrating between the finalists: we keep the one that forces the solver
   * to backtrack the most, and stop as soon as a grid reaches the target — a
   * dozen states per block, enough for a player to have to try twice too.
   * Measuring them all would cost seconds for nothing.
   */
  if (p.demanding && finalists.length) {
    let kept = null;
    let maxDemand = -1;
    for (const c of finalists) {
      const states = demandOf(c, demandBudget(p.demandTarget, c.blocks.length));
      if (states > maxDemand) { maxDemand = states; kept = c; }
      if (states >= c.blocks.length * p.demandTarget) break;
    }
    best = kept;
    best.demand = maxDemand;
  }

  /**
   * Last level of a realm: among the candidates matching at least the playable
   * block count of what this level would have been without this treatment
   * (`best`, chosen by density — or by demand for a realm that is demanding —
   * like any other level), we keep the one requiring the most gestures. It is
   * only replaced if something better turns up; failing that, `best` stays the
   * best honest attempt rather than a random pick — the 50 %-more target is a
   * goal, not a guarantee.
   */
  if (realmFinale && hardCandidates.length) {
    const referencePlayable = best.blocks.filter((b) => b.kind !== KIND.WALL).length;
    let kept = best;
    let keptGestures = measureGestures({ width: W, height: H, gates: best.gates, blocks: best.blocks, solution: best.solution });
    for (const { candidate, gestures, playable } of hardCandidates) {
      if (playable < referencePlayable) continue;
      if (gestures > keptGestures) { kept = candidate; keptGestures = gestures; }
    }
    best = kept;
  }

  if (!best) return null;
  best.minDrags = measureGestures({
    width: best.W, height: best.H, gates: best.gates,
    blocks: best.blocks, solution: best.solution,
  });
  return best;
}
