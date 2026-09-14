/**
 * Real AdMob rewarded/interstitial ads, for the packaged Android app.
 *
 * Only imported and called from brokerManager.js when `isNative()` — the
 * published web site never touches this module's methods (see the simulated
 * `_play()` there, kept for browser development and testing).
 */

import {
  AdMob, RewardAdPluginEvents, AdmobConsentStatus,
} from '../../vendor/capacitor-admob.esm.js';
import { AD_UNITS } from './admobConfig.js';

let ready = null;

/**
 * Runs Google's UMP consent flow (shown only where required — EEA, UK,
 * Switzerland — detected automatically) then initializes the SDK. Safe to
 * call more than once; later calls reuse the first run.
 */
export function ensureInitialized() {
  if (!ready) {
    ready = (async () => {
      const consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm();
      }
      await AdMob.initialize();
    })();
  }
  return ready;
}

/** Reopens Google's consent management screen — wired to a settings entry. */
export async function manageConsent() {
  await ensureInitialized();
  await AdMob.showPrivacyOptionsForm();
}

/** @returns {Promise<boolean>} true if the ad actually showed. */
export async function showInterstitial() {
  await ensureInitialized();
  try {
    await AdMob.prepareInterstitial({ adId: AD_UNITS.INTERSTITIAL });
    await AdMob.showInterstitial();
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<boolean>} true if the reward was earned.
 *
 * `showRewardVideoAd()`'s own promise settles on native SDK quirks that
 * differ enough between "dismissed early" and "failed to show" that the
 * plugin's events are the more reliable source of truth here — `Rewarded`
 * fires before `Dismissed` when the reward is earned, never after.
 */
export function showRewarded() {
  return new Promise((resolve) => {
    let earned = false;
    let rewardedHandle;
    let dismissedHandle;
    let failedHandle;

    const finish = (value) => {
      rewardedHandle?.then((h) => h.remove());
      dismissedHandle?.then((h) => h.remove());
      failedHandle?.then((h) => h.remove());
      resolve(value);
    };

    ensureInitialized()
      .then(() => {
        rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; });
        dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(earned));
        failedHandle = AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false));
        return AdMob.prepareRewardVideoAd({ adId: AD_UNITS.REWARDED });
      })
      .then(() => AdMob.showRewardVideoAd())
      .catch(() => finish(false));
  });
}
