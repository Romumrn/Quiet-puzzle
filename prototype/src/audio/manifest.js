/**
 * Catalogue of the audio files.
 *
 * This module is a deliberate seam: tools/bundle.mjs rewrites it, replacing the
 * paths with `data:` URIs when building the single-file version. The game
 * served from a folder therefore loads separate files, while the one-file
 * version embeds everything, without a single line of the player changing.
 */

export const MUSIC = 'audio/3-verriere.mp3';

/** Exit chimes, from low to high. See AudioManager.exit(). */
export const EXIT_SOUNDS = [
  'audio/sfx-sortie-1.mp3',
  'audio/sfx-sortie-2.mp3',
  'audio/sfx-sortie-3.mp3',
  'audio/sfx-sortie-4.mp3',
  'audio/sfx-sortie-5.mp3',
  'audio/sfx-sortie-6.mp3',
];
