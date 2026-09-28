/**
 * Win-streak bonus — the boosters a run of wins brings into the next level.
 *
 * Candy Crush and Royal Match both pay a streak in boosters for the NEXT level
 * rather than in coins: the reward lands exactly where it is felt, and it is
 * lost on the first defeat, which gives the player something to protect. Here
 * it also answers the sawtooth (generator/index.js): the boosters pile up on
 * the easy levels and are there when the labelled peak arrives.
 *
 * The streak itself is `levelStreak` in the save (see api.completeLevel): wins
 * in a row, broken by a defeat, a restart, or leaving a level. Tiers add up —
 * at six wins the player has all three.
 */

export const TIERS = Object.freeze([
  { at: 2, hint: 1 },
  { at: 4, undo: 3 },
  { at: 6, hammer: 1 },
]);

const KINDS = ['hint', 'undo', 'hammer'];

/** The free boosters a level starts with, for a streak of `streak` wins. */
export function bonusFor(streak) {
  const out = { hint: 0, undo: 0, hammer: 0 };
  for (const tier of TIERS) {
    if (streak < tier.at) continue;
    for (const k of KINDS) out[k] += tier[k] || 0;
  }
  return out;
}

/** The next tier to reach, or null once all are unlocked. */
export const nextTier = (streak) => TIERS.find((tier) => tier.at > streak) || null;

export const isEmpty = (bonus) => KINDS.every((k) => !bonus[k]);

/** "💡×1 ↶×3" — the boosters as the booster bar shows them. */
const ICONS = { hint: '💡', undo: '↶', hammer: '🔨' };
export function describe(bonus) {
  return KINDS.filter((k) => bonus[k]).map((k) => `${ICONS[k]}×${bonus[k]}`).join('  ');
}
