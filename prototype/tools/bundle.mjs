/**
 * Bundler — `node tools/bundle.mjs`
 *
 * Regroupe les modules ES, le CSS et le markup en UN fichier HTML autonome,
 * pour publication (Artifact, partage par mail, ouverture en double-clic).
 * Le projet source reste modulaire : ce script ne modifie rien, il produit
 * dist/quiet-puzzle.html.
 *
 * Chaque module devient une IIFE qui renvoie ses exports, de sorte que les
 * espaces de noms (`import * as screens`) et les noms identiques d'un module à
 * l'autre (`show`, `el`, `update`…) ne se marchent pas dessus.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Ordre de dépendance : un module ne cite que des modules déjà définis.
const MODULES = [
  'src/core/block.js',
  'src/core/gameState.js',
  'src/core/board.js',
  'src/core/levels.js',
  'src/core/solver.js',
  'src/data/save.js',
  'src/data/events.js',
  'src/audio/manifest.js',
  'src/audio/audioManager.js',
  'src/monetization/currency.js',
  'src/monetization/adPolicy.js',
  'src/monetization/adManager.js',
  'src/meta/daily.js',
  'src/data/api.js',
  'src/render/boardView.js',
  'src/input/input.js',
  'src/ui/screens.js',
  'src/ui/theme.js',
  'src/ui/editor.js',
  'src/monetization/failOffer.js',
  'src/ui/mapScreen.js',
  'src/ui/gameplayUI.js',
  'src/ui/resultScreen.js',
  'src/main.js',
];

const ns = (file) => '__m_' + basename(file, '.js');

function transform(file) {
  let code = read(file);
  const exported = new Set();

  // import { a, b as c } from './x.js'  ->  const { a, b: c } = __m_x;
  code = code.replace(
    /^import\s*\{([^}]+)\}\s*from\s*'([^']+)';?$/gm,
    (_, names, from) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = ${ns(from)};`,
  );
  // import * as ns from './x.js'  ->  const ns = __m_x;
  code = code.replace(
    /^import\s*\*\s*as\s+(\w+)\s*from\s*'([^']+)';?$/gm,
    (_, local, from) => `const ${local} = ${ns(from)};`,
  );

  // Relève les noms exportés, puis retire le mot-clé `export`.
  for (const re of [
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+class\s+([A-Za-z_$][\w$]*)/gm,
    /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  ]) {
    for (const m of code.matchAll(re)) exported.add(m[1]);
  }
  code = code.replace(/^export\s+/gm, '');

  const returned = [...exported].join(', ');
  return `const ${ns(file)} = (() => {\n${code}\nreturn { ${returned} };\n})();`;
}

let bundle = MODULES.map(transform).join('\n\n');

// Le son est embarqué en URI `data:` : la politique de sécurité d'un Artifact
// interdit de charger un média depuis un autre hôte, et un fichier unique doit
// pouvoir s'ouvrir par double-clic sans dossier à côté.
const audios = [...bundle.matchAll(/'(audio\/[\w.-]+\.mp3)'/g)].map((m) => m[1]);
let poidsAudio = 0;
for (const chemin of [...new Set(audios)]) {
  const abs = join(root, chemin);
  if (!existsSync(abs)) {
    console.warn(`  audio manquant, laissé en lien : ${chemin}`);
    continue;
  }
  const b64 = readFileSync(abs).toString('base64');
  poidsAudio += b64.length;
  bundle = bundle.split(`'${chemin}'`).join(`'data:audio/mpeg;base64,${b64}'`);
}

// Markup : on reprend le contenu du <body> d'index.html, sans la balise script.
const html = read('index.html');
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const out = `<title>Quiet Puzzle</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&display=swap">
<style>
${read('styles/main.css')}
</style>

${body}

<script>
${bundle}
</script>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/quiet-puzzle.html'), out);

// Deux sorties, parce que les deux destinations n'ont pas les mêmes règles :
//
//  - quiet-puzzle.html est un FRAGMENT : un Artifact interdit d'écrire soi-même
//    <!doctype>, <html>, <head> ou <body>, et fournit lui-même l'encodage.
//  - standalone.html est un document COMPLET, avec sa déclaration d'encodage.
//    Sans elle, un serveur statique qui n'annonce pas utf-8 dans ses en-têtes
//    fait lire le fichier en latin-1 et tous les accents deviennent illisibles.
const standalone = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#fbf4f6">
${out}
</html>
`;
writeFileSync(join(root, 'dist/standalone.html'), standalone);
console.log(`dist/quiet-puzzle.html (fragment Artifact) — ${(out.length / 1024).toFixed(0)} Ko `
  + `dont ${(poidsAudio / 1024).toFixed(0)} Ko de son, ${MODULES.length} modules`);
console.log(`dist/standalone.html (document complet, utf-8) — ${(standalone.length / 1024).toFixed(0)} Ko`);
