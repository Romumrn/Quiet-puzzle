/**
 * Série quotidienne et cadeau du jour.
 *
 * Le levier de rétention le plus efficace du casual, et le plus honnête : il
 * récompense le fait de revenir, sans rien retirer à qui ne revient pas. Aucune
 * pénalité, aucun compte à rebours anxiogène — juste une récompense croissante
 * qui repart à zéro après un jour manqué.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';
import * as currency from '../monetization/currency.js';

/** Paliers de récompense selon l'ancienneté de la série. */
// Paliers de la série quotidienne, alignés sur les gains de fin de niveau
// (divisés par quatre en même temps qu'eux). Un cadeau plus généreux que
// plusieurs niveaux réunis aurait fait de la connexion, et non du jeu, la
// meilleure façon de gagner des pièces.
const PALIERS = [12, 18, 25, 38, 50, 75, 125];

const jour = (decalage = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + decalage);
  return d.toISOString().slice(0, 10);
};

/** À appeler au démarrage. Met la série à jour et signale un nouveau jour. */
export function ouvrirSession() {
  const d = store.load();
  const aujourdhui = jour();
  if (d.lastPlayDay === aujourdhui) {
    track('session_started', { streak: d.streak, nouveauJour: false });
    return { streak: d.streak, nouveauJour: false };
  }
  d.streak = d.lastPlayDay === jour(-1) ? d.streak + 1 : 1;
  d.lastPlayDay = aujourdhui;
  store.save(d);
  track('session_started', { streak: d.streak, nouveauJour: true });
  return { streak: d.streak, nouveauJour: true };
}

export function serie() { return store.load().streak; }

export function recompenseDuJour() {
  return PALIERS[Math.min(Math.max(1, serie()) - 1, PALIERS.length - 1)];
}

export function peutReclamer() {
  return store.load().dailyClaimedOn !== jour();
}

/** @returns {number|0} montant crédité, 0 si déjà réclamé aujourd'hui. */
export function reclamer() {
  if (!peutReclamer()) return 0;
  const d = store.load();
  d.dailyClaimedOn = jour();
  store.save(d);
  const montant = recompenseDuJour();
  currency.crediter(montant, 'daily_reward');
  track('daily_reward_claimed', { streak: d.streak, montant });
  return montant;
}

/** Récompense qu'aurait le joueur demain — sert à donner envie de revenir. */
export function recompenseDeDemain() {
  return PALIERS[Math.min(serie(), PALIERS.length - 1)];
}
