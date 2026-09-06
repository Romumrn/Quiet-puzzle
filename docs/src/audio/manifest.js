/**
 * Catalogue des fichiers audio.
 *
 * Ce module est un point de couture volontaire : tools/bundle.mjs le réécrit en
 * remplaçant les chemins par des URI `data:` au moment de fabriquer le fichier
 * unique. Le jeu servi depuis un dossier charge donc des fichiers séparés,
 * tandis que la version en un seul fichier embarque tout, sans qu'une ligne de
 * code du lecteur ne change.
 */

export const MUSIQUE = 'audio/3-verriere.mp3';

/** Carillons de sortie, du grave à l'aigu. Voir AudioManager.sortie(). */
export const SORTIES = [
  'audio/sfx-sortie-1.mp3',
  'audio/sfx-sortie-2.mp3',
  'audio/sfx-sortie-3.mp3',
  'audio/sfx-sortie-4.mp3',
  'audio/sfx-sortie-5.mp3',
  'audio/sfx-sortie-6.mp3',
];
