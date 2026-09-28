/**
 * The fewest PARKS that clear a grid — a park being a gesture that moves a
 * block without taking it out.
 *
 * Every block has to leave exactly once, so the exits are a fixed cost; what
 * separates an easy grid from a hard one is how many times the player must move
 * something aside first. That is the number this search minimises, and the one
 * the generator climbs on.
 *
 * Exits come in two kinds (see `safeExit` in engine.js):
 *  - safe ones are taken as soon as they are possible (`normalize`), which
 *    collapses the search enormously;
 *  - a choice between gates that have a capacity is a real decision, so it is a
 *    branch — a free one, it costs no park. Hence a 0-1 breadth-first search:
 *    free branches stay in the current layer, parks open the next one.
 */

import {
  newState, cloneState, occBits, blockMasks, reach, applyExit, normalize, normalizeAfter, isDone, stateKey, colorsOf,
} from './engine.js';

/**
 * For each block, the cells it could step onto next: every cell it covers at
 * any reachable position, and their neighbours. A park that frees one of these
 * may have opened a way out for it; a park that frees none of them cannot have.
 * As two 32-bit words (see `precompute` in engine.js).
 */
function touchMasks(ctx, st, reaches) {
  return reaches.map((r, j) => {
    if (!r || st.pos[j] < 0) return null;
    const m = blockMasks(ctx, j);
    let lo = m.hLo[st.pos[j]], hi = m.hHi[st.pos[j]];
    for (const p of r.cells) { lo |= m.hLo[p]; hi |= m.hHi[p]; }
    return [lo, hi];
  });
}

/**
 * @returns {{ parks, moves } | { parks: Infinity } | null}
 *   moves : the search's decisions, in order — `{ type: 'park', i, to }` or
 *           `{ type: 'exit', i, p, dx, dy, gate }`. Replaying them needs the
 *           same `normalize` after each one (see `replay`).
 *   null  : the budget ran out — nothing proven either way.
 *   parks: Infinity : proven unsolvable.
 */
export function solveParks(ctx, pos, maxStates = 120000, from = null) {
  // `from`: start from a state already in play (remaining capacities, blocks
  // out) rather than from the grid as dealt — how `countTraps` asks whether a
  // tempting exit has killed the board.
  const start = from ? cloneState(from) : newState(ctx, pos);
  normalize(ctx, start);
  if (isDone(ctx, start)) return { parks: 0, moves: [] };

  const best = new Map([[stateKey(start), 0]]);
  const prev = new Map([[stateKey(start), null]]);
  const layers = [[start]];
  let states = 1;
  let finish = null;
  const trace = (key, parks) => {
    const path = [];
    for (let at = key; prev.get(at); at = prev.get(at).from) path.push(prev.get(at).move);
    return { parks, moves: path.reverse() };
  };

  for (let cost = 0; cost < layers.length; cost++) {
    const layer = layers[cost];
    for (let li = 0; li < layer.length; li++) {
      const st = layer[li];
      const k = stateKey(st);
      if (best.get(k) !== cost) continue; // reached again, cheaper, since
      const occ = occBits(ctx, st);
      const reaches = ctx.blocks.map((b, i) => (st.pos[i] < 0 || b.kind === 'wall' ? null : reach(ctx, st, occ, i)));
      const touch = touchMasks(ctx, st, reaches);
      // Always re-examined after a park: sliders, and blocks holding a capacity choice.
      const always = ctx.blocks.map((b, i) => i)
        .filter((i) => reaches[i] && (ctx.blocks[i].kind === 'slide' || reaches[i].exits.length));

      for (let i = 0; i < ctx.blocks.length; i++) {
        const r = reaches[i];
        if (!r) continue;
        const moves = [];
        // Exits left over by `normalize` are the capacity choices: free branches.
        for (const e of r.exits) moves.push({ type: 'exit', i, ...e, w: 0 });
        for (const to of r.cells) moves.push({ type: 'park', i, to, w: 1 });
        const mi = blockMasks(ctx, i);
        const from = st.pos[i];

        for (const m of moves) {
          const ns = cloneState(st);
          if (m.type === 'exit') {
            applyExit(ctx, ns, i, m.gate);
            normalize(ctx, ns);
          } else {
            ns.pos[i] = m.to;
            const freedLo = mi.lo[from] & ~mi.lo[m.to], freedHi = mi.hi[from] & ~mi.hi[m.to];
            const candidates = new Set([i, ...always]);
            for (let j = 0; j < touch.length; j++) {
              if (touch[j] && j !== i && ((touch[j][0] & freedLo) !== 0 || (touch[j][1] & freedHi) !== 0)) candidates.add(j);
            }
            normalizeAfter(ctx, ns, candidates, {
              lo: (occ.lo & ~mi.lo[from]) | mi.lo[m.to], hi: (occ.hi & ~mi.hi[from]) | mi.hi[m.to],
            });
          }
          const nk = stateKey(ns);
          const nc = cost + m.w;
          const known = best.get(nk);
          if (known !== undefined && known <= nc) continue;
          best.set(nk, nc);
          const { w, ...move } = m;
          prev.set(nk, { from: k, move });
          if (isDone(ctx, ns)) {
            // A finish one park away is not yet the best: a free branch later
            // in this layer may still finish without it.
            if (nc === cost) return trace(nk, nc);
            finish ||= nk;
            continue;
          }
          if (++states > maxStates) return null;
          (layers[nc] ||= []).push(ns);
        }
      }
    }
    if (finish) return trace(finish, cost + 1);
  }
  return { parks: Infinity };
}

/**
 * Replays a solution and returns every gesture in order, safe exits included —
 * what a player would actually do, and what `build.js` turns into the game's
 * reference solution.
 */
export function replay(ctx, pos, moves) {
  const st = newState(ctx, pos);
  const steps = [];
  const phases = [normalize(ctx, st, steps)];
  for (const m of moves) {
    steps.push(m);
    if (m.type === 'exit') applyExit(ctx, st, m.i, m.gate); else st.pos[m.i] = m.to;
    phases.push(normalize(ctx, st, steps));
  }
  return { steps, phases, final: st };
}

/**
 * TRAPS along a solution: exits the player can take that look like progress
 * and leave the board unsolvable.
 *
 * Only an exit through a gate with a capacity can do that — every other exit
 * only frees room (see `safeExit`). So at every state the reference solution
 * passes through, each such exit on offer is tried, and the rest of the board
 * solved from there: proven unsolvable is a trap. The typical one is a joker,
 * which fits any gate, standing in front of a gate whose last places belong to
 * a block of that colour. Counted once per block and gate, however long the
 * temptation stays on offer.
 *
 * A dead-end check that runs out of budget is not counted: a trap has to be
 * proven.
 */
/**
 * Proves a state dead by counting alone: some set of capacity gates is the
 * only way out for blocks that need more room than those gates have left
 * (Hall's condition, over colours — where a block could physically go is not
 * looked at, which only makes the test weaker, never wrong). Cheap, and it is
 * what a joker trap is: a search would have to exhaust every move to prove the
 * same thing.
 */
export function capacityDead(ctx, st) {
  const capped = [];
  ctx.gates.forEach((g, k) => { if (st.cap[k] >= 0) capped.push(k); });
  if (!capped.length || capped.length > 12) return false;
  const needs = [];
  for (let i = 0; i < ctx.blocks.length; i++) {
    const b = ctx.blocks[i];
    if (st.pos[i] < 0 || b.kind === 'wall') continue;
    let open = false, mask = 0;
    ctx.gates.forEach((g, k) => {
      if (b.kind !== 'joker' && !colorsOf(b).some((c) => colorsOf(g).includes(c))) return;
      if (st.cap[k] < 0) open = true;
      else if (st.cap[k] >= b.cost) mask |= 1 << capped.indexOf(k);
    });
    if (open) continue;
    if (!mask) return true;
    needs.push([mask, b.cost]);
  }
  for (let S = 1; S < 1 << capped.length; S++) {
    let room = 0, demand = 0;
    capped.forEach((k, j) => { if (S & (1 << j)) room += st.cap[k]; });
    for (const [mask, cost] of needs) if ((mask & ~S) === 0) demand += cost;
    if (demand > room) return true;
  }
  return false;
}

export function countTraps(ctx, pos, moves, budget = 5000) {
  if (!ctx.gates.some((g) => g.capacity !== undefined)) return 0;
  const st = newState(ctx, pos);
  normalize(ctx, st);
  const found = new Set(), cleared = new Set();
  const look = () => {
    const occ = occBits(ctx, st);
    for (let i = 0; i < ctx.blocks.length; i++) {
      if (st.pos[i] < 0 || ctx.blocks[i].kind === 'wall') continue;
      for (const e of reach(ctx, st, occ, i).exits) {
        if (st.cap[e.gate] < 0) continue;
        const key = i * 64 + e.gate;
        if (found.has(key)) continue;
        const ns = cloneState(st);
        applyExit(ctx, ns, i, e.gate);
        const sk = stateKey(ns);
        if (cleared.has(sk)) continue;
        if (capacityDead(ctx, ns)) { found.add(key); continue; }
        const r = solveParks(ctx, null, budget, ns);
        if (r && r.parks === Infinity) found.add(key); else cleared.add(sk);
      }
    }
  };
  look();
  for (const m of moves) {
    if (m.type === 'exit') applyExit(ctx, st, m.i, m.gate); else st.pos[m.i] = m.to;
    normalize(ctx, st);
    look();
  }
  return found.size;
}
