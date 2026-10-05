/**
 * The bloom — a flower that gains a petal with every NEW level won, and opens
 * on a gift at the fifth.
 *
 * Royal Match's level chest, Candy Crush's progress chests: a short, visible
 * count towards a reward whose CONTENT is a surprise. The count gives the
 * "one more level" pull (the result screen says how many petals are left); the
 * surprise keeps each opening worth watching. Here it is a flower rather than
 * a chest, in the petals' vocabulary the whole game already speaks.
 *
 * Only a level's first win counts: replaying level 1 must not be the way to
 * pick flowers. A defeat takes nothing away — the bloom never punishes, unlike
 * the win streak, which is the one thing a player can lose.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';
import * as currency from '../monetization/currency.js';

export const PETALS = 5;

/** What the flower may hold, by weight. Mostly shards, sometimes a booster, rarely a jackpot. */
const GIFTS = Object.freeze([
  { kind: 'coins', amount: 30, weight: 30 },
  { kind: 'coins', amount: 50, weight: 20 },
  { kind: 'hint', amount: 1, weight: 22 },
  { kind: 'hammer', amount: 1, weight: 18 },
  { kind: 'coins', amount: 150, weight: 10 },
]);

const STOCK = { hint: 'hints', hammer: 'hammers' };

/** Petals already there, 0 to PETALS - 1. */
export const petals = () => store.load().bloom || 0;

function draw() {
  let roll = Math.random() * GIFTS.reduce((sum, g) => sum + g.weight, 0);
  for (const gift of GIFTS) if ((roll -= gift.weight) < 0) return gift;
  return GIFTS[0];
}

/**
 * Adds a petal for a first win. Returns the petals before and after, and the
 * gift if the flower has just opened — already paid into the save.
 */
export function addPetal() {
  const before = petals();
  const after = before + 1;
  if (after < PETALS) {
    const d = store.load();
    d.bloom = after;
    store.save(d);
    return { before, after, gift: null };
  }
  const gift = draw();
  if (gift.kind === 'coins') currency.credit(gift.amount, 'bloom');
  const d = store.load(); // after `credit`, which saves on its own
  d.bloom = 0;
  if (STOCK[gift.kind]) d[STOCK[gift.kind]] = (d[STOCK[gift.kind]] || 0) + gift.amount;
  store.save(d);
  track('bloom_opened', { type: gift.kind, amount: gift.amount });
  return { before, after: PETALS, gift: { kind: gift.kind, amount: gift.amount } };
}
