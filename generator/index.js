/**
 * The generator's front door — `getLevel(n)`.
 *
 * Assembles what the three other files decide: `realms.js` the tuning table,
 * `curve.js` the ramps and the limits, `build.js` the grid. The result matches
 * the shape of a row of the level database, which is the only thing the game
 * ever reads.
 *
 * Node only. No module of the application imports this file.
 */

import { build } from './build.js';
import { curve, limitsFor } from './curve.js';
import { LEVELS_PER_REALM, realmOf } from './realms.js';

export { LEVELS_PER_REALM, TOTAL_LEVELS, REALMS, realmOf } from './realms.js';

/**
 * CURATED REALMS — the twenty levels ordered by what they turned out to be,
 * not by what they were asked to be.
 *
 * `curve(n)` ramps the QUANTITIES across a realm — walls, rails, anchors — and
 * that ramp is honest. What it cannot do is promise the RESULT: generation is a
 * search over random grids, and the difficulty that comes out scatters. Realm 3
 * shipped as 13 13 13 12 13 13 15 13 16 13 18 20 14 16 15 18 17 17 15 22 — a
 * staircase with the steps in the wrong order, where level 12 is harder than
 * level 14 and the player feels it.
 *
 * So a curated realm generates all twenty, MEASURES them, and then decides where
 * each one goes:
 *
 *  - sorted by measured difficulty, so the climb is real;
 *  - the hardest kept LAST, because a realm has to close on its own summit;
 *  - and one easy level dropped back in at random inside the run.
 *
 * That last one is not a flaw to be tolerated, it is the point. Twenty levels of
 * strictly increasing difficulty read as a grind; one that suddenly gives way
 * lets the player feel they have got better, and it is the level they clear
 * three-starred on the first try. It is never placed in the first three (the
 * realm has not climbed yet, nothing to relieve) nor last (that place is taken).
 *
 * Opt-in per realm, because reordering changes which grid a level number gets,
 * and every published level number is a grid someone has a record on.
 */
function curateRealm(realmId) {
  const first = realmId * LEVELS_PER_REALM + 1;
  const numbers = [];
  for (let k = 0; k < LEVELS_PER_REALM; k++) numbers.push(first + k);

  /**
   * Difficulty as a single number, so grids can be compared at all.
   *
   * Gestures lead because that is what a player spends. `demand` — states the
   * solver explored — breaks ties: two levels of the same length are not the
   * same when one of them can be walked straight through and the other cannot.
   * A park is worth a couple of gestures on its own: it asks a kind of question
   * the other two measures cannot see.
   */
  const weigh = (level) => level.minDrags
    + Math.min(4, Math.log10(Math.max(1, level.demand ?? 1)))
    + 2 * (level.parks || 0);

  const pool = numbers.map((n) => ({ n, grid: build(n) })).filter((c) => c.grid);
  if (pool.length < LEVELS_PER_REALM) return null;   // fall back to plain order

  for (const c of pool) {
    c.grid.minDrags = c.grid.minDrags ?? 0;
    c.weight = weigh(c.grid);
  }
  pool.sort((a, b) => a.weight - b.weight);

  /**
   * The realm closes on its LONGEST level, not its heaviest.
   *
   * `weigh` blends gestures with solver backtracking, which is the right way to
   * order twenty levels — but it is not what a player feels at the end of a
   * world. Closing on the heaviest left fifteen realms out of fifty ending on a
   * level SHORTER than one they had already played, and that reads as the world
   * fizzling out however much the solver had to think.
   *
   * So the finale is chosen on drags, ties broken by weight. The other nineteen
   * keep the blended order.
   */
  pool.sort((a, b) => a.weight - b.weight);
  let top = 0;
  for (let i = 1; i < pool.length; i++) {
    const better = pool[i].grid.minDrags > pool[top].grid.minDrags
      || (pool[i].grid.minDrags === pool[top].grid.minDrags && pool[i].weight > pool[top].weight);
    if (better) top = i;
  }
  const hardest = pool.splice(top, 1)[0];
  const rng = mulberry32(0xbeef * realmId + 7717);
  const breatherAt = 3 + Math.floor(rng() * (LEVELS_PER_REALM - 5));
  const breather = pool.splice(Math.floor(rng() * 3), 1)[0];
  pool.splice(breatherAt, 0, breather);
  pool.push(hardest);

  // Each grid now takes the NUMBER of the slot it landed in. Only the slot
  // moves: the grid, its solution and its reference gesture count travel
  // together, so the level a player meets is exactly the one that was measured.
  return new Map(pool.map((c, k) => [first + k, c.grid]));
}

/** Same seeded generator the placement uses, so a realm is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();
/** Realms already curated, so the pool is generated once and not per level. */
const curated = new Map();

/** Returns the data for level `n` (1-indexed). */
export function getLevel(n) {
  if (cache.has(n)) return cache.get(n);

  const realm = realmOf(n);
  let g;
  if (curve(n).curated) {
    // The whole realm is generated at once, then ordered. Asking for any one of
    // its levels builds all twenty — the order cannot be known before every
    // grid has been measured.
    if (!curated.has(realm.id)) curated.set(realm.id, curateRealm(realm.id));
    g = curated.get(realm.id)?.get(n) ?? build(n);
  } else {
    g = build(n);
  }
  if (!g) throw new Error(`Cannot generate level ${n}`);

  const { starDrags, moveLimit, timeLimit, playable } = limitsFor(n, g);

  const level = {
    levelId: `lvl_${String(n).padStart(3, '0')}`,
    number: n,
    // English label: this is the realm's human-readable identifier in the data.
    // What the player sees goes through the catalogue and `i18n.realmText`,
    // which has all five languages.
    realm: realm.name.en,
    difficulty: realm.difficulty.en,
    width: g.W,
    height: g.H,
    colorCount: g.colorCount,
    moveLimit,
    timeLimit,
    minDrags: g.minDrags,
    /**
     * Number of states a solver explores to clear the grid. A level that stays
     * near its block count solves without ever going wrong; beyond that, you
     * have to backtrack. Measured at build time for demanding realms, absent
     * elsewhere — balancing reads it, the game ignores it.
     */
    ...(g.demand === undefined ? {} : { demand: g.demand }),
    /**
     * Set only when the realm asked for a gesture floor and the generator could
     * not reach it — the value is the floor that was missed. The game ignores
     * it; `build-levels.mjs` reports it so a tier that promises more than the
     * generator can deliver is caught at build time and not in playtesting.
     */
    ...(g.minDragsShort === undefined ? {} : { minDragsShort: g.minDragsShort }),
    /**
     * How many blocks have to be PARKED — moved somewhere they do not exit
     * from. Absent on every level that clears by exit order alone, which is the
     * whole database as it stands. `parkingShort` marks a level whose realm
     * asked for a park and whose board had nowhere to put one.
     */
    ...(g.parks ? { parks: g.parks } : {}),
    ...(g.parkingShort ? { parkingShort: true } : {}),
    objective: { type: 'clear_all', target: playable },
    starDrags,
    estimatedTime: timeLimit,
    gates: g.gates,
    // One-way cells, when the realm has them. Absent everywhere else, so no
    // level that predates the mechanic grows a field it never had.
    ...(g.oneWay && g.oneWay.length ? { oneWay: g.oneWay } : {}),
    blocks: g.blocks,
    solution: g.solution, // used by tests, balancing and the hint system
  };
  cache.set(n, level);
  return level;
}
