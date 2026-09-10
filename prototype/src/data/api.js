/**
 * APIClient — equivalent of Scripts/Backend/APIClient.cs (tech doc §4)
 *
 * A façade over the endpoints of doc §6.1, implemented locally (localStorage).
 * The methods carry the name and response shape of the real REST routes and all
 * return Promises: wiring up the Node backend will amount to replacing the BODY
 * of these functions with a `fetch`, without touching a single caller.
 */

import * as store from './save.js';
import * as levels from './levelStore.js';
import * as dailyPuzzle from '../meta/dailyPuzzle.js';

/**
 * The player's global level, derived from XP. A flat 100 XP tier: easy for the
 * player to read, and XP is already granted by completeLevel (doc §6.1).
 */
export const XP_PER_LEVEL = 100;

export function playerLevelFor(xp) {
  const level = 1 + Math.floor(xp / XP_PER_LEVEL);
  const into = xp % XP_PER_LEVEL;
  return { level, into, required: XP_PER_LEVEL };
}

/** GET /api/user/profile */
export async function getProfile() {
  const d = store.load();
  const progress = playerLevelFor(d.xp);
  return {
    coins: d.coins,
    xpTotal: d.xp,
    playerLevel: progress.level,
    xpIntoLevel: progress.into,
    xpRequired: progress.required,
    levelsCompleted: Object.values(d.levels).filter((l) => l.stars > 0).length,
    currentLevel: d.unlockedLevel,
    highestLevel: d.unlockedLevel,
    totalStars: store.totalStars(),
    maxStars: levels.totalLevels() * 3,
  };
}

/**
 * What a completed level pays out, according to the stars earned.
 *
 * The scale is flat and legible: the player knows what they are getting before
 * playing, and aims for three stars to earn five times more than one.
 *
 * Replaying a level without doing better pays a single coin. This is not a
 * punishment: without that safeguard the first level of the game — a few
 * seconds, three stars with your eyes shut — becomes the fastest way to get
 * rich, and the rest of the economy loses its meaning.
 */
export const COINS_PER_STAR = Object.freeze({ 1: 2, 2: 5, 3: 10 });
const COINS_REPLAY = 1;

export function coinsFor(stars, progressed = true) {
  if (!stars) return 0;
  return progressed ? (COINS_PER_STAR[stars] ?? 0) : COINS_REPLAY;
}

/**
 * GET /api/level/{levelNumber}
 *
 * Reads the level database. The day a real server serves the levels, only the
 * body of `levelStore` changes: callers already see a Promise.
 */
export async function getLevel(n) {
  return levels.getLevel(n);
}

// ---------------------------------------------------------------------------
// Daily puzzle — grids submitted by players
// ---------------------------------------------------------------------------

/**
 * POST /api/daily-puzzle
 *
 * Drops a grid into the submission queue. The level must have been VERIFIED by
 * the caller: it is the editor that runs the solver, and it alone knows whether
 * the grid holds up.
 */
export async function submitDailyPuzzle(level, title) {
  return dailyPuzzle.submit(level, title);
}

/** GET /api/daily-puzzle — today's grid, or null if the queue is empty. */
export async function getDailyPuzzle() {
  return dailyPuzzle.ofTheDay();
}

/**
 * POST /api/daily-puzzle/score
 *
 * The score is recomputed HERE, from the game's own figures, rather than taken
 * from what the caller announces. The day this body becomes a `fetch`, the
 * server will compute it for the same reason: a score the client supplies is a
 * score the client chooses.
 */
export async function submitDailyScore({ drags, minDrags, seconds }) {
  const score = dailyPuzzle.computeScore({ drags, minDrags, seconds });
  const { improved } = dailyPuzzle.recordScore({ score, drags, seconds });
  return { score, improved, leaderboard: dailyPuzzle.leaderboard() };
}

/** GET /api/daily-puzzle/leaderboard */
export async function getDailyLeaderboard() {
  return dailyPuzzle.leaderboard();
}

// ---------------------------------------------------------------------------
// Supabase sync — fire-and-forget, never blocking
// ---------------------------------------------------------------------------

/**
 * Sends the result of a finished level to Supabase in the background.
 * Fails silently if the network is down, the level is not in the database yet,
 * or the user is not authenticated.
 */
async function _syncCompleteLevel(n, { score, failed, timeMs }) {
  // Dynamic import: fails silently under Node (tests), transparent in the
  // browser where the CDN is reachable.
  let sb;
  try {
    sb = await import('./supabaseClient.js');
  } catch {
    return;
  }

  const levelCode = `lvl_${String(n).padStart(3, '0')}`;
  const levelDbId = await sb.getLevelDbId(levelCode);
  if (!levelDbId) return;

  await sb.supabase.rpc('complete_level', {
    p_level_id:          levelDbId,
    p_moves:             score,
    p_time_ms:           timeMs ?? 0,
    p_completed:         !failed,
    p_client_attempt_id: crypto.randomUUID(),
  });
}

/**
 * POST /api/level/{levelNumber}/complete
 * @returns {{stars, coinsEarned, xpEarned, nextLevelUnlocked, rewardItems}}
 */
export async function completeLevel(n, { score, stars, failed, timeMs }) {
  const d = store.load();
  d.lastPlayedAt = new Date().toISOString();

  if (failed) {
    store.save(d);
    return { stars: 0, coinsEarned: 0, xpEarned: 0, nextLevelUnlocked: false, rewardItems: [] };
  }

  const prev = d.levels[n] || { stars: 0, bestScore: 0 };
  const isNewStars = stars > prev.stars;
  // `score` is a drag count here: the best record is the SMALLEST one.
  d.levels[n] = {
    stars: Math.max(prev.stars, stars),
    bestScore: prev.bestScore ? Math.min(prev.bestScore, score) : score,
  };

  const coinsEarned = coinsFor(stars, isNewStars);
  const xpEarned = stars * 10;
  d.coins += coinsEarned;
  d.xp += xpEarned;

  const nextLevelUnlocked = n === d.unlockedLevel && n < levels.totalLevels();
  if (nextLevelUnlocked) d.unlockedLevel = n + 1;

  store.save(d);
  _syncCompleteLevel(n, { score, failed, timeMs }).catch(() => {});
  return { stars, coinsEarned, xpEarned, nextLevelUnlocked, rewardItems: [] };
}
