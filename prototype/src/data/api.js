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
import { getLevel as buildLevel, TOTAL_LEVELS } from '../core/levels.js';

/** GET /api/user/profile */
export async function getProfile() {
  const d = store.load();
  return {
    coins: d.coins,
    xpTotal: d.xp,
    currentLevel: d.unlockedLevel,
    highestLevel: d.unlockedLevel,
    totalStars: store.totalStars(),
    maxStars: TOTAL_LEVELS * 3,
  };
}

/** GET /api/level/{levelNumber} */
export async function getLevel(n) {
  if (n < 1 || n > TOTAL_LEVELS) throw new Error(`Niveau ${n} introuvable`);
  return buildLevel(n);
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
  const coinsEarned = isNewStars ? (stars - prev.stars) * 25 + 20 : 10;
  const xpEarned = stars * 10;
  d.coins += coinsEarned;
  d.xp += xpEarned;

  const nextLevelUnlocked = n === d.unlockedLevel && n < TOTAL_LEVELS;
  if (nextLevelUnlocked) d.unlockedLevel = n + 1;

  store.save(d);
  return { stars, coinsEarned, xpEarned, nextLevelUnlocked, rewardItems: [] };
}
