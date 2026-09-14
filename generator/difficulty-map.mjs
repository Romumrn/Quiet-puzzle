/**
 * Difficulty map — `node generator/difficulty-map.mjs [output.html]`
 *
 * Renders the whole level database as one page: a median-per-world curve, and a
 * grid of every level coloured by the number of gestures its reference solution
 * needs. Writes a standalone HTML file; open it, or publish it as an Artifact.
 *
 * WHY THIS LIVES NEXT TO THE GENERATOR. Every other lever in `tiers.js` asks for
 * a grid that LOOKS hard — more blocks, tighter gates, bigger pieces — and none
 * of them promises the level takes more than one pass to solve. `minDrags` is
 * the only measurement that says how long a level actually is, and it is only
 * legible in aggregate: one number per level tells you nothing, six hundred laid
 * out in a grid show you immediately where a tier stops delivering. Tuning a
 * world without looking at this map is tuning blind.
 *
 * It reads `prototype/levels/`, not the generator: what ships is what gets
 * measured. Rebuild first if you changed a tier.
 *
 *     node prototype/tools/build-levels.mjs --realm 30
 *     node generator/difficulty-map.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REALMS } from './realms.js';
import { curve } from './curve.js';

const here = dirname(fileURLToPath(import.meta.url));
const LEVELS = join(here, '..', 'prototype', 'levels');
const TEMPLATE = join(here, 'templates', 'difficulty-map.html');
const out = process.argv[2] || join(here, '..', 'difficulty-map.html');

const read = (name) => JSON.parse(readFileSync(join(LEVELS, name), 'utf8'));
const index = read('index.json');

/**
 * One row per world. The page recomputes every figure it prints from this, so a
 * rebuilt database updates the prose too rather than leaving it quoting numbers
 * that used to be true.
 */
const worlds = index.realms.map((r) => {
  const levels = read(r.file ?? r.fichier).levels;
  const R = REALMS.find((x) => x.id === r.id);
  const drags = levels.map((L) => L.minDrags);
  const sorted = [...drags].sort((a, b) => a - b);

  return {
    id: r.id,
    name: r.name,
    tier: R?.tier || 'steady',
    hue: r.hue,
    first: r.first,
    last: r.last,
    median: sorted[Math.floor(sorted.length / 2)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    // The floor the tier asked for, so the map can be read against the intent
    // and not only against the outcome. Zero means the world has none.
    floor: R ? (curve(r.first).minDragsFloor || 0) : 0,
    levels: levels.map((L) => ({
      n: L.number,
      d: L.minDrags,
      s3: L.starDrags[0],
      s2: L.starDrags[1],
      mv: L.moveLimit,
      t: L.timeLimit,
      b: L.blocks.length,
      dem: L.demand ?? null,
      // Set when the generator could not reach the world's floor. Worth seeing
      // on the map: a run of these is a tier promising more than the board can
      // deliver.
      short: L.minDragsShort ?? null,
    })),
  };
});

const data = JSON.stringify({ worlds });
const page = readFileSync(TEMPLATE, 'utf8');
if (!page.includes('/*__DATA__*/')) {
  throw new Error('difficulty-map: the template has no /*__DATA__*/ placeholder');
}
writeFileSync(out, page.replace('/*__DATA__*/', data));

const all = worlds.flatMap((w) => w.levels.map((l) => l.d));
const short = worlds.flatMap((w) => w.levels.filter((l) => l.short !== null)).length;
const size = (readFileSync(out).length / 1024).toFixed(0);

console.log(`${out}  —  ${size} kB`);
console.log(`${worlds.length} worlds · ${all.length} levels · `
  + `gestures ${Math.min(...all)}–${Math.max(...all)}`);
if (short) console.log(`⚠  ${short} level(s) below their world's gesture floor`);
