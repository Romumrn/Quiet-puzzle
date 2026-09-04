/**
 * Vérification de syntaxe — `node tools/check.mjs`
 *
 * `node --check` ne détecte pas de façon fiable les erreurs des modules ES :
 * on importe donc réellement chaque module. Les modules qui touchent au DOM
 * sont ignorés (ils ne sont pas chargeables sous Node).
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NAVIGATEUR_SEUL = ['boardView.js', 'input.js', 'screens.js', 'mapScreen.js',
                         'gameplayUI.js', 'resultScreen.js', 'main.js', 'save.js', 'api.js'];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith('.js')) yield p;
  }
}

let echecs = 0;
for (const file of walk('src')) {
  if (NAVIGATEUR_SEUL.includes(file.split('/').pop())) continue;
  try {
    await import('../' + relative('.', file));
    console.log('  OK   ' + file);
  } catch (e) {
    echecs++;
    console.log(' ECHEC ' + file + ' — ' + e.message);
  }
}
process.exit(echecs ? 1 : 0);
