/**
 * Event nomenclature.
 *
 * A single place decides the NAMES and the PARAMETERS. Scattered through the
 * code they drift: two spellings for the same gesture, a parameter present here
 * and missing there, and the funnel becomes unreadable at the exact moment it
 * is needed. The names follow the analytics platforms' convention (lowercase,
 * past tense verb, `object_action`).
 *
 * Gameplay parameters are fixed once and for all by `levelContext`: that is
 * what makes an abandon and a completion comparable without wondering whether
 * one of them counts moves differently.
 */

import { track } from './events.js';

export const EVENTS = Object.freeze({
  // Acquisition
  APP_OPEN: 'app_open',
  FIRST_OPEN: 'first_open',
  TUTORIAL_STARTED: 'tutorial_started',
  TUTORIAL_COMPLETED: 'tutorial_completed',

  // Gameplay
  LEVEL_STARTED: 'level_started',
  LEVEL_COMPLETED: 'level_completed',
  LEVEL_FAILED: 'level_failed',
  LEVEL_RESTARTED: 'level_restarted',
  LEVEL_ABANDONED: 'level_abandoned',

  // Monetisation
  REWARDED_OFFER_SHOWN: 'rewarded_offer_shown',
  REWARDED_STARTED: 'rewarded_started',
  REWARDED_COMPLETED: 'rewarded_completed',
  REWARD_GRANTED: 'reward_granted',
  INTERSTITIAL_SHOWN: 'interstitial_shown',
  INTERSTITIAL_SKIPPED: 'interstitial_skipped',
  IAP_VIEWED: 'iap_viewed',
  IAP_STARTED: 'iap_started',
  IAP_COMPLETED: 'iap_completed',
  REMOVE_ADS_PURCHASED: 'remove_ads_purchased',

  // Retention
  DAILY_OPEN: 'daily_open',
  DAILY_COMPLETED: 'daily_completed',
  STREAK_STARTED: 'streak_started',
  STREAK_CONTINUED: 'streak_continued',
});

/**
 * Parameters common to every level event.
 *
 * `attempt` counts the tries at THIS level since the last completion: it is
 * what says whether a level is a wall, where the failure rate alone confuses
 * "failed once" with "failed ten times".
 */
export function levelContext(level, { attempt = 1, board = null, duration = null } = {}) {
  return {
    level_id: level?.levelId ?? null,
    level: level?.number ?? 0,
    world: level?.realm ?? null,
    attempt,
    duration,
    moves: board ? board.dragsUsed() : null,
    // The reference IN FORCE at the time of the game. Without it, `moves`
    // compares to nothing server-side: no way to say a player beat the known
    // solution, nor to spot a client stuck on an old calibration. This is the
    // measurement that will make recalibrating the scale possible.
    min_drags: level?.minDrags ?? null,
    stars: board ? board.stars() : null,
  };
}

export const emit = (name, params = {}) => track(name, params);
