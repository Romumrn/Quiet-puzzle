/**
 * The search engine's board — a compact copy of `prototype/src/core/board.js`.
 *
 * The generator explores hundreds of thousands of states per level; `Board`
 * reindexes a Map on every move and would make that a matter of hours. So the
 * rules are restated here over flat arrays. Restating rules is how engines drift
 * apart, which is why nothing this file decides reaches the game unchecked:
 * `build.js` replays every reference solution on the real `Board` and throws the
 * grid away at the first disagreement.
 *
 * Every rule below names the `Board` method it mirrors. Change one, change both.
 *
 * ctx   = { W, H, gates, blocks, arrows }   — fixed for a level
 *   gates  : the game's own gate objects (side, start, length, color, colors?,
 *            capacity?, opensAfter?), in the game's order — `_gateFor` takes
 *            the FIRST match, so the order is part of the rule
 *   blocks : { cells, kind, axis, dir, color, colors, condition, cost }
 *            condition uses block INDICES for keys (`{ type: 'block', index }`)
 *   arrows : Int8Array(W*H), 0 = none, else 1 + index in DIRS
 * state = { pos: Int16Array (-1 = gone), cap: Int16Array (remaining, -1 = unlimited) }
 */

export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const SIDE_VEC = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] };
export const sideOf = (dx, dy) => (dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'bottom' : 'top');
const dirIndex = (dx, dy) => (dx === 1 ? 0 : dx === -1 ? 1 : dy === 1 ? 2 : 3);

export const colorsOf = (t) => (t.colors?.length ? t.colors : [t.color]);

export function newState(ctx, pos) {
  const st = {
    pos: Int16Array.from(pos),
    cap: Int16Array.from(ctx.gates.map((g) => (g.capacity === undefined ? -1 : g.capacity))),
    out: 0,
  };
  for (const p of st.pos) if (p < 0) st.out++;
  return st;
}
export const cloneState = (s) => ({ pos: Int16Array.from(s.pos), cap: Int16Array.from(s.cap), out: s.out });

export function occupancy(ctx, st) {
  const { W, H, blocks } = ctx;
  const occ = new Int16Array(W * H).fill(-1);
  for (let i = 0; i < blocks.length; i++) {
    const p = st.pos[i];
    if (p < 0) continue;
    const x = p % W, y = (p / W) | 0;
    for (const [dx, dy] of blocks[i].cells) occ[(y + dy) * W + x + dx] = i;
  }
  return occ;
}

/** Board.exited.length — kept on the state rather than counted: it is read in the hottest loops. */
export const exitedCount = (ctx, st) => st.out;

/** Board.conditionMet */
function conditionMet(ctx, st, b) {
  const c = b.condition;
  if (!c) return true;
  if (c.type === 'exits') return exitedCount(ctx, st) >= c.count;
  if (c.type === 'color') {
    for (let j = 0; j < ctx.blocks.length; j++) {
      if (st.pos[j] >= 0 && ctx.blocks[j].color === c.color) return false;
    }
    return true;
  }
  if (c.type === 'block') return st.pos[c.index] < 0;
  return true;
}

/** Board.canMove */
export function canMove(ctx, st, i) {
  const b = ctx.blocks[i];
  if (b.kind === 'wall') return false;
  if (b.kind === 'locked') return conditionMet(ctx, st, b);
  return true;
}

/** Board._directionRejectReason, with the block standing at (x, y). */
function directionOk(ctx, b, x, y, dx, dy) {
  if (b.kind === 'rail') return b.axis === 'h' ? dy === 0 : dx === 0;
  if (b.kind === 'anchor' && b.dir) {
    const [ax, ay] = SIDE_VEC[b.dir];
    return dx === ax && dy === ay;
  }
  const { arrows, W } = ctx;
  if (ctx.hasArrows) {
    const want = 1 + dirIndex(dx, dy);
    for (const [cx, cy] of b.cells) {
      const a = arrows[(y + cy) * W + x + cx];
      if (a && a !== want) return false;
    }
  }
  return true;
}

/**
 * Everything about a block's moves that does not depend on where the OTHER
 * blocks are, computed once per grid.
 *
 * The board is at most 8×8, so a set of cells fits in two 32-bit words and
 * "is this cell free" becomes one AND. Per block and per anchor position:
 *   lo/hi[p]   the cells it covers standing at p
 *   halo[p]    those cells and their neighbours (see `touchMasks`)
 *   step[p*4+d]  -1: the move is refused (direction — except for a slider, see
 *              dirOk — or off the grid with no
 *              gate); >= 0: the position it moves to; -2: it leaves — then
 *              clrLo/clrHi are the cells that must be free for it (the part
 *              still inside the grid) and gates[p*4+d] the gates on that side
 *              that could take it, in the game's order (`_gateFor` takes the
 *              first), before capacity and late opening are checked.
 * Keyed by ctx in a WeakMap: build.js derives new contexts with spreads, and a
 * cache stored ON the context would travel into them with stale gate indices.
 */
const PRE = new WeakMap();

function precompute(ctx) {
  let pre = PRE.get(ctx);
  if (pre) return pre;
  const { W, H } = ctx;
  if (W * H > 64) throw new Error('The search engine handles boards of 64 cells at most');
  const N = W * H;
  const bit = (lo, hi, c) => (c < 32 ? [lo | (1 << c), hi] : [lo, hi | (1 << (c - 32))]);
  pre = ctx.blocks.map((b) => {
    const lo = new Int32Array(N), hi = new Int32Array(N), hLo = new Int32Array(N), hHi = new Int32Array(N);
    const valid = new Uint8Array(N);
    const step = new Int8Array(N * 4).fill(-1);
    const clrLo = new Int32Array(N * 4), clrHi = new Int32Array(N * 4);
    const gates = new Array(N * 4);
    const next = new Int16Array(N * 4).fill(-1);
    const dirOk = new Uint8Array(N * 4);
    for (let p = 0; p < N; p++) {
      const x = p % W, y = (p / W) | 0;
      if (!b.cells.every(([cx, cy]) => x + cx < W && y + cy < H)) continue;
      valid[p] = 1;
      let l = 0, h = 0, al = 0, ah = 0;
      for (const [cx, cy] of b.cells) {
        const ax = x + cx, ay = y + cy;
        [l, h] = bit(l, h, ay * W + ax);
        for (const [nx, ny] of [[ax, ay], [ax - 1, ay], [ax + 1, ay], [ax, ay - 1], [ax, ay + 1]]) {
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) [al, ah] = bit(al, ah, ny * W + nx);
        }
      }
      lo[p] = l; hi[p] = h; hLo[p] = al; hHi[p] = ah;
    }
    for (let p = 0; p < N; p++) {
      if (!valid[p]) continue;
      const x = p % W, y = (p / W) | 0;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d];
        // A slider's direction is checked once, where the run starts (`step`),
        // not on every cell it crosses: that is `dirOk`, read by `reach`.
        dirOk[p * 4 + d] = directionOk(ctx, b, x, y, dx, dy) ? 1 : 0;
        if (!dirOk[p * 4 + d] && b.kind !== 'slide') continue;
        if (leaves(ctx, b, x, y, dx, dy)) {
          let cl = 0, ch = 0;
          for (const [cx, cy] of b.cells) {
            const nx = x + cx + dx, ny = y + cy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            [cl, ch] = bit(cl, ch, ny * W + nx);
          }
          clrLo[p * 4 + d] = cl & ~lo[p]; clrHi[p * 4 + d] = ch & ~hi[p];
          const side = sideOf(dx, dy);
          const lr = side === 'left' || side === 'right';
          const list = [];
          for (let k = 0; k < ctx.gates.length; k++) {
            const g = ctx.gates[k];
            if (g.side !== side) continue;
            if (b.kind !== 'joker' && !colorsOf(b).some((c) => colorsOf(g).includes(c))) continue;
            const covers = b.cells.every(([cx, cy]) => {
              const v = lr ? y + cy : x + cx;
              return v >= g.start && v < g.start + g.length;
            });
            if (covers) list.push(k);
          }
          if (list.length) { step[p * 4 + d] = -2; gates[p * 4 + d] = list; }
          continue;
        }
        const np = (y + dy) * W + x + dx;
        step[p * 4 + d] = 0;
        next[p * 4 + d] = np;
        clrLo[p * 4 + d] = lo[np] & ~lo[p]; clrHi[p * 4 + d] = hi[np] & ~hi[p];
      }
    }
    return { lo, hi, hLo, hHi, step, next, clrLo, clrHi, gates, dirOk };
  });
  PRE.set(ctx, pre);
  return pre;
}

/** The precomputed masks of block `i` (see `precompute`). */
export const blockMasks = (ctx, i) => precompute(ctx)[i];

/** The occupied cells as two 32-bit words. */
export function occBits(ctx, st) {
  const pre = precompute(ctx);
  let lo = 0, hi = 0;
  for (let i = 0; i < ctx.blocks.length; i++) {
    const p = st.pos[i];
    if (p < 0) continue;
    lo |= pre[i].lo[p]; hi |= pre[i].hi[p];
  }
  return { lo, hi };
}

function leaves(ctx, b, x, y, dx, dy) {
  const { W, H } = ctx;
  for (const [cx, cy] of b.cells) {
    const nx = x + cx + dx, ny = y + cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return true;
  }
  return false;
}

/**
 * Board._gateFor, among the gates precomputed for this side (side, colour and
 * cover already checked): the first one open and with room, or -1.
 */
function gateFor(ctx, st, b, list) {
  for (const k of list) {
    const g = ctx.gates[k];
    if (g.opensAfter && exitedCount(ctx, st) < g.opensAfter) continue;
    if (st.cap[k] >= 0 && st.cap[k] < b.cost) continue;
    return k;
  }
  return -1;
}

// Visited marks for `reach`, reused across calls: a fresh Set per call was most
// of the generator's running time.
let seen = new Uint32Array(0);
let stamp = 0;

/**
 * Where block `i` can go in ONE gesture, and every gate it can leave by.
 * `occ` is `occBits` of the state.
 *
 * A dragged block follows the finger around obstacles, so one gesture reaches
 * its whole connected region (`dragTowards`). A slider cannot be steered: one
 * gesture is one run (Board.slideTarget: it runs until something stops it; at
 * the edge it leaves if a gate takes it).
 *
 * `firstExit` stops at the first exit found (cells then incomplete).
 *
 * @returns {{ cells: number[], exits: Array<{p, dx, dy, gate}> }} — one exit per gate
 */
export function reach(ctx, st, occ, i, firstExit = false) {
  const b = ctx.blocks[i];
  const out = { cells: [], exits: [] };
  if (st.pos[i] < 0 || !canMove(ctx, st, i)) return out;
  const m = precompute(ctx)[i];
  const p0 = st.pos[i];
  const oLo = occ.lo & ~m.lo[p0], oHi = occ.hi & ~m.hi[p0];
  const gates = [];

  if (b.kind === 'slide') {
    for (let d = 0; d < 4; d++) {
      if (!m.dirOk[p0 * 4 + d]) continue;
      let p = p0, moved = false;
      for (let k = 0; k < 40; k++) {
        const s = m.step[p * 4 + d];
        if (s === -1) break;
        const free = (m.clrLo[p * 4 + d] & oLo) === 0 && (m.clrHi[p * 4 + d] & oHi) === 0;
        if (s === -2) {
          const g = free ? gateFor(ctx, st, b, m.gates[p * 4 + d]) : -1;
          if (g >= 0) {
            if (!gates.includes(g)) { gates.push(g); out.exits.push({ p: p0, dx: DIRS[d][0], dy: DIRS[d][1], gate: g }); }
            p = -1;
          }
          break;
        }
        if (!free) break;
        p = m.next[p * 4 + d]; moved = true;
      }
      if (p >= 0 && moved) out.cells.push(p);
    }
    return out;
  }

  const N = ctx.W * ctx.H;
  if (seen.length < N) seen = new Uint32Array(N);
  if (++stamp === 0xffffffff) { seen.fill(0); stamp = 1; }
  seen[p0] = stamp;
  const queue = [p0];
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    for (let d = 0; d < 4; d++) {
      const s = m.step[p * 4 + d];
      if (s === -1) continue;
      if ((m.clrLo[p * 4 + d] & oLo) !== 0 || (m.clrHi[p * 4 + d] & oHi) !== 0) continue;
      if (s === -2) {
        const g = gateFor(ctx, st, b, m.gates[p * 4 + d]);
        if (g >= 0 && !gates.includes(g)) {
          gates.push(g); out.exits.push({ p, dx: DIRS[d][0], dy: DIRS[d][1], gate: g });
          if (firstExit) return out;
        }
        continue;
      }
      const np = m.next[p * 4 + d];
      if (seen[np] !== stamp) { seen[np] = stamp; queue.push(np); out.cells.push(np); }
    }
  }
  return out;
}

/** Board._exit */
export function applyExit(ctx, st, i, gate) {
  st.pos[i] = -1;
  st.out++;
  if (st.cap[gate] >= 0) st.cap[gate] -= ctx.blocks[i].cost;
}

/**
 * Is this exit safe to take immediately, without branching?
 *
 * Leaving never costs a gesture that would not be paid anyway, and it only ever
 * frees room, advances countdowns, empties colours and opens shutters. The one
 * thing it can spoil is CAPACITY: the room a block takes in a gate may be the
 * room another block needed. So an exit is taken greedily when its gate has no
 * capacity, or when it is the only gate the block can reach; a block that could
 * choose between gates that have a capacity is left to the search — and so is
 * a joker by a gate with a capacity, even with one gate in reach.
 */
function safeExit(ctx, st, exits, b) {
  if (exits.every((e) => st.cap[e.gate] < 0)) return exits[0];
  // A joker fits every gate, so the gate it reaches first is not necessarily
  // its gate: leaving by it may take the last places a coloured block needed.
  // Waiting is a real option — that is the trap `countTraps` looks for.
  if (b.kind === 'joker') return null;
  const gates = new Set(exits.map((e) => e.gate));
  return gates.size === 1 ? exits[0] : null;
}

/**
 * Takes every safe exit, repeatedly. `log` receives them in order.
 *
 * One occupancy map, updated as blocks leave, and passes over the blocks until
 * one takes nothing: rescanning from the first block after every exit made this
 * the generator's hottest function.
 */
export function normalize(ctx, st, log = null) {
  let exits = 0;
  const occ = occBits(ctx, st);
  const pre = precompute(ctx);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < ctx.blocks.length; i++) {
      if (st.pos[i] < 0 || ctx.blocks[i].kind === 'wall') continue;
      const r = reach(ctx, st, occ, i);
      if (!r.exits.length) continue;
      const e = safeExit(ctx, st, r.exits, ctx.blocks[i]);
      if (!e) continue;
      log?.push({ type: 'exit', i, ...e });
      occ.lo &= ~pre[i].lo[st.pos[i]]; occ.hi &= ~pre[i].hi[st.pos[i]];
      applyExit(ctx, st, i, e.gate);
      exits++;
      changed = true;
    }
  }
  return exits;
}

/**
 * `normalize`, for a state that was normalized before ONE park.
 *
 * A park frees the cells its block left and fills the ones it went to. Filling
 * can only take room away, so the only blocks that can have gained an exit are
 * the ones that could reach a freed cell — plus the parked block itself, the
 * sliders (a freed cell anywhere on their line can lengthen a run), and the
 * blocks already holding a capacity choice (filling a cell can narrow that
 * choice to one gate, which makes it safe). The caller names them; if none of
 * them leaves, nothing else can, and the full pass is skipped. It was nine
 * tenths of the search.
 */
export function normalizeAfter(ctx, st, candidates, occ = occBits(ctx, st)) {
  // Without capacity every exit is safe, so finding ONE is enough.
  const uncapped = st.cap.every((c) => c < 0);
  for (const i of candidates) {
    if (st.pos[i] < 0) continue;
    if (uncapped) {
      if (reach(ctx, st, occ, i, true).exits.length) return normalize(ctx, st);
      continue;
    }
    const r = reach(ctx, st, occ, i);
    if (r.exits.length && safeExit(ctx, st, r.exits, ctx.blocks[i])) return normalize(ctx, st);
  }
  return 0;
}

export const isDone = (ctx, st) => ctx.blocks.every((b, i) => b.kind === 'wall' || st.pos[i] < 0);

export function stateKey(st) {
  // -1 (gone, or no capacity) becomes U+FFFF: still one distinct character.
  return String.fromCharCode.apply(null, st.pos) + String.fromCharCode.apply(null, st.cap);
}
