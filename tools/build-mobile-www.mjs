/**
 * Prépare le contenu web de l'app mobile — `node tools/build-mobile-www.mjs`
 *
 * Calqué sur `prototype/tools/publier.mjs` (même liste de contenu, même
 * copie telle quelle sans fusion), à une différence près : ici on embarque
 * la base de niveaux complète, pas seulement l'amorce.
 *
 * Le site web se contente de l'amorce parce qu'il peut compléter depuis
 * Supabase à la demande. L'app packagée ne doit pas dépendre du réseau au
 * premier lancement — un joueur qui installe le jeu dans le métro doit
 * pouvoir jouer aux trente mondes tout de suite.
 *
 * `npx cap sync android` lit ensuite ce dossier via `webDir` dans
 * mobile/capacitor.config.json.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(racine, 'prototype');
const cible = join(racine, 'mobile', 'www');

const CONTENU = ['index.html', 'src', 'styles', 'levels', 'audio', 'images', 'vendor'];

rmSync(cible, { recursive: true, force: true });
mkdirSync(cible, { recursive: true });

for (const nom of CONTENU) {
  const chemin = join(source, nom);
  if (!existsSync(chemin)) {
    console.warn(`  absent, ignoré : ${nom}`);
    continue;
  }
  cpSync(chemin, join(cible, nom), { recursive: true });
}

function poids(chemin) {
  const info = statSync(chemin);
  if (!info.isDirectory()) return info.size;
  return readdirSync(chemin).reduce((somme, nom) => somme + poids(join(chemin, nom)), 0);
}

let total = 0;
for (const nom of CONTENU) {
  const chemin = join(cible, nom);
  if (!existsSync(chemin)) continue;
  const taille = statSync(chemin).isDirectory() ? poids(chemin) : statSync(chemin).size;
  total += taille;
  console.log(`  ${nom.padEnd(10)} ${(taille / 1024).toFixed(0).padStart(6)} Ko`);
}
console.log(`  ${'total'.padEnd(10)} ${(total / 1024).toFixed(0).padStart(6)} Ko  → ${cible}`);
