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
import { solve, pathTo, hasExit } from '../prototype/src/core/solver.js';
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
  constructor(W, H) {
    this.W = W; this.H = H; this.occ = new Map();
    /**
     * Cells kept EMPTY on purpose: the pocket a crossed block will be shifted
     * into. Nothing may be placed there for the rest of the build.
     *
     * This is the whole difference between building a parking level and trying
     * to graft one on afterwards. Measured on a finished 10x12 grid at 71 % full,
     * grafting found somewhere to park on ZERO levels out of twenty — there is
     * no free pocket left to find. Reserving it while there is still room costs
     * two or three cells and guarantees it.
     */
    this.reserved = new Set();
  }
  key(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }
  free(cells, except) {
    return cells.every(([x, y]) => {
      if (!this.inside(x, y)) return false;
      if (this.reserved.has(this.key(x, y))) return false;
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

    /**
     * A step with NO GATE is a PARK: the block is moved somewhere it does not
     * leave from, to free the way for another. The drags above already counted
     * it; there is simply no exit to extend them with.
     *
     * `gate: null` rather than a `type` field on purpose — every step written
     * before parking existed carries a gate, so the whole shipped database
     * stays valid unread, and this is the only line that had to learn the
     * difference.
     */
    if (step.gate && b.blocks.has(step.id)) {
      // The exit extends the last drag: the finger does not lift.
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

/**
 * Turns an ordinary grid into one that REQUIRES a block to be parked.
 *
 * This is the one lever that changes what KIND of problem a level is. Every
 * other knob — density, gates, piece sizes, capacity — varies how hard the exit
 * order is to find; measured over the shipped database, the first seven realms
 * clear on a uniformly random order a hundred times out of a hundred. Parking
 * asks something a player cannot answer by counting: see that a block is in the
 * way, and see where it can go instead.
 *
 * HOW. The backward walk only ever crosses free cells, which is exactly why no
 * level ever needs a park (see this file's header). So we do it afterwards: move
 * one block onto the route of a block that leaves BEFORE it. The early block can
 * no longer reach its gate, and the late one cannot simply be sent out first —
 * it has to be shifted aside and left there.
 *
 * WHY IT IS VERIFIED RATHER THAN CONSTRUCTED. Moving a block invalidates the
 * reference solution: its own recorded route started somewhere else, and the
 * capacities were provisioned for the old routing. Rebuilding all that by hand
 * would duplicate the solver badly. So we move the block and ASK: the grid
 * qualifies only when the ordering search fails cleanly AND the one-park search
 * succeeds, and the solution it hands back becomes the new reference. The two
 * answers together are the definition of "this level needs a park" — there is
 * nothing left to prove separately.
 *
 * Returns a fresh candidate, or null when no move qualified.
 */
/**
 * SHUTTERED GATES, read off the reference solution.
 *
 * A gate that stays closed until so many blocks have left. Like the arrows, the
 * schedule is not invented and then checked: it is read from the solution the
 * grid already has. A gate first used at the seventh exit can be shut for up to
 * six, and the reference solution still replays exactly as written — solvable by
 * construction, no verification pass.
 *
 * What it adds is a clock the player has to read. Until now a gate was a fact of
 * the board: look at its colour, count its capacity, decide. A shuttered one
 * makes the ORDER matter for a second reason — not just which gates fill up, but
 * which ones are not open yet.
 *
 * A gate used by the very first exits is left alone: shutting it would make the
 * level unopenable, and the solution says so by using it immediately.
 */
function shutterGates(gates, solution, count, rng) {
  if (!count) return;

  // Side -> the exit index at which the solution first uses it.
  const firstUse = new Map();
  solution.forEach((step, i) => {
    if (step.gate && !firstUse.has(step.gate)) firstUse.set(step.gate, i);
  });

  const usable = gates.filter((g) => (firstUse.get(g.side) ?? 0) >= 2);
  for (const gate of shuffled(rng, usable).slice(0, count)) {
    const first = firstUse.get(gate.side);
    // Shut for strictly fewer exits than its first use, so the solution keeps
    // working; one short of it, so the wait is felt rather than notional.
    gate.opensAfter = Math.max(1, first - 1 + (rng() < 0.5 ? 1 : 0));
    if (gate.opensAfter > first) gate.opensAfter = first;
  }
}

/**
 * ONE-WAY CELLS, read off the reference solution.
 *
 * An arrow is not scattered at random and then checked: it is placed on a cell
 * the solution already walks, pointing the way the solution already goes. The
 * level therefore stays solvable BY CONSTRUCTION, exactly as the backward walk
 * guarantees the rest — no verification pass, no candidates thrown away.
 *
 * The condition is unanimity. A cell crossed by three different blocks heading
 * three different ways cannot carry an arrow: whichever way it points, two of
 * them are stopped and the reference solution no longer replays. So a cell
 * qualifies only when every block that crosses it crosses it the same way.
 *
 * What it buys is the thing the board has never had: a ONE-WAY CORRIDOR. Until
 * now every route could be walked backwards, so a block could always retreat
 * from a mistake. An arrow makes a wrong entry final, and that is a spatial
 * question — no amount of counting gate capacities answers it.
 */
function oneWayFrom(solution, blocks, count, rng) {
  if (!count) return [];
  const shapeOf = new Map(blocks.map((b) => [b.id, b.cells]));

  /**
   * cell -> the one direction every block crossing it agrees on, or null.
   *
   * Recorded over the block's WHOLE BODY, not its anchor cell. The engine holds
   * a block if ANY of its cells sits on an arrow — a four-cell bar lying across
   * one is held by it — so agreement has to be computed the same way. Scoring
   * anchors alone was measured and it breaks the reference solution outright:
   * a bar whose body crossed an arrow placed for some other block could no
   * longer move, and not one of the three test levels replayed.
   */
  const agreed = new Map();
  for (const step of solution) {
    const path = step.path || [];
    const cells = shapeOf.get(step.id) || [[0, 0]];
    for (let i = 0; i + 1 < path.length; i++) {
      const dx = Math.sign(path[i + 1].x - path[i].x);
      const dy = Math.sign(path[i + 1].y - path[i].y);
      // Straight single steps only: anything else is a path artefact, and an
      // arrow on it would point somewhere the block never actually goes.
      if (!dx && !dy) continue;
      if (dx && dy) continue;
      for (const [ox, oy] of cells) {
        const key = `${path[i].x + ox},${path[i].y + oy}`;
        if (!agreed.has(key)) { agreed.set(key, [dx, dy]); continue; }
        const had = agreed.get(key);
        if (!had || had[0] !== dx || had[1] !== dy) agreed.set(key, null);
      }
    }
  }

  // A cell any block ever RESTS on is out: the arrow would hold whatever sits
  // there before it has a reason to move, including at the very start.
  for (const step of solution) {
    const path = step.path || [];
    const cells = shapeOf.get(step.id) || [[0, 0]];
    for (const at of [path[0], path[path.length - 1]]) {
      if (!at) continue;
      for (const [ox, oy] of cells) agreed.set(`${at.x + ox},${at.y + oy}`, null);
    }
  }

  const usable = [...agreed.entries()].filter(([, d]) => d);
  return shuffled(rng, usable).slice(0, count).map(([key, [dx, dy]]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, dx, dy };
  });
}

/**
 * Kinds that can be shifted aside and LEFT there.
 *
 * The exclusions are the whole subtlety, and each one is a rule of the engine
 * read backwards:
 *
 *  - ANCHOR travels one way only, towards its gate (`acceptsDirection`). It can
 *    never step aside — that is precisely what an anchor is for — so asking one
 *    to park is asking it to exit.
 *  - LOCKED does not move until its countdown opens. The park happens BEFORE the
 *    crossing block leaves, which is early, and at that moment the lock may well
 *    still be shut.
 *  - WALL never moves at all.
 *
 * RAIL is in, but only sideways along its own axis — `pocketFor` enforces it.
 */
const PARKABLE = new Set([KIND.NORMAL, KIND.RAIL, KIND.BULKY, KIND.DUAL, KIND.JOKER]);

/**
 * Where a crossed block can be shifted to, and which cells that costs.
 *
 * PERPENDICULAR to the crossing, always. A block shifted along the very
 * direction the other one is travelling stays in the way — it has moved, and
 * nothing has been freed.
 *
 * One step, never more: the pocket has to be reserved, every reserved cell is
 * one the rest of the build cannot use, and a park the player can see in one
 * glance is worth more than a clever one three cells away.
 *
 * @returns {number[]|null} the cell keys to reserve — only the NEW ones, since
 *          the block already holds the rest.
 */
function pocketFor(grid, victim, dx, dy) {
  const across = dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
  for (const [px, py] of across) {
    // A rail only ever travels on its axis. Crossed along that same axis, it has
    // nowhere perpendicular to go, and there is no pocket to be had.
    if (victim.kind === KIND.RAIL) {
      if (victim.axis === 'h' && py !== 0) continue;
      if (victim.axis === 'v' && px !== 0) continue;
    }
    const cells = victim.cells.map(([cx, cy]) => [victim.x + cx + px, victim.y + cy + py]);
    if (cells.some(([cx, cy]) => !grid.inside(cx, cy))) continue;
    const clear = cells.every(([cx, cy]) => {
      if (grid.reserved.has(grid.key(cx, cy))) return false;
      const o = grid.occ.get(grid.key(cx, cy));
      return o === undefined || o === victim.id;
    });
    if (!clear) continue;

    const own = new Set(victim.cells.map(([cx, cy]) => grid.key(victim.x + cx, victim.y + cy)));
    return cells.map(([cx, cy]) => grid.key(cx, cy)).filter((k) => !own.has(k));
  }
  return null;
}

/**
 * A step of the backward walk that goes THROUGH an already-placed block.
 *
 * That block was placed earlier, so it leaves LATER — and the walking block will
 * therefore meet it still standing there. No exit order gets out of that: it has
 * to be shifted aside first. This is the one line of the generator that makes
 * the level something other than a sorting problem.
 *
 * Exactly one occupant, and it must be parkable with a pocket to go to. Two
 * blocks in the way would need two parks, which is past what a player can read
 * and past what the solver is allowed to search.
 */
function crossingFrom(grid, byId, shape, x, y, id, dirs) {
  for (const [dx, dy] of dirs) {
    const target = absolute(shape, x + dx, y + dy);
    if (target.some(([cx, cy]) => !grid.inside(cx, cy))) continue;
    if (target.some(([cx, cy]) => grid.reserved.has(grid.key(cx, cy)))) continue;

    const occupants = new Set();
    for (const [cx, cy] of target) {
      const o = grid.occ.get(grid.key(cx, cy));
      if (o !== undefined && o !== id) occupants.add(o);
    }
    if (occupants.size !== 1) continue;

    const victim = byId.get([...occupants][0]);
    if (!victim || !PARKABLE.has(victim.kind)) continue;

    // The far side has to be clear: the walk goes straight over its victim and
    // lands beyond it, never resting on cells that are not its own.
    const beyond = absolute(shape, x + 2 * dx, y + 2 * dy);
    if (!grid.free(beyond, id)) continue;

    const pocket = pocketFor(grid, victim, dx, dy);
    if (!pocket) continue;
    return { dir: [dx, dy], victim, pocket };
  }
  return null;
}

/**
 * Search budget for the parking verification, well under `OFFLINE_BUDGET`.
 *
 * Two searches are paid per attempt and up to fourteen attempts per level, so
 * the budget is what keeps a world build in minutes rather than hours. A grid
 * whose ordering search cannot finish inside it is thrown out rather than
 * guessed at — `verifyParking` refuses anything that gave up.
 */
const PARK_BUDGET = 60000;

/**
 * Crossed grids put through the solver before giving up on parking. Two searches
 * each, seconds apiece on a large board — this is what keeps a realm build in
 * minutes rather than hours.
 */
const PARK_CANDIDATES = 6;

export function injectParking(candidate, rng, budget) {
  const movable = candidate.blocks.filter((b) => b.kind !== KIND.WALL && b.kind !== KIND.ANCHOR);
  if (movable.length < 2) return null;

  // Exit rank: the reference solution is the order blocks leave in.
  const rank = new Map(candidate.solution.map((step, i) => [step.id, i]));
  const occupied = new Map();
  for (const b of candidate.blocks) {
    for (const [cx, cy] of b.cells) occupied.set(`${b.x + cx},${b.y + cy}`, b.id);
  }

  // Early leavers first: blocking one of them is what forces the park, and it
  // leaves the rest of the solution the most room to still work.
  const targets = shuffled(rng, candidate.solution.slice(0, Math.max(1, Math.ceil(candidate.solution.length / 2))));

  /**
   * Two budgets, because the cost per attempt varies by two orders of magnitude
   * across the game: a first-realm grid verifies in ten milliseconds, a
   * last-realm one in nearly two seconds. A flat count of attempts was measured
   * at 46 seconds on a single level, which no build can afford twenty times per
   * world.
   */
  const MAX_TRIES = 14;
  const MAX_MS = 8000;
  const until = Date.now() + MAX_MS;

  const probe = () => new Board({
    width: candidate.W, height: candidate.H, gates: candidate.gates,
    blocks: candidate.blocks, moveLimit: 9999, timeLimit: 9999, solution: [],
  });

  // Every legal placement, gathered before anything is verified.
  const tries = [];
  for (const step of targets) {
    const route = (step.path || []).slice(1, -1);   // neither its resting spot nor the gate
    for (const spot of shuffled(rng, route)) {
      for (const mover of shuffled(rng, movable)) {
        // It must leave LATER, otherwise sending it out first clears the way and
        // no park is needed.
        if ((rank.get(mover.id) ?? -1) <= (rank.get(step.id) ?? 0)) continue;
        const cells = mover.cells.map(([cx, cy]) => [spot.x + cx, spot.y + cy]);
        const fits = cells.every(([cx, cy]) =>
          cx >= 0 && cy >= 0 && cx < candidate.W && cy < candidate.H
          && ((occupied.get(`${cx},${cy}`) ?? mover.id) === mover.id));
        if (fits) tries.push({ mover, spot, victim: step.id });
      }
    }
  }
  if (!tries.length) return null;

  /**
   * ORDERED, not filtered.
   *
   * A placement that leaves its victim unable to walk to any gate is the strong
   * candidate, and one breadth-first walk says so for almost nothing. But it is
   * not a REQUIREMENT: a block can reach a gate geometrically and still be stuck
   * later because that gate's capacity has been eaten in the meantime. Using
   * this as a filter was measured — it cut the cost by two thirds and the hits
   * from six in nine to two. So it sorts, and the weak candidates still get
   * their turn if the budget allows.
   */
  for (const t of tries) {
    const home = { x: t.mover.x, y: t.mover.y };
    t.mover.x = t.spot.x; t.mover.y = t.spot.y;
    t.trapped = !hasExit(probe(), t.victim);
    t.mover.x = home.x; t.mover.y = home.y;
  }
  tries.sort((a, b) => Number(b.trapped) - Number(a.trapped));

  let tried = 0;
  for (const t of tries) {
    if (tried >= MAX_TRIES || Date.now() > until) break;
    const home = { x: t.mover.x, y: t.mover.y };
    t.mover.x = t.spot.x; t.mover.y = t.spot.y;
    tried++;

    const asked = verifyParking(candidate, budget);
    if (asked) return { ...candidate, solution: asked.solution, parks: asked.parks };

    t.mover.x = home.x; t.mover.y = home.y;
  }
  return null;
}

/**
 * Does this grid need a park, and what is its solution?
 *
 * Both answers come from the same two searches. `gaveUp` on the ordering pass
 * disqualifies the grid outright: a budget that ran out proves nothing, and
 * shipping a level whose solvability was never established is the one thing the
 * generator must never do.
 */
/**
 * Why parking verifications fail, counted.
 *
 * A build that reports "no park" says nothing about what to change. These four
 * numbers do: grids still solvable by ordering mean the crossing did not bite,
 * budget exhaustions mean the board outgrew the search, and a park that cannot
 * be found means the pocket was reserved in the wrong place.
 */
export const PARK_STATS = { tried: 0, solvableByOrder: 0, gaveUp: 0, noPark: 0, ok: 0 };

function verifyParking(candidate, budget) {
  const make = () => new Board({
    width: candidate.W, height: candidate.H, gates: candidate.gates,
    blocks: candidate.blocks, moveLimit: 9999, timeLimit: 9999, solution: [],
  });

  PARK_STATS.tried++;
  const byOrder = solve(make(), budget, 0);
  if (byOrder.solvable) { PARK_STATS.solvableByOrder++; return null; }
  if (byOrder.gaveUp) { PARK_STATS.gaveUp++; return null; }

  const withPark = solve(make(), budget, 1);
  if (!withPark.solvable || withPark.parks === 0) { PARK_STATS.noPark++; return null; }

  // The search returns destinations; a reference solution needs routes. We
  // replay it on a board and ask `pathTo` for each leg as we go — the route
  // depends on where every other block stands at that moment, so it can only be
  // computed in sequence.
  const board = make();
  const solution = [];
  for (const move of withPark.moves) {
    const path = pathTo(board, move.id, move.x, move.y);
    if (!path) return null;
    for (const at of path.slice(1)) board.dragTowards(move.id, at.x, at.y);

    if (move.type === 'exit') {
      const [dx, dy] = EXIT_VECTORS[move.gate.side];
      if (!board.step(move.id, dx, dy).ok) return null;
      solution.push({ id: move.id, gate: move.gate.side, path });
    } else {
      // No gate: this is the park. That absence IS the marker — every step
      // written before parking existed carries a gate.
      solution.push({ id: move.id, gate: null, path });
    }
    board.endGesture(true);
  }
  if (!board.isSolved()) return null;

  PARK_STATS.ok++;
  return { solution, parks: withPark.parks };
}

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
  let bestClean = null;

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
   * Grids whose backward walk went through an earlier block, so a park is
   * needed. Collected rather than verified on the spot: verification costs two
   * solver searches, and on these boards that is seconds.
   */
  const crossedCandidates = [];

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
    // One crossing per grid: which block was walked through, and by whom.
    const crossing = { used: false, victim: null, blocker: null, pocket: null };
    const byId = new Map(blocks.map((b) => [b.id, b]));
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

          /**
           * THE CROSSING — at most one per grid, and never for an anchor.
           *
           * An anchor moves only towards its gate, so a walk that crossed
           * something would have to cross it again on the way out, in the one
           * direction it has. It would need its victim parked twice, or parked
           * somewhere it never comes back from.
           *
           * Attempted from the third step on rather than the first: crossing
           * immediately leaves the two blocks stacked against the gate, where the
           * puzzle is over before it has begun.
           */
          let cross = null;
          if (p.parking > 0 && !crossing.used && special !== KIND.ANCHOR
              && r >= 2 && rng() < 0.5) {
            cross = crossingFrom(grid, byId, spot.shape, x, y, id, all);
          }

          if (cross) {
            /**
             * Crossed in ONE move, landing clear on the far side.
             *
             * Stepping onto the victim and stopping there would put two blocks on
             * the same cells, and `grid.place` overwrites — the victim would
             * simply cease to exist on the grid and later placements would be
             * free to sit inside it. Going straight over means this block never
             * holds a cell that is not its own, and the occupancy map stays true
             * at every step.
             */
            const [dx, dy] = cross.dir;
            crossing.used = true;
            crossing.victim = cross.victim;
            crossing.pocket = cross.pocket;
            for (const k of cross.pocket) grid.reserved.add(k);

            grid.remove(absolute(spot.shape, x, y));
            // The waypoint ON the victim stays in the path: it is what the
            // reference solution has to walk, and what makes the park necessary.
            path.push({ x: x + dx, y: y + dy });
            x += 2 * dx; y += 2 * dy;
            grid.place(id, absolute(spot.shape, x, y));
            path.push({ x, y });
            continue;
          }

          if (!legal.length) break;

          // 80 % of the time we move away, otherwise at random: without that
          // grain of chance every block runs in a straight line to the back of
          // the grid.
          //
          // MEASURED AND REJECTED: making the walk double back on purpose, to buy
          // gestures out of the route's shape rather than its length. It makes
          // levels EASIER — 29.3 gestures on average without it, 26.5 with six
          // reversals, 26.3 with twelve. A reversal costs walk steps, so the
          // block comes to rest nearer its gate, and the distance lost outweighs
          // the gesture gained. `dragTowards` cuts corners anyway, so most
          // reversals collapse back into a single drag.
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

        /**
         * A crossing only counts if the block is STUCK BOTH WAYS.
         *
         * Walking through a block is not enough, and the measurement said so:
         * fourteen verifications out of eighteen came back "still solvable by
         * ordering". The reason is that the backward walk fixes only ONE valid
         * order, and the solver is under no obligation to follow it — it simply
         * sends the victim out first and the way is clear.
         *
         * So the block has to come to rest ON the victim's own route out. Then
         * neither can go first: the walker is blocked by the victim, the victim
         * is blocked by the walker, and the only way out of that is to shift one
         * of them aside. Which is the whole point.
         */
        if (crossing.used && crossing.victim && crossing.blocker !== id) {
          const victimPath = placements.find((pl) => pl.id === crossing.victim.id)?.path ?? [];
          const resting = absolute(spot.shape, x, y);
          const mutual = victimPath.some((at) => {
            const cells = crossing.victim.cells.map(([cx, cy]) => [at.x + cx, at.y + cy]);
            return cells.some(([vx, vy]) => resting.some(([bx, by]) => bx === vx && by === vy));
          });
          if (mutual) {
            crossing.blocker = id;
          } else {
            // Weak crossing: undo it so another placement may still find a real
            // one, and give the reserved pocket back to the grid.
            for (const k of crossing.pocket || []) grid.reserved.delete(k);
            crossing.used = false;
            crossing.victim = null;
            crossing.pocket = null;
          }
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
      byId.set(id, blocks[blocks.length - 1]);
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

    // `byId` was built with the walls and kept up to date at every placement.

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
      occupied, score, meanDistance, dominant, colorCount: p.colorCount,
      // A grid whose walk went through an earlier block. Its reference solution
      // is NOT usable as it stands — it holds a waypoint on a cell another block
      // is still occupying, and no step that moves that block out of the way.
      // Only `verifyParking` can give it a real one.
      crossed: crossing.used };
    if (crossing.used) crossedCandidates.push(candidate);
    if (!best || score > best.score) best = candidate;
    // The best grid that was NEVER walked through. A crossed grid whose park
    // cannot be proved is broken, not merely hard, so there has to be a sound
    // one to fall back on.
    if (!crossing.used && (!bestClean || score > bestClean.score)) bestClean = candidate;

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

  /**
   * PARKING, applied last — to the grid that was going to ship.
   *
   * It has to come after every other selection, because it rewrites the
   * reference solution: `injectParking` moves a block, asks the solver whether
   * the grid now needs a park, and adopts the answer. Running it earlier would
   * mean arbitrating on density or demand between grids whose solutions were
   * about to be replaced.
   *
   * A failure is not fatal. The grid stays exactly what it was — an ordinary,
   * verified level — and says so, because a tier that asks for parking on boards
   * with no room to park is a tuning error worth reading at build time. Measured
   * on the shipped grids, the hit rate falls as density rises: three in eight on
   * realm 2, none in eight on realm 15. Parking needs somewhere to park.
   */
  if (p.parking > 0) {
    /**
     * A crossed grid has to be VERIFIED, and its reference solution comes back
     * from the solver — the walk cannot write one, because the step that moves
     * the victim aside is not something the walk knows about.
     *
     * The verification is also the definition: the grid qualifies only when the
     * exit-order search fails cleanly AND the one-park search succeeds. Both
     * answers together say "this level needs a park", and there is nothing left
     * to establish separately.
     *
     * The densest ones are tried first and the budget stops the search: each
     * candidate costs two searches, and on a ten-by-twelve board that is seconds
     * apiece.
     */
    let parked = null;
    const shortlist = crossedCandidates.sort((a, b) => b.score - a.score).slice(0, PARK_CANDIDATES);
    for (const c of shortlist) {
      const asked = verifyParking(c, PARK_BUDGET);
      if (asked) { parked = { ...c, solution: asked.solution, parks: asked.parks }; break; }
    }

    if (parked) {
      best = parked;
    } else {
      // Nothing qualified. `best` may itself be a crossed grid, whose reference
      // solution is unusable — fall back to one that was never walked through
      // rather than ship a level whose solution does not replay.
      best = best.crossed ? bestClean : best;
      if (!best) return null;
      best.parkingShort = true;
    }
  }

  /**
   * Arrows last, on the grid that ships. They are derived from ITS solution, so
   * they have to wait until the candidate is settled — and they cost the walk
   * nothing, since the route they sit on is the one already chosen.
   */
  if (p.oneWay > 0) best.oneWay = oneWayFrom(best.solution, best.blocks, p.oneWay, rng);
  if (p.shutters > 0) shutterGates(best.gates, best.solution, p.shutters, rng);

  best.minDrags = measureGestures({
    width: best.W, height: best.H, gates: best.gates,
    blocks: best.blocks, solution: best.solution, oneWay: best.oneWay,
  });
  return best;
}
