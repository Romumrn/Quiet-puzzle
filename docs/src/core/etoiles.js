/**
 * Barème des étoiles — le seul endroit qui décide d'une note.
 *
 * Deux seuils, exprimés en fraction du glissé de RÉFÉRENCE du niveau : le
 * nombre de gestes de la solution connue. Indexer la note sur la solution, et
 * non sur la limite de coups, est ce qui fait que bien jouer paie à tout
 * niveau — un barème calculé sur `moveLimit`, qui se resserre avec la
 * progression, plafonnait un joueur parfait à 2★ passé le niveau 7.
 *
 * Ce module ne dépend de rien : le générateur s'en sert hors ligne pour écrire
 * `starDrags` dans la base, et l'application s'en sert pour recalculer ces
 * seuils quand une calibration vient corriger la référence (voir
 * `data/api.js`). Les deux doivent donner le même résultat, d'où un seul
 * fichier plutôt qu'une constante recopiée.
 */

/** 3★ tant qu'on ne dépasse pas la référence de plus de 10 %. */
export const MARGE_3E = 0.1;
/** 2★ jusqu'à 30 % au-dessus. Au-delà, la grille vidée vaut une étoile. */
export const MARGE_2E = 0.3;

/**
 * Seuils `[3★, 2★]` pour un nombre de glissés de référence.
 *
 * `Math.max` garantit deux seuils DISTINCTS : sans lui, une solution de deux ou
 * trois glissés donnait le même nombre aux deux, et la note ne pouvait plus
 * valoir deux étoiles — elle sautait de trois à une.
 */
export function seuilsEtoiles(minDrags) {
  const trois = Math.ceil(minDrags * (1 + MARGE_3E));
  return [trois, Math.max(trois + 1, Math.ceil(minDrags * (1 + MARGE_2E)))];
}
