/**
 * Teinte de l'interface, indexée sur la progression.
 *
 * Toute la chromie de l'habillage (fonds, traits, accents) dérive d'une seule
 * variable CSS `--h`. En avançant dans les niveaux, cette teinte glisse
 * lentement du rose vers le vert d'eau, en passant par le lilas et le bleu
 * poudré : le joueur voit le monde changer sous lui sans jamais de rupture.
 *
 * Les COULEURS DES BLOCS, elles, ne bougent jamais. Elles portent la règle du
 * jeu — un bloc rose sort par une porte rose — et un joueur doit pouvoir les
 * apprendre une fois pour toutes.
 */

import { TOTAL_LEVELS } from '../core/levels.js';

/** Rose poudré au départ, vert d'eau à l'arrivée, en descendant la roue. */
export const TEINTE_DEBUT = 345;
export const TEINTE_FIN = 165;

export function teintePour(niveau) {
  const t = Math.min(1, Math.max(0, (niveau - 1) / (TOTAL_LEVELS - 1)));
  return Math.round(TEINTE_DEBUT + (TEINTE_FIN - TEINTE_DEBUT) * t);
}

/** Applique la teinte d'un niveau à toute l'application. */
export function appliquer(niveau) {
  document.getElementById('app').style.setProperty('--h', teintePour(niveau));
}

/** Applique une teinte à un élément précis (sections de la carte). */
export function appliquerA(element, niveau) {
  element.style.setProperty('--h', teintePour(niveau));
}
