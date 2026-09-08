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
import { PLACEMENT } from './regieManager.js';
import { track } from '../data/events.js';
import { EVENEMENTS as EV } from '../data/analytics.js';
import { t } from '../ui/i18n.js';

/** Ce que rend une continuation acceptée. */
export const BONUS = Object.freeze({ SECONDES: 30, COUPS: 3 });

const el = (id) => document.getElementById(id);

/**
 * @returns {Promise<'ad'|'coins'|'retry'|null>} le moyen choisi, ou null.
 */
export function proposer({ board, ads }) {
  const panneau = el('overlay-offer');
  const restants = board.remaining();
  el('offer-lead').textContent = t(restants > 1 ? 'offer.left.plural' : 'offer.left', { n: restants });
  el('offer-coins-cost').textContent = currency.PRIX.CONTINUER;
  el('offer-bonus').textContent = t('offer.bonus', { s: BONUS.SECONDES, c: BONUS.COUPS });

  // L'option payante s'efface quand le joueur n'a pas de quoi : un bouton grisé
  // ne fait que rappeler ce qui manque, au pire moment pour le lui dire.
  const boutonPieces = el('btn-offer-coins');
  boutonPieces.hidden = !currency.peutPayer(currency.PRIX.CONTINUER);

  track(EV.REWARDED_OFFER_SHOWN, {
    placement: PLACEMENT.RECOMPENSE_CONTINUER, level: board.level.number,
    raison: board.failReason, restants,
  });
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
        track(EV.REWARD_GRANTED, {
          placement: PLACEMENT.RECOMPENSE_CONTINUER, recompense: 'continue',
          secondes: BONUS.SECONDES, coups: BONUS.COUPS,
        });
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

    /**
     * « Recommencer » plutôt qu'« Abandonner » : après un refus, l'écran de
     * défaite n'apprend plus rien au joueur, qui veut surtout reprendre la
     * grille. On le renvoie donc directement en partie.
     */
    el('btn-offer-give-up').onclick = () => {
      track('fail_offer_declined', { level: board.level.number });
      fermer('retry');
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
