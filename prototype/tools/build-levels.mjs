/**
 * Fabrique la base de niveaux — `node tools/build-levels.mjs`
 *
 * Appelle le générateur (`src/core/levels.js`) une fois pour toutes et écrit le
 * résultat dans `levels/`. C'est la seule façon dont le générateur touche
 * désormais au jeu : l'application, elle, ne lit que ces fichiers.
 *
 * Le RNG étant seedé sur le numéro de niveau, relancer cet outil sans avoir
 * touché au générateur réécrit des fichiers identiques. Un niveau retouché à la
 * main est donc perdu à la régénération suivante — l'outil le dit avant
 * d'écraser, et `--garder` protège les fichiers déjà présents.
 *
 * Découpage : un fichier par monde, plus un index. L'application charge l'index
 * au démarrage et un monde à la première demande ; tout charger d'un coup
 * ferait attendre trois quarts de méga-octet pour jouer un seul niveau.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLevel, TOTAL_LEVELS, LEVELS_PER_REALM, REALMS } from '../src/core/levels.js';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = join(racine, 'levels');
const garder = process.argv.includes('--garder');

mkdirSync(sortie, { recursive: true });

const fichierDeMonde = (id) => `monde-${id}.json`;
const ecrire = (nom, data) => {
  const chemin = join(sortie, nom);
  if (garder && existsSync(chemin)) return { nom, taille: readFileSync(chemin).length, garde: true };
  const json = JSON.stringify(data);
  writeFileSync(chemin, json);
  return { nom, taille: json.length, garde: false };
};

console.log(`Génération de ${TOTAL_LEVELS} niveaux…`);

const lignes = [];
let total = 0;

for (const R of REALMS) {
  const premier = R.id * LEVELS_PER_REALM + 1;
  const dernier = Math.min(TOTAL_LEVELS, premier + LEVELS_PER_REALM - 1);
  const levels = [];
  for (let n = premier; n <= dernier; n++) levels.push(getLevel(n));

  const r = ecrire(fichierDeMonde(R.id), { realm: R.id, name: R.nom.fr, levels });
  total += r.taille;
  lignes.push({ R, premier, dernier, ...r, blocs: levels.reduce((s, L) => s + L.blocks.length, 0) });
}

/**
 * L'index porte tout ce dont l'interface a besoin AVANT d'ouvrir un niveau :
 * le nombre de niveaux, et pour chaque monde son nom, sa teinte, sa palette et
 * la nouveauté qu'il annonce. C'est ce qui permet à l'application de se régler
 * sur la base sans rien savoir du générateur.
 */
const index = {
  version: 1,
  genereLe: new Date().toISOString().slice(0, 10),
  levelsPerRealm: LEVELS_PER_REALM,
  totalLevels: TOTAL_LEVELS,
  realms: REALMS.map((R) => ({
    id: R.id,
    // Toutes les langues voyagent dans le catalogue. L'interface n'a alors rien
    // à savoir du générateur pour se traduire, et un monde ajouté sans une
    // traduction retombe proprement sur le français.
    nom: R.nom,
    difficulte: R.difficulte,
    apporte: R.apporte,
    // Libellé français à plat : les outils en ligne de commande impriment des
    // tableaux, pas des tables de langues.
    name: R.nom.fr,
    teinte: R.teinte,
    palette: R.palette,
    fichier: fichierDeMonde(R.id),
    premier: R.id * LEVELS_PER_REALM + 1,
    dernier: Math.min(TOTAL_LEVELS, (R.id + 1) * LEVELS_PER_REALM),
  })),
};
const r = ecrire('index.json', index);
total += r.taille;

const ko = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log('\nmonde                     niveaux  blocs   poids');
for (const l of lignes) {
  console.log(
    l.R.nom.fr.padEnd(24),
    `${l.premier}–${l.dernier}`.padStart(8),
    String(l.blocs).padStart(6),
    ko(l.taille).padStart(8),
    l.garde ? ' (gardé)' : '',
  );
}
console.log(`\nindex.json ${ko(r.taille)} · base complète ${ko(total)} dans levels/`);
