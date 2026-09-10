/**
 * AdBroker — equivalent of Scripts/Monetization/AdManager.cs (tech doc §5.2)
 *
 * A façade over the ad network. The methods mirror those of the document's
 * AppLovin MAX integration (`showRewardedAd`, `showInterstitial`, `showBanner`,
 * `hideBanner`): wiring up the real SDK will amount to replacing the body of
 * `_play()` with the `MaxSdk` calls, without touching any caller.
 *
 * Here, ads are SIMULATED by a full-screen panel with a countdown, so that
 * placement and pacing can be judged before any contract with a network.
 *
 * Pacing lives in brokerPolicy.js (pure logic, tested).
 *
 * FILENAME WARNING — this file is deliberately not called `adManager.js`. A
 * generic ad blocker refused to load a file by that name, which broke the whole
 * application for every player running one: the static import failed, and
 * nothing behind it ran. See brokerPolicy.js for the full story.
 */

import { BrokerPolicy } from './brokerPolicy.js';
import { track } from '../data/events.js';
import { EVENTS as EV } from '../data/analytics.js';
import { t } from '../ui/i18n.js';
import * as currency from './currency.js';

/** Placements, as they will appear in the network's reports. */
export const PLACEMENT = Object.freeze({
  INTERSTITIAL_LEVEL_END: 'interstitial_level_end',
  REWARDED_CONTINUE: 'rewarded_continue',
  REWARDED_DOUBLE: 'rewarded_double_coins',
  REWARDED_HINT: 'rewarded_hint',
  REWARDED_HAMMER: 'rewarded_hammer',
  REWARDED_TIME: 'rewarded_extra_time',
  REWARDED_UNDO: 'rewarded_undo',
  REWARDED_COINS: 'rewarded_coin_shop',
  BANNER: 'banner_menu',
  BANNER_RESULT: 'banner_level_complete',
});

const INTERSTITIAL_SECONDS = 5;  // seconds before it can be closed
const REWARDED_SECONDS = 5;      // seconds to watch to earn the reward

export class AdBroker {
  constructor({ overlay, banner, policy } = {}) {
    this.overlay = overlay;
    this.banner = banner;
    this.policy = policy || new BrokerPolicy();
    this.busy = false;
    /** Simulates unavailable inventory (fill rate) — doc §10, "Low Fill Rates". */
    this.fillRate = 1;
  }

  // --- Interstitials -------------------------------------------------------

  /**
   * @returns {Promise<{shown:boolean, reason:string}>}
   * Only shows the ad if the policy allows it. The reason for a refusal is
   * logged: every ad NOT displayed must be explainable.
   */
  async showInterstitial(ctx) {
    const verdict = this.policy.canShowInterstitial(ctx);
    if (!verdict.ok) {
      track(EV.INTERSTITIAL_SKIPPED, { placement: PLACEMENT.INTERSTITIAL_LEVEL_END, reason: verdict.reason });
      return { shown: false, reason: verdict.reason };
    }
    if (Math.random() > this.fillRate) {
      track('ad_no_fill', { adType: 'interstitial' });
      return { shown: false, reason: 'inventory unavailable' };
    }

    this.policy.noteInterstitial();
    track(EV.INTERSTITIAL_SHOWN, { placement: PLACEMENT.INTERSTITIAL_LEVEL_END });
    await this._play({ type: 'interstitial', seconds: INTERSTITIAL_SECONDS, title: t('ad.title') });
    track('ad_watched', { adType: 'interstitial', placement: PLACEMENT.INTERSTITIAL_LEVEL_END, revenue: 0.012 });
    return { shown: true, reason: 'ok' };
  }

  // --- Rewarded ads --------------------------------------------------------

  /** Always offered, even after the "no ads" purchase: the player chooses them
   *  and gets something out of them. */
  isRewardedReady() { return Math.random() <= this.fillRate; }

  /** @returns {Promise<boolean>} true if the reward is due. */
  async showRewarded(placement) {
    if (this.busy) return false;
    if (!this.isRewardedReady()) {
      track('ad_no_fill', { adType: 'rewarded', placement });
      return false;
    }
    track(EV.REWARDED_STARTED, { placement });
    const completed = await this._play({ type: 'rewarded', seconds: REWARDED_SECONDS, title: t('ad.title.rewarded') });
    this.policy.noteRewarded();
    if (completed) track(EV.REWARDED_COMPLETED, { placement, revenue: 0.015 });
    else track('ad_abandoned', { adType: 'rewarded', placement });
    return completed;
  }

  // --- Banner --------------------------------------------------------------

  updateBanner(screen) {
    if (!this.banner) return;
    const visible = this.policy.canShowBanner(screen, currency.hasRemovedAds());
    this.banner.hidden = !visible;
    if (visible) track('ad_impression', { adType: 'banner', placement: PLACEMENT.BANNER, screen });
  }

  // --- Simulation ----------------------------------------------------------

  /**
   * Stands in entirely for the SDK calls. Shows a full-screen panel with a
   * countdown; for a rewarded ad, closing early cancels the reward.
   * @returns {Promise<boolean>} true if the ad ran to completion
   */
  _play({ type, seconds, title }) {
    if (!this.overlay) return Promise.resolve(true);
    this.busy = true;

    const titleEl = this.overlay.querySelector('.ad-title');
    const counter = this.overlay.querySelector('.ad-count');
    const closeBtn = this.overlay.querySelector('.ad-close');
    const note = this.overlay.querySelector('.ad-note');

    titleEl.textContent = title;
    note.textContent = t(type === 'rewarded' ? 'ad.note.rewarded' : 'ad.note');
    closeBtn.hidden = true;
    this.overlay.hidden = false;

    return new Promise((resolve) => {
      let left = seconds;
      counter.textContent = left;
      const finish = (completed) => {
        clearInterval(timer);
        this.overlay.hidden = true;
        this.busy = false;
        closeBtn.onclick = null;
        resolve(completed);
      };
      const timer = setInterval(() => {
        left--;
        counter.textContent = Math.max(0, left);
        if (left <= 0) {
          closeBtn.hidden = false;
          closeBtn.textContent = t(type === 'rewarded' ? 'ad.claim' : 'ad.close');
          closeBtn.onclick = () => finish(true);
          clearInterval(timer);
        }
      }, 1000);

      // A rewarded ad can be abandoned: skip button after 2 s.
      if (type === 'rewarded') {
        setTimeout(() => {
          if (!this.overlay.hidden && closeBtn.hidden) {
            closeBtn.hidden = false;
            closeBtn.textContent = t('ad.skip');
            closeBtn.onclick = () => finish(false);
          }
        }, 2000);
      }
    });
  }
}
