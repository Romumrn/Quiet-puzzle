/**
 * FailOfferController — equivalent of
 * Scripts/Monetization/FailOfferController.cs (tech doc §4, flagged there as
 * "critical monetization")
 *
 * On defeat, the player is offered a restart with extra time and moves rather
 * than losing everything: either in exchange for a rewarded ad, or for coins.
 *
 * Two deliberate safeguards:
 *  - the offer is made ONLY ONCE per attempt. Chaining continues turns a failed
 *    level into an ad pump and destroys the value of difficulty.
 *  - "Give up" is a normal button, not a tiny link: refusing must be as easy as
 *    accepting.
 */

import * as currency from './currency.js';
import { PLACEMENT } from './brokerManager.js';
import { track } from '../data/events.js';
import { EVENTS as EV } from '../data/analytics.js';
import { t } from '../ui/i18n.js';

/** What an accepted continue gives back. */
export const BONUS = Object.freeze({ SECONDS: 30, MOVES: 3 });

const el = (id) => document.getElementById(id);

/**
 * @returns {Promise<'ad'|'coins'|'retry'|null>} the chosen route, or null.
 */
export function offer({ board, ads }) {
  const panel = el('overlay-offer');
  const remaining = board.remaining();
  el('offer-lead').textContent = t(remaining > 1 ? 'offer.left.plural' : 'offer.left', { n: remaining });
  el('offer-coins-cost').textContent = currency.PRICES.CONTINUE;
  el('offer-bonus').textContent = t('offer.bonus', { s: BONUS.SECONDS, c: BONUS.MOVES });

  // The paid option disappears when the player cannot afford it: a greyed-out
  // button only reminds them of what they lack, at the worst possible moment.
  const coinsButton = el('btn-offer-coins');
  coinsButton.hidden = !currency.canAfford(currency.PRICES.CONTINUE);

  track(EV.REWARDED_OFFER_SHOWN, {
    placement: PLACEMENT.REWARDED_CONTINUE, level: board.level.number,
    reason: board.failReason, remaining,
  });
  panel.hidden = false;

  return new Promise((resolve) => {
    const close = (choice) => {
      panel.hidden = true;
      el('btn-offer-ad').onclick = null;
      el('btn-offer-coins').onclick = null;
      el('btn-offer-give-up').onclick = null;
      resolve(choice);
    };

    el('btn-offer-ad').onclick = async () => {
      panel.hidden = true;
      const rewarded = await ads.showRewarded(PLACEMENT.REWARDED_CONTINUE);
      if (rewarded) {
        track(EV.REWARD_GRANTED, {
          placement: PLACEMENT.REWARDED_CONTINUE, reward: 'continue',
          seconds: BONUS.SECONDS, moves: BONUS.MOVES,
        });
        close('ad');
      } else {
        panel.hidden = false; // ad abandoned: offer the choice again
      }
    };

    el('btn-offer-coins').onclick = () => {
      if (!currency.debit(currency.PRICES.CONTINUE, 'continue')) return;
      track('fail_offer_accepted', { level: board.level.number, method: 'coins' });
      close('coins');
    };

    /**
     * "Restart" rather than "Give up": after a refusal the defeat screen has
     * nothing left to teach the player, who mostly wants to get back to the
     * grid. So they are sent straight back into the game.
     */
    el('btn-offer-give-up').onclick = () => {
      track('fail_offer_declined', { level: board.level.number });
      close('retry');
    };
  });
}

/** Applies the continue to the board. */
export function apply(board) {
  board.timeRemaining += BONUS.SECONDS;
  board.movesRemaining += BONUS.MOVES;
  board.gameState = 'PLAYING';
  board.failReason = null;
}
