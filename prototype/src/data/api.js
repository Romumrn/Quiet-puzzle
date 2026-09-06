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
import * as dailyPuzzle from '../meta/dailyPuzzle.js';

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
 * Ce que rapporte un niveau réussi, selon les étoiles décrochées.
 *
 * Le barème est plat et lisible : le joueur sait ce qu'il gagne avant de jouer,
 * et vise trois étoiles pour cinq fois plus qu'une seule.
 *
 * Rejouer un niveau sans faire mieux ne rapporte qu'une pièce. Ce n'est pas une
 * punition : sans ce garde-fou, le premier niveau du jeu — quelques secondes,
 * trois étoiles les yeux fermés — devient la façon la plus rapide de s'enrichir,
 * et tout le reste de l'économie perd son sens.
 */
export const PIECES_PAR_ETOILE = Object.freeze({ 1: 2, 2: 5, 3: 10 });
const PIECES_REJEU = 1;

export function piecesPour(stars, progres = true) {
  if (!stars) return 0;
  return progres ? (PIECES_PAR_ETOILE[stars] ?? 0) : PIECES_REJEU;
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

// ---------------------------------------------------------------------------
// Puzzle du jour — grilles proposées par les joueurs
// ---------------------------------------------------------------------------

/**
 * POST /api/daily-puzzle
 *
 * Dépose une grille dans la file des propositions. Le niveau doit avoir été
 * VÉRIFIÉ par l'appelant : c'est l'éditeur qui passe le solveur, et lui seul
 * sait si la grille tient debout.
 */
export async function submitDailyPuzzle(niveau, titre) {
  return dailyPuzzle.proposer(niveau, titre);
}

/** GET /api/daily-puzzle — la grille du jour, ou null si la file est vide. */
export async function getDailyPuzzle() {
  return dailyPuzzle.duJour();
}

/**
 * POST /api/daily-puzzle/score
 *
 * Le score est recalculé ICI, à partir des chiffres de la partie, et non repris
 * de ce que l'appelant annonce. Le jour où ce corps deviendra un `fetch`, c'est
 * le serveur qui le calculera pour la même raison : un score que le client
 * fournit est un score qu'il choisit.
 */
export async function submitDailyScore({ drags, minDrags, secondes }) {
  const score = dailyPuzzle.calculerScore({ drags, minDrags, secondes });
  const { ameliore } = dailyPuzzle.enregistrerScore({ score, drags, secondes });
  return { score, ameliore, classement: dailyPuzzle.classement() };
}

/** GET /api/daily-puzzle/leaderboard */
export async function getDailyLeaderboard() {
  return dailyPuzzle.classement();
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

  const coinsEarned = piecesPour(stars, isNewStars);
  const xpEarned = stars * 10;
  d.coins += coinsEarned;
  d.xp += xpEarned;

  const nextLevelUnlocked = n === d.unlockedLevel && n < levels.totalLevels();
  if (nextLevelUnlocked) d.unlockedLevel = n + 1;

  store.save(d);
  return { stars, coinsEarned, xpEarned, nextLevelUnlocked, rewardItems: [] };
}
