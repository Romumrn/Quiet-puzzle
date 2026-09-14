/**
 * Daily streak and daily gift.
 *
 * The most effective retention lever in casual games, and the most honest: it
 * rewards coming back without taking anything away from those who do not. No
 * penalty, no anxiety-inducing countdown — just a growing reward that resets
 * after a missed day.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';
import * as currency from '../monetization/currency.js';

/** Reward tiers according to how old the streak is. */
// Daily streak tiers, aligned with end-of-level payouts (divided by four at the
// same time as them). A gift more generous than several levels put together
// would have made logging in, rather than playing, the best way to earn coins.
const TIERS = [12, 18, 25, 38, 50, 75, 125];

const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** Call at startup. Updates the streak and signals a new day. */
export function openSession() {
  const d = store.load();
  const today = day();
  if (d.lastPlayDay === today) {
    track('session_started', { streak: d.streak, newDay: false });
    return { streak: d.streak, newDay: false };
  }
  const continues = d.lastPlayDay === day(-1);
  d.streak = continues ? d.streak + 1 : 1;
  // A streak restarted from scratch has paid out nothing: without this reset, a
  // player coming back after a month would collect every tier at once.
  if (!continues) d.streakTiers = [];
  track(continues ? 'streak_continued' : 'streak_started', { streak: d.streak });
  d.lastPlayDay = today;
  store.save(d);
  track('session_started', { streak: d.streak, newDay: true });
  return { streak: d.streak, newDay: true };
}

export function streak() { return store.load().streak; }

export function todaysReward() {
  return TIERS[Math.min(Math.max(1, streak()) - 1, TIERS.length - 1)];
}

export function canClaim() {
  return store.load().dailyClaimedOn !== day();
}

/** @returns {number|0} amount credited, 0 if already claimed today. */
export function claim() {
  if (!canClaim()) return 0;
  const d = store.load();
  d.dailyClaimedOn = day();
  store.save(d);
  const amount = todaysReward();
  currency.credit(amount, 'daily_reward');
  track('daily_reward_claimed', { streak: d.streak, amount });
  return amount;
}

/**
 * Streak tiers: the badge shown, and what reaching one pays out.
 *
 * The rewards are of DIFFERENT natures — coins, a theme, hints, a badge — and
 * that is deliberate: a streak that only pays currency gets compared to the
 * currency earned by playing, and always loses. A theme cannot be earned
 * anywhere else.
 */
export const STREAK_TIERS = Object.freeze([
  { days: 1, badge: '🔥' },
  { days: 2, badge: '🔥' },
  { days: 3, badge: '🔥', reward: { type: 'coins', amount: 50 } },
  { days: 7, badge: '🔥', reward: { type: 'theme', id: 'sakura' } },
  { days: 14, badge: '🔥', reward: { type: 'hints', amount: 3 } },
  { days: 30, badge: '🏅', reward: { type: 'badge', id: 'loyal' } },
]);

/** The tier reached by a streak of `n` days. */
export function tierFor(n = streak()) {
  let reached = STREAK_TIERS[0];
  for (const p of STREAK_TIERS) if (n >= p.days) reached = p;
  return reached;
}

/** The next tier to aim for, or null when they are all reached. */
export function nextTier(n = streak()) {
  return STREAK_TIERS.find((p) => p.days > n) || null;
}

/**
 * Streak rewards still owed.
 *
 * We record what has been paid rather than trusting the day counter alone: a
 * streak broken and picked up again must not pay out twice, and a player who
 * misses the exact day of a tier must not lose it.
 */
export function rewardsDue() {
  const d = store.load();
  const paid = d.streakTiers || [];
  return STREAK_TIERS.filter((p) => p.reward && d.streak >= p.days && !paid.includes(p.days));
}

/** Marks a tier as paid. */
export function markTierPaid(days) {
  const d = store.load();
  d.streakTiers = [...new Set([...(d.streakTiers || []), days])];
  store.save(d);
  track('streak_reward_granted', { days, streak: d.streak });
}

/** The reward the player would get tomorrow — makes coming back worthwhile. */
export function tomorrowsReward() {
  return TIERS[Math.min(streak(), TIERS.length - 1)];
}
