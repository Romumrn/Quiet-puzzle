/**
 * Loads the level database under Node — `import { getLevel } from './base.mjs'`
 *
 * Tools must measure and validate the shipped data in `levels/`, not whatever the
 * generator would produce if we ran it again. They can diverge: a level edited by
 * hand, or a database not rebuilt after a tuning change.
 *
 * We reuse the application's reader instead of re-implementing one: same code
 * path, same defensive copies, same error messages. `BUNDLED` is the seam the
 * single-file build uses in exactly the same way.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED, open } from '../src/data/levelStore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'levels');
const read = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));

if (!existsSync(join(root, 'index.json'))) {
  console.error('\nLevel database missing. Run: node tools/build-levels.mjs\n');
  process.exit(1);
}

BUNDLED.index = read('index.json');
for (const realm of BUNDLED.index.realms) BUNDLED.realms[realm.file ?? realm.fichier] = read(realm.file ?? realm.fichier);
await open();

export * from '../src/data/levelStore.js';
