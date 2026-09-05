/**
 * Habillage chromatique, indexé sur la progression.
 *
 * Deux choses distinctes, et il faut les tenir séparées :
 *
 *  - LA TEINTE DE L'INTERFACE (`--h`) — fonds, traits, accents. Chaque monde a
 *    sa teinte d'ancrage, et l'on glisse de celle-ci vers celle du monde suivant
 *    au fil de ses vingt niveaux. Le joueur voit donc le décor virer sous lui
 *    sans jamais de rupture, tout en reconnaissant chaque monde à sa dominante.
 *
 *  - LES COULEURS DES BLOCS (`--c0`…`--c5`) — elles changent d'un monde à
 *    l'autre, mais D'UN SEUL COUP, au passage, et jamais à l'intérieur d'un
 *    monde. Les six familles gardent leurs glyphes (●◆▲★■⬢) : c'est le glyphe,
 *    et non la teinte, qui identifie une famille d'un bout à l'autre du jeu.
 *    Repeindre les familles change donc l'ambiance sans rien à réapprendre.
 */

import { realms, levelsPerRealm, realmDe } from '../data/levelStore.js';

/**
 * Interpolation sur le plus court arc de la roue chromatique. Sans elle, passer
 * de 345° à 22° redescendait toute la roue à l'envers — le joueur traversait le
 * spectre entier au lieu des trente-sept degrés qui les séparent réellement.
 */
function arc(depuis, vers, t) {
  const delta = ((vers - depuis + 540) % 360) - 180;
  return (depuis + delta * t + 360) % 360;
}

export function teintePour(niveau) {
  const tous = realms();
  const n = Math.min(Math.max(1, niveau), tous.length * levelsPerRealm());
  const monde = realmDe(n);
  const suivant = tous[monde.id + 1] || monde;   // le dernier monde garde la sienne
  const t = ((n - 1) % levelsPerRealm()) / levelsPerRealm();
  return Math.round(arc(monde.teinte, suivant.teinte, t));
}

/** Les six couleurs de blocs du monde auquel appartient ce niveau. */
export function palettePour(niveau) {
  return realmDe(Math.min(Math.max(1, niveau), realms().length * levelsPerRealm())).palette;
}

/** Applique teinte et palette à un élément. */
export function appliquerA(element, niveau) {
  element.style.setProperty('--h', teintePour(niveau));
  palettePour(niveau).forEach((couleur, i) => element.style.setProperty(`--c${i}`, couleur));
}

/** Applique l'habillage d'un niveau à toute l'application. */
export function appliquer(niveau) {
  appliquerA(document.getElementById('app'), niveau);
}
