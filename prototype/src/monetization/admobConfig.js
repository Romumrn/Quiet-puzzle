/**
 * AdMob ad unit IDs, for the packaged Android app only (see admob.js). The
 * App ID itself lives in mobile/android/app/src/main/AndroidManifest.xml.
 *
 * REWARDED is the real ad unit (AdMob console → Quiet Puzzle → Ad units).
 * INTERSTITIAL is still Google's public TEST unit — replace it the same way
 * once an interstitial ad unit is created there; until then it only ever
 * serves Google's own sample ad, which is fine since nothing in the current
 * scope asked for a real interstitial, only rewarded ads.
 */
export const AD_UNITS = {
  REWARDED: 'ca-app-pub-7234951269462523/9192078780',
  INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
};
