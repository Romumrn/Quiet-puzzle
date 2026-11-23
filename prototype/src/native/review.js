/**
 * Asking for a Play Store rating — Google's in-app review card.
 *
 * Only at a moment the player is pleased: a first three-star win once they
 * are hooked (level REVIEW_FROM onward), or a realm just finished. Never after
 * a loss, never on a button: Google decides whether the card actually shows
 * (a quota, about once a month), so a "Rate us" button could do nothing.
 *
 * Google's policy also forbids asking anything first ("Do you like the
 * game?") or steering only happy players to the store — so no home-made card
 * in front of it, just Google's own.
 *
 * Our own spacing (REVIEW_EVERY_DAYS) keeps from spending Google's quota on
 * players who already said no: the card says nothing back about what they did.
 */

import { InAppReview } from '../../vendor/capacitor-in-app-review.esm.js';
import { isNative } from './capacitor.js';
import * as store from '../data/save.js';

const REVIEW_FROM = 5;
const REVIEW_EVERY_DAYS = 45;
/** Lets the win sequence play out first: the card comes over a calm screen. */
const REVIEW_DELAY_MS = 2600;

/**
 * Called after a win. `realmDone`: the last level of a realm; else a first
 * three-star win counts.
 */
export function afterWin({ level, stars, firstWin, realmDone = false }) {
  if (!isNative()) return;
  if (level < REVIEW_FROM) return;
  if (!realmDone && !(firstWin && stars === 3)) return;
  const d = store.load();
  if (d.reviewAskedAt && Date.now() - d.reviewAskedAt < REVIEW_EVERY_DAYS * 86400e3) return;
  d.reviewAskedAt = Date.now();
  store.save(d);
  setTimeout(() => InAppReview.requestReview().catch(() => {}), REVIEW_DELAY_MS);
}
