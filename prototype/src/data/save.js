/**
 * DataManager — equivalent of Scripts/Utilities/DataManager.cs (tech doc §4)
 *
 * Local save. In the final game this store is the local cache that
 * CloudSaveManager synchronises with the backend; here it is authoritative.
 * Every access is guarded: private browsing, a full quota or blocked storage
 * must never break the game.
 */

const KEY = 'puzzlequest.save.v1';

/**
 * Which LEVEL SET this save's progress belongs to.
 *
 * Progress is a cursor and a table keyed by level NUMBER. When the levels
 * themselves are replaced, level 300 is a different grid, and a cursor at 300
 * would unlock three hundred levels nobody has played. So a save written against
 * an older level set loses its level progress — cursor, stars, records — and
 * keeps everything else: coins, purchases, streaks, settings.
 *
 * 2: the 2026-09 rebuild (parks generator). Bump it with the next replacement of
 * the level set, together with the server-side reset of `user_progress`.
 */
export const PROGRESS_EPOCH = 2;

const EMPTY = () => ({
  version: 2,
  unlockedLevel: 1,
  coins: 150,        // starting purse: the player can taste the hints
  xp: 0,
  levels: {},        // number -> { stars, bestScore }
  noAds: false,      // "remove ads" purchase (doc §5.3, PRODUCT_NO_ADS)
  music: true,
  sfx: true,
  vibration: true,
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
  levelStreak: 0,    // consecutive levels won in a row, reset on any loss
  lives: 5,          // hearts, in halves — see meta/lives.js
  livesAt: null,     // when the heart being refilled started refilling (ms)
  night: false,      // night mode (else the realm's usual light palette)
  themes: [],        // unlocked themes, on top of the original one
  theme: null,       // chosen theme, or null for the realm's hue
  badges: [],        // badges earned
  hints: 0,          // free hints, spent before coins
  hammers: 0,        // free hammers, spent before an ad
  boostersIntro: false, // the booster bar's one-time explanation was shown
  dailyRewardOn: null,  // 'YYYY-MM-DD' of the last daily puzzle bonus paid
  lastPlayDay: null, // 'YYYY-MM-DD'
  dailyClaimedOn: null,
  createdAt: new Date().toISOString(),
  lastPlayedAt: null,
  progressEpoch: PROGRESS_EPOCH,
});

let cached = null;

export function load() {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) : null;
    cached = stored ? { ...EMPTY(), ...stored } : EMPTY();
    // Read off what was STORED: merged over EMPTY(), an old save would always
    // look current.
    if (stored && stored.progressEpoch !== PROGRESS_EPOCH) {
      Object.assign(cached, { unlockedLevel: 1, levels: {}, levelStreak: 0, progressEpoch: PROGRESS_EPOCH });
      save(cached);
    }
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
