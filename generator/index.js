/**
 * The generator's front door — `getLevel(n)`.
 *
 * Assembles what the other files decide: `realms.js` the worlds and their
 * profiles, `rush/build.js` the grid, `curve.js` the limits. The result matches
 * the shape of a row of the level database, which is the only thing the game
 * ever reads.
 *
 * Node only. No module of the application imports this file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLevel } from './rush/build.js';
import { realmShape } from '../prototype/src/core/sawtooth.js';
import { limitsFor } from './curve.js';
import { LEVELS_PER_REALM, REALMS, realmOf } from './realms.js';

export { LEVELS_PER_REALM, TOTAL_LEVELS, REALMS, realmOf } from './realms.js';

/**
 * A realm's twenty levels, placed on its sawtooth.
 *
 * Each level is ASKED for its slot's parks, and generation mostly delivers —
 * mostly: a climb can overshoot its target, or fall short. So the twenty are
 * built, measured, and then dealt out by rank: the easiest measured level to
 * the easiest slot, and so on. The shape holds whatever the generator did;
 * only the exact numbers move.
 */
/**
 * One level of a realm, before placement: slot `k`'s target, seeded by the
 * level number. Exported so a slow realm can be built one slot per process
 * (`prototype/tools/build-slot.mjs`) — same seeds, so the same grids as
 * building the realm in one go.
 */
export function buildSlot(realmId, k) {
  const R = REALMS[realmId];
  const first = realmId * LEVELS_PER_REALM + 1;
  const SLOTS = realmShape(realmId, LEVELS_PER_REALM);
  // A level whose seed finds nothing gets fresh seeds before the world is
  // declared broken. Seeded, so still the same grid on every run.
  let grid = null;
  for (let attempt = 0; !grid && attempt < 4; attempt++) {
    grid = buildLevel(R.profile, SLOTS[k].f, first + k + attempt * 100000);
  }
  if (!grid) throw new Error(`Cannot generate level ${first + k} (${R.name.en})`);
  return grid;
}

/**
 * `SLOTS_DIR=<dir>`: slots already built by build-slot.mjs are read from
 * `<dir>/<realm>-<slot>.json` instead of being built again.
 */
function slotFromCache(realmId, k) {
  const dir = process.env.SLOTS_DIR;
  const file = dir && join(dir, `${realmId}-${k}.json`);
  return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function buildRealm(realmId) {
  const first = realmId * LEVELS_PER_REALM + 1;
  // The sawtooth (see prototype/src/core/sawtooth.js), shared with the game so
  // the labels it shows match what was built.
  const SLOTS = realmShape(realmId, LEVELS_PER_REALM);
  const pool = [];
  for (let k = 0; k < LEVELS_PER_REALM; k++) {
    const grid = slotFromCache(realmId, k) || buildSlot(realmId, k);
    // One line per level on stderr: a world takes up to hours, and a silent one
    // cannot be told from a stuck one.
    process.stderr.write(`  level ${first + k}: ${grid.parks} parks (asked ${grid.targetParks}), ${grid.traps || 0} traps, ${grid.minDrags} drags\n`);
    pool.push(grid);
  }

  const weigh = (g) => g.parks * 10 + (g.traps || 0) * 4 + g.minDrags / 10;
  pool.sort((a, b) => weigh(a) - weigh(b));
  const slots = SLOTS.map((s, k) => ({ ...s, k })).sort((a, b) => a.f - b.f || a.k - b.k);
  const placed = new Array(LEVELS_PER_REALM);
  slots.forEach((s, rank) => { placed[s.k] = { ...pool[rank], tier: s.tier }; });
  return placed;
}

const realms = new Map();

/** Returns the data for level `n` (1-indexed). */
export function getLevel(n) {
  const realm = realmOf(n);
  if (!realms.has(realm.id)) realms.set(realm.id, buildRealm(realm.id));
  const g = realms.get(realm.id)[(n - 1) % LEVELS_PER_REALM];

  const { starDrags, moveLimit, timeLimit, playable } = limitsFor(n, g);

  return {
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
     * Blocks that must be moved aside, at the least, and how many separate
     * times the board jams along the way. The game ignores both; balancing and
     * the difficulty map read them. `parksShort` marks a level that fell short
     * of what its realm asked for.
     */
    parks: g.parks,
    stuckPhases: g.stuckPhases,
    ...(g.traps ? { traps: g.traps } : {}),
    // 'hard' | 'superhard' — the label the game shows before the level.
    ...(g.tier ? { tier: g.tier } : {}),
    ...(g.parksShort ? { parksShort: g.parksShort } : {}),
    objective: { type: 'clear_all', target: playable },
    starDrags,
    estimatedTime: timeLimit,
    gates: g.gates,
    ...(g.oneWay?.length ? { oneWay: g.oneWay } : {}),
    blocks: g.blocks,
    solution: g.solution, // used by tests, balancing and the hint system
  };
}
