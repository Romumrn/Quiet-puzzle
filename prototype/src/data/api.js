/**
 * APIClient — équivalent de Scripts/Backend/APIClient.cs (doc §4)
 *
 * Façade sur les endpoints du doc §6.1, implémentée en local (localStorage).
 * Les méthodes portent le nom et la forme de réponse des vraies routes REST et
 * renvoient toutes des Promises : brancher le backend Node reviendra à
 * remplacer le CORPS de ces fonctions par un `fetch`, sans toucher à un seul
 * appelant.
 */

import * as store from './save.js';
import * as levels from './levelStore.js';

/**
 * Niveau global du joueur, dérivé de l'XP. Palier fixe de 100 XP : simple à
 * lire pour le joueur, et l'XP est déjà versée par completeLevel (doc §6.1).
 */
export const XP_PAR_NIVEAU = 100;

export function niveauJoueur(xp) {
  const niveau = 1 + Math.floor(xp / XP_PAR_NIVEAU);
  const dans = xp % XP_PAR_NIVEAU;
  return { niveau, dans, requis: XP_PAR_NIVEAU };
}

/** GET /api/user/profile */
export async function getProfile() {
  const d = store.load();
  const progression = niveauJoueur(d.xp);
  return {
    coins: d.coins,
    xpTotal: d.xp,
    playerLevel: progression.niveau,
    xpDansNiveau: progression.dans,
    xpRequis: progression.requis,
    levelsCompleted: Object.values(d.levels).filter((l) => l.stars > 0).length,
    currentLevel: d.unlockedLevel,
    highestLevel: d.unlockedLevel,
    totalStars: store.totalStars(),
    maxStars: levels.totalLevels() * 3,
  };
}

/**
 * GET /api/level/{levelNumber}
 *
 * Lit la base de niveaux. Le jour où un vrai serveur sert les niveaux, seul le
 * corps de `levelStore` change : les appelants, eux, voient déjà une Promise.
 */
export async function getLevel(n) {
  return levels.getLevel(n);
}

/**
 * POST /api/level/{levelNumber}/complete
 * @returns {{stars, coinsEarned, xpEarned, nextLevelUnlocked, rewardItems}}
 */
export async function completeLevel(n, { score, stars, failed }) {
  const d = store.load();
  d.lastPlayedAt = new Date().toISOString();

  if (failed) {
    store.save(d);
    return { stars: 0, coinsEarned: 0, xpEarned: 0, nextLevelUnlocked: false, rewardItems: [] };
  }

  const prev = d.levels[n] || { stars: 0, bestScore: 0 };
  const isNewStars = stars > prev.stars;
  // `score` est ici un nombre de glissés : le meilleur record est le PLUS PETIT.
  d.levels[n] = {
    stars: Math.max(prev.stars, stars),
    bestScore: prev.bestScore ? Math.min(prev.bestScore, score) : score,
  };

  // Les pièces ne sont versées que sur les étoiles NOUVELLES : rejouer un
  // niveau déjà 3★ ne doit pas être une machine à monnaie.
  //
  // Les montants ont été divisés par quatre : à 25 pièces l'étoile, un joueur
  // ordinaire amassait de quoi payer un indice tous les deux niveaux, et les
  // bonus perdaient tout poids — on ne choisit pas ce qu'on peut s'offrir en
  // permanence. Les TARIFS n'ont pas bougé (currency.PRIX) : c'est le rapport
  // entre les deux qui fait l'économie.
  const coinsEarned = isNewStars ? (stars - prev.stars) * 6 + 5 : 3;
  const xpEarned = stars * 10;
  d.coins += coinsEarned;
  d.xp += xpEarned;

  const nextLevelUnlocked = n === d.unlockedLevel && n < levels.totalLevels();
  if (nextLevelUnlocked) d.unlockedLevel = n + 1;

  store.save(d);
  return { stars, coinsEarned, xpEarned, nextLevelUnlocked, rewardItems: [] };
}
