/**
 * CurrencyManager — equivalent of Scripts/Monetization/CurrencyManager.cs
 * (tech doc §4)
 *
 * The player's purse. Every expense goes through here, so that a single place
 * decides what is payable and logs the transaction.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

/**
 * Prices, in coins. One scale, shown everywhere it applies: the player must be
 * able to tell what a booster costs before opening it.
 *
 * Continuing costs less than it used to (120), and for a reason: at the moment
 * of defeat, the ad is the main offer. The price in coins is there for whoever
 * has some put by and does not want an ad, not to deter.
 */
export const PRICES = Object.freeze({
  HINT: 50,
  CONTINUE: 75,
});

export function balance() { return store.load().coins; }

export function credit(amount, source) {
  const d = store.load();
  d.coins += amount;
  store.save(d);
  track('currency_earned', { amount, source, balance: d.coins });
  return d.coins;
}

/** @returns {boolean} true if the expense was honoured. */
export function debit(amount, reason) {
  const d = store.load();
  if (d.coins < amount) {
    track('currency_insufficient', { amount, reason, balance: d.coins });
    return false;
  }
  d.coins -= amount;
  store.save(d);
  track('currency_spent', { amount, reason, balance: d.coins });
  return true;
}

export function canAfford(amount) { return store.load().coins >= amount; }

/**
 * Coin packs (doc §5.3). The identifiers follow the stores' naming: this is
 * what will be declared on Google Play and the App Store, and the day the
 * purchase SDK arrives, only the body of `buyPack` will change.
 *
 * The bonus grows with the tier — it is the genre's custom, and it is honest: a
 * player who spends more at once pays less per coin. The amounts are calibrated
 * on the game's economy, where a hint costs 50 coins: the smallest pack buys
 * ten, the largest enough to stop thinking about it.
 */
export const PACKS = Object.freeze([
  { id: 'com.puzzle.coins.small', coins: 500, bonus: 0, price: '€1.99' },
  { id: 'com.puzzle.coins.medium', coins: 1200, bonus: 20, price: '€3.99' },
  { id: 'com.puzzle.coins.large', coins: 3000, bonus: 50, price: '€8.99' },
  { id: 'com.puzzle.coins.huge', coins: 8000, bonus: 100, price: '€19.99' },
]);

/**
 * Coins paid by a rewarded ad watched from the shop, and how many views are
 * granted per day.
 *
 * The daily cap is not there to restrain the player but to protect the economy:
 * without it, an infinite supply of free coins makes every booster painless,
 * and a painless booster is no longer a choice. Five views are worth two and a
 * half hints, enough to get by without making the rest pointless.
 */
export const AD_REWARD = Object.freeze({ COINS: 25, PER_DAY: 5 });

const today = () => new Date().toISOString().slice(0, 10);

/** Views already used today. */
export function adsWatchedToday() {
  const d = store.load();
  return d.coinAdsDay === today() ? (d.coinAdsCount || 0) : 0;
}

export const adsRemaining = () => Math.max(0, AD_REWARD.PER_DAY - adsWatchedToday());

/** Pays out the reward for an ad watched from the shop. */
export function creditAdReward() {
  if (adsRemaining() <= 0) return 0;
  const d = store.load();
  d.coinAdsDay = today();
  d.coinAdsCount = adsWatchedToday() + 1;
  store.save(d);
  credit(AD_REWARD.COINS, 'shop_rewarded_ad');
  return AD_REWARD.COINS;
}

/**
 * Buying a pack. SIMULATED: no billing SDK is wired up, and the shop screen
 * says so. The purchase event is logged all the same, in its final form, so
 * that the funnel is measurable before it is real.
 */
export function buyPack(id) {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) return 0;
  const total = Math.round(pack.coins * (1 + pack.bonus / 100));
  credit(total, 'iap_coin_pack');
  track('iap_purchased', { productId: pack.id, coins: total, price: pack.price, simulated: true });
  return total;
}

/** "Remove ads" purchase (doc §5.3, PRODUCT_NO_ADS). */
export function hasRemovedAds() { return store.load().noAds === true; }

export function setAdsRemoved(value) {
  const d = store.load();
  d.noAds = value;
  store.save(d);
  track('iap_purchased', { productId: 'com.puzzle.no.ads', active: value });
}
