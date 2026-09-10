/**
 * Star rating scale — the single place that decides a grade.
 *
 * Two thresholds, expressed as a fraction of the level's REFERENCE drag count:
 * the number of gestures in the known solution. Indexing the grade on the
 * solution rather than on the move limit is what makes playing well pay off at
 * every level — a scale computed from `moveLimit`, which tightens as the player
 * progresses, capped a perfect player at 2★ past level 7.
 *
 * This module depends on nothing: the generator uses it offline to write
 * `starDrags` into the level database, and the application uses it to recompute
 * those thresholds when a calibration corrects the reference (see
 * `data/api.js`). Both must agree, hence one file rather than a copied constant.
 */

/** 3★ as long as the player stays within 10% of the reference. */
export const MARGIN_3_STAR = 0.1;
/** 2★ up to 30% above it. Beyond that, clearing the grid is worth one star. */
export const MARGIN_2_STAR = 0.3;

/**
 * Thresholds `[3★, 2★]` for a given reference drag count.
 *
 * `Math.max` guarantees two DISTINCT thresholds: without it, a two- or
 * three-drag solution gave both the same number, and the grade could no longer
 * be worth two stars — it jumped from three straight to one.
 */
export function starThresholds(minDrags) {
  const three = Math.ceil(minDrags * (1 + MARGIN_3_STAR));
  return [three, Math.max(three + 1, Math.ceil(minDrags * (1 + MARGIN_2_STAR)))];
}
