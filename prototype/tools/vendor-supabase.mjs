/**
 * Vendors `@supabase/supabase-js` as a standalone, browser-ready ESM file —
 * `node tools/vendor-supabase.mjs`. Run after bumping the version in
 * package.json. See the comment in `src/data/supabaseClient.js` for why this
 * is vendored rather than imported from a CDN.
 */

import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'node_modules/@supabase/supabase-js/dist/index.mjs');
const outDir = join(root, 'vendor');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  outfile: join(outDir, 'supabase-js.esm.js'),
  logLevel: 'warning',
});

console.log('  @supabase/supabase-js  → vendor/supabase-js.esm.js');
