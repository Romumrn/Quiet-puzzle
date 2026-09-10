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
import * as themes from '../meta/themes.js';

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

/**
 * Applies hue and palette to an element.
 *
 * A CHOSEN theme wins over the realm's hue: it is a preference, and a
 * preference overwritten at every realm change would not be one. With no theme
 * chosen, the original chromatic progression is kept.
 */
export function applyTo(element, level) {
  const chosen = themes.byId(themes.chosen());
  const hue = chosen ? chosen.hue : hueFor(level);
  const palette = chosen ? chosen.palette : paletteFor(level);
  element.style.setProperty('--h', hue);
  palette.forEach((color, i) => element.style.setProperty(`--c${i}`, color));
}

/** Applies a level's skin to the whole application. */
export function apply(level) {
  applyTo(document.getElementById('app'), level);
}
