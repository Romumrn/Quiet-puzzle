/**
 * Builds the level database — `node tools/build-levels.mjs`
 *
 * Calls the generator (`generator/`) once and writes the result to
 * `levels/`. This is the only way the generator touches the shipped game: the
 * app reads these files, not the generator.
 *
 * Because the RNG is seeded by the level number, rerunning this tool without
 * changing the generator rewrites identical files. A level edited by hand is
 * therefore lost on the next regeneration — the tool warns before overwriting,
 * and `--garder` protects existing files.
 *
 * Layout: one file per realm, plus an index. The app loads the index at startup
 * and a realm on first demand; loading everything up front would mean waiting
 * for a few hundred kilobytes before a single level can start.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLevel, TOTAL_LEVELS, LEVELS_PER_REALM, REALMS } from '../../generator/index.js';
import { curve } from '../../generator/curve.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'levels');
const args = process.argv.slice(2);
const keep = args.includes('--garder');

/**
 * `--realm <id>` rebuilds a single realm, leaving the others and the index
 * alone. Tuning a tier means running this a dozen times, and a full rebuild
 * costs minutes — most of them spent regenerating realms that did not change.
 */
const onlyRealm = args.includes('--realm') ? Number(args[args.indexOf('--realm') + 1]) : null;

mkdirSync(output, { recursive: true });

const realmFile = (id) => `monde-${id}.json`;
const writeJson = (name, data) => {
  const filePath = join(output, name);
  if (keep && existsSync(filePath)) return { name, size: readFileSync(filePath).length, kept: true };
  const json = JSON.stringify(data);
  writeFileSync(filePath, json);
  return { name, size: json.length, kept: false };
};

const todo = onlyRealm === null ? REALMS : REALMS.filter((R) => R.id === onlyRealm);
if (!todo.length) {
  console.error(`No realm ${onlyRealm} in REALMS.`);
  process.exit(1);
}

console.log(onlyRealm === null
  ? `Generating ${TOTAL_LEVELS} levels…`
  : `Generating realm ${onlyRealm} (${todo[0].name.en})…`);

const rows = [];
const short = [];
let total = 0;

for (const R of todo) {
  const first = R.id * LEVELS_PER_REALM + 1;
  const last = Math.min(TOTAL_LEVELS, first + LEVELS_PER_REALM - 1);
  const levels = [];
  for (let n = first; n <= last; n++) levels.push(getLevel(n));

  const r = writeJson(realmFile(R.id), { realm: R.id, name: R.name, levels });
  total += r.size;
  const drags = levels.map((L) => L.minDrags);
  for (const L of levels) {
    if (L.minDragsShort !== undefined) short.push({ n: L.number, got: L.minDrags, want: L.minDragsShort });
  }
  rows.push({
    R, first, last, ...r,
    blocks: levels.reduce((s, L) => s + L.blocks.length, 0),
    // What the tier actually delivered. Without it a floor is a wish: the only
    // way to know whether a step of the curve holds is to read it back.
    drags: `${Math.min(...drags)}–${Math.max(...drags)}`,
    floor: curve(first).minDragsFloor || 0,
  });
}

/**
 * The index carries everything the UI needs before opening a level: the number
 * of levels, and for each realm its name, hue, palette and the feature it introduces.
 * That lets the app boot against the database without knowing anything about the generator.
 */
const index = {
  version: 1,
  generatedOn: new Date().toISOString().slice(0, 10),
  levelsPerRealm: LEVELS_PER_REALM,
  totalLevels: TOTAL_LEVELS,
  realms: REALMS.map((R) => ({
    id: R.id,
    // All languages travel in the catalogue. The interface then knows nothing
    // about the generator and can translate itself, while a realm added without
    // a translation falls back cleanly to English.
    name: R.name,
    difficulty: R.difficulty,
    introduces: R.introduces,
    hue: R.hue,
    palette: R.palette,
    file: realmFile(R.id),
    first: R.id * LEVELS_PER_REALM + 1,
    last: Math.min(TOTAL_LEVELS, (R.id + 1) * LEVELS_PER_REALM),
  })),
};
// A partial build must not rewrite the index: it still describes the realms it
// did not regenerate, and overwriting it from REALMS alone would be fine today
// but silently wrong the moment the two drift.
const r = onlyRealm === null ? writeJson('index.json', index) : { size: 0, name: 'index.json', kept: true };
total += r.size;

const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log('\nrealm                     levels   blocks   drags  floor    size');
for (const l of rows) {
  console.log(
    l.R.name.en.padEnd(24),
    `${l.first}–${l.last}`.padStart(8),
    String(l.blocks).padStart(7),
    l.drags.padStart(7),
    (l.floor || '·').toString().padStart(6),
    ko(l.size).padStart(8),
    l.kept ? ' (kept)' : '',
  );
}

/**
 * A tier that promises more gestures than the generator can produce is a
 * tuning error, and it has to be visible here — in playtesting it shows up as
 * "this world feels easier than the last one", which is much harder to trace.
 */
if (short.length) {
  console.log(`\n⚠  ${short.length} level(s) below their realm's gesture floor:`);
  for (const s of short.slice(0, 12)) console.log(`   level ${s.n}: ${s.got} drags, floor ${s.want}`);
  if (short.length > 12) console.log(`   …and ${short.length - 12} more`);
  console.log('   Lower the tier\'s minDrags, or give the realm more room (bigger grid, more blocks).');
}

console.log(`\nindex.json ${ko(r.size)} · ${onlyRealm === null ? 'full database' : 'realm'} ${ko(total)} in levels/`);
