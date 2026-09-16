/**
 * Real AdMob rewarded/interstitial/banner ads, for the packaged Android app.
 *
 * Only imported and called from brokerManager.js when `isNative()` — the
 * published web site never touches this module's methods (see the simulated
 * `_play()` there, and the plain placeholder `<div>` for the banner, kept for
 * browser development and testing).
 */

import {
  AdMob, RewardAdPluginEvents, AdmobConsentStatus, BannerAdSize, BannerAdPosition,
} from '../../vendor/capacitor-admob.esm.js';
import { AD_UNITS } from './admobConfig.js';

let ready = null;
let bannerLoaded = false; // showBanner() vs resumeBanner(): the plugin only accepts the former once

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
    })().catch((e) => {
      // A rejected promise must not be cached: the first attempt failing
      // (no network yet at cold start, a UMP form hiccup) used to disable
      // every ad — interstitial and rewarded alike — for the rest of the
      // session, with nothing retrying it. Clearing `ready` lets the next
      // ad request try again instead of reusing a dead promise forever.
      ready = null;
      throw e;
    });
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

/**
 * Shows the real bottom banner. Safe to call repeatedly (e.g. once per
 * screen change): the plugin's own `showBanner()` creates the native view,
 * so later calls resume the same view instead of creating a second one.
 */
export async function showBanner() {
  await ensureInitialized();
  try {
    if (bannerLoaded) {
      await AdMob.resumeBanner();
      return;
    }
    await AdMob.showBanner({
      adId: AD_UNITS.BANNER,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
    });
    bannerLoaded = true;
  } catch {
    bannerLoaded = false;
  }
}

/** Hides the banner without destroying it — cheaper to bring back than a fresh showBanner(). */
export async function hideBanner() {
  if (!bannerLoaded) return;
  try {
    await AdMob.hideBanner();
  } catch {
    // Already gone (e.g. never actually loaded): nothing to hide.
  }
}
