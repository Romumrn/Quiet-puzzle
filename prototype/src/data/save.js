/**
 * DataManager — equivalent of Scripts/Utilities/DataManager.cs (tech doc §4)
 *
 * Local save. In the final game this store is the local cache that
 * CloudSaveManager synchronises with the backend; here it is authoritative.
 * Every access is guarded: private browsing, a full quota or blocked storage
 * must never break the game.
 */

const KEY = 'puzzlequest.save.v1';

const EMPTY = () => ({
  version: 2,
  unlockedLevel: 1,
  coins: 150,        // starting purse: the player can taste the hints
  xp: 0,
  levels: {},        // number -> { stars, bestScore }
  noAds: false,      // "remove ads" purchase (doc §5.3, PRODUCT_NO_ADS)
  music: true,
  sfx: true,
  /**
   * Interface language, or null while the player has not chosen — in which case
   * we follow the browser's. Storing a default choice would have frozen the
   * language of the first load.
   */
  language: null,
  /**
   * Family glyphs on blocks and gates. The six families are told apart by their
   * colour; this option gives them their symbol back (●◆▲★■⬢), for anyone who
   * cannot rely on hue.
   */
  glyphs: false,
  /** Author token for the daily puzzle (see meta/dailyPuzzle.js). */
  authorId: null,
  /** Rewarded "coin" ad views: the current day and how many. */
  coinAdsDay: null,
  coinAdsCount: 0,
  streak: 0,         // consecutive days played
  streakTiers: [],   // streak tiers already rewarded
  themes: [],        // unlocked themes, on top of the original one
  theme: null,       // chosen theme, or null for the realm's hue
  badges: [],        // badges earned
  hints: 0,          // free hints, spent before coins
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
    /* storage unavailable: the game in progress stays playable */
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
