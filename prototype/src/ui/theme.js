/**
 * Chromatic skin, indexed on progression.
 *
 * Two distinct things, and they must be kept apart:
 *
 *  - THE INTERFACE HUE (`--h`) — backgrounds, strokes, accents. Every realm has
 *    its anchor hue, and we slide from that one towards the next realm's across
 *    its twenty levels. The player therefore sees the setting shift under them
 *    without any break, while still recognising each realm by its dominant.
 *
 *  - THE BLOCK COLOURS (`--c0`…`--c5`) — they change from one realm to the
 *    next, but ALL AT ONCE, at the transition, and never within a realm. The
 *    six families keep their glyphs (●◆▲★■⬢): it is the glyph, not the hue,
 *    that identifies a family from one end of the game to the other. Repainting
 *    the families therefore changes the mood with nothing to relearn.
 */

import { realms, levelsPerRealm, realmOf } from '../data/levelStore.js';

/**
 * Interpolation along the shortest arc of the colour wheel. Without it, going
 * from 345° to 22° went all the way back down the wheel — the player crossed
 * the entire spectrum instead of the thirty-seven degrees actually between
 * them.
 */
function arc(from, to, t) {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

export function hueFor(level) {
  const all = realms();
  const n = Math.min(Math.max(1, level), all.length * levelsPerRealm());
  const realm = realmOf(n);
  const next = all[realm.id + 1] || realm;   // the last realm keeps its own
  const t = ((n - 1) % levelsPerRealm()) / levelsPerRealm();
  return Math.round(arc(realm.hue, next.hue, t));
}

/** The six block colours of the realm this level belongs to. */
export function paletteFor(level) {
  return realmOf(Math.min(Math.max(1, level), realms().length * levelsPerRealm())).palette;
}

/** Applies hue and palette to an element. */
export function applyTo(element, level) {
  element.style.setProperty('--h', hueFor(level));
  paletteFor(level).forEach((color, i) => element.style.setProperty(`--c${i}`, color));
}

/**
 * Where the menu's skin is kept between launches. index.html reads it in an
 * inline script, before the first paint: the menu opens straight in the
 * player's colour instead of `:root`'s default pink, which used to show until
 * the level database, the session and the sync had all answered. No skin kept
 * (first launch, reinstall) puts up the loading veil instead (`html.booting`).
 */
const SKIN_KEY = 'quietpuzzle.skin';

/**
 * Applies a level's skin to the whole application. `remember` keeps it for
 * the next cold start — the menu passes it, a replayed old level does not.
 */
export function apply(level, { remember = false } = {}) {
  applyTo(document.getElementById('app'), level);
  if (!remember) return;
  try {
    localStorage.setItem(SKIN_KEY, JSON.stringify({ h: hueFor(level), palette: paletteFor(level) }));
  } catch { /* private mode, full storage: the next launch shows the veil */ }
}

/** Lifts the loading veil, if the launch had one. Idempotent. */
export function endBoot() {
  document.documentElement.classList.remove('booting');
}
