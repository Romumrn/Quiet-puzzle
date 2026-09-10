/**
 * Syntax check — `node tools/check.mjs`
 *
 * `node --check` does not reliably catch ES module errors, so we import each
 * module for real. Browser-only modules are skipped because they cannot run
 * under Node.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BROWSER_ONLY = ['boardView.js', 'input.js', 'screens.js', 'mapScreen.js',
                      'gameplayUI.js', 'resultScreen.js', 'main.js', 'save.js', 'api.js',
                      'supabaseClient.js', 'auth.js'];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith('.js')) yield p;
  }
}

let failures = 0;
for (const file of walk('src')) {
  if (BROWSER_ONLY.includes(file.split('/').pop())) continue;
  try {
    await import('../' + relative('.', file));
    console.log('  OK   ' + file);
  } catch (e) {
    failures++;
    console.log(' FAIL ' + file + ' — ' + e.message);
  }
}
process.exit(failures ? 1 : 0);
