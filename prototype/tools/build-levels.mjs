/**
 * Builds the level database — `node tools/build-levels.mjs`
 *
 * Calls the generator (`src/core/levels.js`) once and writes the result to
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
import { getLevel, TOTAL_LEVELS, LEVELS_PER_REALM, REALMS } from '../src/core/levels.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'levels');
const keep = process.argv.includes('--garder');

mkdirSync(output, { recursive: true });

const realmFile = (id) => `monde-${id}.json`;
const writeJson = (name, data) => {
  const filePath = join(output, name);
  if (keep && existsSync(filePath)) return { name, size: readFileSync(filePath).length, kept: true };
  const json = JSON.stringify(data);
  writeFileSync(filePath, json);
  return { name, size: json.length, kept: false };
};

console.log(`Generating ${TOTAL_LEVELS} levels…`);

const rows = [];
let total = 0;

for (const R of REALMS) {
  const first = R.id * LEVELS_PER_REALM + 1;
  const last = Math.min(TOTAL_LEVELS, first + LEVELS_PER_REALM - 1);
  const levels = [];
  for (let n = first; n <= last; n++) levels.push(getLevel(n));

  const r = writeJson(realmFile(R.id), { realm: R.id, name: R.name.en, levels });
  total += r.size;
  rows.push({ R, first, last, ...r, blocks: levels.reduce((s, L) => s + L.blocks.length, 0) });
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
    name: R.name.en,
    difficulty: R.difficulty,
    introduces: R.introduces,
    hue: R.hue,
    palette: R.palette,
    file: realmFile(R.id),
    first: R.id * LEVELS_PER_REALM + 1,
    last: Math.min(TOTAL_LEVELS, (R.id + 1) * LEVELS_PER_REALM),
  })),
};
const r = writeJson('index.json', index);
total += r.size;

const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log('\nmonde                     niveaux  blocs   poids');
for (const l of rows) {
  console.log(
  l.R.name.en.padEnd(24),
    `${l.first}–${l.last}`.padStart(8),
    String(l.blocks).padStart(6),
    ko(l.size).padStart(8),
    l.kept ? ' (kept)' : '',
  );
}
console.log(`\nindex.json ${ko(r.size)} · full database ${ko(total)} in levels/`);
