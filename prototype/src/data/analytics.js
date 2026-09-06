/**
 * Nomenclature des évènements.
 *
 * Un seul endroit décide des NOMS et des PARAMÈTRES. Éparpillés dans le code,
 * ils dérivent : deux graphies pour le même geste, un paramètre présent ici et
 * absent là, et l'entonnoir devient illisible au moment précis où l'on en a
 * besoin. Les noms suivent la convention des plateformes d'analyse (minuscules,
 * verbe au passé, `objet_action`).
 *
 * Les paramètres de gameplay sont fixés une fois pour toutes par `contexteNiveau` :
 * c'est ce qui permet de comparer un abandon et une réussite sans se demander
 * si l'un des deux compte les coups autrement.
 */

import { track } from './events.js';

export const EVENEMENTS = Object.freeze({
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

  // Monétisation
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

  // Rétention
  DAILY_OPEN: 'daily_open',
  DAILY_COMPLETED: 'daily_completed',
  STREAK_STARTED: 'streak_started',
  STREAK_CONTINUED: 'streak_continued',
});

/**
 * Paramètres communs à tout évènement de niveau.
 *
 * `attempt` compte les essais de CE niveau depuis la dernière réussite : c'est
 * lui qui dit si un niveau bloque, là où le seul taux d'échec confond « raté
 * une fois » et « raté dix fois ».
 */
export function contexteNiveau(level, { essai = 1, board = null, duree = null } = {}) {
  return {
    level_id: level?.levelId ?? null,
    level: level?.number ?? 0,
    world: level?.realm ?? null,
    attempt: essai,
    duration: duree,
    moves: board ? board.dragsUsed() : null,
    stars: board ? board.stars() : null,
  };
}

export const emettre = (nom, params = {}) => track(nom, params);
