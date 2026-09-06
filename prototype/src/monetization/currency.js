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

/**
 * Packs de pièces (doc §5.3). Les identifiants suivent la nomenclature des
 * stores : c'est ce qui sera déclaré chez Google Play et l'App Store, et le
 * jour où le SDK d'achat arrivera, seul le corps d'`acheterPack` changera.
 *
 * Le bonus croît avec le palier — c'est l'usage du genre, et il est honnête :
 * un joueur qui met davantage d'un coup paie moins cher la pièce. Les montants
 * sont calés sur l'économie du jeu, où un indice coûte 50 pièces : le plus
 * petit pack en offre dix, le plus grand de quoi ne plus y penser.
 */
export const PACKS = Object.freeze([
  { id: 'com.puzzle.coins.small', pieces: 500, bonus: 0, prix: '1,99 €' },
  { id: 'com.puzzle.coins.medium', pieces: 1200, bonus: 20, prix: '3,99 €' },
  { id: 'com.puzzle.coins.large', pieces: 3000, bonus: 50, prix: '8,99 €' },
  { id: 'com.puzzle.coins.huge', pieces: 8000, bonus: 100, prix: '19,99 €' },
]);

/**
 * Pièces versées par une pub récompensée depuis la boutique, et nombre de
 * visionnages accordés par jour.
 *
 * La limite quotidienne n'est pas là pour brider le joueur mais pour protéger
 * l'économie : sans elle, une réserve infinie de pièces gratuites rend tous les
 * bonus indolores, et un bonus indolore ne se choisit plus. Cinq visionnages
 * valent deux indices et demi, de quoi se dépanner sans rendre le reste inutile.
 */
export const PUB_RECOMPENSE = Object.freeze({ PIECES: 25, PAR_JOUR: 5 });

const jour = () => new Date().toISOString().slice(0, 10);

/** Visionnages déjà consommés aujourd'hui. */
export function pubsVuesAujourdhui() {
  const d = store.load();
  return d.pubsPiecesJour === jour() ? (d.pubsPiecesCompte || 0) : 0;
}

export const pubsRestantes = () => Math.max(0, PUB_RECOMPENSE.PAR_JOUR - pubsVuesAujourdhui());

/** Verse la récompense d'une pub regardée depuis la boutique. */
export function crediterPub() {
  if (pubsRestantes() <= 0) return 0;
  const d = store.load();
  d.pubsPiecesJour = jour();
  d.pubsPiecesCompte = pubsVuesAujourdhui() + 1;
  store.save(d);
  crediter(PUB_RECOMPENSE.PIECES, 'shop_rewarded_ad');
  return PUB_RECOMPENSE.PIECES;
}

/**
 * Achat d'un pack. SIMULÉ : aucun SDK de facturation n'est branché, et l'écran
 * de la boutique le dit. On journalise malgré tout l'évènement d'achat sous sa
 * forme définitive, pour que le tunnel soit mesurable avant d'être réel.
 */
export function acheterPack(id) {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) return 0;
  const total = Math.round(pack.pieces * (1 + pack.bonus / 100));
  crediter(total, 'iap_coin_pack');
  track('iap_purchased', { productId: pack.id, pieces: total, prix: pack.prix, simule: true });
  return total;
}

/** Achat "supprimer les pubs" (doc §5.3, PRODUCT_NO_ADS). */
export function aSupprimeLesPubs() { return store.load().noAds === true; }

export function definirSuppressionPubs(valeur) {
  const d = store.load();
  d.noAds = valeur;
  store.save(d);
  track('iap_purchased', { productId: 'com.puzzle.no.ads', actif: valeur });
}
