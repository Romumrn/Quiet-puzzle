/**
 * FailOfferController — équivalent de Scripts/Monetization/FailOfferController.cs
 * (doc §4, désigné comme "critical monetization")
 *
 * Au moment de la défaite, on propose de repartir avec du temps et des coups
 * plutôt que de tout perdre : soit contre une pub récompensée, soit contre des
 * pièces.
 *
 * Deux garde-fous délibérés :
 *  - l'offre n'est proposée QU'UNE FOIS par tentative. Enchaîner les
 *    continuations transforme un niveau raté en pompe à pubs et détruit la
 *    valeur de la difficulté.
 *  - « Abandonner » est un bouton normal, pas un lien minuscule : refuser doit
 *    être aussi facile qu'accepter.
 */

import * as currency from './currency.js';
import { PLACEMENT } from './adManager.js';
import { track } from '../data/events.js';
import { t } from '../ui/i18n.js';

/** Ce que rend une continuation acceptée. */
export const BONUS = Object.freeze({ SECONDES: 30, COUPS: 3 });

const el = (id) => document.getElementById(id);

/**
 * @returns {Promise<'ad'|'coins'|null>} le moyen choisi, ou null si refus.
 */
export function proposer({ board, ads }) {
  const panneau = el('overlay-offer');
  const raison = t(board.failReason === 'temps' ? 'offer.timeout' : 'offer.nomoves');
  el('offer-reason').textContent = raison;
  el('offer-remaining').textContent = board.remaining();
  el('offer-coins-cost').textContent = currency.PRIX.CONTINUER;
  el('offer-bonus').textContent = t('offer.bonus', { s: BONUS.SECONDES, c: BONUS.COUPS });

  const boutonPieces = el('btn-offer-coins');
  boutonPieces.disabled = !currency.peutPayer(currency.PRIX.CONTINUER);

  track('fail_offer_shown', { level: board.level.number, raison: board.failReason, restants: board.remaining() });
  panneau.hidden = false;

  return new Promise((resolve) => {
    const fermer = (choix) => {
      panneau.hidden = true;
      el('btn-offer-ad').onclick = null;
      el('btn-offer-coins').onclick = null;
      el('btn-offer-give-up').onclick = null;
      resolve(choix);
    };

    el('btn-offer-ad').onclick = async () => {
      panneau.hidden = true;
      const recompense = await ads.montrerRecompensee(PLACEMENT.RECOMPENSE_CONTINUER);
      if (recompense) {
        track('fail_offer_accepted', { level: board.level.number, moyen: 'ad' });
        fermer('ad');
      } else {
        panneau.hidden = false; // pub abandonnée : on repropose le choix
      }
    };

    el('btn-offer-coins').onclick = () => {
      if (!currency.debiter(currency.PRIX.CONTINUER, 'continue')) return;
      track('fail_offer_accepted', { level: board.level.number, moyen: 'coins' });
      fermer('coins');
    };

    el('btn-offer-give-up').onclick = () => {
      track('fail_offer_declined', { level: board.level.number });
      fermer(null);
    };
  });
}

/** Applique la continuation au plateau. */
export function appliquer(board) {
  board.timeRemaining += BONUS.SECONDES;
  board.movesRemaining += BONUS.COUPS;
  board.gameState = 'PLAYING';
  board.failReason = null;
}
