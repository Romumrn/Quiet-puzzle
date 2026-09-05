/**
 * Ouvre la base de niveaux sous Node — `import { getLevel } from './base.mjs'`
 *
 * Les outils doivent mesurer et vérifier CE QUI EST LIVRÉ, c'est-à-dire les
 * fichiers de `levels/`, et non ce que le générateur produirait s'il tournait à
 * nouveau. Les deux peuvent diverger : un niveau retouché à la main, une base
 * pas régénérée après un réglage.
 *
 * On passe par le lecteur de l'application plutôt que d'en réécrire un : c'est
 * le même chemin de code, les mêmes copies défensives, les mêmes messages
 * d'erreur. `EMBARQUE` est le point de couture prévu pour ça — le bundler
 * l'utilise exactement de la même façon pour le fichier unique.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBARQUE, ouvrir } from '../src/data/levelStore.js';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', 'levels');
const lire = (nom) => JSON.parse(readFileSync(join(racine, nom), 'utf8'));

if (!existsSync(join(racine, 'index.json'))) {
  console.error('\nBase de niveaux absente. Lancer : node tools/build-levels.mjs\n');
  process.exit(1);
}

EMBARQUE.index = lire('index.json');
for (const monde of EMBARQUE.index.realms) EMBARQUE.mondes[monde.fichier] = lire(monde.fichier);
await ouvrir();

export * from '../src/data/levelStore.js';
