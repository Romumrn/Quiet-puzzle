/**
 * Limits — how tight a level is once its grid exists: star thresholds, move
 * limit, time limit.
 *
 * What a level asks for (board, mechanics, parks) is the realm's profile, in
 * `realms.js`; how it is built is `rush/build.js`. This file only turns the
 * finished grid into the numbers a player feels.
 */

import { KIND } from '../prototype/src/core/block.js';
import { starThresholds } from '../prototype/src/core/stars.js';

/**
 * @param g  the built grid: `minDrags`, `parks`, `blocks`
 */
export function limitsFor(n, g) {
  const starDrags = starThresholds(g.minDrags);

  /**
   * The move limit is a SAFETY NET, not a grading scale. It sits well above the
   * 2★ threshold: a level built around parks is solved by trying things, and a
   * park tried and undone costs gestures the reference solution never spends.
   */
  const moveLimit = starDrags[1] + Math.max(3, Math.round(g.minDrags * 0.3));

  /**
   * Time pays for THINKING. The old formula sized it on the number of blocks,
   * capped at two minutes — right for a board you tidy, far too short for one
   * where every park has to be found. So each park buys time of its own, on top
   * of a few seconds per gesture, and each trap a little more — a dead end
   * spotted is a dead end thought about. Up to ten minutes: a hardcore level
   * needs fifteen parks and more.
   */
  const playable = g.blocks.filter((b) => b.kind !== KIND.WALL).length;
  // Never under a minute (the game clamps at 60 s as well — MIN_TIME_S).
  const timeLimit = Math.max(60, Math.min(600, Math.round((30 + 4 * g.minDrags + 15 * (g.parks || 0) + 20 * (g.traps || 0)) / 5) * 5));

  return { starDrags, moveLimit, timeLimit, playable };
}
