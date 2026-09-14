/**
 * Prépare le site publié — `node tools/publier.mjs [dossier]`
 *
 * Copie les sources telles quelles plutôt que de les fondre en un fichier
 * unique. La raison est arithmétique : la base de niveaux pèse quatre
 * méga-octets, et le fichier unique en fait six. C'était tenable à vingt
 * niveaux ; à six cents, cela fait quinze secondes d'attente en 4G avant de
 * voir quoi que ce soit — et un jeu qu'on attend est un jeu qu'on ferme.
 *
 * Servi en modules, le jeu ouvre sur `index.json` (17 Ko) et ne charge un monde
 * qu'au moment de le jouer (~150 Ko). Le fichier unique reste fabriqué par
 * `tools/bundle.mjs`, pour le partage hors ligne et l'ouverture par double-clic.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const cible = process.argv[2] || join(racine, '..', 'docs');

/** Ce que le navigateur demande réellement. Rien d'autre n'a à être publié. */
const CONTENU = ['index.html', 'privacy.html', 'src', 'styles', 'levels', 'audio', 'images', 'vendor'];

/**
 * De `levels/`, on ne publie que l'AMORCE.
 *
 * Les niveaux viennent de Supabase désormais, et le client garde en cache ce
 * qu'il a téléchargé. Les trente mondes sur disque pesaient 3,8 Mo publiés pour
 * n'être lus qu'au premier lancement sans réseau — l'index et le premier monde
 * suffisent à ce cas, et c'est 60 Ko.
 *
 * Les vingt-neuf autres restent dans le dépôt : les outils node mesurent la
 * base livrée, et `publish-levels.mjs` la pousse en base depuis ces fichiers.
 */
const AMORCE = ['index.json', 'monde-0.json'];

rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });

for (const nom of CONTENU) {
  const source = join(racine, nom);
  if (!existsSync(source)) {
    console.warn(`  absent, ignoré : ${nom}`);
    continue;
  }
  if (nom === 'levels') {
    mkdirSync(join(cible, nom), { recursive: true });
    for (const fichier of AMORCE) cpSync(join(source, fichier), join(cible, nom, fichier));
    continue;
  }
  cpSync(source, join(cible, nom), { recursive: true });
}

// Sans ce fichier, GitHub Pages passe le site à Jekyll, qui ignore les dossiers
// commençant par un souligné et peut réécrire ce qu'il ne comprend pas.
writeFileSync(join(cible, '.nojekyll'), '');

const poids = (dossier) => readdirSync(dossier, { withFileTypes: true })
  .reduce((somme, e) => {
    const p = join(dossier, e.name);
    return somme + (e.isDirectory() ? poids(p) : statSync(p).size);
  }, 0);

const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log('Site préparé dans', cible);
for (const nom of CONTENU) {
  const p = join(cible, nom);
  if (!existsSync(p)) continue;
  console.log('  ', nom.padEnd(10), ko(statSync(p).isDirectory() ? poids(p) : statSync(p).size).padStart(9));
}
console.log('  ', 'total'.padEnd(10), ko(poids(cible)).padStart(9),
  '· première ouverture :', ko(statSync(join(cible, 'index.html')).size
    + poids(join(cible, 'src')) + statSync(join(cible, 'styles/main.css')).size
    + statSync(join(cible, 'levels/index.json')).size));
