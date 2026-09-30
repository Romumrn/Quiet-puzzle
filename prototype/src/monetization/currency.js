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
  LIFE: 50,      // one heart — see meta/lives.js
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
 * Coins paid by a rewarded ad watched from the shop, and how many views are
 * granted per day. This is the ONLY way to get shards outside play: there are
 * no in-app purchases (decision of 2026-09-30 — the coin packs are gone).
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

/** "Remove ads" purchase (doc §5.3, PRODUCT_NO_ADS). */
export function hasRemovedAds() { return store.load().noAds === true; }

export function setAdsRemoved(value) {
  const d = store.load();
  d.noAds = value;
  store.save(d);
  track('iap_purchased', { productId: 'com.puzzle.no.ads', active: value });
}
