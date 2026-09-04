/**
 * Bundler — `node tools/bundle.mjs`
 *
 * Regroupe les modules ES, le CSS et le markup en UN fichier HTML autonome,
 * pour publication (Artifact, partage par mail, ouverture en double-clic).
 * Le projet source reste modulaire : ce script ne modifie rien, il produit
 * dist/puzzle-quest.html.
 *
 * Chaque module devient une IIFE qui renvoie ses exports, de sorte que les
 * espaces de noms (`import * as screens`) et les noms identiques d'un module à
 * l'autre (`show`, `el`, `update`…) ne se marchent pas dessus.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const bundle = MODULES.map(transform).join('\n\n');

// Markup : on reprend le contenu du <body> d'index.html, sans la balise script.
const html = read('index.html');
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const out = `<title>Puzzle Quest</title>
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
writeFileSync(join(root, 'dist/puzzle-quest.html'), out);
console.log(`dist/puzzle-quest.html — ${(out.length / 1024).toFixed(0)} Ko, ${MODULES.length} modules`);
