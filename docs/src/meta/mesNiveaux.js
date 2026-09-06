/**
 * Historique des grilles créées dans l'éditeur.
 *
 * Un niveau dessiné se perdait à la fermeture de l'éditeur : rien ne le gardait,
 * et une grille sur laquelle on a passé dix minutes ne survivait pas à un aller
 * au menu. On enregistre donc chaque essai — au moment de le tester comme de le
 * proposer — pour pouvoir le reprendre.
 *
 * Stockage local, comme le reste du prototype. La liste est bornée : au-delà,
 * les plus anciens brouillons tombent. Un historique qui grossit sans fin finit
 * par saturer le stockage du navigateur, et personne ne relit son vingtième
 * brouillon.
 */

import { track } from '../data/events.js';

const CLE = 'puzzlequest.mesniveaux.v1';
const MAX = 12;

const lire = () => {
  try {
    const brut = localStorage.getItem(CLE);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
};

const ecrire = (liste) => {
  try {
    localStorage.setItem(CLE, JSON.stringify(liste.slice(0, MAX)));
  } catch { /* stockage plein ou bloqué : l'éditeur continue sans historique */ }
};

export const liste = () => lire();

/**
 * Enregistre une grille, ou met à jour celle qui porte déjà cet identifiant.
 *
 * Deux essais successifs sur la même grille ne doivent pas produire deux
 * entrées : l'éditeur garde l'identifiant de ce qu'il a chargé, et le repasse
 * ici. Sans cela, tester cinq fois de suite remplissait l'historique de cinq
 * copies presque identiques.
 *
 * @returns {string} l'identifiant, à conserver côté éditeur
 */
export function enregistrer(niveau, { id = null, titre = '', propose = false } = {}) {
  const l = lire();
  const existant = id ? l.find((e) => e.id === id) : null;
  const entree = existant || { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` };

  Object.assign(entree, {
    titre: (titre || entree.titre || '').slice(0, 40),
    modifieLe: new Date().toISOString(),
    largeur: niveau.width,
    hauteur: niveau.height,
    blocs: niveau.blocks.filter((b) => b.kind !== 'wall').length,
    propose: propose || entree.propose === true,
    niveau,
  });

  if (!existant) l.unshift(entree);
  else {
    // Le plus récemment touché remonte en tête : c'est celui qu'on reprendra.
    l.splice(l.indexOf(existant), 1);
    l.unshift(existant);
  }
  ecrire(l);
  track('editor_draft_saved', { id: entree.id, blocs: entree.blocs });
  return entree.id;
}

export function charger(id) {
  return lire().find((e) => e.id === id) || null;
}

export function supprimer(id) {
  ecrire(lire().filter((e) => e.id !== id));
}

export function vider() {
  ecrire([]);
}
