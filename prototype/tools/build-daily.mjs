/**
 * Builds the daily challenges — `node prototype/tools/build-daily.mjs [days] [from]`
 *
 * One grid per date, the same for every player, written to
 * `levels/daily.json`. The game plays the date's entry as "the daily puzzle"
 * (see meta/dailyPuzzle.js), and the daily quest "finish the daily puzzle"
 * depends on there always being one: the old daily puzzle only ever served
 * grids drawn in the editor on the same device, so for nearly everyone there
 * was none.
 *
 * The profile is deliberately early-game — rails and walls on 6×6, 5 to 8
 * parks — so that anyone past the third world can play it, whatever mechanics
 * they have not met yet. Seeded by the date: rerunning rewrites the same grids.
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileOf } from '../../generator/realms.js';
import { buildLevel } from '../../generator/rush/build.js';
import { limitsFor } from '../../generator/curve.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const days = Number(process.argv[2]) || 120;
const from = process.argv[3] || new Date().toISOString().slice(0, 10);

// A capped effort: a day's grid has no world to hold up, and the odd seed
// that cannot reach its target should give up in seconds, not an hour.
const PROFILE = { ...profileOf({ features: ['walls'], W: 6, H: 6, colors: 4, parks: [5, 8] }), maxEvaluations: 600, stall: 300 };
const DAY = 86400000;

const out = {};
for (let d = 0; d < days; d++) {
  const date = new Date(Date.parse(from) + d * DAY).toISOString().slice(0, 10);
  const seed = 900000 + Math.floor(Date.parse(date) / DAY);
  // A little variety from day to day: somewhere on the profile's ramp.
  const t = (seed % 7) / 6;
  // A day's grid must make the player think: under 4 parks, try other seeds.
  let g = null;
  for (let a = 0; a < 6 && (!g || g.parks < 4); a++) {
    const next = buildLevel(PROFILE, t, seed + a * 100000);
    if (next && (!g || next.parks > g.parks)) g = next;
  }
  if (!g) throw new Error(`No grid for ${date}`);
  const lim = limitsFor(0, g);
  out[date] = {
    width: g.W, height: g.H, colorCount: g.colorCount, moveLimit: lim.moveLimit, timeLimit: lim.timeLimit,
    minDrags: g.minDrags, parks: g.parks, objective: { type: 'clear_all', target: lim.playable },
    starDrags: lim.starDrags, gates: g.gates, ...(g.oneWay?.length ? { oneWay: g.oneWay } : {}),
    blocks: g.blocks, solution: g.solution,
  };
  process.stdout.write(`${date}: ${g.parks} parks, ${g.minDrags} drags\n`);
  // Written after every day: a long run is usable before it ends.
  writeFileSync(join(root, 'levels', 'daily.json'), JSON.stringify({ from, days: out }));
}
console.log(`levels/daily.json — ${days} days from ${from}`);
