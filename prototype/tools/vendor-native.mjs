/**
 * Vendors the Capacitor runtime and native plugin packages as standalone,
 * browser-ready ESM files — `node tools/vendor-native.mjs`.
 *
 * Same reasoning as `vendor-supabase.mjs` (see the comment in
 * `src/data/supabaseClient.js`): no bundler at serve time, and no fetching
 * JS from a CDN at runtime inside the packaged Android app. Each package is
 * bundled fully standalone (its own copy of small shared bits included)
 * rather than sharing one `@capacitor/core` module — harmless duplication,
 * since on both native and web the plugins talk through the single
 * `window.Capacitor` object the platform injects, not through JS module
 * state.
 *
 * `Capacitor.isNativePlatform()` (from vendor/capacitor-core.esm.js) is what
 * lets the shared `src/` code branch safely: these imports resolve and run
 * fine in a plain browser too (the web build never calls their native-only
 * methods), so main.js does not need two versions.
 *
 * Run from `mobile/` after `npm install` there (the packages must be in
 * mobile/node_modules).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mobileModules = join(root, '..', 'mobile', 'node_modules');
const outDir = join(root, 'vendor');

const PACKAGES = [
  ['@capacitor/core', 'dist/index.js', 'capacitor-core.esm.js'],
  ['@capacitor/app', 'dist/esm/index.js', 'capacitor-app.esm.js'],
  ['@capacitor/haptics', 'dist/esm/index.js', 'capacitor-haptics.esm.js'],
  ['@capacitor/status-bar', 'dist/esm/index.js', 'capacitor-status-bar.esm.js'],
  ['@capacitor/browser', 'dist/esm/index.js', 'capacitor-browser.esm.js'],
  ['@capacitor-community/admob', 'dist/esm/index.js', 'capacitor-admob.esm.js'],
  ['@southdevs/capacitor-google-auth', 'dist/esm/index.js', 'capacitor-google-auth.esm.js'],
];

mkdirSync(outDir, { recursive: true });

for (const [pkg, entryRel, outFile] of PACKAGES) {
  const entry = join(mobileModules, pkg, entryRel);
  if (!existsSync(entry)) {
    console.warn(`  absent, ignoré (npm install manquant dans mobile/ ?) : ${pkg}`);
    continue;
  }
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    outfile: join(outDir, outFile),
    logLevel: 'warning',
  });
  console.log(`  ${pkg.padEnd(36)} → vendor/${outFile}`);
}
