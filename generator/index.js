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
import { limitsFor } from './curve.js';
import { realmOf } from './realms.js';

export { LEVELS_PER_REALM, TOTAL_LEVELS, REALMS, realmOf } from './realms.js';

const cache = new Map();

/** Returns the data for level `n` (1-indexed). */
export function getLevel(n) {
  if (cache.has(n)) return cache.get(n);
  const g = build(n);
  if (!g) throw new Error(`Cannot generate level ${n}`);

  const realm = realmOf(n);
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
    objective: { type: 'clear_all', target: playable },
    starDrags,
    estimatedTime: timeLimit,
    gates: g.gates,
    blocks: g.blocks,
    solution: g.solution, // used by tests, balancing and the hint system
  };
  cache.set(n, level);
  return level;
}
