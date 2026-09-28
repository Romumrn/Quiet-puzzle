/**
 * Builds ONE level slot of a realm — `node prototype/tools/build-slot.mjs <realm> <slot> <dir>`
 *
 * A realm is built slot after slot on a single core, and the slowest 8×8 trap
 * realms take half a day that way. Run their twenty slots as twenty processes,
 * then assemble:
 *
 *   node prototype/tools/build-slot.mjs 49 0 /tmp/slots   # … one per slot, in parallel
 *   SLOTS_DIR=/tmp/slots node prototype/tools/build-levels.mjs --realm 49
 *
 * Same seeds as `buildRealm`, so the same grids as a build in one go. The
 * assembly (sort, sawtooth placement, limits) is left to build-levels.mjs,
 * which reads the slots back through `SLOTS_DIR`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSlot } from '../../generator/index.js';

const [realm, slot, dir] = process.argv.slice(2);
if (dir === undefined) {
  console.error('usage: build-slot.mjs <realm> <slot> <dir>');
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const grid = buildSlot(Number(realm), Number(slot));
writeFileSync(join(dir, `${realm}-${slot}.json`), JSON.stringify(grid));
console.log(`realm ${realm} slot ${slot}: ${grid.parks} parks, ${grid.traps || 0} traps, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
