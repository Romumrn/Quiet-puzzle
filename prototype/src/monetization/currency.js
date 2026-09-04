/**
 * CurrencyManager — équivalent de Scripts/Monetization/CurrencyManager.cs (doc §4)
 * Porte-monnaie du joueur. Toute dépense passe par ici, pour qu'un seul endroit
 * décide de ce qui est payable et journalise la transaction.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

/** Tarifs. Constantes de tuning, à ajuster après playtest. */
export const PRIX = Object.freeze({
  INDICE: 50,
  CONTINUER: 120,
});

export function solde() { return store.load().coins; }

export function crediter(montant, source) {
  const d = store.load();
  d.coins += montant;
  store.save(d);
  track('currency_earned', { montant, source, solde: d.coins });
  return d.coins;
}

/** @returns {boolean} vrai si la dépense a été honorée. */
export function debiter(montant, motif) {
  const d = store.load();
  if (d.coins < montant) {
    track('currency_insufficient', { montant, motif, solde: d.coins });
    return false;
  }
  d.coins -= montant;
  store.save(d);
  track('currency_spent', { montant, motif, solde: d.coins });
  return true;
}

export function peutPayer(montant) { return store.load().coins >= montant; }

/** Achat "supprimer les pubs" (doc §5.3, PRODUCT_NO_ADS). */
export function aSupprimeLesPubs() { return store.load().noAds === true; }

export function definirSuppressionPubs(valeur) {
  const d = store.load();
  d.noAds = valeur;
  store.save(d);
  track('iap_purchased', { productId: 'com.puzzle.no.ads', actif: valeur });
}
