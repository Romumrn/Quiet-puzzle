/**
 * DataManager — équivalent de Scripts/Utilities/DataManager.cs (doc §4)
 *
 * Sauvegarde locale. Dans le jeu final, ce store est le cache local que
 * CloudSaveManager synchronise avec le backend ; ici il fait autorité.
 * Tous les accès sont protégés : navigation privée, quota plein ou stockage
 * bloqué ne doivent jamais casser le jeu.
 */

const KEY = 'puzzlequest.save.v1';

const EMPTY = () => ({
  version: 2,
  unlockedLevel: 1,
  coins: 150,        // pécule de départ : le joueur peut goûter aux indices
  xp: 0,
  levels: {},        // numéro -> { stars, bestScore }
  noAds: false,      // achat "supprimer les pubs" (doc §5.3, PRODUCT_NO_ADS)
  musique: true,
  effets: true,
  streak: 0,         // jours consécutifs joués
  lastPlayDay: null, // 'YYYY-MM-DD'
  dailyClaimedOn: null,
  createdAt: new Date().toISOString(),
  lastPlayedAt: null,
});

let cached = null;

export function load() {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? { ...EMPTY(), ...JSON.parse(raw) } : EMPTY();
  } catch {
    cached = EMPTY();
  }
  return cached;
}

export function save(data) {
  cached = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* stockage indisponible : la partie en cours reste jouable */
  }
  return cached;
}

export function reset() {
  cached = EMPTY();
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  return cached;
}

export function levelRecord(n) {
  return load().levels[n] || { stars: 0, bestScore: 0 };
}

export function totalStars() {
  return Object.values(load().levels).reduce((s, l) => s + l.stars, 0);
}

export function isUnlocked(n) {
  return n <= load().unlockedLevel;
}
