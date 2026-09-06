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
  const continue_ = d.lastPlayDay === jour(-1);
  d.streak = continue_ ? d.streak + 1 : 1;
  // Une série repartie de zéro n'a plus rien versé : sans cette remise, un
  // joueur qui revient après un mois toucherait tous les paliers d'un coup.
  if (!continue_) d.paliersSerie = [];
  track(continue_ ? 'streak_continued' : 'streak_started', { streak: d.streak });
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

/**
 * Paliers de série : le badge affiché, et ce qu'on touche en l'atteignant.
 *
 * Les récompenses sont de NATURES différentes — éclats, thème, indices, badge —
 * et c'est voulu : une série qui ne verse que de la monnaie se compare à la
 * monnaie qu'on gagne en jouant, et perd toujours. Un thème ne se gagne nulle
 * part ailleurs.
 */
export const PALIERS_SERIE = Object.freeze([
  { jours: 1, badge: '🔥' },
  { jours: 2, badge: '🔥' },
  { jours: 3, badge: '🔥', recompense: { type: 'eclats', montant: 50 } },
  { jours: 7, badge: '🔥', recompense: { type: 'theme', id: 'sakura' } },
  { jours: 14, badge: '🔥', recompense: { type: 'indices', montant: 3 } },
  { jours: 30, badge: '🏅', recompense: { type: 'badge', id: 'fidele' } },
]);

/** Le palier atteint par une série de `n` jours. */
export function palierDe(n = serie()) {
  let atteint = PALIERS_SERIE[0];
  for (const p of PALIERS_SERIE) if (n >= p.jours) atteint = p;
  return atteint;
}

/** Le prochain palier à viser, ou null quand tout est atteint. */
export function palierSuivant(n = serie()) {
  return PALIERS_SERIE.find((p) => p.jours > n) || null;
}

/**
 * Récompenses de série encore dues.
 *
 * On note ce qui a été versé plutôt que de se fier au seul compteur du jour :
 * une série interrompue puis reprise ne doit pas reverser ce qui l'a déjà été,
 * et un joueur qui manque le jour exact d'un palier ne doit pas le perdre.
 */
export function recompensesDues() {
  const d = store.load();
  const versees = d.paliersSerie || [];
  return PALIERS_SERIE.filter((p) => p.recompense && d.streak >= p.jours && !versees.includes(p.jours));
}

/** Marque un palier comme versé. */
export function noterPalierVerse(jours) {
  const d = store.load();
  d.paliersSerie = [...new Set([...(d.paliersSerie || []), jours])];
  store.save(d);
  track('streak_reward_granted', { jours, streak: d.streak });
}

/** Récompense qu'aurait le joueur demain — sert à donner envie de revenir. */
export function recompenseDeDemain() {
  return PALIERS[Math.min(serie(), PALIERS.length - 1)];
}
