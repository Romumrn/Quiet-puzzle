/**
 * Real AdMob rewarded/interstitial/banner ads, for the packaged Android app.
 *
 * Only imported and called from brokerManager.js when `isNative()` — the
 * published web site never touches this module's methods (see the simulated
 * `_play()` there, and the plain placeholder `<div>` for the banner, kept for
 * browser development and testing).
 */

import {
  AdMob, RewardAdPluginEvents, AdmobConsentStatus, BannerAdSize, BannerAdPosition, BannerAdPluginEvents,
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

/** How long an interstitial may take to load before the level opens without it. */
const INTERSTITIAL_LOAD_MS = 5000;

/**
 * @returns {Promise<boolean>} true if the ad actually showed. Never rejects:
 * the level waits on it. `ensureInitialized()` used to sit outside the `try`,
 * so a consent/initialize failure (the app not yet live on the Play Store)
 * rejected through `startLevel()` after the result screen was already hidden —
 * "Replay" left the won, empty board frozen on screen. Loading is also capped:
 * a request that never settles must not hold the level hostage either.
 */
export async function showInterstitial(onLoaded) {
  try {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('interstitial load timeout')), INTERSTITIAL_LOAD_MS);
    });
    await Promise.race([
      ensureInitialized().then(() => AdMob.prepareInterstitial({ adId: AD_UNITS.INTERSTITIAL })),
      timeout,
    ]).finally(() => clearTimeout(timer));
    onLoaded?.();
    await AdMob.showInterstitial();
    return true;
  } catch {
    return false;
  }
}

/** How long a rewarded video may take to load before we give up and say so. */
const REWARDED_LOAD_MS = 10000;

/**
 * @param {() => void} [onLoaded] called once the video has loaded, just before
 *   it plays — the caller's "loading" veil comes down then.
 * @returns {Promise<boolean>} true if the reward was earned.
 *
 * `showRewardVideoAd()`'s own promise settles on native SDK quirks that
 * differ enough between "dismissed early" and "failed to show" that the
 * plugin's events are the more reliable source of truth here — `Rewarded`
 * fires before `Dismissed` when the reward is earned, never after.
 *
 * Loading (consent, then the video itself) is capped: past REWARDED_LOAD_MS
 * the promise settles false, and a video that arrives later is not played —
 * the player had been left staring at a button that seemed to do nothing.
 */
export function showRewarded(onLoaded) {
  return new Promise((resolve) => {
    let earned = false;
    let settled = false;
    let rewardedHandle;
    let dismissedHandle;
    let failedHandle;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rewardedHandle?.then((h) => h.remove());
      dismissedHandle?.then((h) => h.remove());
      failedHandle?.then((h) => h.remove());
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), REWARDED_LOAD_MS);

    ensureInitialized()
      .then(() => {
        rewardedHandle = AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; });
        dismissedHandle = AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(earned));
        failedHandle = AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false));
        return AdMob.prepareRewardVideoAd({ adId: AD_UNITS.REWARDED });
      })
      .then(() => {
        if (settled) return;
        clearTimeout(timer);
        onLoaded?.();
        return AdMob.showRewardVideoAd();
      })
      .catch(() => finish(false));
  });
}

/**
 * The plugin has ONE banner view, placed when it is created: a later
 * `showBanner()` only reloads it where it already is. The menu's sits at the
 * bottom of the screen; the result card's in the slot under its buttons, so
 * moving between the two removes the view and creates it again. Calls are
 * chained: a hide and a show sent back to back must reach the plugin in order.
 */
let bannerAt = null;
const BANNER_HEIGHT = 50; // BannerAdSize.BANNER is 320×50 dp
let queue = Promise.resolve();
const chained = (fn) => (queue = queue.then(fn, fn));

/**
 * `removeBanner()` resolves BEFORE the view is gone: the plugin posts the
 * removal to the UI thread and answers at once. A `showBanner()` sent right
 * after still found the old view, merely reloaded it — and the removal then
 * destroyed it: the result card's slot stayed empty (1.12, seen on device).
 * The removal's own "size 0" event says it really happened.
 */
async function removeBannerAndWait() {
  let done;
  const gone = new Promise((r) => { done = r; });
  const sub = await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (s) => { if (!s?.height) done(); });
  try {
    await AdMob.removeBanner();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 1000))]);
  } finally {
    sub.remove();
  }
}

// A banner that found no ad is destroyed by the plugin: the next show must
// create one again, not resume a view that no longer exists.
let failWatch = null;
const watchBannerFailures = () => {
  failWatch ??= AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => { bannerLoaded = false; });
};

/**
 * @param {number|null} top distance from the top of the screen, in CSS px
 *   (= dp in the WebView), to show a 320×50 banner there; null for the
 *   full-width banner at the bottom.
 */
export function showBanner(top = null) {
  return chained(async () => {
    // The plugin applies `margin` to BOTH the top and the bottom of the view:
    // a slot 616 dp down on an 873 dp screen asked for 616 + 616 dp of margin
    // and Android squeezed the banner to 0 px high (1.12, seen on device). So
    // the margin is taken from the nearer edge: the bottom for a slot in the
    // lower half, as the result card's is.
    const fromBottom = top == null ? 0 : Math.round(window.innerHeight - top - BANNER_HEIGHT);
    const at = top == null ? 'bottom'
      : fromBottom < top ? `b${fromBottom}` : `t${Math.round(top)}`;
    try {
      await ensureInitialized();
      watchBannerFailures();
      if (bannerLoaded && bannerAt === at) {
        await AdMob.resumeBanner();
        return;
      }
      if (bannerLoaded) await removeBannerAndWait();
      bannerLoaded = false;
      await AdMob.showBanner(at === 'bottom'
        ? { adId: AD_UNITS.BANNER, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER }
        : {
          adId: AD_UNITS.BANNER, adSize: BannerAdSize.BANNER, margin: Number(at.slice(1)),
          position: at[0] === 'b' ? BannerAdPosition.BOTTOM_CENTER : BannerAdPosition.TOP_CENTER,
        });
      bannerLoaded = true;
      bannerAt = at;
    } catch {
      bannerLoaded = false;
    }
  });
}

/** Hides the banner without destroying it — cheaper to bring back than a fresh showBanner(). */
export function hideBanner() {
  return chained(async () => {
    if (!bannerLoaded) return;
    try {
      await AdMob.hideBanner();
    } catch {
      // Already gone (e.g. never actually loaded): nothing to hide.
    }
  });
}
